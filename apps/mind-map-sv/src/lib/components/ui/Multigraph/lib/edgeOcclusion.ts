import type { Point } from '../../types/multigraph';

export const DEFAULT_EDGE_OCCLUSION_CLEARANCE_PX = 6;
export const DEFAULT_EDGE_OCCLUSION_FADE_WIDTH_PX = 12;
export const DEFAULT_EDGE_OCCLUSION_MIN_OPACITY = 0.16;

const MIN_EDGE_OCCLUSION_SEGMENT_LENGTH_PX = 1;

export interface EdgeOcclusionSegment {
	sourceNodeId: string;
	targetNodeId: string;
	source: Point;
	target: Point;
	directed?: boolean;
}

export interface EdgeOcclusionNode {
	nodeId: string;
	position: Point;
	radius: number;
}

export interface EdgeOcclusionOptions {
	edgeOcclusionClearancePx?: number;
	edgeOcclusionFadeWidthPx?: number;
	edgeOcclusionMinOpacity?: number;
}

export interface EdgeOcclusionWindow {
	fadeStart: number;
	coreStart: number;
	coreEnd: number;
	fadeEnd: number;
	occludingNodeIds: readonly string[];
}

interface WindowInPixels {
	fadeStartPx: number;
	coreStartPx: number;
	coreEndPx: number;
	fadeEndPx: number;
	occludingNodeIds: readonly string[];
}

export function computeEdgeOcclusionWindows(
	segment: EdgeOcclusionSegment,
	nodes: readonly EdgeOcclusionNode[],
	options: EdgeOcclusionOptions = {}
): EdgeOcclusionWindow[] {
	const clearance = options.edgeOcclusionClearancePx ?? DEFAULT_EDGE_OCCLUSION_CLEARANCE_PX;
	const fadeWidth = options.edgeOcclusionFadeWidthPx ?? DEFAULT_EDGE_OCCLUSION_FADE_WIDTH_PX;
	const minOpacity = options.edgeOcclusionMinOpacity ?? DEFAULT_EDGE_OCCLUSION_MIN_OPACITY;
	const dx = segment.target.x - segment.source.x;
	const dy = segment.target.y - segment.source.y;
	const length = Math.hypot(dx, dy);

	if (
		length < MIN_EDGE_OCCLUSION_SEGMENT_LENGTH_PX ||
		!Number.isFinite(clearance) ||
		!Number.isFinite(fadeWidth) ||
		clearance < 0 ||
		fadeWidth < 0 ||
		minOpacity >= 1
	) {
		return [];
	}

	const windows = nodes
		.flatMap((node) => {
			if (node.nodeId === segment.sourceNodeId || node.nodeId === segment.targetNodeId) {
				return [];
			}
			return windowForNode(segment.source, dx, dy, length, node, clearance, fadeWidth);
		})
		.sort(compareWindowInPixels);

	return mergeWindows(windows).map((window) => ({
		fadeStart: window.fadeStartPx / length,
		coreStart: window.coreStartPx / length,
		coreEnd: window.coreEndPx / length,
		fadeEnd: window.fadeEndPx / length,
		occludingNodeIds: window.occludingNodeIds
	}));
}

function windowForNode(
	source: Point,
	dx: number,
	dy: number,
	length: number,
	node: EdgeOcclusionNode,
	clearance: number,
	fadeWidth: number
): WindowInPixels[] {
	if (!Number.isFinite(node.radius) || node.radius <= 0) return [];

	const occlusionRadius = node.radius + clearance;
	if (!pointIntersectsSegmentBounds(node.position, source, dx, dy, occlusionRadius)) return [];

	const unitX = dx / length;
	const unitY = dy / length;
	const rawProjectionPx =
		(node.position.x - source.x) * unitX + (node.position.y - source.y) * unitY;
	const projectionPx = clamp(rawProjectionPx, 0, length);
	const closestPoint = {
		x: source.x + unitX * projectionPx,
		y: source.y + unitY * projectionPx
	};
	const distance = Math.hypot(node.position.x - closestPoint.x, node.position.y - closestPoint.y);

	if (distance >= occlusionRadius) return [];

	const coreHalfLength = Math.sqrt(Math.max(0, node.radius * node.radius - distance * distance));
	const widenedCoreHalfLength = coreHalfLength + clearance;
	const coreStartPx = clamp(projectionPx - widenedCoreHalfLength, 0, length);
	const coreEndPx = clamp(projectionPx + widenedCoreHalfLength, 0, length);

	return [
		{
			fadeStartPx: clamp(coreStartPx - fadeWidth, 0, length),
			coreStartPx,
			coreEndPx,
			fadeEndPx: clamp(coreEndPx + fadeWidth, 0, length),
			occludingNodeIds: [node.nodeId]
		}
	];
}

function pointIntersectsSegmentBounds(
	point: Point,
	source: Point,
	dx: number,
	dy: number,
	padding: number
): boolean {
	const minX = Math.min(source.x, source.x + dx) - padding;
	const maxX = Math.max(source.x, source.x + dx) + padding;
	const minY = Math.min(source.y, source.y + dy) - padding;
	const maxY = Math.max(source.y, source.y + dy) + padding;

	return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
}

function mergeWindows(windows: readonly WindowInPixels[]): WindowInPixels[] {
	const merged: WindowInPixels[] = [];

	for (const window of windows) {
		const previous = merged.at(-1);
		if (!previous || window.fadeStartPx > previous.fadeEndPx) {
			merged.push(window);
			continue;
		}

		merged[merged.length - 1] = {
			fadeStartPx: Math.min(previous.fadeStartPx, window.fadeStartPx),
			coreStartPx: Math.min(previous.coreStartPx, window.coreStartPx),
			coreEndPx: Math.max(previous.coreEndPx, window.coreEndPx),
			fadeEndPx: Math.max(previous.fadeEndPx, window.fadeEndPx),
			occludingNodeIds: [...previous.occludingNodeIds, ...window.occludingNodeIds].sort()
		};
	}

	return merged;
}

function compareWindowInPixels(a: WindowInPixels, b: WindowInPixels): number {
	return (
		a.fadeStartPx - b.fadeStartPx ||
		a.coreStartPx - b.coreStartPx ||
		a.coreEndPx - b.coreEndPx ||
		a.fadeEndPx - b.fadeEndPx ||
		a.occludingNodeIds[0].localeCompare(b.occludingNodeIds[0])
	);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
