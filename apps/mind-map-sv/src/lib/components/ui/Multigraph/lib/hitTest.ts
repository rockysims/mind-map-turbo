/**
 * Pure hit-test helpers. No DOM — easy to unit test.
 */

/** True if point (px, py) is inside the circle (centerX, centerY, radius). Uses squared distance. */
export function isPointInCircle(
	px: number,
	py: number,
	centerX: number,
	centerY: number,
	radius: number
): boolean {
	const dx = px - centerX;
	const dy = py - centerY;
	return dx * dx + dy * dy <= radius * radius;
}

/** Distance between two points. */
export function pointerDistance(
	x1: number,
	y1: number,
	x2: number,
	y2: number
): number {
	return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}
