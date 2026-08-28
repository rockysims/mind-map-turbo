/**
 * When and how to name the quantities flowing along a derived edge.
 *
 * Labels reveal with zoom rather than rendering permanently, because a bundled
 * edge is legible as an arrow at graph scale and only becomes worth reading once
 * there is room for the text.
 */

import type { Point } from '../../types/multigraph';

/**
 * The angle the edge element is rotated by, so a label placed inside it can be
 * counter-rotated back to horizontal and stay readable on a downhill edge.
 */
export function edgeAngleDegrees(source: Point, target: Point): number {
	return (Math.atan2(target.y - source.y, target.x - source.x) * 180) / Math.PI;
}

export interface QuantityLabelVisibilityOptions {
	/** Zoom below which labels stay hidden entirely. */
	minStageScale?: number;
	/** Shortest on-screen edge worth labelling, in CSS pixels. */
	minOnScreenLengthPx?: number;
}

/**
 * Two independent conditions, because either alone reads wrong. Zoom alone would
 * label a cluster of tiny edges the moment the user zoomed in; length alone would
 * label a long edge while the whole graph is too small to read.
 */
export function shouldRevealQuantityLabel(
	edgeLengthPx: number,
	stageScale: number,
	options: QuantityLabelVisibilityOptions = {}
): boolean {
	const { minStageScale = 0.8, minOnScreenLengthPx = 90 } = options;

	if (!Number.isFinite(edgeLengthPx) || !Number.isFinite(stageScale)) {
		return false;
	}
	if (stageScale < minStageScale) {
		return false;
	}
	return edgeLengthPx * stageScale >= minOnScreenLengthPx;
}

/**
 * Name the first few quantities and count the rest.
 *
 * A pair sharing many variables is exactly the case where spelling them all out
 * would cover the canvas, and the count still says the bundle is worth opening.
 */
export function formatQuantityLabel(labels: readonly string[], maxVisible = 3): string {
	if (labels.length === 0) {
		return '';
	}
	if (maxVisible < 1) {
		return `${labels.length}`;
	}
	if (labels.length <= maxVisible) {
		return labels.join(', ');
	}
	return `${labels.slice(0, maxVisible).join(', ')} +${labels.length - maxVisible}`;
}
