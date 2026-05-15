import { describe, expect, it } from 'vitest';
import { deriveGraphLayout, relaxGraphPositions } from './graphLayout';
import { makeGraph } from './testFixtures';

describe('graphLayout', () => {
	it('returns presentation data for every graph node', () => {
		const graph = makeGraph({
			nodeCount: 3,
			pinned: [0],
			edges: [
				[0, 1],
				[1, 2]
			]
		});

		const layout = deriveGraphLayout(graph, {
			settings: { baseRadius: 100, scaleFalloff: 0.5, minScale: 0.2 },
			relaxIterations: 0
		});

		expect(layout.nodes.map((node) => node.nodeId)).toEqual(['n0', 'n1', 'n2']);
		expect(layout.hopsByNodeId).toEqual({ n0: 0, n1: 1, n2: 2 });
		expect(layout.scaleByNodeId).toEqual({ n0: 1, n1: 0.5, n2: 0.25 });
		expect(layout.radiusByNodeId).toEqual({ n0: 100, n1: 50, n2: 25 });
	});

	it('uses min scale for disconnected nodes', () => {
		const graph = makeGraph({
			nodeCount: 3,
			pinned: [0],
			edges: [[0, 1]]
		});

		const layout = deriveGraphLayout(graph, {
			settings: { baseRadius: 100, minScale: 0.2 },
			relaxIterations: 0
		});

		expect(layout.hopsByNodeId.n2).toBe(Infinity);
		expect(layout.scaleByNodeId.n2).toBe(0.2);
		expect(layout.radiusByNodeId.n2).toBe(20);
	});

	it('anchors pinned nodes and the active drag node while relaxing positions', () => {
		const graph = makeGraph({
			nodeCount: 3,
			pinned: [0],
			posByNodeId: {
				n0: { x: 0, y: 0 },
				n1: { x: 80, y: 0 },
				n2: { x: 120, y: 0 }
			}
		});

		const layout = deriveGraphLayout(graph, {
			activeDragNodeId: 'n2',
			settings: { baseRadius: 50, minScale: 1, paddingPx: 0 },
			relaxIterations: 1
		});

		expect(layout.nodes.find((node) => node.nodeId === 'n0')?.anchored).toBe(true);
		expect(layout.nodes.find((node) => node.nodeId === 'n2')?.anchored).toBe(true);
		expect(layout.posByNodeId.n0).toEqual({ x: 0, y: 0 });
		expect(layout.posByNodeId.n2).toEqual({ x: 120, y: 0 });
		expect(layout.posByNodeId.n1.x).not.toBe(80);
	});

	it('returns a new positions map without mutating the original graph', () => {
		const graph = makeGraph({
			nodeCount: 2,
			pinned: [0],
			posByNodeId: {
				n0: { x: 0, y: 0 },
				n1: { x: 80, y: 0 }
			}
		});

		const positions = relaxGraphPositions(graph, {
			settings: { baseRadius: 50, minScale: 1, paddingPx: 0 },
			relaxIterations: 1
		});

		expect(positions).not.toBe(graph.posByNodeId);
		expect(positions.n1).toEqual({ x: 100, y: 0 });
		expect(graph.posByNodeId.n1).toEqual({ x: 80, y: 0 });
	});
});
