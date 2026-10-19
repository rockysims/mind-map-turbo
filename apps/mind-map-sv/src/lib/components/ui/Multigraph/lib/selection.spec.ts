import { describe, expect, it } from 'vitest';
import type { GraphAssetMetadata, MultigraphData, Point } from '../../types/multigraph';
import type { AiRun } from '../../types/node';
import { importGraphData } from './graphImport';
import type { NodeFocusCandidate, ViewTransform } from './nodeFocus';
import {
	inducedSubgraph,
	nodeIdsInScreenRect,
	pastePlacement,
	withSeededPinIfPinless
} from './selection';
import type { StageRect } from './stageCoordinates';
import { makeGraph } from './testFixtures';

// A 400×400 stage at the client origin with an identity view puts graph (0, 0)
// at client (200, 200), so every candidate below reads as "graph x + 200".
const STAGE: StageRect = { left: 0, top: 0, width: 400, height: 400 };
const IDENTITY: ViewTransform = { panX: 0, panY: 0, scale: 1 };
// Client x and y from 150 to 250: graph -50 to 50 around the origin.
const BOX: StageRect = { left: 150, top: 150, width: 100, height: 100 };

function candidate(id: string, position: Point, radius = 20): NodeFocusCandidate {
	return {
		node: { id, title: id, description: '', tags: [] },
		position,
		radius
	};
}

function asset(id: string): GraphAssetMetadata {
	return { id, kind: 'image', mimeType: 'image/png', name: id, size: 64, createdAt: 0 };
}

function runWithOutput(assetId: string): AiRun {
	return {
		id: 'r1',
		startedAt: 1,
		status: 'done',
		mode: 'analyse',
		runtime: '0.27.7',
		inputs: [],
		summary: '',
		outputs: [{ name: 'plot.png', assetId, mimeType: 'image/png' }],
		toolCalls: 1
	};
}

