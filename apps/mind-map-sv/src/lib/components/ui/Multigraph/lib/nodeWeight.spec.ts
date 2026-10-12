import { describe, expect, it } from 'vitest';
import { authoredDegrees, formatNodeWeight, nodeBorderValue } from './nodeWeight';
import { derivedEdgeId } from './derivedEdges';
import { makeGraph } from './testFixtures';
import type { NodeContentBlock, NodeData } from '../../types/node';

const NO_DEGREES: ReadonlyMap<string, number> = new Map();

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
	describe('size', () => {
		it('reads sizeBytes', () => {
			expect(nodeBorderValue(node({ sizeBytes: 2048 }), 'size', NO_DEGREES)).toBe(2048);
		});

		it('reads a stored 0 as unknown', () => {
			expect(nodeBorderValue(node({ sizeBytes: 0 }), 'size', NO_DEGREES)).toBeUndefined();
		});

		it('has no value when the size is absent', () => {
			expect(nodeBorderValue(node(), 'size', NO_DEGREES)).toBeUndefined();
		});
	});

	describe('weight', () => {
		it('reads weight', () => {
			expect(nodeBorderValue(node({ weight: 12.5 }), 'weight', NO_DEGREES)).toBe(12.5);
		});

		it('keeps a stored 0 as a real value', () => {
			expect(nodeBorderValue(node({ weight: 0 }), 'weight', NO_DEGREES)).toBe(0);
		});

		it('has no value when the weight is absent', () => {
			expect(nodeBorderValue(node(), 'weight', NO_DEGREES)).toBeUndefined();
		});
	});

	describe('degree', () => {
		it('reads the node’s count from the degree map', () => {
			const degrees = new Map([['n', 4]]);
			expect(nodeBorderValue(node(), 'degree', degrees)).toBe(4);
		});

		it('reads a node missing from the map as 0', () => {
			expect(nodeBorderValue(node(), 'degree', new Map([['other', 9]]))).toBe(0);
		});
	});

	describe('attachments', () => {
		it('counts content blocks', () => {
			const withFiles = node({
				content: [FILE_BLOCK, { type: 'image', assetId: 'a2', alt: 'A chart' }, FILE_BLOCK]
			});
			expect(nodeBorderValue(withFiles, 'attachments', NO_DEGREES)).toBe(3);
		});

		it('reads a node with no content as 0', () => {
			expect(nodeBorderValue(node(), 'attachments', NO_DEGREES)).toBe(0);
			expect(nodeBorderValue(node({ content: [] }), 'attachments', NO_DEGREES)).toBe(0);
		});
	});

	describe('descriptionLength', () => {
		it('counts the raw stored text, untrimmed', () => {
			const described = node({ description: '  $x^2$ ' });
			expect(nodeBorderValue(described, 'descriptionLength', NO_DEGREES)).toBe(8);
		});

		it('reads an empty description as 0', () => {
			expect(nodeBorderValue(node(), 'descriptionLength', NO_DEGREES)).toBe(0);
		});
	});

	it.each([['none'], ['bogus'], ['toString'], ['']])(
		'has no value under %j, whatever the node carries',
		(source) => {
			const loaded = node({
				sizeBytes: 2048,
				weight: 3,
				content: [FILE_BLOCK],
				description: 'text'
			});
			expect(nodeBorderValue(loaded, source, new Map([['n', 2]]))).toBeUndefined();
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
