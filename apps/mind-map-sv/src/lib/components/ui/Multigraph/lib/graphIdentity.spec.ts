import { describe, expect, it } from 'vitest';
import type { MultigraphData } from '../../types/multigraph';
import { addNode, removeNode, setTagColor, setTagPhysicsFactor } from './graph';
import {
	removedNodePositions,
	restoreSemantics,
	semanticallyUnchanged,
	semanticFingerprint
} from './graphIdentity';
import { LayoutRuntime, type LayoutRuntimeScheduler } from './layoutRuntime.svelte';
import { makeGraph } from './testFixtures';

class FrozenScheduler implements LayoutRuntimeScheduler {
	requestFrame(): number {
		return 1;
	}

	cancelFrame(): void {}

	now(): number {
		return 0;
	}
}

const baseGraph = (): MultigraphData =>
	makeGraph({
		nodeCount: 3,
		edges: [
			[0, 1],
			[1, 2]
		],
		posByNodeId: {
			n0: { x: 0, y: 0 },
			n1: { x: 100, y: 0 },
			n2: { x: 200, y: 0 }
		}
	});

describe('semanticallyUnchanged', () => {
	it('sees through a positions-only rewrite', () => {
		const graph = baseGraph();
		const moved = { ...graph, posByNodeId: { ...graph.posByNodeId, n1: { x: 5, y: 5 } } };

		expect(semanticallyUnchanged(graph, moved)).toBe(true);
	});

	it('holds after a real relaxAfterMutation, which is the invariant everything rests on', () => {
		// If this fails, a layout write has stopped preserving `nodes`/`edges` by
		// reference. That is a design change to understand, not a test to update:
		// the history's O(1) gate would start recording every physics frame.
		let graph = baseGraph();
		const runtime = new LayoutRuntime({
			getGraph: () => graph,
			getLayoutSettings: () => ({ relaxIterations: 4 }),
			getActiveDragNodeId: () => null,
			getPreferredBeaconNodeIds: () => [],
			applyGraph: (next) => {
				graph = next;
			},
			scheduler: new FrozenScheduler()
		});

		const relaxed = runtime.relaxAfterMutation(graph);

		expect(semanticallyUnchanged(graph, relaxed)).toBe(true);
	});

	it('detects each of the six tracked fields changing', () => {
		const graph = baseGraph();

		expect(semanticallyUnchanged(graph, { ...graph, nodes: [...graph.nodes] })).toBe(false);
		expect(semanticallyUnchanged(graph, { ...graph, edges: [...graph.edges] })).toBe(false);
		expect(
			semanticallyUnchanged(graph, { ...graph, tagColorConfig: { ...graph.tagColorConfig } })
		).toBe(false);
		expect(
			semanticallyUnchanged(graph, {
				...graph,
				tagPhysicsConfig: { nodeTags: {}, edgeTags: { rel: 2 } }
			})
		).toBe(false);
		expect(semanticallyUnchanged(graph, { ...graph, assets: {} })).toBe(false);
		expect(semanticallyUnchanged(graph, { ...graph, pinSequence: 1 })).toBe(false);
	});

	it('reports a tag physics edit as semantic', () => {
		const graph = baseGraph();
		const tuned = setTagPhysicsFactor(graph, 'edgeTags', 'rel', 2);

		expect(semanticallyUnchanged(graph, tuned)).toBe(false);
		expect(semanticFingerprint(tuned)).not.toBe(semanticFingerprint(graph));
	});

	it('reports a tag colour edit as semantic', () => {
		const graph = baseGraph();

		expect(semanticallyUnchanged(graph, setTagColor(graph, 'nodeTags', 'physics', '#ff0000'))).toBe(
			false
		);
	});
});

describe('removedNodePositions', () => {
	it('captures only the positions the next graph has no node for', () => {
		const graph = baseGraph();

		expect(removedNodePositions(graph, removeNode(graph, 'n1'))).toEqual({
			n1: { x: 100, y: 0 }
		});
	});

	it('is empty when nothing was removed', () => {
		const graph = baseGraph();

		expect(removedNodePositions(graph, addNode(graph, {}))).toEqual({});
	});
});

describe('restoreSemantics', () => {
	it('keeps the current position for a node present in both graphs', () => {
		const snapshot = baseGraph();
		const current = {
			...removeNode(snapshot, 'n2'),
			posByNodeId: { n0: { x: 0, y: 0 }, n1: { x: 900, y: 900 } }
		};

		const restored = restoreSemantics(current, snapshot);

		expect(restored.posByNodeId.n1).toEqual({ x: 900, y: 900 });
	});

	it('lands a resurrected node at its snapshot position', () => {
		const snapshot = baseGraph();
		const current = {
			...removeNode(snapshot, 'n2'),
			posByNodeId: { n0: { x: 0, y: 0 }, n1: { x: 900, y: 900 } }
		};

		const restored = restoreSemantics(current, snapshot);

		expect(restored.nodes.map((node) => node.id)).toEqual(['n0', 'n1', 'n2']);
		expect(restored.posByNodeId.n2).toEqual({ x: 200, y: 0 });
	});

	it('leaves no posByNodeId entry for a node in neither graph', () => {
		const snapshot = {
			...baseGraph(),
			posByNodeId: { ...baseGraph().posByNodeId, ghost: { x: 7, y: 7 } }
		};
		const current = baseGraph();

		const restored = restoreSemantics(current, snapshot);

		expect(restored.posByNodeId).not.toHaveProperty('ghost');
	});

	it('restores nodes, edges, tagColorConfig, assets and pinSequence from the snapshot', () => {
		const snapshot: MultigraphData = {
			...baseGraph(),
			tagColorConfig: { nodeTags: { physics: '#00ff00' }, edgeTags: {} },
			assets: {
				a1: { id: 'a1', kind: 'image', mimeType: 'image/png', size: 12, createdAt: 3 }
			},
			pinSequence: 4
		};
		const current = {
			...removeNode(snapshot, 'n2'),
			tagColorConfig: { nodeTags: {}, edgeTags: {} }
		};

		const restored = restoreSemantics(current, snapshot);

		expect(restored.nodes).toBe(snapshot.nodes);
		expect(restored.edges).toBe(snapshot.edges);
		expect(restored.tagColorConfig).toBe(snapshot.tagColorConfig);
		expect(restored.assets).toBe(snapshot.assets);
		expect(restored.pinSequence).toBe(4);
	});

	it('does not inherit an optional field the snapshot never had', () => {
		const snapshot = baseGraph();
		const current = { ...snapshot, pinSequence: 9, assets: { a1: undefined } as never };

		const restored = restoreSemantics(current, snapshot);

		expect(restored.pinSequence).toBeUndefined();
		expect(restored.assets).toBeUndefined();
	});
});
