/**
 * The selection's own rules, with no canvas around it. Runs in the `server`
 * project: `svelte/reactivity` resolves to its server build there, where
 * `SvelteSet` is a plain `Set`, which is all these rules need.
 */

import { describe, expect, it } from 'vitest';
import { SelectionController } from './selectionController.svelte';
import { makeGraph } from './testFixtures';

function selectionOf(...ids: string[]): SelectionController {
	const selection = new SelectionController();
	selection.add(ids);
	return selection;
}

describe('selection controller', () => {
	it('starts empty', () => {
		const selection = new SelectionController();

		expect(selection.size).toBe(0);
		expect(selection.ids).toEqual([]);
		expect(selection.has('n0')).toBe(false);
	});

	it('replace makes the selection exactly the ids given, in their order', () => {
		const selection = selectionOf('n0', 'n1');

		selection.replace(['n2', 'n1']);

		expect(selection.ids).toEqual(['n2', 'n1']);
		expect(selection.has('n0')).toBe(false);
	});

	it('replace with nothing empties the selection', () => {
		const selection = selectionOf('n0');

		selection.replace([]);

		expect(selection.size).toBe(0);
	});

	it('add keeps what was selected and counts a repeat once', () => {
		const selection = selectionOf('n0');

		selection.add(['n1', 'n0', 'n2']);

		expect(selection.ids).toEqual(['n0', 'n1', 'n2']);
		expect(selection.size).toBe(3);
	});

	it('toggle selects an unselected node and deselects a selected one', () => {
		const selection = selectionOf('n0');

		selection.toggle('n1');
		expect(selection.ids).toEqual(['n0', 'n1']);

		selection.toggle('n0');
		expect(selection.ids).toEqual(['n1']);
	});

	it('clear empties the selection', () => {
		const selection = selectionOf('n0', 'n1');

		selection.clear();

		expect(selection.size).toBe(0);
		expect(selection.ids).toEqual([]);
	});

	it('prune drops ids that name no node and keeps the rest in order', () => {
		const selection = selectionOf('n2', 'gone', 'n0');

		selection.prune(makeGraph({ nodeCount: 3 }));

		expect(selection.ids).toEqual(['n2', 'n0']);
	});

	it('prune against an empty graph empties the selection', () => {
		const selection = selectionOf('n0', 'n1');

		selection.prune(makeGraph({ nodeCount: 0 }));

		expect(selection.size).toBe(0);
	});

	it('prune of an empty selection is a no-op', () => {
		const selection = new SelectionController();

		selection.prune(makeGraph({ nodeCount: 2 }));

		expect(selection.size).toBe(0);
	});

	it('ids is a snapshot: changing it leaves the selection alone', () => {
		const selection = selectionOf('n0');
		const snapshot = selection.ids;

		selection.add(['n1']);

		expect(snapshot).toEqual(['n0']);
		expect(selection.ids).toEqual(['n0', 'n1']);
	});
});
