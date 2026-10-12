import { describe, expect, it } from 'vitest';
import { borderFactorForNode, borderWidthFactorForValue } from './borderWeight';
import { authoredDegrees } from './nodeWeight';
import { makeGraph } from './testFixtures';
import type { NodeData } from '../../types/node';

const MIB = 1024 * 1024;

// Explicit settings throughout, so the shipped defaults can change without
// breaking these cases.
const SETTINGS = {
	reference: MIB,
	widthPerDoubling: 0.15,
	minFactor: 0.5,
	maxFactor: 3
};

describe('borderWidthFactorForValue', () => {
	it('draws exactly the configured border at the reference size', () => {
		expect(borderWidthFactorForValue(MIB, SETTINGS)).toBe(1);
	});

	it('adds widthPerDoubling for twice the reference and removes it for half', () => {
		expect(borderWidthFactorForValue(2 * MIB, SETTINGS)).toBeCloseTo(1.15, 12);
		expect(borderWidthFactorForValue(MIB / 2, SETTINGS)).toBeCloseTo(0.85, 12);
	});

	it('follows widthPerDoubling rather than a fixed slope', () => {
		const settings = { ...SETTINGS, widthPerDoubling: 0.25 };
		expect(borderWidthFactorForValue(4 * MIB, settings)).toBeCloseTo(1.5, 12);
	});

	it('floors far-below-reference sizes at minFactor', () => {
		expect(borderWidthFactorForValue(1, SETTINGS)).toBe(0.5);
		expect(borderWidthFactorForValue(10 * 1024, SETTINGS)).toBe(0.5);
	});

	it('caps far-above-reference sizes at maxFactor', () => {
		expect(borderWidthFactorForValue(1e15, SETTINGS)).toBe(3);
	});

	it('lands between the bounds for a mid-range size', () => {
		// 100 MiB: 1 + 0.15 * log2(100) ≈ 1.9966.
		expect(borderWidthFactorForValue(100 * MIB, SETTINGS)).toBeCloseTo(
			1 + 0.15 * Math.log2(100),
			12
		);
	});

	it.each([
		['undefined', undefined],
		['NaN', Number.NaN],
		['Infinity', Number.POSITIVE_INFINITY],
		['-Infinity', Number.NEGATIVE_INFINITY],
		['a negative value', -2048]
	])('treats %s as no value (factor 1)', (_label, value) => {
		expect(borderWidthFactorForValue(value, SETTINGS)).toBe(1);
	});

	it.each([
		['reference 0', { reference: 0 }],
		['a negative reference', { reference: -MIB }],
		['reference NaN', { reference: Number.NaN }],
		['reference Infinity', { reference: Number.POSITIVE_INFINITY }],
		['widthPerDoubling NaN', { widthPerDoubling: Number.NaN }],
		['widthPerDoubling Infinity', { widthPerDoubling: Number.POSITIVE_INFINITY }],
		['a NaN bound', { minFactor: Number.NaN }]
	])('returns 1 for a degenerate setting: %s', (_label, override) => {
		expect(borderWidthFactorForValue(100 * MIB, { ...SETTINGS, ...override })).toBe(1);
	});

	it('clamps to the crossed bounds whichever way round they are given', () => {
		const crossed = { ...SETTINGS, minFactor: 2, maxFactor: 1.5 };
		expect(borderWidthFactorForValue(1, crossed)).toBe(1.5);
		expect(borderWidthFactorForValue(1e15, crossed)).toBe(2);
		// The reference size sits below both bounds, so it floors at the lower.
		expect(borderWidthFactorForValue(MIB, crossed)).toBe(1.5);
	});

	it('draws a flat border when widthPerDoubling is 0', () => {
		const flat = { ...SETTINGS, widthPerDoubling: 0 };
		expect(borderWidthFactorForValue(1, flat)).toBe(1);
		expect(borderWidthFactorForValue(1e15, flat)).toBe(1);
	});

	it('fills missing slope and bounds from the shipped defaults', () => {
		expect(borderWidthFactorForValue(MIB, { reference: MIB })).toBe(1);
		expect(borderWidthFactorForValue(MIB, { reference: MIB, widthPerDoubling: 0.5 })).toBe(1);
		expect(
			borderWidthFactorForValue(2 * MIB, { reference: MIB, widthPerDoubling: 0.5 })
		).toBeCloseTo(1.5, 12);
	});

	// A real 0 (an isolated node under edge count, an empty description) is the
	// least there can be, so it draws the thinnest border rather than the normal one.
	it('draws a value of 0 at the floor', () => {
		expect(borderWidthFactorForValue(0, SETTINGS)).toBe(0.5);
	});

	it('draws a value of 0 at the lower of crossed bounds', () => {
		expect(borderWidthFactorForValue(0, { ...SETTINGS, minFactor: 2, maxFactor: 1.5 })).toBe(1.5);
	});

	it('draws a value of 0 at 1 when widthPerDoubling is 0', () => {
		expect(borderWidthFactorForValue(0, { ...SETTINGS, widthPerDoubling: 0 })).toBe(1);
	});
});

