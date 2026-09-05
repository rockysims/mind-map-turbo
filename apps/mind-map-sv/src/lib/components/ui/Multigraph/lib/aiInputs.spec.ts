import { describe, expect, it } from 'vitest';
import { collectAiInputs, type AiInput } from './aiInputs';
import { makeGraph } from './testFixtures';
import type { GraphAssetMetadata, MultigraphData } from '../../types/multigraph';
import type { NodeContentBlock } from '../../types/node';

function asset(id: string, over: Partial<GraphAssetMetadata> = {}): GraphAssetMetadata {
	return {
		id,
		kind: 'file',
		mimeType: 'text/csv',
		name: `${id}.csv`,
		size: 1024,
		createdAt: 0,
		...over
	};
}

function fileBlock(assetId: string, name: string): NodeContentBlock {
	return { type: 'file', assetId, name };
}

function withAssets(graph: MultigraphData, assets: GraphAssetMetadata[]): MultigraphData {
	return { ...graph, assets: Object.fromEntries(assets.map((entry) => [entry.id, entry])) };
}

/**
 * `ai` is the AI node; `up` feeds it over a directed edge, `side` over an
 * undirected one, and `down` hangs off a directed edge leaving the AI node —
 * the shape a promoted output has.
 */
function baseGraph(): MultigraphData {
	return withAssets(
		makeGraph({
			nodes: [
				{
					id: 'ai',
					title: 'Plot the runs',
					description: 'prompt lives in the add-on',
					content: [fileBlock('a-own-1', 'own-first.csv'), fileBlock('a-own-2', 'own-second.csv')]
				},
				{
					id: 'up',
					title: 'Bench run 1',
					description: 'first sweep',
					content: [fileBlock('a-up', 'sweep1.csv')]
				},
				{ id: 'side', title: 'Bench run 2', description: 'second sweep' },
				{ id: 'down', title: 'figure-1.png', description: 'promoted output' }
			],
			edges: [
				{ id: 'e-up', source: 'up', target: 'ai', directed: true, tags: ['baseline'] },
				{ id: 'e-side', source: 'ai', target: 'side', directed: false },
				{ id: 'e-down', source: 'ai', target: 'down', directed: true, tags: ['output'] }
			]
		}),
		[asset('a-own-1'), asset('a-own-2'), asset('a-up')]
	);
}

