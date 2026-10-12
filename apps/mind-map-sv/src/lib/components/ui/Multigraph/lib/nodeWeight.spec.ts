import { describe, expect, it } from 'vitest';
import {
	authoredDegrees,
	formatNodeWeight,
	type BorderInputs,
	nodeBorderValue,
	weightFromDraft,
	weightName
} from './nodeWeight';
import { derivedEdgeId } from './derivedEdges';
import { makeGraph } from './testFixtures';
import type { GraphAssetMetadata } from '../../types/multigraph';
import type { NodeContentBlock, NodeData } from '../../types/node';

const NO_INPUTS: BorderInputs = { degrees: new Map(), assets: {} };

function asset(id: string, size: number, kind: 'image' | 'file' = 'file'): GraphAssetMetadata {
	return { id, kind, mimeType: kind === 'image' ? 'image/png' : 'text/plain', size, createdAt: 0 };
}

function node(overrides: Partial<NodeData> = {}): NodeData {
	return { id: 'n', title: 'Node', description: '', tags: [], ...overrides };
}

const FILE_BLOCK: NodeContentBlock = { type: 'file', assetId: 'a1', name: 'notes.pdf' };

describe('authoredDegrees', () => {
	it('gives the hub of a five-edge star 5 and each leaf 1', () => {
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

		const degrees = authoredDegrees(graph.edges);

		expect(degrees.get('n0')).toBe(5);
		for (const leaf of ['n1', 'n2', 'n3', 'n4', 'n5']) expect(degrees.get(leaf)).toBe(1);
	});

	it('counts directed and undirected edges the same, from either end', () => {
		const graph = makeGraph({
			nodeCount: 3,
			edges: [
				{ source: 0, target: 1, directed: true },
				{ source: 2, target: 0, directed: true },
				{ source: 0, target: 2, directed: false }
			]
		});

		const degrees = authoredDegrees(graph.edges);

		expect(degrees.get('n0')).toBe(3);
		expect(degrees.get('n1')).toBe(1);
		expect(degrees.get('n2')).toBe(2);
	});

	it('counts each of two parallel edges', () => {
		const graph = makeGraph({
			nodeCount: 2,
			edges: [
				{ id: 'p1', source: 0, target: 1 },
				{ id: 'p2', source: 0, target: 1 }
			]
		});

		const degrees = authoredDegrees(graph.edges);

		expect(degrees.get('n0')).toBe(2);
		expect(degrees.get('n1')).toBe(2);
	});

	it('counts a self-loop once', () => {
		const graph = makeGraph({ nodeCount: 1, edges: [[0, 0]] });

		expect(authoredDegrees(graph.edges).get('n0')).toBe(1);
	});

	it('skips a derived dataflow edge even when one is passed in', () => {
		const graph = makeGraph({
			nodeCount: 2,
			edges: [{ id: derivedEdgeId('n0', 'n1'), source: 0, target: 1, directed: true }]
		});

		const degrees = authoredDegrees(graph.edges);

		expect(degrees.get('n0') ?? 0).toBe(0);
		expect(degrees.get('n1') ?? 0).toBe(0);
	});
});

