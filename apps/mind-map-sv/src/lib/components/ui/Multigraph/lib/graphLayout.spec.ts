import { describe, expect, it } from 'vitest';
import {
	deriveGraphLayout,
	relaxGraphPositions,
	withRelaxedGraphPositions,
	withSettledGraphPositions
} from './graphLayout';
import { makeGraph } from './testFixtures';

function maxOverlapAmount(
	positions: Record<string, { x: number; y: number }>,
	radii: Record<string, number>
): number {
	let maxOverlap = 0;
	const nodeIds = Object.keys(positions);

	for (let sourceIndex = 0; sourceIndex < nodeIds.length; sourceIndex += 1) {
		for (let targetIndex = sourceIndex + 1; targetIndex < nodeIds.length; targetIndex += 1) {
			const sourceId = nodeIds[sourceIndex];
			const targetId = nodeIds[targetIndex];
			const source = positions[sourceId];
			const target = positions[targetId];
			const overlap =
				radii[sourceId] + radii[targetId] - Math.hypot(target.x - source.x, target.y - source.y);

			maxOverlap = Math.max(maxOverlap, overlap);
		}
	}

	return maxOverlap;
}

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
			settings: { baseRadius: 50, minScale: 1 },
			relaxIterations: 1
		});

		expect(layout.nodes.find((node) => node.nodeId === 'n0')?.anchored).toBe(true);
		expect(layout.nodes.find((node) => node.nodeId === 'n2')?.anchored).toBe(true);
		expect(layout.posByNodeId.n0).toEqual({ x: 0, y: 0 });
		expect(layout.posByNodeId.n2).toEqual({ x: 120, y: 0 });
		expect(layout.posByNodeId.n1.x).not.toBe(80);
	});

	it('pulls connected nodes toward an active drag node when the edge gap is too large', () => {
		const graph = makeGraph({
			nodeCount: 2,
			edges: [[0, 1]],
			posByNodeId: {
				n0: { x: 0, y: 0 },
				n1: { x: 500, y: 0 }
			}
		});

		const layout = deriveGraphLayout(graph, {
			activeDragNodeId: 'n0',
			settings: {
				baseRadius: 20,
				minScale: 1,
				edgeGapMinRadiusFactor: 1,
				edgeGapMaxRadiusFactor: 2.5,
				edgeSpringStrength: 1
			},
			relaxIterations: 1
		});

		expect(layout.posByNodeId.n0).toEqual({ x: 0, y: 0 });
		expect(layout.posByNodeId.n1).toEqual({ x: 140, y: 0 });
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
			settings: { baseRadius: 50, minScale: 1, hopRepulsionStrength: 0 },
			relaxIterations: 1
		});

		expect(positions).not.toBe(graph.posByNodeId);
		expect(positions.n1).toEqual({ x: 100, y: 0 });
		expect(graph.posByNodeId.n1).toEqual({ x: 80, y: 0 });
	});

	it('returns graph data with relaxed positions for initial render', () => {
		const graph = makeGraph({
			nodeCount: 2,
			pinned: [0],
			posByNodeId: {
				n0: { x: 0, y: 0 },
				n1: { x: 80, y: 0 }
			}
		});

		const relaxed = withRelaxedGraphPositions(graph, {
			settings: { baseRadius: 50, minScale: 1, hopRepulsionStrength: 0 },
			relaxIterations: 1
		});

		expect(relaxed).not.toBe(graph);
		expect(relaxed.nodes).toBe(graph.nodes);
		expect(relaxed.edges).toBe(graph.edges);
		expect(relaxed.posByNodeId.n0).toEqual({ x: 0, y: 0 });
		expect(relaxed.posByNodeId.n1).toEqual({ x: 100, y: 0 });
		expect(graph.posByNodeId.n1).toEqual({ x: 80, y: 0 });
	});

	it('settles larger graphs beyond the per-frame relaxation budget', () => {
		const nodeCount = 100;
		const graph = makeGraph({
			nodeCount,
			pinned: [0, 33, 66],
			edges: Array.from({ length: nodeCount - 1 }, (_, index) => [index, index + 1]),
			posByNodeId: Object.fromEntries(
				Array.from({ length: nodeCount }, (_, index) => {
					const angle = (index / nodeCount) * Math.PI * 2;
					return [`n${index}`, { x: Math.cos(angle) * 480, y: Math.sin(angle) * 480 }];
				})
			)
		});
		const settings = {
			baseRadius: 200,
			scaleFalloff: 0.7,
			minScale: 0.1,
			edgeSpringStrength: 0,
			hopRepulsionStrength: 0
		};
		const lightlyRelaxed = deriveGraphLayout(graph, { settings, relaxIterations: 4 });
		const settled = deriveGraphLayout(withSettledGraphPositions(graph, { settings }), {
			settings,
			relaxIterations: 0
		});

		expect(
			maxOverlapAmount(lightlyRelaxed.posByNodeId, lightlyRelaxed.radiusByNodeId)
		).toBeGreaterThan(5);
		expect(maxOverlapAmount(settled.posByNodeId, settled.radiusByNodeId)).toBeLessThan(0.01);
	});
});
