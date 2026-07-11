import { describe, expect, it, vi } from 'vitest';
import { FocusController, type FocusControllerDeps } from './focusController.svelte';
import type { NodeData } from '../../types/node';
import type { NodeFocusCandidate } from './nodeFocus';

const node: NodeData = { id: 'n0', title: 'Node', description: '', tags: [] };
const stageRect = { left: 0, top: 0, width: 800, height: 600 };
const fillRect = { left: 0, top: 0, width: 800, height: 600 };
const candidates: NodeFocusCandidate[] = [
	{ node, position: { x: 0, y: 0 }, radius: 40, zIndex: 0 }
];

function makeDeps(overrides: Partial<FocusControllerDeps> = {}) {
	const armEntryGate = vi.fn();
	const closeOverlays = vi.fn();
	const deps: FocusControllerDeps = {
		getStageRect: () => stageRect,
		getViewState: () => ({ panX: 0, panY: 0, scale: 1 }),
		getFillRect: () => fillRect,
		getFocusCandidates: () => candidates,
		// Reduced motion forces the synchronous close path (no rAF needed).
		getReduceMotion: () => true,
		armEntryGate,
		closeOverlays,
		config: { transitionMs: 0, entryGestureIdleMs: 180, entryGestureMaxMs: 420 },
		...overrides
	};
	return { deps, armEntryGate, closeOverlays };
}

