import type { Point } from '../../types/multigraph';

import { shouldShowCreationPreviewNode } from './creationGesture.js';
import { easeInOut } from './elementTransitions.js';

/**
 * Pure state for the creation-gesture preview: a preview node that scales in
 * while the cursor is over background and scales out over any node, plus the
 * cursor point the preview edge is drawn to.
 */
export interface CreationPreviewState {
	sourceNodeId: string;
	/** Cursor position in graph coordinates. */
	point: Point;
	hoverNodeId: string | null;
	/** Scale animation: fromScale -> toScale starting at startedAtMs. toScale 0 = hiding, 1 = showing. */
	anim: { fromScale: number; toScale: number; startedAtMs: number; durationMs: number };
	/** Gesture finished (cancelled); prune the preview once the scale-out settles. */
	ending: boolean;
}

/** New nodes are created pinned (hops 0), so their layout scale is exactly 1. */
export const CREATION_PREVIEW_TARGET_SCALE = 1;

/** Start a preview. The gesture always starts over the source node, so it begins hidden. */
export function beginCreationPreview(
	sourceNodeId: string,
	point: Point,
	nowMs: number
): CreationPreviewState {
	return {
		sourceNodeId,
		point,
		hoverNodeId: sourceNodeId,
		anim: { fromScale: 0, toScale: 0, startedAtMs: nowMs, durationMs: 0 },
		ending: false
	};
}

/**
 * Track the cursor and retarget the scale animation whenever preview-node
 * visibility flips. Retargeting starts from the current interpolated scale so
 * mid-animation flips never snap.
 */
export function updateCreationPreview(
	state: CreationPreviewState,
	input: { point: Point; hoverNodeId: string | null },
	nowMs: number,
	durationMs: number
): CreationPreviewState {
	const targetScale = shouldShowCreationPreviewNode(input.hoverNodeId)
		? CREATION_PREVIEW_TARGET_SCALE
		: 0;
	const anim =
		targetScale === state.anim.toScale
			? state.anim
			: {
					fromScale: creationPreviewScaleAt(state, nowMs),
					toScale: targetScale,
					startedAtMs: nowMs,
					durationMs: Math.max(0, durationMs)
				};
	return { ...state, point: input.point, hoverNodeId: input.hoverNodeId, anim, ending: false };
}

/**
 * Cancel path: scale the preview node out from its current scale and mark the
 * preview as ending. Returns null when there is nothing visible to animate.
 */
export function endCreationPreview(
	state: CreationPreviewState,
	nowMs: number,
	durationMs: number
): CreationPreviewState | null {
	const fromScale = creationPreviewScaleAt(state, nowMs);
	if (fromScale <= 0) return null;
	return {
		...state,
		anim: { fromScale, toScale: 0, startedAtMs: nowMs, durationMs: Math.max(0, durationMs) },
		ending: true
	};
}

/** Eased interpolated scale of the preview node at `nowMs`. */
export function creationPreviewScaleAt(state: CreationPreviewState, nowMs: number): number {
	const { fromScale, toScale, startedAtMs, durationMs } = state.anim;
	const t = easeInOut(animProgress(startedAtMs, durationMs, nowMs));
	return fromScale + (toScale - fromScale) * t;
}

/** True once the current scale animation has completed. */
export function isCreationPreviewSettled(state: CreationPreviewState, nowMs: number): boolean {
	return animProgress(state.anim.startedAtMs, state.anim.durationMs, nowMs) >= 1;
}

function animProgress(startedAtMs: number, durationMs: number, nowMs: number): number {
	if (durationMs <= 0) return 1;
	return Math.min(1, Math.max(0, (nowMs - startedAtMs) / durationMs));
}