describe('nodeIdsInScreenRect', () => {
	// Centre outside the box, circle crossing its right edge: client 240–280.
	const crossing = candidate('crossing', { x: 60, y: 0 });
	// Centre inside the box, circle crossing its right edge: client 220–260.
	const straddling = candidate('straddling', { x: 40, y: 0 });
	// Wholly inside: client 180–220.
	const inside = candidate('inside', { x: 0, y: 0 });
	// Wholly outside: client 280–320.
	const outside = candidate('outside', { x: 100, y: 0 });
	const all = [crossing, straddling, inside, outside];

	describe("'intersect'", () => {
		it('takes a node whose circle crosses the box edge with its centre outside', () => {
			const ids = nodeIdsInScreenRect(all, BOX, STAGE, IDENTITY, { containment: 'intersect' });

			expect(ids).toEqual(['crossing', 'straddling', 'inside']);
		});

		it('is the default', () => {
			expect(nodeIdsInScreenRect(all, BOX, STAGE, IDENTITY)).toEqual(
				nodeIdsInScreenRect(all, BOX, STAGE, IDENTITY, { containment: 'intersect' })
			);
		});

		it('leaves a node off the corner whose bounding square overlaps but whose circle does not', () => {
			// Centre (265, 265) is 21.2 px from the box's corner at (250, 250).
			const offCorner = candidate('off-corner', { x: 65, y: 65 });

			expect(nodeIdsInScreenRect([offCorner], BOX, STAGE, IDENTITY)).toEqual([]);
		});

		it('takes a node just within a radius of the corner', () => {
			// Centre (263, 263) is 18.4 px from the corner.
			const nearCorner = candidate('near-corner', { x: 63, y: 63 });

			expect(nodeIdsInScreenRect([nearCorner], BOX, STAGE, IDENTITY)).toEqual(['near-corner']);
		});

		it('takes a node whose circle swallows the whole box', () => {
			const box: StageRect = { left: 250, top: 195, width: 10, height: 10 };
			const huge = candidate('huge', { x: 0, y: 0 }, 200);

			expect(nodeIdsInScreenRect([huge], box, STAGE, IDENTITY)).toEqual(['huge']);
			expect(nodeIdsInScreenRect([huge], box, STAGE, IDENTITY, { containment: 'center' })).toEqual(
				[]
			);
		});

		it('counts a circle that only touches the box', () => {
			// Client 250–290: the circle's left edge lies on the box's right edge.
			const touching = candidate('touching', { x: 70, y: 0 });

			expect(nodeIdsInScreenRect([touching], BOX, STAGE, IDENTITY)).toEqual(['touching']);
		});
	});

	describe("'center'", () => {
		it('takes only the nodes whose centre is inside the box', () => {
			const ids = nodeIdsInScreenRect(all, BOX, STAGE, IDENTITY, { containment: 'center' });

			expect(ids).toEqual(['straddling', 'inside']);
		});
	});

	describe("'enclose'", () => {
		it('takes only the nodes whose whole circle is inside the box', () => {
			const ids = nodeIdsInScreenRect(all, BOX, STAGE, IDENTITY, { containment: 'enclose' });

			expect(ids).toEqual(['inside']);
		});
	});

	describe('view and stage', () => {
		it('measures the on-screen circle, so zooming in grows the radius it is tested with', () => {
			const box: StageRect = { left: 0, top: 0, width: 100, height: 400 };
			const node = candidate('n0', { x: -60, y: 0 }, 30);
			// Both views put the centre at client x = 150; only the radius differs.
			const near: ViewTransform = { panX: 10, panY: 0, scale: 1 };
			const zoomed: ViewTransform = { panX: 70, panY: 0, scale: 2 };

			expect(nodeIdsInScreenRect([node], box, STAGE, near)).toEqual([]);
			expect(nodeIdsInScreenRect([node], box, STAGE, zoomed)).toEqual(['n0']);
		});

		it('reads the box in client pixels against a stage that is not at the origin', () => {
			const stage: StageRect = { left: 30, top: 40, width: 400, height: 400 };
			const node = candidate('n0', { x: 0, y: 0 }, 10);
			// Graph origin is at client (230, 240) on this stage, not (200, 200).
			const aroundIt: StageRect = { left: 220, top: 230, width: 20, height: 20 };
			const aroundTheOrigin: StageRect = { left: 190, top: 190, width: 20, height: 20 };

			expect(
				nodeIdsInScreenRect([node], aroundIt, stage, IDENTITY, { containment: 'enclose' })
			).toEqual(['n0']);
			expect(nodeIdsInScreenRect([node], aroundTheOrigin, stage, IDENTITY)).toEqual([]);
		});
	});

	it('returns ids in candidate order, not position order', () => {
		const ids = nodeIdsInScreenRect([inside, crossing, straddling], BOX, STAGE, IDENTITY);

		expect(ids).toEqual(['inside', 'crossing', 'straddling']);
	});

	it('takes nothing from no candidates', () => {
		expect(nodeIdsInScreenRect([], BOX, STAGE, IDENTITY)).toEqual([]);
	});

	it('leaves the candidate list untouched', () => {
		const candidates = [inside, outside];
		const snapshot = structuredClone(candidates);

		nodeIdsInScreenRect(candidates, BOX, STAGE, IDENTITY);

		expect(candidates).toEqual(snapshot);
	});
});

