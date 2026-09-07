import { describe, expect, it } from 'vitest';
import {
	addEdge,
	addNode,
	addNodeContentBlock,
	commitInlineTitleSyntax,
	deleteTagEverywhere,
	moveNode,
	moveNodeContentBlock,
	removeEdge,
	removeNode,
	removeNodeContentBlock,
	setNodeDesignations,
	setNodePinned,
	setTagColor,
	togglePinned,
	updateEdge,
	updateNodeContent,
	updateNodeImageContent
} from './components/ui/Multigraph/lib/graph';
import { importGraphData } from './components/ui/Multigraph/lib/graphImport';
import { planNodeMerge } from './components/ui/Multigraph/lib/nodeMerge';
import { designations, makeGraph } from './components/ui/Multigraph/lib/testFixtures';
import type { GraphAssetMetadata, MultigraphData } from './components/ui/types/multigraph';
import { applyDelta, deltaApplies, diffByReference, isEmptyDelta } from './graphDelta';

const IMAGE_ASSET: GraphAssetMetadata = {
	id: 'a1',
	kind: 'image',
	mimeType: 'image/png',
	size: 10,
	createdAt: 1
};

const baseGraph = (): MultigraphData =>
	makeGraph({
		nodes: [
			{ id: 'n0', title: 'One', description: '', tags: ['physics'] },
			{ id: 'n1', title: 'Two', description: '' },
			{ id: 'n2', title: 'Three', description: '' }
		],
		edges: [
			[0, 1],
			[1, 2]
		],
		posByNodeId: {
			n0: { x: 0, y: 0 },
			n1: { x: 100, y: 0 },
			n2: { x: 200, y: 0 }
		},
		tagColorConfig: { nodeTags: { physics: '#ff0000' }, edgeTags: {} }
	});

/** The document fields a delta is responsible for. Positions are explicitly not among them. */
const document = (graph: MultigraphData) => ({
	nodes: graph.nodes,
	edges: graph.edges,
	tagColorConfig: graph.tagColorConfig,
	assets: graph.assets,
	pinSequence: graph.pinSequence
});

const FILE_ASSET: GraphAssetMetadata = {
	id: 'f1',
	kind: 'file',
	mimeType: 'text/csv',
	name: 'readings.csv',
	size: 24,
	createdAt: 1
};

const withImage = (): MultigraphData =>
	addNodeContentBlock(
		baseGraph(),
		'n0',
		{ type: 'image', assetId: 'a1', alt: 'A picture' },
		IMAGE_ASSET
	);

const withFile = (): MultigraphData =>
	addNodeContentBlock(
		baseGraph(),
		'n0',
		{ type: 'file', assetId: 'f1', name: 'readings.csv' },
		FILE_ASSET
	);

/**
 * Every mutation the app can make, as `[name, produce]`. The two built outside
 * `graph.ts` — a node merge and an additive import — are here for the same
 * reason: they land through the same commit funnel, so the delta format has to
 * carry them.
 */
const MUTATIONS: Array<[string, (graph: MultigraphData) => MultigraphData]> = [
	['addNode', (graph) => addNode(graph, { title: 'New' })],
	['removeNode', (graph) => removeNode(graph, 'n1')],
	['addEdge', (graph) => addEdge(graph, 'n0', 'n2')],
	['removeEdge', (graph) => removeEdge(graph, graph.edges[0].id)],
	['updateEdge', (graph) => updateEdge(graph, graph.edges[0].id, { directed: true })],
	['togglePinned', (graph) => togglePinned(graph, 'n0')],
	['setNodePinned', (graph) => setNodePinned(graph, 'n1', true)],
	[
		'updateNodeContent',
		(graph) => updateNodeContent(graph, 'n0', { title: 'Renamed', description: 'Body' })
	],
	[
		'setNodeDesignations',
		(graph) => setNodeDesignations(graph, 'n0', { inputs: [], outputs: designations('v') })
	],
	['addNodeContentBlock (image)', () => withImage()],
	['addNodeContentBlock (file)', () => withFile()],
	[
		'updateNodeImageContent',
		() => updateNodeImageContent(withImage(), 'n0', 'a1', { alt: 'Changed' })
	],
	[
		'moveNodeContentBlock',
		() => {
			const twoBlocks = addNodeContentBlock(
				withImage(),
				'n0',
				{ type: 'image', assetId: 'a2', alt: 'Second' },
				{ ...IMAGE_ASSET, id: 'a2' }
			);
			return moveNodeContentBlock(twoBlocks, 'n0', 0, 1);
		}
	],
	['removeNodeContentBlock (image)', () => removeNodeContentBlock(withImage(), 'n0', 'a1').graph],
	['removeNodeContentBlock (file)', () => removeNodeContentBlock(withFile(), 'n0', 'f1').graph],
	['setTagColor', (graph) => setTagColor(graph, 'nodeTags', 'physics', '#00ff00')],
	['deleteTagEverywhere', (graph) => deleteTagEverywhere(graph, 'nodeTags', 'physics')],
	['commitInlineTitleSyntax', (graph) => commitInlineTitleSyntax(graph, 'n0', 'One #maths')],
	['moveNode', (graph) => moveNode(graph, 'n0', { x: 42, y: 42 })],
	['planNodeMerge', (graph) => planNodeMerge(graph, 'n2', 'n0').next],
	[
		'importGraphData',
		(graph) => importGraphData(graph, makeGraph({ nodeCount: 2, edges: [[0, 1]] })).next
	]
];

