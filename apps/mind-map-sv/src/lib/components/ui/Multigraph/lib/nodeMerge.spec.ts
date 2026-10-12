import { describe, expect, it } from 'vitest';
import { planNodeMerge } from './nodeMerge';
import { designations, makeGraph } from './testFixtures';
import type { MultigraphData } from '../../types/multigraph';

const nodeById = (data: MultigraphData, id: string) => data.nodes.find((node) => node.id === id);
const edgeById = (data: MultigraphData, id: string) => data.edges.find((edge) => edge.id === id);

describe('planNodeMerge', () => {
	describe('no-ops', () => {
		it('returns the input graph itself when merging a node with itself', () => {
			const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

			const plan = planNodeMerge(graph, 'n0', 'n0');

			expect(plan.next).toBe(graph);
			expect(plan.directionConflicts).toEqual([]);
			expect(plan.droppedSelfEdgeId).toBeNull();
		});

		it('returns the input graph itself when the absorbed node is unknown', () => {
			const graph = makeGraph({ nodeCount: 2 });

			const plan = planNodeMerge(graph, 'missing', 'n1');

			expect(plan.next).toBe(graph);
			expect(plan.directionConflicts).toEqual([]);
		});

		it('returns the input graph itself when the survivor is unknown', () => {
			const graph = makeGraph({ nodeCount: 2 });

			const plan = planNodeMerge(graph, 'n0', 'missing');

			expect(plan.next).toBe(graph);
			expect(plan.directionConflicts).toEqual([]);
		});
	});

	describe('immutability', () => {
		it('leaves the input graph untouched', () => {
			const graph = makeGraph({
				nodes: [
					{ id: 'n0', title: 'Keeper', description: 'Kept', tags: ['a'] },
					{ id: 'n1', title: 'Absorbed', description: 'Folded', tags: ['b'] },
					{ id: 'n2', title: 'Neighbor', description: '', tags: [] }
				],
				edges: [
					[0, 2],
					[1, 2]
				]
			});
			const before = structuredClone(graph);

			planNodeMerge(graph, 'n1', 'n0');

			expect(graph).toEqual(before);
		});

		it('produces the same next graph on repeated calls, however the caller reads it', () => {
			const graph = makeGraph({
				nodeCount: 3,
				edges: [
					{ source: 0, target: 2, directed: true },
					{ source: 2, target: 1, directed: true }
				]
			});

			const first = planNodeMerge(graph, 'n1', 'n0');
			const second = planNodeMerge(graph, 'n1', 'n0');

			expect(first.directionConflicts).toHaveLength(1);
			expect(second.next).toEqual(first.next);
		});
	});

	describe('survivor fields', () => {
		it('keeps the survivor id, title and position, and drops the absorbed node', () => {
			const graph = makeGraph({
				nodes: [
					{ id: 'n0', title: 'Keeper', description: '', tags: [] },
					{ id: 'n1', title: 'Absorbed', description: '', tags: [] }
				],
				posByNodeId: { n0: { x: 10, y: 20 }, n1: { x: 99, y: 99 } }
			});

			const { next } = planNodeMerge(graph, 'n1', 'n0');

			expect(next.nodes.map((node) => node.id)).toEqual(['n0']);
			expect(nodeById(next, 'n0')?.title).toBe('Keeper');
			expect(next.posByNodeId).toEqual({ n0: { x: 10, y: 20 } });
		});

		it('concatenates both descriptions with a blank line between them', () => {
			const graph = makeGraph({
				nodes: [
					{ id: 'n0', title: 'Keeper', description: 'Survivor prose', tags: [] },
					{ id: 'n1', title: 'Absorbed', description: 'Absorbed prose', tags: [] }
				]
			});

			const { next } = planNodeMerge(graph, 'n1', 'n0');

			expect(nodeById(next, 'n0')?.description).toBe('Survivor prose\n\nAbsorbed prose');
		});

		it('skips empty descriptions rather than leaving a stray blank line', () => {
			const graph = makeGraph({
				nodes: [
					{ id: 'n0', title: 'Keeper', description: '   ', tags: [] },
					{ id: 'n1', title: 'Absorbed', description: 'Only prose', tags: [] }
				]
			});

			const { next } = planNodeMerge(graph, 'n1', 'n0');

			expect(nodeById(next, 'n0')?.description).toBe('Only prose');
		});

		it('unions tags preserving the survivor order', () => {
			const graph = makeGraph({
				nodes: [
					{ id: 'n0', title: 'Keeper', description: '', tags: ['topic', 'core'] },
					{ id: 'n1', title: 'Absorbed', description: '', tags: ['core', 'idea'] }
				]
			});

			const { next } = planNodeMerge(graph, 'n1', 'n0');

			expect(nodeById(next, 'n0')?.tags).toEqual(['topic', 'core', 'idea']);
		});

		it('unions inputs and outputs deduped by symbol key', () => {
			const graph = makeGraph({
				nodes: [
					{
						id: 'n0',
						title: 'Keeper',
						description: '',
						tags: [],
						inputs: designations('t'),
						outputs: designations('v_0')
					},
					{
						id: 'n1',
						title: 'Absorbed',
						description: '',
						tags: [],
						inputs: designations('t', 'a'),
						outputs: designations('v_0')
					}
				]
			});

			const { next } = planNodeMerge(graph, 'n1', 'n0');

			expect(nodeById(next, 'n0')?.inputs).toEqual(designations('t', 'a'));
			expect(nodeById(next, 'n0')?.outputs).toEqual(designations('v_0'));
		});

		it('leaves inputs and outputs undefined when neither node declared any', () => {
			const graph = makeGraph({ nodeCount: 2 });

			const { next } = planNodeMerge(graph, 'n1', 'n0');

			expect(nodeById(next, 'n0')?.inputs).toBeUndefined();
			expect(nodeById(next, 'n0')?.outputs).toBeUndefined();
			expect(nodeById(next, 'n0')?.content).toBeUndefined();
			expect(nodeById(next, 'n0')?.pinned).toBeUndefined();
			expect(nodeById(next, 'n0')?.lastPinnedSeq).toBeUndefined();
		});

		it("appends the absorbed content blocks after the survivor's own", () => {
			const graph = makeGraph({
				nodes: [
					{
						id: 'n0',
						title: 'Keeper',
						description: '',
						tags: [],
						content: [{ type: 'image', assetId: 'asset-a', alt: 'A' }]
					},
					{
						id: 'n1',
						title: 'Absorbed',
						description: '',
						tags: [],
						content: [{ type: 'image', assetId: 'asset-b', alt: 'B' }]
					}
				]
			});

			const { next } = planNodeMerge(graph, 'n1', 'n0');

			expect(nodeById(next, 'n0')?.content).toEqual([
				{ type: 'image', assetId: 'asset-a', alt: 'A' },
				{ type: 'image', assetId: 'asset-b', alt: 'B' }
			]);
		});

		it('pins the survivor when either node was pinned, keeping the most recent stamp', () => {
			const graph = makeGraph({
				nodeCount: 2,
				pinned: [1],
				pinHistory: { 0: 3, 1: 7 }
			});

			const { next } = planNodeMerge(graph, 'n1', 'n0');

			expect(nodeById(next, 'n0')?.pinned).toBe(true);
			expect(nodeById(next, 'n0')?.lastPinnedSeq).toBe(7);
		});

		it("keeps the survivor's size over the absorbed node's", () => {
			const graph = makeGraph({ nodeCount: 2, sizeBytes: { 0: 1000, 1: 5000 } });

			const { next } = planNodeMerge(graph, 'n1', 'n0');

			expect(nodeById(next, 'n0')?.sizeBytes).toBe(1000);
		});

		it("keeps a survivor's size of 0 rather than taking the absorbed one", () => {
			const graph = makeGraph({ nodeCount: 2, sizeBytes: { 0: 0, 1: 5000 } });

			const { next } = planNodeMerge(graph, 'n1', 'n0');

			expect(nodeById(next, 'n0')?.sizeBytes).toBe(0);
		});

		it("fills a sizeless survivor with the absorbed node's size", () => {
			const graph = makeGraph({ nodeCount: 2, sizeBytes: { 1: 5000 } });

			const { next } = planNodeMerge(graph, 'n1', 'n0');

			expect(nodeById(next, 'n0')?.sizeBytes).toBe(5000);
		});

		it('leaves the size undefined when neither node has one', () => {
			const graph = makeGraph({ nodeCount: 2 });

			const { next } = planNodeMerge(graph, 'n1', 'n0');

			expect(nodeById(next, 'n0')?.sizeBytes).toBeUndefined();
		});
	});

	describe('edges', () => {
		it('rewrites an absorbed endpoint onto the survivor, preserving orientation', () => {
			const graph = makeGraph({
				nodeCount: 3,
				edges: [{ id: 'e-in', source: 2, target: 1, directed: true, tags: ['causes'] }]
			});

			const { next } = planNodeMerge(graph, 'n1', 'n0');

			expect(edgeById(next, 'e-in')).toEqual({
				id: 'e-in',
				sourceNodeId: 'n2',
				targetNodeId: 'n0',
				directed: true,
				tags: ['causes']
			});
		});

		it('drops exactly the absorbed--survivor edge and leaves no self-loop', () => {
			const graph = makeGraph({
				nodeCount: 3,
				edges: [
					{ id: 'e-pair', source: 0, target: 1 },
					{ id: 'e-other', source: 1, target: 2 }
				]
			});

			const plan = planNodeMerge(graph, 'n1', 'n0');

			expect(plan.droppedSelfEdgeId).toBe('e-pair');
			expect(plan.next.edges.map((edge) => edge.id)).toEqual(['e-other']);
			expect(plan.next.edges.some((edge) => edge.sourceNodeId === edge.targetNodeId)).toBe(false);
		});

		it('reports no dropped self edge when the two nodes were not adjacent', () => {
			const graph = makeGraph({ nodeCount: 3, edges: [[1, 2]] });

			expect(planNodeMerge(graph, 'n1', 'n0').droppedSelfEdgeId).toBeNull();
		});

		it('collapses into the survivor counterpart, keeping its id and direction', () => {
			const graph = makeGraph({
				nodeCount: 3,
				edges: [
					{ id: 'e-survivor', source: 0, target: 2, directed: true, tags: ['keep'] },
					{ id: 'e-absorbed', source: 1, target: 2, directed: true, tags: ['fold'] }
				]
			});

			const { next } = planNodeMerge(graph, 'n1', 'n0');

			expect(next.edges).toHaveLength(1);
			expect(next.edges[0]).toEqual({
				id: 'e-survivor',
				sourceNodeId: 'n0',
				targetNodeId: 'n2',
				directed: true,
				tags: ['keep', 'fold']
			});
		});

		it('collapses parallel absorbed edges to the same neighbor into one edge', () => {
			const graph = makeGraph({
				nodeCount: 3,
				edges: [
					{ id: 'e-a', source: 1, target: 2, tags: ['first'] },
					{ id: 'e-b', source: 1, target: 2, tags: ['second'] }
				]
			});

			const { next } = planNodeMerge(graph, 'n1', 'n0');

			expect(next.edges).toHaveLength(1);
			expect(next.edges[0]).toMatchObject({
				id: 'e-a',
				sourceNodeId: 'n0',
				targetNodeId: 'n2',
				tags: ['first', 'second']
			});
		});

		it('collapses into a survivor counterpart that appears later in the edge list', () => {
			const graph = makeGraph({
				nodeCount: 3,
				edges: [
					{ id: 'e-absorbed', source: 1, target: 2, directed: true, tags: ['fold'] },
					{ id: 'e-survivor', source: 0, target: 2, tags: ['keep'] }
				]
			});

			const plan = planNodeMerge(graph, 'n1', 'n0');

			expect(plan.next.edges).toHaveLength(1);
			expect(plan.next.edges[0]).toMatchObject({
				id: 'e-survivor',
				directed: false,
				tags: ['keep', 'fold']
			});
			expect(plan.directionConflicts).toEqual([
				{ absorbedEdgeId: 'e-absorbed', survivingEdgeId: 'e-survivor' }
			]);
		});

		it('never rewrites or emits a derived dataflow edge', () => {
			const graph = makeGraph({ nodeCount: 3, edges: [[1, 2]] });
			const withDerived: MultigraphData = {
				...graph,
				edges: [
					...graph.edges,
					{
						id: 'dataflow:n1->n2',
						sourceNodeId: 'n1',
						targetNodeId: 'n2',
						tags: [],
						directed: true
					}
				]
			};

			const { next } = planNodeMerge(withDerived, 'n1', 'n0');

			expect(next.edges.some((edge) => edge.id.startsWith('dataflow:'))).toBe(false);
		});
	});

	describe('direction conflicts', () => {
		it('reports a conflict when the two edges point opposite ways', () => {
			const graph = makeGraph({
				nodeCount: 3,
				edges: [
					{ id: 'e-survivor', source: 0, target: 2, directed: true },
					{ id: 'e-absorbed', source: 2, target: 1, directed: true }
				]
			});

			const plan = planNodeMerge(graph, 'n1', 'n0');

			expect(plan.directionConflicts).toEqual([
				{ absorbedEdgeId: 'e-absorbed', survivingEdgeId: 'e-survivor' }
			]);
			expect(edgeById(plan.next, 'e-survivor')).toMatchObject({
				sourceNodeId: 'n0',
				targetNodeId: 'n2'
			});
		});

		it('reports a conflict when a directed absorbed edge folds into an undirected one', () => {
			const graph = makeGraph({
				nodeCount: 3,
				edges: [
					{ id: 'e-survivor', source: 0, target: 2, directed: false },
					{ id: 'e-absorbed', source: 1, target: 2, directed: true }
				]
			});

			const plan = planNodeMerge(graph, 'n1', 'n0');

			expect(plan.directionConflicts).toEqual([
				{ absorbedEdgeId: 'e-absorbed', survivingEdgeId: 'e-survivor' }
			]);
			expect(edgeById(plan.next, 'e-survivor')?.directed).toBe(false);
		});

		it('reports no conflict when an undirected absorbed edge folds into a directed one', () => {
			const graph = makeGraph({
				nodeCount: 3,
				edges: [
					{ id: 'e-survivor', source: 0, target: 2, directed: true },
					{ id: 'e-absorbed', source: 1, target: 2, directed: false }
				]
			});

			const plan = planNodeMerge(graph, 'n1', 'n0');

			expect(plan.directionConflicts).toEqual([]);
			expect(edgeById(plan.next, 'e-survivor')?.directed).toBe(true);
		});

		it('reports no conflict when both edges already point the same way', () => {
			const graph = makeGraph({
				nodeCount: 3,
				edges: [
					{ id: 'e-survivor', source: 0, target: 2, directed: true },
					{ id: 'e-absorbed', source: 1, target: 2, directed: true }
				]
			});

			expect(planNodeMerge(graph, 'n1', 'n0').directionConflicts).toEqual([]);
		});

		it('reports no conflict when the absorbed edge only moves its endpoint', () => {
			const graph = makeGraph({
				nodeCount: 3,
				edges: [{ id: 'e-absorbed', source: 1, target: 2, directed: true }]
			});

			expect(planNodeMerge(graph, 'n1', 'n0').directionConflicts).toEqual([]);
		});

		it('counts one conflict per absorbed edge whose direction is discarded', () => {
			const graph = makeGraph({
				nodeCount: 4,
				edges: [
					{ id: 'e-s2', source: 0, target: 2, directed: true },
					{ id: 'e-s3', source: 0, target: 3, directed: true },
					{ id: 'e-a2', source: 2, target: 1, directed: true },
					{ id: 'e-a3', source: 3, target: 1, directed: true }
				]
			});

			const plan = planNodeMerge(graph, 'n1', 'n0');

			expect(plan.directionConflicts).toHaveLength(2);
			expect(plan.next.edges.map((edge) => edge.id)).toEqual(['e-s2', 'e-s3']);
		});
	});
});