describe('inducedSubgraph', () => {
	/**
	 * n0 —supports— n1 —blocks— n2 — n3, plus a derived edge n0 → n1. n0 is an
	 * `!ai` node with an image block, a run output, and two promoted bindings;
	 * n3 holds the only reference to its own asset.
	 */
	function sourceGraph(): MultigraphData {
		const base = makeGraph({
			nodes: [
				{
					id: 'n0',
					title: 'Analysis',
					description: '',
					tags: ['topic'],
					content: [{ type: 'image', assetId: 'a-kept', alt: '' }],
					addons: {
						ai: {
							prompt: '',
							runs: [runWithOutput('a-output')],
							promoted: { 'plot.png': 'n1', 'table.csv': 'n3' }
						}
					}
				},
				{ id: 'n1', title: 'One', description: '', tags: ['topic'] },
				{ id: 'n2', title: 'Two', description: '', tags: [] },
				{
					id: 'n3',
					title: 'Three',
					description: '',
					tags: ['idea'],
					content: [{ type: 'file', assetId: 'a-dropped', name: 'notes.txt' }]
				}
			],
			edges: [
				{ source: 'n0', target: 'n1', tags: ['supports'] },
				{ source: 'n1', target: 'n2', tags: ['blocks'] },
				['n2', 'n3']
			],
			pinned: ['n1', 'n3'],
			pinHistory: { n1: 4, n2: 2, n3: 9 },
			posByNodeId: {
				n0: { x: 0, y: 0 },
				n1: { x: 100, y: 0 },
				n2: { x: 200, y: 50 },
				n3: { x: 300, y: 50 }
			},
			tagColorConfig: {
				nodeTags: { topic: '#111111', idea: '#222222' },
				edgeTags: { supports: '#333333', blocks: '#444444' }
			},
			tagPhysicsConfig: { nodeTags: { topic: 2, idea: 3 }, edgeTags: { blocks: 1.5 } },
			weightConfig: { label: 'Mass', unit: 'kg' }
		});

		return {
			...base,
			edges: [
				...base.edges,
				{
					id: 'dataflow:n0->n1',
					sourceNodeId: 'n0',
					targetNodeId: 'n1',
					tags: [],
					directed: true
				}
			],
			assets: {
				'a-kept': asset('a-kept'),
				'a-output': asset('a-output'),
				'a-dropped': asset('a-dropped'),
				'a-orphan': asset('a-orphan')
			},
			pinSequence: 9
		};
	}

	const FIRST_TWO = new Set(['n0', 'n1']);

	it('keeps the selected nodes in graph order, whatever order the set names them in', () => {
		const subgraph = inducedSubgraph(sourceGraph(), new Set(['n2', 'n0']));

		expect(subgraph.nodes.map((node) => node.id)).toEqual(['n0', 'n2']);
	});

	it('ignores an id with no node behind it', () => {
		const subgraph = inducedSubgraph(sourceGraph(), new Set(['n1', 'ghost']));

		expect(subgraph.nodes.map((node) => node.id)).toEqual(['n1']);
		expect(Object.keys(subgraph.posByNodeId)).toEqual(['n1']);
	});

	it('drops an edge to an unselected node and keeps the edge between two selected ones', () => {
		const subgraph = inducedSubgraph(sourceGraph(), FIRST_TWO);

		expect(subgraph.edges.map((edge) => [edge.sourceNodeId, edge.targetNodeId])).toEqual([
			['n0', 'n1']
		]);
	});

	it('drops a derived edge even when both its ends are selected', () => {
		const subgraph = inducedSubgraph(sourceGraph(), FIRST_TWO);

		expect(subgraph.edges.some((edge) => edge.id.startsWith('dataflow:'))).toBe(false);
	});

	it('carries positions for the selected nodes only, inventing none', () => {
		const data: MultigraphData = {
			...sourceGraph(),
			posByNodeId: { n0: { x: 5, y: 6 }, n3: { x: 7, y: 8 } }
		};

		const subgraph = inducedSubgraph(data, FIRST_TWO);

		expect(subgraph.posByNodeId).toEqual({ n0: { x: 5, y: 6 } });
	});

	it('carries the colours of the tags the copied nodes and edges use, and no others', () => {
		const subgraph = inducedSubgraph(sourceGraph(), FIRST_TWO);

		expect(subgraph.tagColorConfig).toEqual({
			nodeTags: { topic: '#111111' },
			edgeTags: { supports: '#333333' }
		});
	});

	it('carries the layout factors of used tags only', () => {
		const subgraph = inducedSubgraph(sourceGraph(), new Set(['n1', 'n2', 'n3']));

		expect(subgraph.tagPhysicsConfig).toEqual({
			nodeTags: { topic: 2, idea: 3 },
			edgeTags: { blocks: 1.5 }
		});
	});

	it('leaves out the layout factors altogether when no used tag has one', () => {
		const subgraph = inducedSubgraph(sourceGraph(), new Set(['n2']));

		expect('tagPhysicsConfig' in subgraph).toBe(false);
	});

	it('adds no layout factors to a copy of a graph that had none', () => {
		const untuned = sourceGraph();
		delete untuned.tagPhysicsConfig;

		const subgraph = inducedSubgraph(untuned, FIRST_TWO);

		expect('tagPhysicsConfig' in subgraph).toBe(false);
	});

	it('carries the metadata of the assets the copied nodes reference, run outputs included', () => {
		const subgraph = inducedSubgraph(sourceGraph(), FIRST_TWO);

		expect(Object.keys(subgraph.assets ?? {}).sort()).toEqual(['a-kept', 'a-output']);
	});

	it('does not carry an asset only an unselected node references', () => {
		const subgraph = inducedSubgraph(sourceGraph(), FIRST_TWO);

		expect(subgraph.assets?.['a-dropped']).toBeUndefined();
		expect(subgraph.assets?.['a-orphan']).toBeUndefined();
	});

	it('keeps an empty asset map when the source had one but nothing copied uses it', () => {
		const subgraph = inducedSubgraph(sourceGraph(), new Set(['n2']));

		expect(subgraph.assets).toEqual({});
	});

	it('adds no asset map to a copy of a graph that had none', () => {
		const assetless = sourceGraph();
		delete assetless.assets;

		const subgraph = inducedSubgraph(assetless, FIRST_TWO);

		expect('assets' in subgraph).toBe(false);
	});

	it('carries the weight config whole', () => {
		const subgraph = inducedSubgraph(sourceGraph(), new Set(['n2']));

		expect(subgraph.weightConfig).toEqual({ label: 'Mass', unit: 'kg' });
	});

	it('adds no weight config to a copy of a graph that had none', () => {
		const subgraph = inducedSubgraph(makeGraph({ nodeCount: 2 }), new Set(['n0']));

		expect('weightConfig' in subgraph).toBe(false);
	});

	it('takes the pin counter from the highest stamp among the copied nodes', () => {
		const subgraph = inducedSubgraph(sourceGraph(), new Set(['n0', 'n1', 'n2']));

		expect(subgraph.pinSequence).toBe(4);
	});

	it('leaves the pin counter out when no copied node carries a stamp', () => {
		const subgraph = inducedSubgraph(sourceGraph(), new Set(['n0']));

		expect('pinSequence' in subgraph).toBe(false);
	});

	it('drops a promoted binding to an unselected node and keeps one inside the selection', () => {
		const subgraph = inducedSubgraph(sourceGraph(), FIRST_TWO);

		expect(subgraph.nodes[0].addons?.ai?.promoted).toEqual({ 'plot.png': 'n1' });
	});

	it('keeps every binding when all their targets are selected', () => {
		const data = sourceGraph();

		const subgraph = inducedSubgraph(data, new Set(['n0', 'n1', 'n3']));

		expect(subgraph.nodes[0]).toBe(data.nodes[0]);
	});

	it('copies an empty selection as an empty graph', () => {
		const subgraph = inducedSubgraph(sourceGraph(), new Set());

		expect(subgraph.nodes).toEqual([]);
		expect(subgraph.edges).toEqual([]);
		expect(subgraph.posByNodeId).toEqual({});
		expect(subgraph.tagColorConfig).toEqual({ nodeTags: {}, edgeTags: {} });
	});

	describe('immutability', () => {
		it('mutates neither the graph nor the set', () => {
			const data = sourceGraph();
			const nodes = data.nodes;
			const edges = data.edges;
			const firstNode = data.nodes[0];
			const snapshot = structuredClone(data);
			const ids = new Set(FIRST_TWO);

			inducedSubgraph(data, ids);

			expect(data).toEqual(snapshot);
			expect(data.nodes).toBe(nodes);
			expect(data.edges).toBe(edges);
			expect(data.nodes[0]).toBe(firstNode);
			expect(data.nodes[0].addons?.ai?.promoted).toEqual({
				'plot.png': 'n1',
				'table.csv': 'n3'
			});
			expect([...ids]).toEqual([...FIRST_TWO]);
		});

		it('shares the kept node and edge objects with the source', () => {
			const data = sourceGraph();

			const subgraph = inducedSubgraph(data, new Set(['n1', 'n2']));

			expect(subgraph.nodes[0]).toBe(data.nodes[1]);
			expect(subgraph.nodes[1]).toBe(data.nodes[2]);
			expect(subgraph.edges[0]).toBe(data.edges[1]);
		});

		it('returns new containers rather than the source ones', () => {
			const data = sourceGraph();

			const subgraph = inducedSubgraph(data, new Set(data.nodes.map((node) => node.id)));

			expect(subgraph).not.toBe(data);
			expect(subgraph.posByNodeId).not.toBe(data.posByNodeId);
			expect(subgraph.tagColorConfig).not.toBe(data.tagColorConfig);
		});
	});
});

