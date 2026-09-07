<script lang="ts">
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import type { Point } from '../types/multigraph';
	import {
		beginEntryGestureGate,
		EMPTY_ENTRY_GESTURE_GATE,
		stepEntryGestureGate,
		type EntryGestureDirection,
		type EntryGestureGateState
	} from './lib/entryGestureGate';
	import { wheelDeltaPixels } from './lib/graphMath';
	import { pointerDistance } from './lib/hitTest';
	import { nestedScrollChain, yieldsToNestedScroll } from './lib/nestedScrollTarget';
	import {
		clampZoomWorldState,
		pinchZoomWorld,
		wheelExitBoundaryAmount,
		wheelZoomWorld,
		type ZoomWorldBounds,
		type ZoomWorldState
	} from './lib/zoomWorldController';
	import type { Rect } from './lib/zoomBoundary';

	/** Payload for a committed descend into a nested image subject. */
	export type DescendInput = { assetId: string; sourceRect: Rect; src: string; alt: string };

	let {
		minScale,
		maxScale = 8,
		entryGestureIdleMs = 0,
		entryGestureMaxMs = 0,
		onExitBoundary,
		onDescend,
		children
	}: {
		minScale?: number;
		maxScale?: number;
		entryGestureIdleMs?: number;
		entryGestureMaxMs?: number;
		onExitBoundary?: (delta: number) => void;
		onDescend?: (input: DescendInput) => void;
		children?: Snippet;
	} = $props();

	let worldRef = $state<HTMLElement | null>(null);
	let subjectRef = $state<HTMLElement | null>(null);
	let worldState = $state<ZoomWorldState>({ panX: 0, panY: 0, scale: 1 });
	let dragStart = $state<{
		clientX: number;
		clientY: number;
		panX: number;
		panY: number;
	} | null>(null);
	let pinchStart = $state<{
		distance: number;
		scale: number;
		state: ZoomWorldState;
	} | null>(null);
	let entryGestureGate = $state<EntryGestureGateState>(EMPTY_ENTRY_GESTURE_GATE);
	let exitBoundaryAmount = $state(0);
	let descendBoundaryAmount = $state(0);

	const activePointers = new SvelteMap<number, { clientX: number; clientY: number }>();
	const transformStyle = $derived(
		`translate(${worldState.panX}px, ${worldState.panY}px) scale(${worldState.scale})`
	);

	onMount(() => {
		entryGestureGate = beginEntryGestureGate(
			'in',
			Date.now(),
			entryGestureIdleMs,
			entryGestureMaxMs
		);
	});

	function currentBounds(): ZoomWorldBounds | null {
		if (!worldRef || !subjectRef) return null;
		return {
			width: worldRef.clientWidth,
			height: worldRef.clientHeight,
			subjectWidth: subjectRef.offsetWidth,
			subjectHeight: subjectRef.offsetHeight,
			minScale,
			maxScale
		};
	}

	function localPoint(clientX: number, clientY: number): Point | null {
		if (!worldRef) return null;
		const rect = worldRef.getBoundingClientRect();
		return { x: clientX - rect.left, y: clientY - rect.top };
	}

	function commitState(next: ZoomWorldState) {
		worldState = next;
	}

	/**
	 * Called by the single fullscreen focus input surface (DeepZoomStack) so a
	 * wheel that lands off the shrinking frame still drives THIS world — the
	 * event's `clientX/clientY` become the focal point via `localPoint`. The
	 * surface is the sole external wheel source; the element's own `onwheel`
	 * still handles wheels physically over the frame (never both, since only
	 * the topmost element under the cursor receives the event).
	 */
	export function dispatchWheel(event: WheelEvent) {
		handleWheel(event);
	}

	function shouldSwallowEntryZoom(direction: EntryGestureDirection): boolean {
		const step = stepEntryGestureGate(
			entryGestureGate,
			{ direction },
			Date.now(),
			entryGestureIdleMs,
			entryGestureMaxMs
		);
		entryGestureGate = step.state;
		return step.swallow;
	}

	/**
	 * Resolve the descendable image directly under the cursor. Only an
	 * `<img class="focus-image">` carrying a `data-asset-id` qualifies, so
	 * bold zoom-in over empty space or non-image content never descends (and a
	 * nested image world, whose image is `focus-image-full`, cannot re-descend).
	 */
	function descendImageAt(clientX: number, clientY: number): HTMLImageElement | null {
		if (typeof document === 'undefined') return null;
		const hit = document.elementFromPoint(clientX, clientY);
		const asset = hit?.closest('[data-asset-id]');
		if (asset instanceof HTMLImageElement && asset.classList.contains('focus-image')) {
			return asset;
		}
		return null;
	}

	/** Only read for `DOM_DELTA_PAGE` wheels, which no mainstream browser sends. */
	function viewportHeightPx(): number | undefined {
		return typeof window === 'undefined' ? undefined : window.innerHeight;
	}

	function handleWheel(event: WheelEvent) {
		const bounds = currentBounds();
		const point = localPoint(event.clientX, event.clientY);
		if (!bounds || !point) return;
		// Normalized once, at the only place the raw event is in hand: the zoom
		// math downstream reads a pixel delta, and Firefox reports a mouse wheel
		// in lines (see `wheelDeltaPixels`).
		const deltaY = wheelDeltaPixels(event, viewportHeightPx());
		// Before anything is swallowed: a marked scroller inside the world with
		// room left in this direction owns the wheel, and the browser scrolls it
		// natively. At its end the wheel comes back here, which is what lets a
		// wheel-out at the top of a tall surface still exit focus.
		if (yieldsToNestedScroll(nestedScrollChain(event.target, worldRef), deltaY)) return;
		event.preventDefault();
		event.stopPropagation();
		if (shouldSwallowEntryZoom(deltaY < 0 ? 'in' : 'out')) return;
		if (exitBoundaryAmount > 0) {
			exitBoundaryAmount = wheelExitBoundaryAmount(exitBoundaryAmount, deltaY, bounds);
			onExitBoundary?.(exitBoundaryAmount);
			return;
		}
		// A reversal (zoom-out) cancels any in-flight descend accumulation,
		// mirroring how a zoom-in cancels an exit scrub.
		if (descendBoundaryAmount > 0 && deltaY > 0) descendBoundaryAmount = 0;
		const step = wheelZoomWorld(worldState, deltaY, point, bounds);
		commitState(step.state);
		if (step.exitBoundaryDelta > 0) {
			exitBoundaryAmount = Math.min(1, exitBoundaryAmount + step.exitBoundaryDelta);
			onExitBoundary?.(exitBoundaryAmount);
		} else if (exitBoundaryAmount > 0) {
			exitBoundaryAmount = 0;
			onExitBoundary?.(0);
		}
		accumulateDescend(step.entryBoundaryDelta, event.clientX, event.clientY);
	}

	function accumulateDescend(entryBoundaryDelta: number, clientX: number, clientY: number) {
		if (!onDescend) return;
		if (entryBoundaryDelta <= 0) {
			descendBoundaryAmount = 0;
			return;
		}
		const image = descendImageAt(clientX, clientY);
		if (!image) {
			// Blocked at max but not over a descendable image: no descend.
			descendBoundaryAmount = 0;
			return;
		}
		descendBoundaryAmount = Math.min(1, descendBoundaryAmount + entryBoundaryDelta);
		if (descendBoundaryAmount < 1) return;
		descendBoundaryAmount = 0;
		const rect = image.getBoundingClientRect();
		onDescend({
			assetId: image.dataset.assetId ?? '',
			sourceRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
			src: image.getAttribute('src') ?? '',
			alt: image.getAttribute('alt') ?? ''
		});
	}

	function getTwoPointerDistance(): number | null {
		const points = [...activePointers.values()];
		if (points.length !== 2) return null;
		return pointerDistance(
			points[0].clientX,
			points[0].clientY,
			points[1].clientX,
			points[1].clientY
		);
	}

	function getTwoPointerCentroid(): Point | null {
		const points = [...activePointers.values()];
		if (points.length !== 2) return null;
		return {
			x: (points[0].clientX + points[1].clientX) / 2,
			y: (points[0].clientY + points[1].clientY) / 2
		};
	}

	/**
	 * A press that starts on a control belongs to the control. Capturing it here
	 * would retarget its pointerup — and therefore its click — at this element,
	 * so no button inside the world would ever fire for a real pointer. Synthetic
	 * test events dispatch straight at the element and never showed this.
	 */
	function startsOnInteractiveContent(event: PointerEvent): boolean {
		return (
			event.target instanceof Element &&
			event.target.closest('button, a, input, textarea, select, [contenteditable]') !== null
		);
	}

	function handlePointerDown(event: PointerEvent) {
		if (startsOnInteractiveContent(event)) return;
		activePointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
		if (activePointers.size === 1 && worldState.scale > (minScale ?? 1) + 0.001) {
			dragStart = {
				clientX: event.clientX,
				clientY: event.clientY,
				panX: worldState.panX,
				panY: worldState.panY
			};
		} else if (activePointers.size === 2) {
			dragStart = null;
			const distance = getTwoPointerDistance();
			if (distance !== null) {
				pinchStart = { distance, scale: worldState.scale, state: worldState };
			}
		}
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function handlePointerMove(event: PointerEvent) {
		if (activePointers.has(event.pointerId)) {
			activePointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
		}
		if (activePointers.size === 2) {
			const bounds = currentBounds();
			const distance = getTwoPointerDistance();
			const centroid = getTwoPointerCentroid();
			const point = centroid ? localPoint(centroid.x, centroid.y) : null;
			if (!bounds || distance === null || !point) return;
			if (!pinchStart) {
				pinchStart = { distance, scale: worldState.scale, state: worldState };
				return;
			}
			if (shouldSwallowEntryZoom(distance > pinchStart.distance ? 'in' : 'out')) {
				pinchStart = { distance, scale: worldState.scale, state: worldState };
				return;
			}
			if (exitBoundaryAmount > 0) {
				exitBoundaryAmount = 0;
				onExitBoundary?.(0);
			}
			commitState(
				pinchZoomWorld(
					pinchStart.state,
					pinchStart.scale,
					distance / pinchStart.distance,
					point,
					bounds
				)
			);
			return;
		}
		if (!dragStart) return;
		const bounds = currentBounds();
		if (!bounds) return;
		if (exitBoundaryAmount > 0) {
			exitBoundaryAmount = 0;
			onExitBoundary?.(0);
		}
		commitState(
			clampZoomWorldState(
				{
					...worldState,
					panX: dragStart.panX + event.clientX - dragStart.clientX,
					panY: dragStart.panY + event.clientY - dragStart.clientY
				},
				bounds
			)
		);
	}

	function handlePointerUp(event: PointerEvent) {
		activePointers.delete(event.pointerId);
		if (activePointers.size < 2) pinchStart = null;
		if (activePointers.size === 0) dragStart = null;
		const target = event.currentTarget as HTMLElement;
		if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
	}
</script>

<div
	bind:this={worldRef}
	class="zoom-world"
	onwheel={handleWheel}
	onpointerdown={handlePointerDown}
	onpointermove={handlePointerMove}
	onpointerup={handlePointerUp}
	onpointercancel={handlePointerUp}
	data-zoom-world-scale={worldState.scale}
	data-zoom-world-pan-x={worldState.panX}
	data-zoom-world-pan-y={worldState.panY}
	role="presentation"
>
	<div bind:this={subjectRef} class="zoom-world-subject" style={`transform: ${transformStyle};`}>
		{#if children}
			{@render children()}
		{/if}
	</div>
</div>

<style>
	.zoom-world {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		overflow: visible;
		touch-action: none;
	}

	.zoom-world-subject {
		width: 100%;
		height: 100%;
		transform-origin: 50% 50%;
		will-change: transform;
	}
</style>