describe('collectAiInputs', () => {
	it('returns only the node’s own attachments when it has no edges', () => {
		const graph = withAssets(
			makeGraph({
				nodes: [
					{
						id: 'ai',
						title: 'Alone',
						description: '',
						content: [fileBlock('a1', 'one.csv'), fileBlock('a2', 'two.csv')]
					}
				]
			}),
			[asset('a1', { size: 10 }), asset('a2', { size: 20 })]
		);

		expect(collectAiInputs(graph, 'ai')).toEqual<AiInput[]>([
			{
				kind: 'file',
				nodeId: 'ai',
				assetId: 'a1',
				name: 'one.csv',
				mimeType: 'text/csv',
				size: 10
			},
			{
				kind: 'file',
				nodeId: 'ai',
				assetId: 'a2',
				name: 'two.csv',
				mimeType: 'text/csv',
				size: 20
			}
		]);
	});

	it('collects own attachments, then incoming and undirected neighbours, skipping outgoing', () => {
		expect(collectAiInputs(baseGraph(), 'ai')).toEqual<AiInput[]>([
			{
				kind: 'file',
				nodeId: 'ai',
				assetId: 'a-own-1',
				name: 'own-first.csv',
				mimeType: 'text/csv',
				size: 1024
			},
			{
				kind: 'file',
				nodeId: 'ai',
				assetId: 'a-own-2',
				name: 'own-second.csv',
				mimeType: 'text/csv',
				size: 1024
			},
			{
				kind: 'text',
				nodeId: 'up',
				title: 'Bench run 1',
				description: 'first sweep',
				label: 'baseline'
			},
			{
				kind: 'file',
				nodeId: 'up',
				assetId: 'a-up',
				name: 'sweep1.csv',
				mimeType: 'text/csv',
				size: 1024,
				label: 'baseline'
			},
			{ kind: 'text', nodeId: 'side', title: 'Bench run 2', description: 'second sweep' }
		]);
	});

	it('excludes a promoted output node even when it carries an attachment', () => {
		const graph = baseGraph();
		const promoted = withAssets(
			{
				...graph,
				nodes: graph.nodes.map((node) =>
					node.id === 'down' ? { ...node, content: [fileBlock('a-down', 'figure-1.png')] } : node
				)
			},
			[asset('a-own-1'), asset('a-own-2'), asset('a-up'), asset('a-down')]
		);

		expect(collectAiInputs(promoted, 'ai').map((input) => input.nodeId)).toEqual([
			'ai',
			'ai',
			'up',
			'up',
			'side'
		]);
	});

	it('gives an undirected edge with no tags no label', () => {
		const inputs = collectAiInputs(baseGraph(), 'ai');
		const side = inputs.find((input) => input.nodeId === 'side');

		expect(side).toEqual<AiInput>({
			kind: 'text',
			nodeId: 'side',
			title: 'Bench run 2',
			description: 'second sweep'
		});
	});

	it('takes the first tag of an edge as the label', () => {
		const graph = makeGraph({
			nodes: [
				{ id: 'ai', title: 'AI', description: '' },
				{ id: 'src', title: 'Source', description: 'text' }
			],
			edges: [
				{ id: 'e', source: 'src', target: 'ai', directed: true, tags: ['baseline', 'ignored'] }
			]
		});

		expect(collectAiInputs(graph, 'ai')).toEqual<AiInput[]>([
			{ kind: 'text', nodeId: 'src', title: 'Source', description: 'text', label: 'baseline' }
		]);
	});

	it('lists a neighbour joined by two edges once, with the labels merged', () => {
		const graph = makeGraph({
			nodes: [
				{ id: 'ai', title: 'AI', description: '' },
				{ id: 'src', title: 'Source', description: 'text' }
			],
			edges: [
				{ id: 'e1', source: 'src', target: 'ai', directed: true, tags: ['baseline'] },
				{ id: 'e2', source: 'src', target: 'ai', directed: false, tags: ['control'] }
			]
		});

		expect(collectAiInputs(graph, 'ai')).toEqual<AiInput[]>([
			{
				kind: 'text',
				nodeId: 'src',
				title: 'Source',
				description: 'text',
				label: 'baseline, control'
			}
		]);
	});

	it('keeps the order when an unrelated edge is inserted ahead of the others', () => {
		const graph = baseGraph();
		const before = collectAiInputs(graph, 'ai');
		const withUnrelated: MultigraphData = {
			...graph,
			edges: [
				{
					id: 'e-unrelated',
					sourceNodeId: 'side',
					targetNodeId: 'down',
					tags: [],
					directed: false
				},
				...graph.edges
			]
		};

		expect(collectAiInputs(withUnrelated, 'ai')).toEqual(before);
	});

	it('keeps the order when unrelated nodes are reordered around the neighbours', () => {
		const graph = baseGraph();
		const before = collectAiInputs(graph, 'ai');
		const spectators = makeGraph({
			nodes: [
				{ id: 'x', title: 'Unrelated X', description: '' },
				{ id: 'y', title: 'Unrelated Y', description: '' }
			]
		}).nodes;
		const reordered: MultigraphData = {
			...graph,
			nodes: [spectators[1], ...graph.nodes, spectators[0]]
		};

		expect(collectAiInputs(reordered, 'ai')).toEqual(before);
	});

	it('orders neighbours by node order rather than edge order', () => {
		const graph = makeGraph({
			nodes: [
				{ id: 'ai', title: 'AI', description: '' },
				{ id: 'first', title: 'First', description: '' },
				{ id: 'second', title: 'Second', description: '' }
			],
			edges: [
				{ id: 'e-second', source: 'second', target: 'ai', directed: true, tags: [] },
				{ id: 'e-first', source: 'first', target: 'ai', directed: true, tags: [] }
			]
		});

		expect(collectAiInputs(graph, 'ai').map((input) => input.nodeId)).toEqual(['first', 'second']);
	});

	it('names an image by its asset name, falling back to the alt text', () => {
		const graph = withAssets(
			makeGraph({
				nodes: [
					{
						id: 'ai',
						title: 'AI',
						description: '',
						content: [
							{ type: 'image', assetId: 'img-named', alt: 'alt for the named one' },
							{ type: 'image', assetId: 'img-unnamed', alt: 'scope trace' }
						]
					}
				]
			}),
			[
				asset('img-named', { kind: 'image', mimeType: 'image/png', name: 'trace.png', size: 5 }),
				asset('img-unnamed', { kind: 'image', mimeType: 'image/png', name: undefined, size: 7 })
			]
		);

		expect(
			collectAiInputs(graph, 'ai').map((input) => input.kind === 'file' && input.name)
		).toEqual(['trace.png', 'scope trace']);
	});

	it('skips a content block whose asset metadata is missing, and an unknown node', () => {
		const graph = withAssets(
			makeGraph({
				nodes: [
					{
						id: 'ai',
						title: 'AI',
						description: '',
						content: [fileBlock('present', 'here.csv'), fileBlock('gone', 'missing.csv')]
					}
				]
			}),
			[asset('present')]
		);

		expect(collectAiInputs(graph, 'ai').map((input) => input.nodeId)).toEqual(['ai']);
		expect(collectAiInputs(graph, 'nope')).toEqual([]);
	});
});