describe('pastePlacement', () => {
	it('centres the bounding box of the incoming nodes on the anchor', () => {
		const incoming = makeGraph({
			nodeCount: 3,
			posByNodeId: { n0: { x: 0, y: 0 }, n1: { x: 100, y: 50 }, n2: { x: 40, y: -30 } }
		});

		// Box x 0–100, y −30–50: centre (50, 10).
		expect(pastePlacement(incoming, { x: 200, y: 300 })).toEqual({ x: 150, y: 290 });
	});

	it('counts a node with no stored position at the origin', () => {
		const incoming: MultigraphData = {
			...makeGraph({ nodeCount: 2 }),
			posByNodeId: { n0: { x: 100, y: 100 } }
		};

		expect(pastePlacement(incoming, { x: 0, y: 0 })).toEqual({ x: -50, y: -50 });
	});

	it('moves a single node exactly onto the anchor', () => {
		const incoming = makeGraph({ nodeCount: 1, posByNodeId: { n0: { x: 30, y: -20 } } });

		expect(pastePlacement(incoming, { x: 5, y: 5 })).toEqual({ x: -25, y: 25 });
	});

	it('moves nothing for an empty graph', () => {
		expect(pastePlacement(makeGraph(), { x: 200, y: 300 })).toEqual({ x: 0, y: 0 });
	});

	it('lands an import centred on the anchor, keeping its internal layout', () => {
		const host = makeGraph({
			nodeCount: 2,
			posByNodeId: { n0: { x: 0, y: 0 }, n1: { x: 10, y: 0 } }
		});
		const incoming = makeGraph({
			nodeCount: 2,
			edges: [[0, 1]],
			posByNodeId: { n0: { x: -20, y: 0 }, n1: { x: 60, y: 40 } }
		});
		const anchor = { x: 500, y: -200 };

		const { next, nodeIdMap } = importGraphData(host, incoming, {
			offset: pastePlacement(incoming, anchor)
		});

		// The map is in incoming order, so these are n0's and n1's new positions.
		const [first, second] = [...nodeIdMap.values()].map((id) => next.posByNodeId[id]);
		expect({ x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }).toEqual(anchor);
		expect({ x: second.x - first.x, y: second.y - first.y }).toEqual({ x: 80, y: 40 });
	});
});

