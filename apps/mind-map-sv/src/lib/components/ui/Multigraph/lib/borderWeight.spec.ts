import { describe, expect, it } from 'vitest';
import { borderFactorForNode, linearBorderFactor, logBorderFactor } from './borderWeight';
import { authoredDegrees, type BorderInputs } from './nodeWeight';
import { makeGraph } from './testFixtures';
import type { GraphAssetMetadata } from '../../types/multigraph';
import type { NodeData } from '../../types/node';

const MIB = 1024 * 1024;

// Explicit settings throughout, so the shipped defaults can change without
// breaking these cases.
const BOUNDS = { minFactor: 0.5, maxFactor: 3 };
const LOG_SETTINGS = { reference: MIB, widthPerDoubling: 0.15, ...BOUNDS };
const LINEAR_SETTINGS = { reference: 3, ...BOUNDS };

const UNDRAWABLE_VALUES: Array<[string, number | undefined]> = [
	['undefined', undefined],
	['NaN', Number.NaN],
	['Infinity', Number.POSITIVE_INFINITY],
	['-Infinity', Number.NEGATIVE_INFINITY],
	['a negative value', -2]
];

const DEGENERATE_REFERENCES: Array<[string, number]> = [
	['reference 0', 0],
	['a negative reference', -1],
	['reference NaN', Number.NaN],
	['reference Infinity', Number.POSITIVE_INFINITY]
];

describe('linearBorderFactor', () => {
	it('draws exactly the configured border at the reference', () => {
		expect(linearBorderFactor(3, LINEAR_SETTINGS)).toBe(1);
	});

	it('is proportional to the value between the bounds', () => {
		expect(linearBorderFactor(6, LINEAR_SETTINGS)).toBe(2);
		expect(linearBorderFactor(4.5, LINEAR_SETTINGS)).toBe(1.5);
		expect(linearBorderFactor(2, { reference: 1, ...BOUNDS })).toBe(2);
	});

	it('floors values far below the reference at minFactor', () => {
		expect(linearBorderFactor(1, LINEAR_SETTINGS)).toBe(0.5);
	});

	it('caps values far above the reference at maxFactor', () => {
		expect(linearBorderFactor(8, { reference: 1, ...BOUNDS })).toBe(3);
		expect(linearBorderFactor(1e15, LINEAR_SETTINGS)).toBe(3);
	});

	// A real 0 (an isolated node under edge count, a weight of 0) is the least
	// there can be, so it draws the thinnest border rather than the normal one.
	it('draws a value of 0 at the floor', () => {
		expect(linearBorderFactor(0, LINEAR_SETTINGS)).toBe(0.5);
	});

	it.each(UNDRAWABLE_VALUES)('treats %s as no value (factor 1)', (_label, value) => {
		expect(linearBorderFactor(value, LINEAR_SETTINGS)).toBe(1);
	});

	it.each(DEGENERATE_REFERENCES)('returns 1 for a degenerate %s', (_label, reference) => {
		expect(linearBorderFactor(6, { ...LINEAR_SETTINGS, reference })).toBe(1);
	});

	it('returns 1 for a NaN bound', () => {
		expect(linearBorderFactor(6, { ...LINEAR_SETTINGS, minFactor: Number.NaN })).toBe(1);
	});

	it('clamps to the crossed bounds whichever way round they are given', () => {
		const crossed = { ...LINEAR_SETTINGS, minFactor: 2, maxFactor: 1.5 };
		expect(linearBorderFactor(0, crossed)).toBe(1.5);
		expect(linearBorderFactor(1e15, crossed)).toBe(2);
		expect(linearBorderFactor(3, crossed)).toBe(1.5);
	});

	it('fills missing bounds from the shipped defaults', () => {
		expect(linearBorderFactor(3, { reference: 3 })).toBe(1);
		expect(linearBorderFactor(6, { reference: 3 })).toBe(2);
	});
});

