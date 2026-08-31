import { describe, expect, it } from 'vitest';
import { severedComponentAfterMutation } from './severedComponent';
import { makeGraph } from './testFixtures';

describe('severedComponentAfterMutation', () => {
	it('reports no severing when every candidate still reaches a pinned node', () => {
		// a(pinned) — b — c, and nothing was cut: both of b's neighbours are fine.
		const graph = makeGraph({
			nodeCount: 3,
			pinned: [0],
			edges: [
				[0, 1],
				[1, 2]
			]
		});

		expect(severedComponentAfterMutation(graph, ['n0', 'n2'])).toEqual({
			survivorNodeId: 'n0',
			severed: false
		});
	});

	it('names a survivor and reports severing when one side lost every route to a pin', () => {
		// a(pinned) — b, and c alone: c is the endpoint whose edge was just removed.
		const graph = makeGraph({
			nodeCount: 3,
			pinned: [0],
			edges: [[0, 1]]
		});

		expect(severedComponentAfterMutation(graph, ['n1', 'n2'])).toEqual({
			survivorNodeId: 'n1',
			severed: true
		});
	});

	it('picks the first reachable candidate as the survivor', () => {
		const graph = makeGraph({
			nodeCount: 4,
			pinned: [0],
			edges: [
				[0, 1],
				[0, 2]
			]
		});

		expect(severedComponentAfterMutation(graph, ['n3', 'n2', 'n1']).survivorNodeId).toBe('n2');
	});

	it('reports no severing when nothing at all can reach a pinned node', () => {
		// Nowhere to play a reveal wave from, so this is not the severing case even
		// though every candidate is unreachable.
		const graph = makeGraph({ nodeCount: 2, edges: [[0, 1]] });

		expect(severedComponentAfterMutation(graph, ['n0', 'n1'])).toEqual({
			survivorNodeId: null,
			severed: false
		});
	});

	it('reports no severing for an empty candidate list', () => {
		const graph = makeGraph({ nodeCount: 1, pinned: [0] });

		expect(severedComponentAfterMutation(graph, [])).toEqual({
			survivorNodeId: null,
			severed: false
		});
	});
});