/**
 * The graph a mutation starts from. Rows whose closure ignores the argument and
 * builds its own content-bearing graph have to be diffed against the same
 * starting point, or the delta describes two unrelated documents.
 */
function baseFor(name: string): MultigraphData {
	if (name === 'removeNodeContentBlock (file)') return withFile();
	if (
		name.startsWith('updateNodeImageContent') ||
		name === 'moveNodeContentBlock' ||
		name === 'removeNodeContentBlock (image)'
	) {
		return withImage();
	}
	return baseGraph();
}

describe('diffByReference / applyDelta', () => {
	for (const [name, mutate] of MUTATIONS) {
		it(`round-trips a graph through ${name}`, () => {
			const before = baseFor(name);
			const after = mutate(before);

			const delta = diffByReference(before, after);

			expect(deltaApplies(before, delta)).toBe(true);
			expect(document(applyDelta(before, delta))).toEqual(document(after));
		});

		it(`round-trips ${name} backwards, which is the direction the tail chains`, () => {
			const before = baseFor(name);
			const after = mutate(before);

			const delta = diffByReference(after, before);

			expect(deltaApplies(after, delta)).toBe(true);
			expect(document(applyDelta(after, delta))).toEqual(document(before));
		});
	}

	it('emits an empty delta for a layout-only change', () => {
		const graph = baseGraph();
		const relaxed = { ...graph, posByNodeId: { ...graph.posByNodeId, n0: { x: 9, y: 9 } } };

		expect(isEmptyDelta(diffByReference(graph, relaxed))).toBe(true);
	});

	it('lands a resurrected node at the position it was removed from', () => {
		const graph = baseGraph();
		const deleted = removeNode(graph, 'n1');

		const restored = applyDelta(deleted, diffByReference(deleted, graph));

		expect(restored.posByNodeId.n1).toEqual({ x: 100, y: 0 });
	});

	it('keeps the current position for a node that never left', () => {
		const graph = baseGraph();
		const deleted = removeNode(graph, 'n1');
		const moved = { ...deleted, posByNodeId: { ...deleted.posByNodeId, n0: { x: 500, y: 500 } } };

		const restored = applyDelta(moved, diffByReference(deleted, graph));

		expect(restored.posByNodeId.n0).toEqual({ x: 500, y: 500 });
	});

	it('leaves no position behind for a node the delta removes', () => {
		const graph = baseGraph();

		const applied = applyDelta(graph, diffByReference(graph, removeNode(graph, 'n1')));

		expect(applied.posByNodeId).not.toHaveProperty('n1');
	});

	it('puts a resurrected node back in its original place in the list', () => {
		const graph = baseGraph();
		const deleted = removeNode(graph, 'n0');

		const restored = applyDelta(deleted, diffByReference(deleted, graph));

		expect(restored.nodes.map((node) => node.id)).toEqual(['n0', 'n1', 'n2']);
	});

	it('takes away an optional field the target does not have', () => {
		const withAssets: MultigraphData = {
			...baseGraph(),
			assets: { a1: IMAGE_ASSET },
			pinSequence: 3
		};
		const without = baseGraph();

		const applied = applyDelta(withAssets, diffByReference(withAssets, without));

		expect(applied.assets).toBeUndefined();
		expect(applied.pinSequence).toBeUndefined();
	});
});

describe('deltaApplies', () => {
	it('rejects a delta naming elements this graph does not have', () => {
		const graph = baseGraph();
		const delta = diffByReference(graph, removeNode(graph, 'n1'));

		// The graph another tab left behind, with `n1` already gone.
		expect(deltaApplies(removeNode(graph, 'n1'), delta)).toBe(false);
	});

	it('rejects a delta re-adding an element this graph already has', () => {
		const graph = baseGraph();
		const deleted = removeNode(graph, 'n1');
		const delta = diffByReference(deleted, graph);

		expect(deltaApplies(graph, delta)).toBe(false);
	});
});
