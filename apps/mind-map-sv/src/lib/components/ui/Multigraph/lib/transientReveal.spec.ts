import { describe, expect, it } from 'vitest';
import { NAV_STACK_LIMIT, type NavStackEntry } from './navStack';
import { TransientRevealController } from './transientReveal.svelte';

function entry(
	originNodeId: string,
	revealedNodeId: string | null = null,
	scale = 1
): NavStackEntry {
	return {
		originNodeId,
		viewState: { panX: 10, panY: -20, scale },
		revealedNodeId,
		originFocused: true
	};
}

describe('transient reveal controller', () => {
	it('pushes, reports the top, and pops in reverse order', () => {
		const controller = new TransientRevealController();
		controller.push(entry('a', 'x'));
		controller.push(entry('b', 'y'));

		expect(controller.depth).toBe(2);
		expect(controller.top?.originNodeId).toBe('b');
		expect(controller.pop()?.originNodeId).toBe('b');
		expect(controller.pop()?.originNodeId).toBe('a');
		expect(controller.pop()).toBeUndefined();
	});

	it('restores the exact view state that was pushed', () => {
		const controller = new TransientRevealController();
		controller.push(entry('a', 'x', 2.75));

		expect(controller.pop()?.viewState).toEqual({ panX: 10, panY: -20, scale: 2.75 });
	});

	it('caps the stack at NAV_STACK_LIMIT, dropping the oldest', () => {
		const controller = new TransientRevealController();
		for (let index = 0; index < NAV_STACK_LIMIT + 2; index += 1) {
			controller.push(entry(`n${index}`));
		}

		expect(controller.depth).toBe(NAV_STACK_LIMIT);
		expect(controller.entries[0].originNodeId).toBe('n2');
	});

	it('drops a seed as soon as its entry pops', () => {
		const controller = new TransientRevealController();
		controller.push(entry('a', 'x'));
		controller.push(entry('b', 'y'));

		expect([...controller.revealedNodeIds].sort()).toEqual(['x', 'y']);
		controller.pop();
		expect([...controller.revealedNodeIds]).toEqual(['x']);
		controller.pop();
		expect(controller.revealedNodeIds.size).toBe(0);
	});

	it('holds nothing for a jump to a node that was already on screen', () => {
		const controller = new TransientRevealController();
		controller.push(entry('a', null));

		expect(controller.depth).toBe(1);
		expect(controller.revealedNodeIds.size).toBe(0);
	});

	it('hands back the same set until the stack changes', () => {
		const controller = new TransientRevealController();
		controller.push(entry('a', 'x'));

		const first = controller.revealedNodeIds;
		expect(controller.revealedNodeIds).toBe(first);

		controller.push(entry('b', 'y'));
		expect(controller.revealedNodeIds).not.toBe(first);
	});

	it('unwinds several jumps at once, dropping their seeds with them', () => {
		const controller = new TransientRevealController();
		controller.push(entry('a', 'x'));
		controller.push(entry('b', 'y'));
		controller.push(entry('c', 'z'));

		const target = controller.unwindTo(0);

		expect(target?.originNodeId).toBe('a');
		expect(controller.depth).toBe(0);
		expect(controller.revealedNodeIds.size).toBe(0);
	});

	it('leaves the stack alone when the crumb no longer exists', () => {
		const controller = new TransientRevealController();
		controller.push(entry('a', 'x'));

		expect(controller.unwindTo(3)).toBeUndefined();
		expect(controller.depth).toBe(1);
	});

	it('clears the whole stack', () => {
		const controller = new TransientRevealController();
		controller.push(entry('a', 'x'));
		controller.clear();

		expect(controller.depth).toBe(0);
		expect(controller.revealedNodeIds.size).toBe(0);
	});

	it('prunes entries pointing at nodes that no longer exist', () => {
		const controller = new TransientRevealController();
		controller.push(entry('a', 'x'));
		controller.push(entry('b', 'y'));
		controller.pruneMissing(new Set(['a', 'x', 'b']));

		expect(controller.depth).toBe(1);
		expect(controller.top?.originNodeId).toBe('a');
	});
});