describe('logBorderFactor', () => {
	it('draws exactly the configured border at the reference', () => {
		expect(logBorderFactor(MIB, LOG_SETTINGS)).toBe(1);
	});

	it('adds widthPerDoubling for twice the reference and removes it for half', () => {
		expect(logBorderFactor(2 * MIB, LOG_SETTINGS)).toBeCloseTo(1.15, 12);
		expect(logBorderFactor(MIB / 2, LOG_SETTINGS)).toBeCloseTo(0.85, 12);
	});

	it('follows widthPerDoubling rather than a fixed slope', () => {
		expect(logBorderFactor(4 * MIB, { ...LOG_SETTINGS, widthPerDoubling: 0.25 })).toBeCloseTo(
			1.5,
			12
		);
	});

	it('floors far-below-reference values at minFactor', () => {
		expect(logBorderFactor(1, LOG_SETTINGS)).toBe(0.5);
		expect(logBorderFactor(10 * 1024, LOG_SETTINGS)).toBe(0.5);
	});

	it('caps far-above-reference values at maxFactor', () => {
		expect(logBorderFactor(1e15, LOG_SETTINGS)).toBe(3);
	});

	it('lands between the bounds for a mid-range value', () => {
		// 100 MiB: 1 + 0.15 * log2(100) ≈ 1.9966.
		expect(logBorderFactor(100 * MIB, LOG_SETTINGS)).toBeCloseTo(1 + 0.15 * Math.log2(100), 12);
	});

	it('draws a value of 0 at the floor', () => {
		expect(logBorderFactor(0, LOG_SETTINGS)).toBe(0.5);
	});

	it('draws a value of 0 at the lower of crossed bounds', () => {
		expect(logBorderFactor(0, { ...LOG_SETTINGS, minFactor: 2, maxFactor: 1.5 })).toBe(1.5);
	});

	it('draws a value of 0 at 1 when widthPerDoubling is 0', () => {
		expect(logBorderFactor(0, { ...LOG_SETTINGS, widthPerDoubling: 0 })).toBe(1);
	});

	it.each(UNDRAWABLE_VALUES)('treats %s as no value (factor 1)', (_label, value) => {
		expect(logBorderFactor(value, LOG_SETTINGS)).toBe(1);
	});

	it.each(DEGENERATE_REFERENCES)('returns 1 for a degenerate %s', (_label, reference) => {
		expect(logBorderFactor(100 * MIB, { ...LOG_SETTINGS, reference })).toBe(1);
	});

	it.each([
		['widthPerDoubling NaN', { widthPerDoubling: Number.NaN }],
		['widthPerDoubling Infinity', { widthPerDoubling: Number.POSITIVE_INFINITY }],
		['a NaN bound', { minFactor: Number.NaN }]
	])('returns 1 for a degenerate setting: %s', (_label, override) => {
		expect(logBorderFactor(100 * MIB, { ...LOG_SETTINGS, ...override })).toBe(1);
	});

	it('clamps to the crossed bounds whichever way round they are given', () => {
		const crossed = { ...LOG_SETTINGS, minFactor: 2, maxFactor: 1.5 };
		expect(logBorderFactor(1, crossed)).toBe(1.5);
		expect(logBorderFactor(1e15, crossed)).toBe(2);
		// The reference sits below both bounds, so it floors at the lower.
		expect(logBorderFactor(MIB, crossed)).toBe(1.5);
	});

	it('draws a flat border when widthPerDoubling is 0', () => {
		const flat = { ...LOG_SETTINGS, widthPerDoubling: 0 };
		expect(logBorderFactor(1, flat)).toBe(1);
		expect(logBorderFactor(1e15, flat)).toBe(1);
	});

	it('fills missing slope and bounds from the shipped defaults', () => {
		expect(logBorderFactor(MIB, { reference: MIB })).toBe(1);
		expect(logBorderFactor(MIB, { reference: MIB, widthPerDoubling: 0.5 })).toBe(1);
		expect(logBorderFactor(2 * MIB, { reference: MIB, widthPerDoubling: 0.5 })).toBeCloseTo(
			1.5,
			12
		);
	});
});

