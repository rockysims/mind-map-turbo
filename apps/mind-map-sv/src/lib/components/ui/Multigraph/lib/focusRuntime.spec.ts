import { describe, expect, it } from 'vitest';
import { FocusRuntime } from './focusRuntime.svelte';

const fillRect = { left: 0, top: 0, width: 800, height: 600 };

describe('focus runtime stack', () => {
	it('pushes and pops recursive levels while restoring parent state exactly', () => {
		const runtime = new FocusRuntime();

		runtime.push({
			subjectKind: 'node',
			subjectId: 'n0',
			sourceRect: { left: 100, top: 80, width: 120, height: 120 },
			fillRect,
			borderWidthPx: 12
		});
		runtime.push({
			subjectKind: 'placeholder',
			subjectId: 'child-a',
			sourceRect: { left: 140, top: 120, width: 200, height: 100 },
			fillRect
		});
		runtime.push({
			subjectKind: 'placeholder',
			subjectId: 'child-b',
			sourceRect: { left: 200, top: 160, width: 180, height: 180 },
			fillRect
		});

		expect(runtime.depth).toBe(3);
		expect(runtime.activeLevel?.subjectId).toBe('child-b');
		expect(runtime.pop()?.subjectId).toBe('child-b');
		expect(runtime.activeLevel?.subjectId).toBe('child-a');
		expect(runtime.pop()?.subjectId).toBe('child-a');
		expect(runtime.activeLevel?.subjectId).toBe('n0');
		expect(runtime.activeLevel?.sourceRect).toEqual({
			left: 100,
			top: 80,
			width: 120,
			height: 120
		});
		expect(runtime.activeLevel?.fillRect).toEqual(fillRect);
		expect(runtime.activeLevel?.borderWidthPx).toBe(12);
	});

	it('updates active progress immutably', () => {
		const runtime = new FocusRuntime();
		runtime.push({
			subjectKind: 'node',
			subjectId: 'n0',
			sourceRect: { left: 0, top: 0, width: 100, height: 100 },
			fillRect
		});
		const firstLevel = runtime.activeLevel;

		runtime.setProgress(0.4, 'exiting');

		expect(runtime.activeLevel).not.toBe(firstLevel);
		expect(runtime.activeLevel?.morphProgress).toBe(0.4);
		expect(runtime.activeLevel?.phase).toBe('exiting');
	});

	it('keeps focused node getters backed by the active level', () => {
		const runtime = new FocusRuntime();
		runtime.open({ id: 'n0', title: 'Node', description: '', tags: [] });

		expect(runtime.isFocused).toBe(true);
		expect(runtime.focusedNodeId).toBe('n0');

		runtime.close();
		expect(runtime.isFocused).toBe(false);
		expect(runtime.focusedNodeId).toBeNull();
	});

	it('can open a focused node at an entry morph progress', () => {
		const runtime = new FocusRuntime();
		runtime.open(
			{ id: 'n0', title: 'Node', description: '', tags: [] },
			{ left: 10, top: 20, width: 100, height: 100 },
			fillRect,
			{ borderWidthPx: 14, morphProgress: 0, phase: 'entering' }
		);

		expect(runtime.activeLevel?.borderWidthPx).toBe(14);
		expect(runtime.activeLevel?.morphProgress).toBe(0);
		expect(runtime.activeLevel?.phase).toBe('entering');
	});
});