describe('withSeededPinIfPinless', () => {
	it('returns the same graph when a node is already pinned', () => {
		const incoming = makeGraph({ nodeCount: 3, edges: [[0, 1]], pinned: [2] });

		expect(withSeededPinIfPinless(incoming)).toBe(incoming);
	});

	it("pins a pinless component's hub with a fresh stamp", () => {
		const incoming: MultigraphData = {
			...makeGraph({
				nodeCount: 3,
				edges: [
					[0, 1],
					[1, 2]
				]
			}),
			pinSequence: 4
		};

		const seeded = withSeededPinIfPinless(incoming);

		const pinned = seeded.nodes.filter((node) => node.pinned);
		expect(pinned.map((node) => node.id)).toEqual(['n1']);
		expect(pinned[0].lastPinnedSeq).toBe(5);
		expect(seeded.pinSequence).toBe(5);
	});

	it('pins one node in each pinless component', () => {
		const incoming = makeGraph({ nodeCount: 4, edges: [[0, 1]] });

		const seeded = withSeededPinIfPinless(incoming);

		// n0–n1 is one component; n2 and n3 are each their own.
		expect(seeded.nodes.filter((node) => node.pinned)).toHaveLength(3);
	});

	it('returns an empty graph as it is', () => {
		const incoming = makeGraph();

		expect(withSeededPinIfPinless(incoming)).toBe(incoming);
	});

	it('leaves the input untouched', () => {
		const incoming = makeGraph({ nodeCount: 2, edges: [[0, 1]] });
		const nodes = incoming.nodes;
		const snapshot = structuredClone(incoming);

		withSeededPinIfPinless(incoming);

		expect(incoming).toEqual(snapshot);
		expect(incoming.nodes).toBe(nodes);
	});
});
