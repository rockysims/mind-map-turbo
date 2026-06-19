import { describe, expect, it } from 'vitest';
import {
	collectLegendTags,
	DEFAULT_EDGE_STROKE_COLOR,
	edgeStrokeColor,
	fallbackTagColor,
	nodeBorderSegments,
	tagUsageCount
} from './tagColors';
import { makeGraph } from './testFixtures';

describe('tag color helpers', () => {
	it('returns deterministic hex fallback colors from tag names', () => {
		expect(fallbackTagColor('topic')).toMatch(/^#[0-9a-f]{6}$/);
		expect(fallbackTagColor('topic')).toBe(fallbackTagColor('topic'));
		expect(fallbackTagColor('topic')).not.toBe(fallbackTagColor('other'));
	});

	it('keeps explicit node and edge tag config maps separate', () => {
		const graph = makeGraph({
			nodeCount: 2,
			nodes: [
				{ id: 'n0', title: 'Node 0', description: '', tags: ['shared'] },
				{ id: 'n1', title: 'Node 1', description: '', tags: [] }
			],
			edges: [{ source: 0, target: 1, tags: ['shared'] }],
			tagColorConfig: {
				nodeTags: { shared: '#111111' },
				edgeTags: { shared: '#222222' }
			}
		});

		expect(nodeBorderSegments(graph.nodes[0], graph.tagColorConfig.nodeTags)[0].color).toBe(
			'#111111'
		);
		expect(edgeStrokeColor(graph.edges[0], graph.tagColorConfig.edgeTags)).toBe('#222222');
	});

	it('collects legend tags from configured and in-use tags with usage counts', () => {
		const graph = makeGraph({
			nodes: [
				{ id: 'n0', title: 'Node 0', description: '', tags: ['topic', 'topic'] },
				{ id: 'n1', title: 'Node 1', description: '', tags: ['other'] }
			],
			edges: [{ source: 'n0', target: 'n1', tags: ['rel'] }],
			tagColorConfig: {
				nodeTags: { unused: '#abcdef' },
				edgeTags: { rel: '#123456', stale: '#654321' }
			}
		});

		expect(collectLegendTags(graph)).toEqual([
			expect.objectContaining({ namespace: 'nodeTags', tag: 'other', usageCount: 1 }),
			expect.objectContaining({ namespace: 'nodeTags', tag: 'topic', usageCount: 2 }),
			expect.objectContaining({
				namespace: 'nodeTags',
				tag: 'unused',
				usageCount: 0,
				hasExplicitColor: true
			}),
			expect.objectContaining({
				namespace: 'edgeTags',
				tag: 'rel',
				usageCount: 1,
				hasExplicitColor: true
			}),
			expect.objectContaining({
				namespace: 'edgeTags',
				tag: 'stale',
				usageCount: 0,
				hasExplicitColor: true
			})
		]);
	});

	it('counts tag usage in the requested namespace only', () => {
		const graph = makeGraph({
			nodes: [{ id: 'n0', title: 'Node 0', description: '', tags: ['shared'] }],
			edges: [{ source: 'n0', target: 'n0', tags: ['shared', 'shared'] }]
		});

		expect(tagUsageCount(graph, 'nodeTags', 'shared')).toBe(1);
		expect(tagUsageCount(graph, 'edgeTags', 'shared')).toBe(2);
	});

	it('builds no node border segments for untagged nodes', () => {
		const graph = makeGraph({ nodeCount: 1 });

		expect(nodeBorderSegments(graph.nodes[0], {})).toEqual([]);
	});

	it('builds one segment for a single node tag', () => {
		const graph = makeGraph({
			nodes: [{ id: 'n0', title: 'Node 0', description: '', tags: ['topic'] }],
			tagColorConfig: { nodeTags: { topic: '#123456' }, edgeTags: {} }
		});

		expect(nodeBorderSegments(graph.nodes[0], graph.tagColorConfig.nodeTags)).toEqual([
			{ color: '#123456', startTurn: 0, endTurn: 1 }
		]);
	});

	it('splits node border segments evenly for multiple tags', () => {
		const graph = makeGraph({
			nodes: [{ id: 'n0', title: 'Node 0', description: '', tags: ['a', 'b', 'c'] }]
		});

		expect(
			nodeBorderSegments(graph.nodes[0], {}).map(({ startTurn, endTurn }) => [startTurn, endTurn])
		).toEqual([
			[0, 1 / 3],
			[1 / 3, 2 / 3],
			[2 / 3, 1]
		]);
	});

	it('uses the neutral stroke color for untagged edges', () => {
		const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

		expect(edgeStrokeColor(graph.edges[0], {})).toBe(DEFAULT_EDGE_STROKE_COLOR);
	});

	it('uses fallback, explicit, and first-tag colors for edge strokes', () => {
		const graph = makeGraph({
			nodeCount: 3,
			edges: [
				{ source: 0, target: 1, tags: ['unknown'] },
				{ source: 1, target: 2, tags: ['rel', 'secondary'] }
			],
			tagColorConfig: { nodeTags: {}, edgeTags: { rel: '#112233', secondary: '#445566' } }
		});

		expect(edgeStrokeColor(graph.edges[0], graph.tagColorConfig.edgeTags)).toBe(
			fallbackTagColor('unknown')
		);
		expect(edgeStrokeColor(graph.edges[1], graph.tagColorConfig.edgeTags)).toBe('#112233');
	});
});
