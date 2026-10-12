import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../../../../appConfig';
import type { GraphAssetMetadata, MultigraphData } from '../../types/multigraph';
import { importGraphData } from './graphImport';
import { makeGraph, makeRandomEdges } from './testFixtures';

const EMPTY_GRAPH: MultigraphData = makeGraph();

function asset(id: string, name: string): GraphAssetMetadata {
	return { id, kind: 'image', mimeType: 'image/png', name, size: 128, createdAt: 0 };
}

/** Every id in the graph, node and edge alike — they must all be distinct. */
function allIds(data: MultigraphData): string[] {
	return [...data.nodes.map((node) => node.id), ...data.edges.map((edge) => edge.id)];
}

function duplicates(ids: string[]): string[] {
	const seen = new Set<string>();
	const repeated: string[] = [];
	for (const id of ids) {
		if (seen.has(id)) repeated.push(id);
		seen.add(id);
	}
	return repeated;
}

describe('importGraphData', () => {
	describe('id remapping', () => {
		it('doubles the nodes with no duplicate ids when a graph imports itself', () => {
			const graph = makeGraph({
				nodeCount: 3,
				edges: [
					[0, 1],
					[1, 2]
				]
			});

			const { next } = importGraphData(graph, graph);

			expect(next.nodes).toHaveLength(6);
			expect(next.edges).toHaveLength(4);
			expect(duplicates(allIds(next))).toEqual([]);
		});

		it('leaves every edge in a self-import resolving to a real node', () => {
			const graph = makeGraph({
				nodeCount: 3,
				edges: [
					[0, 1],
					[1, 2]
				]
			});

			const { next } = importGraphData(graph, graph);

			const nodeIds = new Set(next.nodes.map((node) => node.id));
			for (const edge of next.edges) {
				expect(nodeIds.has(edge.sourceNodeId)).toBe(true);
				expect(nodeIds.has(edge.targetNodeId)).toBe(true);
			}
		});

		it('keeps the two components disconnected', () => {
			const host = makeGraph({ nodeCount: 2, edges: [[0, 1]] });
			const incoming = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

			const { next, nodeIdMap } = importGraphData(host, incoming);

			const importedIds = new Set(nodeIdMap.values());
			for (const edge of next.edges) {
				expect(importedIds.has(edge.sourceNodeId)).toBe(importedIds.has(edge.targetNodeId));
			}
		});

		it('mints host-style ids into gaps the host left', () => {
			const host = makeGraph({
				nodes: [
					{ id: 'n0', title: 'Zero', description: '', tags: [] },
					{ id: 'n2', title: 'Two', description: '', tags: [] }
				]
			});
			const incoming = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

			const { next, nodeIdMap, edgeIdMap } = importGraphData(host, incoming);

			expect([...nodeIdMap.entries()]).toEqual([
				['n0', 'n1'],
				['n1', 'n3']
			]);
			expect([...edgeIdMap.entries()]).toEqual([['e0', 'e0']]);
			expect(next.nodes.map((node) => node.id)).toEqual(['n0', 'n2', 'n1', 'n3']);
		});

		it('rewrites edge endpoints through the node map', () => {
			const host = makeGraph({ nodeCount: 1 });
			const incoming = makeGraph({
				nodeCount: 2,
				edges: [{ source: 0, target: 1, tags: ['supports'], directed: true }]
			});

			const { next, nodeIdMap } = importGraphData(host, incoming);

			expect(next.edges).toHaveLength(1);
			expect(next.edges[0]).toMatchObject({
				sourceNodeId: nodeIdMap.get('n0'),
				targetNodeId: nodeIdMap.get('n1'),
				tags: ['supports'],
				directed: true
			});
		});

		it('never emits a derived edge id, and drops incoming derived edges', () => {
			const host = makeGraph({ nodeCount: 1 });
			const incoming = makeGraph({ nodeCount: 2, edges: [[0, 1]] });
			const withDerived: MultigraphData = {
				...incoming,
				edges: [
					...incoming.edges,
					{
						id: 'dataflow:n0->n1',
						sourceNodeId: 'n0',
						targetNodeId: 'n1',
						tags: [],
						directed: true
					}
				]
			};

			const { next, edgeIdMap } = importGraphData(host, withDerived);

			expect(next.edges).toHaveLength(1);
			expect(edgeIdMap.has('dataflow:n0->n1')).toBe(false);
			for (const id of allIds(next)) expect(id.startsWith('dataflow:')).toBe(false);
		});

		it('imports an empty graph as a no-op on content', () => {
			const host = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

			const { next, nodeIdMap } = importGraphData(host, EMPTY_GRAPH);

			expect(nodeIdMap.size).toBe(0);
			expect(next.nodes).toEqual(host.nodes);
			expect(next.edges).toEqual(host.edges);
		});

		it('imports into an empty host without renaming anything away', () => {
			const incoming = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

			const { next } = importGraphData(EMPTY_GRAPH, incoming);

			expect(next.nodes.map((node) => node.id)).toEqual(['n0', 'n1']);
			expect(next.edges.map((edge) => edge.id)).toEqual(['e0']);
		});

		it('assigns every id exactly once across a large import (property-style)', () => {
			const host = makeGraph({
				nodeCount: 40,
				edges: makeRandomEdges({ nodeCount: 40, edgeCount: 60, seed: 7 })
			});
			const incoming = makeGraph({
				nodeCount: 25,
				edges: makeRandomEdges({ nodeCount: 25, edgeCount: 40, seed: 13 })
			});

			const { next, nodeIdMap, edgeIdMap } = importGraphData(host, incoming);

			const ids = allIds(next);
			expect(duplicates(ids)).toEqual([]);
			expect(ids).toHaveLength(next.nodes.length + next.edges.length);
			// Injective as well as collision-free: distinct incoming ids never share
			// a minted id, and no minted id lands on a host id.
			expect(new Set(nodeIdMap.values()).size).toBe(nodeIdMap.size);
			expect(new Set(edgeIdMap.values()).size).toBe(edgeIdMap.size);
			const hostNodeIds = new Set(host.nodes.map((node) => node.id));
			for (const minted of nodeIdMap.values()) expect(hostNodeIds.has(minted)).toBe(false);
		});
	});

	describe('positions', () => {
		it('gives every node a position entry and leaves no orphan keys', () => {
			const host = makeGraph({ nodeCount: 2, edges: [[0, 1]] });
			const incoming = makeGraph({
				nodeCount: 3,
				posByNodeId: { n0: { x: 5, y: 5 }, n1: { x: 15, y: 25 }, n2: { x: -5, y: 0 } }
			});

			const { next } = importGraphData(host, incoming);

			expect(Object.keys(next.posByNodeId).sort()).toEqual(next.nodes.map((n) => n.id).sort());
		});

		it('places the incoming bounding box clear of the host bounding box', () => {
			const host = makeGraph({
				nodeCount: 2,
				posByNodeId: { n0: { x: 0, y: 0 }, n1: { x: 300, y: 100 } }
			});
			const incoming = makeGraph({
				nodeCount: 2,
				posByNodeId: { n0: { x: -50, y: -50 }, n1: { x: 50, y: 50 } }
			});

			const { next, nodeIdMap } = importGraphData(host, incoming);

			const hostMaxX = Math.max(next.posByNodeId.n0.x, next.posByNodeId.n1.x);
			const importedXs = [...nodeIdMap.values()].map((id) => next.posByNodeId[id].x);
			expect(Math.min(...importedXs)).toBeGreaterThan(hostMaxX);
			// Two radii, so the two components start out touching. Physics no longer
			// drives disconnected parts apart, so the parked gap is the gap.
			expect(Math.min(...importedXs) - hostMaxX).toBe(APP_CONFIG.multigraph.nodeRadiusPx * 2);
		});

		it('translates the incoming graph rigidly, preserving its internal geometry', () => {
			const host = makeGraph({ nodeCount: 1, posByNodeId: { n0: { x: 0, y: 0 } } });
			const incoming = makeGraph({
				nodeCount: 3,
				posByNodeId: { n0: { x: 0, y: 0 }, n1: { x: 120, y: -40 }, n2: { x: -60, y: 80 } }
			});

			const { next, nodeIdMap, offset } = importGraphData(host, incoming);

			for (const [incomingId, mintedId] of nodeIdMap) {
				expect(next.posByNodeId[mintedId]).toEqual({
					x: incoming.posByNodeId[incomingId].x + offset.x,
					y: incoming.posByNodeId[incomingId].y + offset.y
				});
			}
		});

		it('does not translate anything when the host is empty', () => {
			const incoming = makeGraph({
				nodeCount: 2,
				posByNodeId: { n0: { x: 10, y: 20 }, n1: { x: 30, y: 40 } }
			});

			const { next, offset } = importGraphData(EMPTY_GRAPH, incoming);

			expect(offset).toEqual({ x: 0, y: 0 });
			expect(next.posByNodeId).toEqual(incoming.posByNodeId);
		});

		it('defaults a missing incoming position to the origin before offsetting', () => {
			const host = makeGraph({ nodeCount: 1, posByNodeId: { n0: { x: 0, y: 0 } } });
			const incoming: MultigraphData = {
				...makeGraph({ nodeCount: 2 }),
				posByNodeId: { n1: { x: 0, y: 0 } }
			};

			const { next, nodeIdMap, offset } = importGraphData(host, incoming);

			expect(next.posByNodeId[nodeIdMap.get('n0') as string]).toEqual(offset);
		});

		it('drops incoming position keys with no node behind them', () => {
			const host = makeGraph({ nodeCount: 1 });
			const incoming: MultigraphData = {
				...makeGraph({ nodeCount: 1 }),
				posByNodeId: { n0: { x: 0, y: 0 }, ghost: { x: 999, y: 999 } }
			};

			const { next } = importGraphData(host, incoming);

			expect(Object.keys(next.posByNodeId)).toHaveLength(2);
			expect(Object.values(next.posByNodeId)).not.toContainEqual({ x: 999, y: 999 });
		});

		it('leaves the host positions untouched', () => {
			const host = makeGraph({
				nodeCount: 2,
				posByNodeId: { n0: { x: -10, y: -10 }, n1: { x: 40, y: 90 } }
			});

			const { next } = importGraphData(host, makeGraph({ nodeCount: 2 }));

			expect(next.posByNodeId.n0).toEqual({ x: -10, y: -10 });
			expect(next.posByNodeId.n1).toEqual({ x: 40, y: 90 });
		});
	});

	describe('tag colors', () => {
		it('keeps the host color when both graphs color the same tag name', () => {
			const host = makeGraph({
				nodeCount: 1,
				tagColorConfig: { nodeTags: { topic: '#111111' }, edgeTags: { supports: '#222222' } }
			});
			const incoming = makeGraph({
				nodeCount: 1,
				tagColorConfig: { nodeTags: { topic: '#aaaaaa' }, edgeTags: { supports: '#bbbbbb' } }
			});

			const { next } = importGraphData(host, incoming);

			expect(next.tagColorConfig.nodeTags.topic).toBe('#111111');
			expect(next.tagColorConfig.edgeTags.supports).toBe('#222222');
		});

		it('adds tags only the incoming graph colored', () => {
			const host = makeGraph({
				nodeCount: 1,
				tagColorConfig: { nodeTags: { topic: '#111111' }, edgeTags: {} }
			});
			const incoming = makeGraph({
				nodeCount: 1,
				tagColorConfig: { nodeTags: { idea: '#cccccc' }, edgeTags: { blocks: '#dddddd' } }
			});

			const { next } = importGraphData(host, incoming);

			expect(next.tagColorConfig.nodeTags).toEqual({ topic: '#111111', idea: '#cccccc' });
			expect(next.tagColorConfig.edgeTags).toEqual({ blocks: '#dddddd' });
		});
	});

	describe('tag physics factors', () => {
		it('keeps the host factor when both graphs tune the same tag name', () => {
			const host = makeGraph({
				nodeCount: 1,
				tagPhysicsConfig: { nodeTags: { topic: 2 }, edgeTags: { supports: 0.5 } }
			});
			const incoming = makeGraph({
				nodeCount: 1,
				tagPhysicsConfig: { nodeTags: { topic: 4 }, edgeTags: { supports: 3 } }
			});

			const { next } = importGraphData(host, incoming);

			expect(next.tagPhysicsConfig).toEqual({
				nodeTags: { topic: 2 },
				edgeTags: { supports: 0.5 }
			});
		});

		it('brings along the factor of a tag only the incoming graph tuned', () => {
			const host = makeGraph({
				nodeCount: 1,
				tagPhysicsConfig: { nodeTags: { topic: 2 }, edgeTags: {} }
			});
			const incoming = makeGraph({
				nodeCount: 1,
				tagPhysicsConfig: { nodeTags: { idea: 1.5 }, edgeTags: { blocks: 0.75 } }
			});

			const { next } = importGraphData(host, incoming);

			expect(next.tagPhysicsConfig).toEqual({
				nodeTags: { topic: 2, idea: 1.5 },
				edgeTags: { blocks: 0.75 }
			});
		});

		it('brings the incoming factors into an untuned host', () => {
			const host = makeGraph({ nodeCount: 1 });
			const incoming = makeGraph({
				nodeCount: 1,
				tagPhysicsConfig: { nodeTags: {}, edgeTags: { blocks: 2 } }
			});

			const { next } = importGraphData(host, incoming);

			expect(next.tagPhysicsConfig).toEqual({ nodeTags: {}, edgeTags: { blocks: 2 } });
		});

		it('adds no field when neither graph tuned a tag', () => {
			const { next } = importGraphData(makeGraph({ nodeCount: 1 }), makeGraph({ nodeCount: 1 }));

			expect('tagPhysicsConfig' in next).toBe(false);
		});
	});

	describe('pin sequencing', () => {
		it('rebases incoming stamps past the host maximum, preserving their order', () => {
			const host = makeGraph({
				nodeCount: 2,
				pinned: [0],
				pinHistory: { 0: 4, 1: 7 }
			});
			const incoming = makeGraph({
				nodeCount: 3,
				pinned: [0, 2],
				pinHistory: { 0: 1, 1: 2, 2: 5 }
			});

			const { next, nodeIdMap } = importGraphData(host, incoming);

			const stampFor = (incomingId: string) =>
				next.nodes.find((node) => node.id === nodeIdMap.get(incomingId))?.lastPinnedSeq as number;

			expect(stampFor('n0')).toBeGreaterThan(7);
			expect(stampFor('n1')).toBeGreaterThan(stampFor('n0'));
			expect(stampFor('n2')).toBeGreaterThan(stampFor('n1'));
			// Relative gaps survive too, so recency distances read the same.
			expect(stampFor('n1') - stampFor('n0')).toBe(1);
			expect(stampFor('n2') - stampFor('n1')).toBe(3);
		});

		it('measures the host ceiling from pinSequence when it leads the stamps', () => {
			const host: MultigraphData = {
				...makeGraph({ nodeCount: 1, pinned: [0], pinHistory: { 0: 2 } }),
				pinSequence: 9
			};
			const incoming = makeGraph({ nodeCount: 1, pinned: [0], pinHistory: { 0: 1 } });

			const { next, nodeIdMap } = importGraphData(host, incoming);

			const imported = next.nodes.find((node) => node.id === nodeIdMap.get('n0'));
			expect(imported?.lastPinnedSeq).toBe(10);
			expect(next.pinSequence).toBe(10);
		});

		it('leaves unstamped incoming nodes unstamped', () => {
			const host = makeGraph({ nodeCount: 1, pinned: [0], pinHistory: { 0: 3 } });
			const incoming = makeGraph({ nodeCount: 2, pinned: [1], pinHistory: { 1: 1 } });

			const { next, nodeIdMap } = importGraphData(host, incoming);

			const first = next.nodes.find((node) => node.id === nodeIdMap.get('n0'));
			expect(first?.lastPinnedSeq).toBeUndefined();
		});

		it('takes the result counter as the maximum of both after rebasing', () => {
			const host: MultigraphData = {
				...makeGraph({ nodeCount: 1, pinned: [0], pinHistory: { 0: 5 } }),
				pinSequence: 5
			};
			const incoming: MultigraphData = {
				...makeGraph({ nodeCount: 2, pinned: [0, 1], pinHistory: { 0: 1, 1: 4 } }),
				pinSequence: 6
			};

			const { next } = importGraphData(host, incoming);

			const stamps = next.nodes.map((node) => node.lastPinnedSeq ?? 0);
			// Incoming counter (6) rebased by the same shift outranks its own stamps.
			expect(next.pinSequence).toBe(11);
			expect(next.pinSequence).toBeGreaterThanOrEqual(Math.max(...stamps));
		});

		it('stacks a bare incoming counter on the host ceiling', () => {
			const host: MultigraphData = { ...makeGraph({ nodeCount: 1 }), pinSequence: 4 };
			const incoming: MultigraphData = { ...makeGraph({ nodeCount: 1 }), pinSequence: 3 };

			const { next } = importGraphData(host, incoming);

			expect(next.pinSequence).toBe(7);
		});

		it('leaves the counter absent when neither graph has one', () => {
			const { next } = importGraphData(makeGraph({ nodeCount: 1 }), makeGraph({ nodeCount: 1 }));

			expect(next.pinSequence).toBeUndefined();
			expect('pinSequence' in next).toBe(false);
		});

		it('carries the pinned flag across unchanged', () => {
			const host = makeGraph({ nodeCount: 1 });
			const incoming = makeGraph({ nodeCount: 2, pinned: [1], pinHistory: { 1: 1 } });

			const { next, nodeIdMap } = importGraphData(host, incoming);

			expect(next.nodes.find((node) => node.id === nodeIdMap.get('n1'))?.pinned).toBe(true);
		});
	});

	describe('assets', () => {
		it('unions both metadata maps without letting the import overwrite the host', () => {
			const host: MultigraphData = {
				...makeGraph({ nodeCount: 1 }),
				assets: { shared: asset('shared', 'host copy'), 'host-only': asset('host-only', 'host') }
			};
			const incoming: MultigraphData = {
				...makeGraph({ nodeCount: 1 }),
				assets: {
					shared: asset('shared', 'incoming copy'),
					'import-only': asset('import-only', 'import')
				}
			};

			const { next } = importGraphData(host, incoming);

			expect(Object.keys(next.assets ?? {}).sort()).toEqual(['host-only', 'import-only', 'shared']);
			expect(next.assets?.shared.name).toBe('host copy');
		});

		it('leaves assets absent when neither graph has any', () => {
			const { next } = importGraphData(makeGraph({ nodeCount: 1 }), makeGraph({ nodeCount: 1 }));

			expect('assets' in next).toBe(false);
		});

		it('adopts the incoming map when the host has none', () => {
			const incoming: MultigraphData = {
				...makeGraph({ nodeCount: 1 }),
				assets: { 'import-only': asset('import-only', 'import') }
			};

			const { next } = importGraphData(makeGraph({ nodeCount: 1 }), incoming);

			expect(next.assets).toEqual(incoming.assets);
		});

		it('keeps image content blocks pointing at their unremapped asset ids', () => {
			const incoming: MultigraphData = {
				...makeGraph({
					nodes: [
						{
							id: 'n0',
							title: 'Picture',
							description: '',
							tags: [],
							content: [{ type: 'image', assetId: 'uuid-1', alt: 'A picture' }]
						}
					]
				}),
				assets: { 'uuid-1': asset('uuid-1', 'picture') }
			};

			const { next, nodeIdMap } = importGraphData(makeGraph({ nodeCount: 1 }), incoming);

			const imported = next.nodes.find((node) => node.id === nodeIdMap.get('n0'));
			expect(imported?.content).toEqual([{ type: 'image', assetId: 'uuid-1', alt: 'A picture' }]);
			expect(next.assets?.['uuid-1']).toBeDefined();
		});
	});

	describe('immutability', () => {
		it('mutates neither input', () => {
			const host: MultigraphData = {
				...makeGraph({
					nodeCount: 2,
					edges: [[0, 1]],
					pinned: [0],
					pinHistory: { 0: 3 },
					tagColorConfig: { nodeTags: { topic: '#111111' }, edgeTags: {} }
				}),
				assets: { 'host-asset': asset('host-asset', 'host') },
				pinSequence: 3
			};
			const incoming: MultigraphData = {
				...makeGraph({
					nodeCount: 2,
					edges: [[0, 1]],
					pinned: [1],
					pinHistory: { 1: 2 },
					tagColorConfig: { nodeTags: { topic: '#aaaaaa' }, edgeTags: { blocks: '#bbbbbb' } }
				}),
				assets: { 'import-asset': asset('import-asset', 'import') },
				pinSequence: 2
			};
			const hostSnapshot = structuredClone(host);
			const incomingSnapshot = structuredClone(incoming);

			const { next } = importGraphData(host, incoming);

			expect(host).toEqual(hostSnapshot);
			expect(incoming).toEqual(incomingSnapshot);
			expect(next).not.toBe(host);
			expect(next.posByNodeId).not.toBe(host.posByNodeId);
			expect(next.tagColorConfig).not.toBe(host.tagColorConfig);
		});

		it('carries unrelated host fields through untouched', () => {
			const host = makeGraph({ nodeCount: 1 });

			const { next } = importGraphData(host, makeGraph({ nodeCount: 1 }));

			expect(next.nodes[0]).toEqual(host.nodes[0]);
		});
	});
});
