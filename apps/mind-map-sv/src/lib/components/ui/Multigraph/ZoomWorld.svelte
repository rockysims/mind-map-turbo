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
	import { pointerDistance } from './lib/hitTest';
	import {
		clampZoomWorldState,
		pinchZoomWorld,
		wheelZoomWorld,
		type ZoomWorldBounds,
		type ZoomWorldState
	} from './lib/zoomWorldController';

	let {
		minScale,
		maxScale = 8,
		entryGestureIdleMs = 0,
		entryGestureMaxMs = 0,
		onExitBoundary,
		onStateChange,
		children
	}: {
		minScale?: number;
		maxScale?: number;
		entryGestureIdleMs?: number;
		entryGestureMaxMs?: number;
		onExitBoundary?: (delta: number) => void;
		onStateChange?: (state: ZoomWorldState) => void;
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
		onStateChange?.(next);
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

	function handleWheel(event: WheelEvent) {
		const bounds = currentBounds();
		const point = localPoint(event.clientX, event.clientY);
		if (!bounds || !point) return;
		event.preventDefault();
		event.stopPropagation();
		if (shouldSwallowEntryZoom(event.deltaY < 0 ? 'in' : 'out')) return;
		const step = wheelZoomWorld(worldState, event.deltaY, point, bounds);
		commitState(step.state);
		if (step.exitBoundaryDelta > 0) onExitBoundary?.(step.exitBoundaryDelta);
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

	function handlePointerDown(event: PointerEvent) {
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
		transform-origin: 50% 50%;
		will-change: transform;
	}
</style>