describe('nodeBorderValue', () => {
	describe('weight', () => {
		it('reads weight', () => {
			expect(nodeBorderValue(node({ weight: 12.5 }), 'weight', NO_INPUTS)).toBe(12.5);
		});

		it('keeps a stored 0 as a real value', () => {
			expect(nodeBorderValue(node({ weight: 0 }), 'weight', NO_INPUTS)).toBe(0);
		});

		it('has no value when the weight is absent', () => {
			expect(nodeBorderValue(node(), 'weight', NO_INPUTS)).toBeUndefined();
		});
	});

	describe('degree', () => {
		it('reads the node’s count from the degree map', () => {
			const inputs = { ...NO_INPUTS, degrees: new Map([['n', 4]]) };
			expect(nodeBorderValue(node(), 'degree', inputs)).toBe(4);
		});

		it('reads a node missing from the map as 0', () => {
			const inputs = { ...NO_INPUTS, degrees: new Map([['other', 9]]) };
			expect(nodeBorderValue(node(), 'degree', inputs)).toBe(0);
		});
	});

	describe('attachmentBytes', () => {
		it('sums the sizes of every attached asset, images and files alike', () => {
			const withFiles = node({
				content: [FILE_BLOCK, { type: 'image', assetId: 'a2', alt: 'A chart' }]
			});
			const assets = {
				a1: asset('a1', 1000),
				a2: asset('a2', 24, 'image'),
				other: asset('other', 7)
			};
			expect(nodeBorderValue(withFiles, 'attachmentBytes', { ...NO_INPUTS, assets })).toBe(1024);
		});

		it('counts an asset twice when two blocks show it', () => {
			const twice = node({ content: [FILE_BLOCK, FILE_BLOCK] });
			const assets = { a1: asset('a1', 512) };
			expect(nodeBorderValue(twice, 'attachmentBytes', { ...NO_INPUTS, assets })).toBe(1024);
		});

		it('reads a node with no content as 0', () => {
			expect(nodeBorderValue(node(), 'attachmentBytes', NO_INPUTS)).toBe(0);
			expect(nodeBorderValue(node({ content: [] }), 'attachmentBytes', NO_INPUTS)).toBe(0);
		});

		it('adds nothing for a block whose asset has no metadata, or bad metadata', () => {
			const subject = node({
				content: [
					FILE_BLOCK,
					{ type: 'file', assetId: 'missing', name: 'gone.pdf' },
					{ type: 'file', assetId: 'toString', name: 'proto.pdf' },
					{ type: 'file', assetId: 'nan', name: 'nan.pdf' },
					{ type: 'file', assetId: 'negative', name: 'negative.pdf' }
				]
			});
			const assets = {
				a1: asset('a1', 300),
				nan: asset('nan', Number.NaN),
				negative: asset('negative', -50)
			};
			expect(nodeBorderValue(subject, 'attachmentBytes', { ...NO_INPUTS, assets })).toBe(300);
		});

		it('ignores sizeBytes, which describes the thing the node stands for', () => {
			expect(nodeBorderValue(node({ sizeBytes: 2048 }), 'attachmentBytes', NO_INPUTS)).toBe(0);
		});
	});

	describe('descriptionLength', () => {
		it('counts the raw stored text, untrimmed', () => {
			const described = node({ description: '  $x^2$ ' });
			expect(nodeBorderValue(described, 'descriptionLength', NO_INPUTS)).toBe(8);
		});

		it('reads an empty description as 0', () => {
			expect(nodeBorderValue(node(), 'descriptionLength', NO_INPUTS)).toBe(0);
		});
	});

	// `size` and `attachments` were sources until 2026-10-12; they read nothing now.
	it.each([['none'], ['size'], ['attachments'], ['bogus'], ['toString'], ['']])(
		'has no value under %j, whatever the node carries',
		(source) => {
			const loaded = node({
				sizeBytes: 2048,
				weight: 3,
				content: [FILE_BLOCK],
				description: 'text'
			});
			const inputs = { degrees: new Map([['n', 2]]), assets: { a1: asset('a1', 4096) } };
			expect(nodeBorderValue(loaded, source, inputs)).toBeUndefined();
		}
	);
});

describe('formatNodeWeight', () => {
	it('labels the value with the graph’s label and groups thousands', () => {
		expect(formatNodeWeight(4200, { label: 'Word count' })).toEqual({
			label: 'Word count',
			text: '4,200'
		});
	});

	it('appends the unit after the value', () => {
		expect(formatNodeWeight(12.5, { label: 'Mass', unit: 'kg' })).toEqual({
			label: 'Mass',
			text: '12.5 kg'
		});
	});

	it('falls back to "Weight" when the graph names nothing', () => {
		expect(formatNodeWeight(7, undefined)).toEqual({ label: 'Weight', text: '7' });
	});

	it('shows a stored 0', () => {
		expect(formatNodeWeight(0, undefined)).toEqual({ label: 'Weight', text: '0' });
	});

	it('rounds to at most two decimals', () => {
		expect(formatNodeWeight(1 / 3, undefined).text).toBe('0.33');
	});
});

describe('weightName', () => {
	it('uses the graph’s label and unit', () => {
		expect(weightName({ label: 'Mass', unit: 'kg' })).toEqual({ label: 'Mass', unit: 'kg' });
	});

	it('has no unit when the graph gives only a label', () => {
		expect(weightName({ label: 'Word count' })).toEqual({ label: 'Word count', unit: undefined });
	});

	it('falls back to "Weight" with no unit when the graph names nothing', () => {
		expect(weightName(undefined)).toEqual({ label: 'Weight', unit: undefined });
	});
});

describe('weightFromDraft', () => {
	it('reads a number as the weight to set', () => {
		expect(weightFromDraft('5')).toBe(5);
		expect(weightFromDraft(' 12.5 ')).toBe(12.5);
	});

	it('keeps 0 as a real weight', () => {
		expect(weightFromDraft('0')).toBe(0);
	});

	it('reads a blank field as "no weight"', () => {
		expect(weightFromDraft('')).toBeNull();
		expect(weightFromDraft('   ')).toBeNull();
	});

	it('clamps a negative number to 0', () => {
		expect(weightFromDraft('-3')).toBe(0);
	});

	it('ignores text that is not a finite number', () => {
		expect(weightFromDraft('abc')).toBeUndefined();
		expect(weightFromDraft('Infinity')).toBeUndefined();
		expect(weightFromDraft('NaN')).toBeUndefined();
	});

	it('ignores a field the browser could not read rather than clearing the weight', () => {
		// A number field reports unreadable text such as "1e" as an empty value.
		expect(weightFromDraft('', true)).toBeUndefined();
	});
});
