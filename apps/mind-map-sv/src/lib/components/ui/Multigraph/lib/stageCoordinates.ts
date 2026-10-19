import type { Point } from '../../types/multigraph';

export interface StageRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export function clientPointToGraphPoint(
	clientPoint: Point,
	stageRect: StageRect,
	pan: Point = { x: 0, y: 0 },
	scale = 1
): Point {
	const centerX = stageRect.left + stageRect.width / 2 + pan.x;
	const centerY = stageRect.top + stageRect.height / 2 + pan.y;

	return {
		x: (clientPoint.x - centerX) / scale,
		y: (clientPoint.y - centerY) / scale
	};
}

export function graphPointToClientPoint(
	graphPoint: Point,
	stageRect: StageRect,
	pan: Point = { x: 0, y: 0 },
	scale = 1
): Point {
	const centerX = stageRect.left + stageRect.width / 2 + pan.x;
	const centerY = stageRect.top + stageRect.height / 2 + pan.y;

	return {
		x: centerX + graphPoint.x * scale,
		y: centerY + graphPoint.y * scale
	};
}

/**
 * The rectangle two corners span, whichever two they are.
 *
 * A drag can run any way from where it started, so the press and the pointer
 * are opposite corners in no fixed order: dragging up and to the left would
 * otherwise give a negative width and height, which no consumer measuring
 * overlap expects. Both points share one coordinate space and so does the
 * result.
 */
export function rectFromCorners(a: Point, b: Point): StageRect {
	return {
		left: Math.min(a.x, b.x),
		top: Math.min(a.y, b.y),
		width: Math.abs(a.x - b.x),
		height: Math.abs(a.y - b.y)
	};
}

/**
 * The stage rect the focus frame should lay out against.
 *
 * A browser can report a stage of no size for a moment — a window losing its
 * viewport to a native picker or a sheet, a layout pass caught mid-way. The
 * stage keeps reporting what it measures (other readers want the latest,
 * empty or not), but the focus frame laid out from an empty measurement was
 * clamped to one pixel with everything inside clipped away, which reads as
 * the deep zoom going blank. So the frame uses the current measurement when
 * it has size and otherwise the last one that did; with neither, whatever the
 * stage reported, so the caller's own fallback still applies.
 */
export function usableStageRect(
	current: StageRect | null,
	lastGood: StageRect | null
): StageRect | null {
	if (current !== null && hasSize(current)) return current;
	return lastGood ?? current;
}

/** Whether a measurement is one the frame can be laid out against. */
export function hasSize(rect: StageRect): boolean {
	return (
		Number.isFinite(rect.width) &&
		Number.isFinite(rect.height) &&
		rect.width >= 1 &&
		rect.height >= 1
	);
}