describe('borderFactorForNode', () => {
	const BORDER_WEIGHT = { widthPerDoubling: 0.15, minFactor: 0.5, maxFactor: 3 };
	const REFERENCE = {
		size: MIB,
		weight: 1,
		degree: 3,
		attachments: 1,
		descriptionLength: 200
	};
	const NO_DEGREES: ReadonlyMap<string, number> = new Map();

	function node(overrides: Partial<NodeData> = {}): NodeData {
		return { id: 'n', title: 'Node', description: '', tags: [], ...overrides };
	}

	const factor = (subject: NodeData, source: string, degrees = NO_DEGREES) =>
		borderFactorForNode(subject, degrees, { source, ...BORDER_WEIGHT }, REFERENCE);

	it.each(['none', 'bogus', 'toString'])('draws the configured border under %s', (source) => {
		const busy = node({ sizeBytes: 100 * MIB, weight: 50, description: 'x'.repeat(5000) });
		expect(factor(busy, source)).toBe(1);
	});

	it('scales a 2 MiB node by one doubling under size', () => {
		expect(factor(node({ sizeBytes: 2 * MIB }), 'size')).toBeCloseTo(1.15, 12);
	});

	it('draws a 0-byte node as unknown under size', () => {
		expect(factor(node({ sizeBytes: 0 }), 'size')).toBe(1);
	});

	it('scales a node of five edges against a reference of three under degree', () => {
		const graph = makeGraph({
			nodeCount: 6,
			edges: [
				[0, 1],
				[0, 2],
				[0, 3],
				[0, 4],
				[0, 5]
			]
		});
		const hub = graph.nodes[0];
		if (hub === undefined) throw new Error('hub missing');

		expect(factor(hub, 'degree', authoredDegrees(graph.edges))).toBeCloseTo(
			1 + 0.15 * Math.log2(5 / 3),
			12
		);
	});

	it('draws an isolated node at the floor under degree', () => {
		expect(factor(node(), 'degree')).toBe(0.5);
	});

	it('draws a weight of 0 at the floor and no weight as-is', () => {
		expect(factor(node({ weight: 0 }), 'weight')).toBe(0.5);
		expect(factor(node(), 'weight')).toBe(1);
	});

	it('reads the reference from the selected source', () => {
		const subject = node({ sizeBytes: 4 * MIB, weight: 4, description: 'x'.repeat(400) });
		const reference = { ...REFERENCE, weight: 2, descriptionLength: 100 };
		const under = (source: string) =>
			borderFactorForNode(subject, NO_DEGREES, { source, ...BORDER_WEIGHT }, reference);

		// size: 4 MiB / 1 MiB is two doublings; weight: 4 / 2 is one;
		// descriptionLength: 400 / 100 is two.
		expect(under('size')).toBeCloseTo(1.3, 12);
		expect(under('weight')).toBeCloseTo(1.15, 12);
		expect(under('descriptionLength')).toBeCloseTo(1.3, 12);
	});

	it('follows the slope and bounds it is given', () => {
		const steep = borderFactorForNode(
			node({ weight: 1e9 }),
			NO_DEGREES,
			{ source: 'weight', widthPerDoubling: 0.5, minFactor: 0.25, maxFactor: 2 },
			REFERENCE
		);
		expect(steep).toBe(2);
	});
});