describe('borderFactorForNode', () => {
	const BORDER_WEIGHT = { widthPerDoubling: 0.15, ...BOUNDS };
	const REFERENCE = { weight: 1, degree: 3, attachmentBytes: MIB, descriptionLength: 200 };
	const NO_INPUTS: BorderInputs = { degrees: new Map(), assets: {} };

	function node(overrides: Partial<NodeData> = {}): NodeData {
		return { id: 'n', title: 'Node', description: '', tags: [], ...overrides };
	}

	function asset(id: string, size: number): GraphAssetMetadata {
		return { id, kind: 'file', mimeType: 'application/pdf', size, createdAt: 0 };
	}

	const factor = (subject: NodeData, source: string, inputs = NO_INPUTS) =>
		borderFactorForNode(subject, inputs, { source, ...BORDER_WEIGHT }, REFERENCE);

	it.each(['none', 'bogus', 'toString', 'size', 'attachments'])(
		'draws the configured border under %j',
		(source) => {
			const busy = node({
				sizeBytes: 100 * MIB,
				weight: 50,
				description: 'x'.repeat(5000),
				content: [{ type: 'file', assetId: 'a', name: 'a.pdf' }]
			});
			expect(
				factor(busy, source, { degrees: new Map([['n', 9]]), assets: { a: asset('a', 1e9) } })
			).toBe(1);
		}
	);

	describe('weight (linear)', () => {
		it('draws twice the reference weight at twice the border', () => {
			expect(factor(node({ weight: 2 }), 'weight')).toBe(2);
		});

		it('caps a weight far above the reference at maxFactor', () => {
			expect(factor(node({ weight: 8 }), 'weight')).toBe(3);
		});

		it('draws a weight of 0 at the floor and no weight as-is', () => {
			expect(factor(node({ weight: 0 }), 'weight')).toBe(0.5);
			expect(factor(node(), 'weight')).toBe(1);
		});

		it('ignores widthPerDoubling', () => {
			const steep = borderFactorForNode(
				node({ weight: 2 }),
				NO_INPUTS,
				{ source: 'weight', ...BORDER_WEIGHT, widthPerDoubling: 0.5 },
				REFERENCE
			);
			expect(steep).toBe(2);
		});
	});

	describe('degree (linear)', () => {
		it('draws a node of six edges at twice a reference of three', () => {
			const graph = makeGraph({
				nodeCount: 7,
				edges: [
					[0, 1],
					[0, 2],
					[0, 3],
					[0, 4],
					[0, 5],
					[0, 6]
				]
			});
			const hub = graph.nodes[0];
			if (hub === undefined) throw new Error('hub missing');
			const inputs = { degrees: authoredDegrees(graph.edges), assets: {} };

			expect(factor(hub, 'degree', inputs)).toBe(2);
		});

		it('draws a node at the reference count at the normal border', () => {
			expect(factor(node(), 'degree', { degrees: new Map([['n', 3]]), assets: {} })).toBe(1);
		});

		it('draws an isolated node at the floor', () => {
			expect(factor(node(), 'degree')).toBe(0.5);
		});
	});

	describe('attachmentBytes (logarithmic)', () => {
		it('sums every attachment, images and files alike', () => {
			const subject = node({
				content: [
					{ type: 'image', assetId: 'img', alt: 'A chart' },
					{ type: 'file', assetId: 'doc', name: 'notes.pdf' }
				]
			});
			const assets = { img: asset('img', MIB), doc: asset('doc', 3 * MIB) };

			// 4 MiB against 1 MiB is two doublings.
			expect(factor(subject, 'attachmentBytes', { degrees: new Map(), assets })).toBeCloseTo(
				1.3,
				12
			);
		});

		it('draws a node with no attachments at the floor', () => {
			expect(factor(node(), 'attachmentBytes')).toBe(0.5);
		});

		it('ignores sizeBytes, which is not an attachment', () => {
			expect(factor(node({ sizeBytes: 100 * MIB }), 'attachmentBytes')).toBe(0.5);
		});
	});

	describe('descriptionLength (logarithmic)', () => {
		it('scales by doublings of the reference length', () => {
			expect(factor(node({ description: 'x'.repeat(200) }), 'descriptionLength')).toBe(1);
			expect(factor(node({ description: 'x'.repeat(800) }), 'descriptionLength')).toBeCloseTo(
				1.3,
				12
			);
		});

		it('draws an empty description at the floor', () => {
			expect(factor(node(), 'descriptionLength')).toBe(0.5);
		});
	});

	it('reads the reference from the selected source', () => {
		const subject = node({ weight: 4, description: 'x'.repeat(400) });
		const reference = { ...REFERENCE, weight: 2, descriptionLength: 100 };
		const under = (source: string) =>
			borderFactorForNode(subject, NO_INPUTS, { source, ...BORDER_WEIGHT }, reference);

		// weight: 4 / 2 is ×2 linearly; descriptionLength: 400 / 100 is two doublings.
		expect(under('weight')).toBe(2);
		expect(under('descriptionLength')).toBeCloseTo(1.3, 12);
	});

	it('follows the bounds it is given', () => {
		const capped = borderFactorForNode(
			node({ weight: 1e9 }),
			NO_INPUTS,
			{ source: 'weight', widthPerDoubling: 0.5, minFactor: 0.25, maxFactor: 2 },
			REFERENCE
		);
		expect(capped).toBe(2);
	});
});
