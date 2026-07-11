import { APP_CONFIG } from '$lib/appConfig';
import type { Point } from '../../types/multigraph';
import type { NodeData } from '../../types/node';
import { graphPointToClientPoint, type StageRect } from './stageCoordinates';
import { inscribeScaleForCircle, type ViewportSize } from './zoomBoundary';

export interface ViewTransform {
	panX: number;
	panY: number;
	scale: number;
}

export interface NodeFocusCandidate {
	node: NodeData;
	position: Point;
	radius: number;
	zIndex?: number;
}

export interface ScreenCircle {
	nodeId: string;
	center: Point;
	radius: number;
}

export interface NodeFocusMorphSource {
	nodeId: string;
	left: number;
	top: number;
	width: number;
	height: number;
}

export function nodeScreenCircle(
	nodeId: string,
	position: Point,
	radius: number,
	stageRect: StageRect,
	view: ViewTransform
): ScreenCircle {
	return {
		nodeId,
		center: graphPointToClientPoint(
			position,
			stageRect,
			{ x: view.panX, y: view.panY },
			view.scale
		),
		radius: radius * view.scale
	};
}

export function focalNodeForPoint(
	candidates: readonly NodeFocusCandidate[],
	focalPoint: Point,
	stageRect: StageRect,
	view: ViewTransform,
	options: { coverageRatio?: number } = {}
): NodeFocusCandidate | null {
	const coverageRatio =
		options.coverageRatio ?? APP_CONFIG.multigraph.focus.eligibilityCoverageRatio;
	const hits = candidates.filter((candidate) => {
		const circle = nodeScreenCircle(
			candidate.node.id,
			candidate.position,
			candidate.radius,
			stageRect,
			view
		);
		return distance(circle.center, focalPoint) <= circle.radius * coverageRatio;
	});
	if (hits.length === 0) return null;
	return hits.toSorted((left, right) => (right.zIndex ?? 0) - (left.zIndex ?? 0))[0] ?? null;
}

export function persistedScaleForFocusOverzoom(visualScale: number, maxScale: number): number {
	return Math.min(visualScale, maxScale);
}

export function focusOverzoomMaxScaleForNode(
	radius: number,
	viewport: ViewportSize,
	maxScale: number
): number {
	const inscribeScale = inscribeScaleForCircle(radius, viewport);
	return Number.isFinite(inscribeScale) && inscribeScale > 0 ? inscribeScale : maxScale;
}

function distance(left: Point, right: Point): number {
	return Math.hypot(left.x - right.x, left.y - right.y);
}
