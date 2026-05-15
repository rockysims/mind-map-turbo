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
