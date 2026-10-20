import { describe, expect, it } from 'vitest';
import type { EdgeData } from '../../types/edge';
import type { MultigraphData } from '../../types/multigraph';
import { composeVisibleLayoutGraph } from './boundedVisibility';
import {
	deriveGraphLayout,
	relaxGraphPositionsStep,
	relaxGraphPositions,
	withRelaxedGraphPositions,
	withSettledGraphPositions
} from './graphLayout';
import { hopsFromPinned, shortestPathHopsByNodeId } from './layout';
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
			hopsByNodeId: hopsFromPinned(graph),
			settings: { baseRadius: 100, scaleFalloff: 0.5, minScale: 0.2 },
			relaxIterations: 0
		});

		expect(layout.nodes.map((node) => node.nodeId)).toEqual(['n0', 'n1', 'n2']);
		expect(layout.hopsByNodeId).toEqual({ n0: 0, n1: 1, n2: 2 });
		expect(layout.scaleByNodeId).toEqual({ n0: 1, n1: 0.5, n2: 0.25 });
		expect(layout.radiusByNodeId).toEqual({ n0: 100, n1: 50, n2: 25 });
	});

	describe('a derived edge that joined the layout graph', () => {
		// Two nodes at the same reading distance, starting far enough apart that
		// whatever connects them has to pull. Everything here runs at the app's own
		// settings — the standoff this covers is a property of those numbers.
		const HOPS = { n0: 0, n1: 0 };
		const SETTLE_ITERATIONS = 400;

		function spreadPair(edges: [number, number][]): MultigraphData {
			return {
				...makeGraph({ nodeCount: 2, edges }),
				posByNodeId: { n0: { x: 0, y: 0 }, n1: { x: 1200, y: 0 } }
			};
		}

		function derivedEdge(springFactor: number): EdgeData {
			return {
				id: 'dataflow:n0->n1',
				sourceNodeId: 'n0',
				targetNodeId: 'n1',
				tags: [],
				directed: true,
				springFactor
			};
		}

		function pairJoinedOnlyByDataflow(springFactor = 1): MultigraphData {
			return composeVisibleLayoutGraph(spreadPair([]), new Set(['n0', 'n1']), [
				derivedEdge(springFactor)
			]);
		}

		function settledDistance(graph: MultigraphData): number {
			const settled = withSettledGraphPositions(graph, {
				hopsByNodeId: HOPS,
				relaxIterations: SETTLE_ITERATIONS
			});
			const source = settled.posByNodeId.n0;
			const target = settled.posByNodeId.n1;
			return Math.hypot(target.x - source.x, target.y - source.y);
		}

		it('settles a derived-only pair where an authored pair settles', () => {
			// The reason the side channel had to go. A spring-only edge left the pair
			// unreachable in `data.edges`, so hop repulsion — which maps unreachable
			// to its maximum push — shoved at full strength against the very spring
			// pulling them together: 950px of standoff against an authored 736px, and
			// a tug-of-war that burned settle frames getting there.
			const authored = settledDistance(spreadPair([[0, 1]]));
			const derived = settledDistance(pairJoinedOnlyByDataflow());

			expect(derived).toBeGreaterThan(authored * 0.97);
			expect(derived).toBeLessThan(authored * 1.03);
		});

		it('makes the pair neighbors for hop repulsion instead of unreachable', () => {
			expect(shortestPathHopsByNodeId(pairJoinedOnlyByDataflow()).n0.n1).toBe(1);
			// Without the composition this is the number repulsion was reading.
			expect(shortestPathHopsByNodeId(spreadPair([])).n0.n1).toBe(Infinity);
		});

		it('scales the pull by the edge factor', () => {
			const full = settledDistance(pairJoinedOnlyByDataflow(1));
			const half = settledDistance(pairJoinedOnlyByDataflow(0.5));

			// Weaker spring, same repulsion: the pair comes to rest further apart.
			expect(half).toBeGreaterThan(full);
		});

		it('leaves distance and scale to the hop map it was handed', () => {
			// A derived edge connects the pair for force, but how big a node is drawn
			// is still the one bounded hop map's answer, never a fresh measure here.
			const layout = deriveGraphLayout(pairJoinedOnlyByDataflow(), {
				hopsByNodeId: { n0: 0 },
				settings: { minScale: 0.2 },
				relaxIterations: 0
			});

			expect(layout.hopsByNodeId.n1).toBe(Infinity);
			expect(layout.scaleByNodeId.n1).toBe(0.2);
		});
	});

	it('uses min scale for disconnected nodes', () => {
		const graph = makeGraph({
			nodeCount: 3,
			pinned: [0],
			edges: [[0, 1]]
		});

		const layout = deriveGraphLayout(graph, {
			hopsByNodeId: hopsFromPinned(graph),
			settings: { baseRadius: 100, minScale: 0.2 },
			relaxIterations: 0
		});

		expect(layout.hopsByNodeId.n2).toBe(Infinity);
		expect(layout.scaleByNodeId.n2).toBe(0.2);
		expect(layout.radiusByNodeId.n2).toBe(20);
	});

	it('scales from the hop map it is handed rather than measuring the graph itself', () => {
		// n2 has no edge to the pin, so a BFS over this graph would call it
		// unreachable. Whoever owns the whole graph knows better — an equation
		// reaches it, or it is its cluster's beacon — and the layout takes their
		// word for it. Nodes the map has never heard of are simply not here.
		const graph = makeGraph({
			nodeCount: 3,
			pinned: [0],
			edges: [[0, 1]]
		});

		const layout = deriveGraphLayout(graph, {
			settings: { baseRadius: 100, scaleFalloff: 0.5, minScale: 0.2 },
			hopsByNodeId: { n0: 0, n1: 1, n2: 1, 'missing-node': 1 },
			relaxIterations: 0
		});

		expect(layout.hopsByNodeId.n2).toBe(1);
		expect(layout.scaleByNodeId.n2).toBe(0.5);
		expect(layout.radiusByNodeId.n2).toBe(50);
		expect('missing-node' in layout.hopsByNodeId).toBe(false);
	});

	it('treats a node the hop map leaves out as unreachable', () => {
		const graph = makeGraph({ nodeCount: 2, pinned: [0], edges: [[0, 1]] });

		const layout = deriveGraphLayout(graph, {
			settings: { baseRadius: 100, minScale: 0.2 },
			hopsByNodeId: { n0: 0 },
			relaxIterations: 0
		});

		expect(layout.hopsByNodeId.n1).toBe(Infinity);
		expect(layout.scaleByNodeId.n1).toBe(0.2);
	});

	describe('repulsionFactorByNodeId', () => {
		// A chain n0 — n1 — n2 laid out on a line, so n0 and n2 are a
		// non-adjacent pair held apart by hop repulsion's extra clearance.
		const graph = makeGraph({
			nodeCount: 3,
			pinned: [0],
			edges: [
				[0, 1],
				[1, 2]
			],
			posByNodeId: { n0: { x: 0, y: 0 }, n1: { x: 120, y: 0 }, n2: { x: 240, y: 0 } }
		});

		function settledGapN0ToN2(repulsionFactorByNodeId?: Record<string, number>): number {
			const layout = deriveGraphLayout(graph, {
				hopsByNodeId: { n0: 0, n1: 1, n2: 2 },
				settings: { baseRadius: 100 },
				relaxIterations: 400,
				repulsionFactorByNodeId
			});
			const source = layout.posByNodeId.n0;
			const target = layout.posByNodeId.n2;
			return Math.hypot(target.x - source.x, target.y - source.y);
		}

		it('pushes a non-adjacent pair further apart when a node holds more clearance', () => {
			expect(settledGapN0ToN2({ n2: 4 })).toBeGreaterThan(settledGapN0ToN2() + 1);
		});

		it('lays out exactly as without it when the map is empty', () => {
			expect(settledGapN0ToN2({})).toBe(settledGapN0ToN2());
		});
	});

	// An import is parked beside its host with the two components touching, and
	// nothing connects them, so whatever the layout does next is where they stay.
	describe('two disconnected components parked side by side', () => {
		const BASE_RADIUS = 200;
		const RADIUS_SUM = BASE_RADIUS * 2;

		function settledDistance(): number {
			const graph = {
				...makeGraph({ nodeCount: 2 }),
				posByNodeId: { n0: { x: 0, y: 0 }, n1: { x: RADIUS_SUM, y: 0 } }
			};

			const settled = withSettledGraphPositions(graph, {
				hopsByNodeId: { n0: 0, n1: 0 },
				settings: { baseRadius: BASE_RADIUS },
				relaxIterations: 400
			});

			return Math.hypot(
				settled.posByNodeId.n1.x - settled.posByNodeId.n0.x,
				settled.posByNodeId.n1.y - settled.posByNodeId.n0.y
			);
		}

		it('leaves them close to touching instead of flinging them apart', () => {
			// The old ramp read `Infinity` hops as the hop cap and settled these at
			// three radius sums — the import ended up most of a screen from its host.
			expect(settledDistance()).toBeGreaterThanOrEqual(RADIUS_SUM);
			expect(settledDistance()).toBeLessThan(RADIUS_SUM * 1.2);
		});
	});

	it('uses animated scale overrides for radii and physics', () => {
		const graph = makeGraph({
			nodeCount: 2,
			pinned: [0],
			posByNodeId: {
				n0: { x: 0, y: 0 },
				n1: { x: 80, y: 0 }
			}
		});

		const layout = deriveGraphLayout(graph, {
			hopsByNodeId: hopsFromPinned(graph),
			settings: { baseRadius: 100, minScale: 0.2, hopRepulsionStrength: 0 },
			scaleByNodeId: { n1: 0.6 },
			relaxIterations: 1
		});

		expect(layout.scaleByNodeId.n1).toBe(0.6);
		expect(layout.radiusByNodeId.n1).toBe(60);
		expect(layout.posByNodeId.n1.x).toBe(160);
	});

	it('anchors nodes listed in scaleAnchoredNodeIds during relaxation', () => {
		const graph = makeGraph({
			nodeCount: 2,
			edges: [[0, 1]],
			posByNodeId: {
				n0: { x: 0, y: 0 },
				n1: { x: 80, y: 0 }
			}
		});

		const layout = deriveGraphLayout(graph, {
			hopsByNodeId: hopsFromPinned(graph),
			settings: { baseRadius: 50, minScale: 1, relaxIterations: 1 },
			scaleAnchoredNodeIds: ['n0']
		});

		expect(layout.nodes.find((node) => node.nodeId === 'n0')?.anchored).toBe(true);
		expect(layout.posByNodeId.n0).toEqual({ x: 0, y: 0 });
		expect(layout.posByNodeId.n1.x).not.toBe(80);
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
			hopsByNodeId: hopsFromPinned(graph),
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

	describe('heldNodeIds', () => {
		// Two held nodes far apart on a stretched edge, and a free one beside the
		// first: an unheld pair would close the gap, and the free node is there
		// to show the relax still runs around them.
		const graph = makeGraph({
			nodeCount: 3,
			edges: [
				[0, 1],
				[0, 2]
			],
			posByNodeId: {
				n0: { x: 0, y: 0 },
				n1: { x: 500, y: 0 },
				n2: { x: 0, y: 300 }
			}
		});
		const settings = {
			baseRadius: 20,
			minScale: 1,
			edgeGapMinRadiusFactor: 1,
			edgeGapMaxRadiusFactor: 2.5,
			edgeSpringStrength: 1
		};

		it('anchors held nodes while relaxing positions, as it anchors a pin', () => {
			const layout = deriveGraphLayout(graph, {
				hopsByNodeId: hopsFromPinned(graph),
				heldNodeIds: ['n0', 'n1'],
				settings,
				relaxIterations: 5
			});

			expect(layout.nodes.find((node) => node.nodeId === 'n0')?.anchored).toBe(true);
			expect(layout.nodes.find((node) => node.nodeId === 'n1')?.anchored).toBe(true);
			expect(layout.nodes.find((node) => node.nodeId === 'n2')?.anchored).toBe(false);
			expect(layout.posByNodeId.n0).toEqual({ x: 0, y: 0 });
			expect(layout.posByNodeId.n1).toEqual({ x: 500, y: 0 });
			// The free node still answers to its edge into the held one.
			expect(layout.posByNodeId.n2.y).toBeLessThan(300);
		});

		it('holds them through a frame step, normalization included', () => {
			const step = relaxGraphPositionsStep(graph, {
				hopsByNodeId: hopsFromPinned(graph),
				heldNodeIds: ['n0', 'n1'],
				settings,
				relaxIterations: 1
			});

			expect(step.data.posByNodeId.n0).toEqual({ x: 0, y: 0 });
			expect(step.data.posByNodeId.n1).toEqual({ x: 500, y: 0 });
		});

		it('ignores an id with no node behind it', () => {
			const held = deriveGraphLayout(graph, {
				hopsByNodeId: hopsFromPinned(graph),
				heldNodeIds: ['gone'],
				settings,
				relaxIterations: 5
			});
			const free = deriveGraphLayout(graph, {
				hopsByNodeId: hopsFromPinned(graph),
				settings,
				relaxIterations: 5
			});

			expect(held.posByNodeId).toEqual(free.posByNodeId);
		});
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
			hopsByNodeId: hopsFromPinned(graph),
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
			hopsByNodeId: hopsFromPinned(graph),
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
			hopsByNodeId: hopsFromPinned(graph),
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

	it('returns a relaxation step with the largest position delta', () => {
		const graph = makeGraph({
			nodeCount: 2,
			pinned: [0],
			posByNodeId: {
				n0: { x: 0, y: 0 },
				n1: { x: 80, y: 0 }
			}
		});

		const step = relaxGraphPositionsStep(graph, {
			hopsByNodeId: hopsFromPinned(graph),
			settings: { baseRadius: 50, minScale: 1, hopRepulsionStrength: 0 },
			relaxIterations: 1
		});

		expect(step.data.posByNodeId.n1).toEqual({ x: 100, y: 0 });
		expect(step.maxPositionDelta).toBe(20);
	});

	it('normalizes unanchored per-frame drift and measures the corrected delta', () => {
		const graph = makeGraph({
			nodeCount: 2,
			edges: [[0, 1]],
			posByNodeId: {
				n0: { x: 0, y: 0 },
				n1: { x: 80, y: 0 }
			}
		});
		const settings = {
			baseRadius: 50,
			minScale: 1,
			edgeGapMinRadiusFactor: 0.2,
			edgeGapMaxRadiusFactor: 0.4,
			edgeSpringStrength: 1,
			hopRepulsionStrength: 0
		};

		const step = relaxGraphPositionsStep(graph, {
			hopsByNodeId: hopsFromPinned(graph),
			settings,
			relaxIterations: 1,
			mobilityByNodeId: { n0: 0.25, n1: 1 }
		});
		const unnormalizedStep = relaxGraphPositionsStep(graph, {
			hopsByNodeId: hopsFromPinned(graph),
			settings: {
				...settings,
				normalizeRelaxationTranslation: false,
				normalizeRelaxationRotation: false
			},
			relaxIterations: 1,
			mobilityByNodeId: { n0: 0.25, n1: 1 }
		});

		expect(step.data.posByNodeId).toEqual({ n0: { x: -20, y: 0 }, n1: { x: 100, y: 0 } });
		expect(step.maxPositionDelta).toBe(20);
		expect(unnormalizedStep.data.posByNodeId).toEqual({
			n0: { x: -8, y: 0 },
			n1: { x: 112, y: 0 }
		});
		expect(unnormalizedStep.maxPositionDelta).toBe(32);
	});

	it('does not normalize per-frame movement while a node is actively dragged', () => {
		const graph = makeGraph({
			nodeCount: 2,
			edges: [[0, 1]],
			posByNodeId: {
				n0: { x: 0, y: 0 },
				n1: { x: 80, y: 0 }
			}
		});
		const settings = {
			baseRadius: 50,
			minScale: 1,
			edgeGapMinRadiusFactor: 0.2,
			edgeGapMaxRadiusFactor: 0.4,
			edgeSpringStrength: 1,
			hopRepulsionStrength: 0
		};

		const step = relaxGraphPositionsStep(graph, {
			hopsByNodeId: hopsFromPinned(graph),
			activeDragNodeId: 'dragging-node',
			settings,
			relaxIterations: 1,
			mobilityByNodeId: { n0: 0.25, n1: 1 }
		});
		const normalizationDisabledStep = relaxGraphPositionsStep(graph, {
			hopsByNodeId: hopsFromPinned(graph),
			activeDragNodeId: 'dragging-node',
			settings: {
				...settings,
				normalizeRelaxationTranslation: false,
				normalizeRelaxationRotation: false
			},
			relaxIterations: 1,
			mobilityByNodeId: { n0: 0.25, n1: 1 }
		});

		expect(step).toEqual(normalizationDisabledStep);
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
		const hopsByNodeId = hopsFromPinned(graph);
		const lightlyRelaxed = deriveGraphLayout(graph, {
			hopsByNodeId,
			settings,
			relaxIterations: 4
		});
		const settled = deriveGraphLayout(
			withSettledGraphPositions(graph, { hopsByNodeId, settings }),
			{
				hopsByNodeId,
				settings,
				relaxIterations: 0
			}
		);

		expect(
			maxOverlapAmount(lightlyRelaxed.posByNodeId, lightlyRelaxed.radiusByNodeId)
		).toBeGreaterThan(5);
		expect(maxOverlapAmount(settled.posByNodeId, settled.radiusByNodeId)).toBeLessThan(0.01);
	});
});