describe('FocusController lifecycle', () => {
	it('runs entry scrub → commit → partial exit → revert → close', () => {
		const { deps, armEntryGate } = makeDeps();
		const focus = new FocusController(deps);

		focus.beginOrUpdateEntryScrub(node, 0.5);
		expect(focus.isFocused).toBe(true);
		expect(focus.focusedNodeId).toBe('n0');
		expect(focus.activeLevel?.phase).toBe('entering');
		expect(focus.activeLevel?.morphProgress).toBe(0.5);
		expect(focus.committed).toBe(false);
		expect(focus.dialogOpen).toBe(false);
		expect(focus.exitScrubActive).toBe(false);

		focus.commitFocus(node, 0);
		expect(focus.committed).toBe(true);
		expect(focus.activeLevel?.phase).toBe('active');
		expect(focus.activeLevel?.morphProgress).toBe(1);
		expect(focus.dialogOpen).toBe(true);
		expect(focus.exitScrubActive).toBe(false);

		focus.handleExit(focus.activeLevel!, 0.4);
		expect(focus.activeLevel?.phase).toBe('exiting');
		expect(focus.activeLevel?.morphProgress).toBeCloseTo(0.6);
		expect(focus.committed).toBe(true);
		expect(focus.exitScrubActive).toBe(true);
		expect(focus.dialogOpen).toBe(true);

		focus.handleExit(focus.activeLevel!, 0);
		expect(focus.activeLevel?.phase).toBe('active');
		expect(focus.activeLevel?.morphProgress).toBe(1);
		expect(focus.exitScrubActive).toBe(false);

		focus.closeFocus();
		expect(focus.isFocused).toBe(false);
		expect(focus.activeLevel).toBeNull();
		expect(armEntryGate).toHaveBeenCalledWith('out');
	});

	it('commits directly through openFocus (long-press menu path)', () => {
		const { deps, closeOverlays } = makeDeps();
		const focus = new FocusController(deps);

		focus.openFocus(node);

		expect(focus.isFocused).toBe(true);
		expect(focus.committed).toBe(true);
		expect(focus.depth).toBe(1);
		expect(focus.focusedNodeId).toBe('n0');
		expect(focus.entryGestureIdleMs).toBe(0);
		expect(closeOverlays).toHaveBeenCalled();
	});

	it('routes handleExit deltas: <=0 reverts, partial scrubs, >=1 closes', () => {
		const { deps } = makeDeps();
		const focus = new FocusController(deps);
		focus.openFocus(node);

		focus.handleExit(focus.activeLevel!, 0.3);
		expect(focus.activeLevel?.phase).toBe('exiting');
		expect(focus.activeLevel?.morphProgress).toBeCloseTo(0.7);

		focus.handleExit(focus.activeLevel!, -0.5);
		expect(focus.activeLevel?.phase).toBe('active');
		expect(focus.activeLevel?.morphProgress).toBe(1);

		focus.handleExit(focus.activeLevel!, 1);
		expect(focus.isFocused).toBe(false);
	});

	it('descends into an image (depth 2) then pops back to the node (depth 1)', () => {
		const { deps } = makeDeps();
		const focus = new FocusController(deps);
		focus.openFocus(node);
		expect(focus.depth).toBe(1);

		const imageRect = { left: 100, top: 80, width: 200, height: 150 };
		focus.descendToImage({
			assetId: 'asset-1',
			sourceRect: imageRect,
			src: 'blob:image',
			alt: 'A picture'
		});

		expect(focus.depth).toBe(2);
		const image = focus.activeLevel!;
		expect(image.subjectKind).toBe('image');
		expect(image.subjectId).toBe('asset-1');
		expect(image.subjectSrc).toBe('blob:image');
		expect(image.subjectAlt).toBe('A picture');
		expect(image.sourceRect).toEqual(imageRect);
		expect(image.fillRect).toEqual(fillRect);
		// Reduced motion (makeDeps default) jumps straight to committed.
		expect(image.morphProgress).toBe(1);
		expect(image.phase).toBe('active');
		expect(focus.committed).toBe(true);

		// Partial exit at depth 2 scrubs the image frame, staying at depth 2.
		focus.handleExit(focus.activeLevel!, 0.4);
		expect(focus.depth).toBe(2);
		expect(focus.activeLevel?.subjectKind).toBe('image');
		expect(focus.activeLevel?.phase).toBe('exiting');
		expect(focus.activeLevel?.morphProgress).toBeCloseTo(0.6);

		// A full exit at depth 2 POPS to the node instead of closing focus.
		focus.handleExit(focus.activeLevel!, 1);
		expect(focus.isFocused).toBe(true);
		expect(focus.depth).toBe(1);
		expect(focus.focusedNodeId).toBe('n0');
		expect(focus.activeLevel?.phase).toBe('active');
		expect(focus.activeLevel?.morphProgress).toBe(1);

		// A full exit at depth 1 still closes focus entirely.
		focus.handleExit(focus.activeLevel!, 1);
		expect(focus.isFocused).toBe(false);
	});

	it('handleBlockedZoom scrubs at partial progress and commits at full', () => {
		const { deps } = makeDeps();
		const focus = new FocusController(deps);
		const zoomIn = {
			direction: 'in' as const,
			focalPoint: { x: 0, y: 0 },
			nodeId: 'n0',
			viewState: { panX: 0, panY: 0, scale: 2 }
		};

		focus.handleBlockedZoom({ ...zoomIn, boundaryProgress: 0.5 });
		expect(focus.activeLevel?.phase).toBe('entering');
		expect(focus.activeLevel?.morphProgress).toBeCloseTo(0.5);
		expect(focus.committed).toBe(false);

		focus.handleBlockedZoom({ ...zoomIn, boundaryProgress: 1 });
		expect(focus.committed).toBe(true);
		expect(focus.activeLevel?.phase).toBe('active');
	});

	it('resolves the sticky boundary candidate only for a genuine zoom-in', () => {
		const { deps } = makeDeps();
		const focus = new FocusController(deps);

		expect(
			focus.entryBoundaryCandidateForPoint({
				focalPoint: { x: 0, y: 0 },
				requestedScale: 3,
				viewState: { panX: 0, panY: 0, scale: 1 },
				stickyNodeId: 'n0'
			})
		).toEqual({ nodeId: 'n0', position: { x: 0, y: 0 }, radius: 40 });

		expect(
			focus.entryBoundaryCandidateForPoint({
				focalPoint: { x: 0, y: 0 },
				requestedScale: 1,
				viewState: { panX: 0, panY: 0, scale: 1 },
				stickyNodeId: 'n0'
			})
		).toBeNull();

		focus.openFocus(node);
		// Committed focus never re-enters through the boundary path.
		expect(
			focus.entryBoundaryCandidateForPoint({
				focalPoint: { x: 0, y: 0 },
				requestedScale: 3,
				viewState: { panX: 0, panY: 0, scale: 1 },
				stickyNodeId: 'n0'
			})
		).toBeNull();
	});

	it('idle-unmounts an uncommitted entry surface resting at progress 0', () => {
		vi.useFakeTimers();
		vi.stubGlobal('window', {});
		try {
			const { deps } = makeDeps();
			const focus = new FocusController(deps);

			focus.beginOrUpdateEntryScrub(node, 0);
			expect(focus.isFocused).toBe(true);

			focus.scheduleIdleUnmount();
			vi.advanceTimersByTime(deps.config.entryGestureIdleMs);
			expect(focus.isFocused).toBe(false);
		} finally {
			vi.useRealTimers();
			vi.unstubAllGlobals();
		}
	});

	it('never idle-unmounts a committed focus', () => {
		vi.useFakeTimers();
		vi.stubGlobal('window', {});
		try {
			const { deps } = makeDeps();
			const focus = new FocusController(deps);

			focus.openFocus(node);
			focus.scheduleIdleUnmount();
			vi.advanceTimersByTime(deps.config.entryGestureIdleMs * 4);
			expect(focus.isFocused).toBe(true);
		} finally {
			vi.useRealTimers();
			vi.unstubAllGlobals();
		}
	});

	it('drives the closing phase through the tween before unmounting', () => {
		vi.useFakeTimers();
		const rafQueue: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			rafQueue.push(cb);
			return rafQueue.length;
		});
		vi.stubGlobal('cancelAnimationFrame', () => {});
		const flushFrame = () => rafQueue.shift()?.(0);
		try {
			const { deps, armEntryGate } = makeDeps({
				getReduceMotion: () => false,
				config: { transitionMs: 660, entryGestureIdleMs: 180, entryGestureMaxMs: 420 }
			});
			const focus = new FocusController(deps);
			focus.openFocus(node);

			focus.closeFocus();
			expect(armEntryGate).toHaveBeenCalledWith('out');

			// First tween frame flips the phase to 'closing' while still mounted.
			flushFrame();
			expect(focus.exiting).toBe(true);
			expect(focus.committed).toBe(false);
			expect(focus.isFocused).toBe(true);

			// Finish the tween, then flush the deferred finishClose frame.
			vi.advanceTimersByTime(660);
			flushFrame();
			flushFrame();
			expect(focus.isFocused).toBe(false);
		} finally {
			vi.useRealTimers();
			vi.unstubAllGlobals();
		}
	});
});
