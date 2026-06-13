import type { Point } from '../../types/multigraph';
import {
	EDGE_ARROW_REFERENCE_NODE_SCALE,
	EDGE_STROKE_REFERENCE_NODE_SCALE
} from '$lib/constants.js';
import type { EdgeVisibility } from './boundedVisibility';
import type { GraphLayout } from './graphLayout';
import { trimSegmentToNodeBorders } from './edgeRender';

const CENTERED_POSITION: Point = { x: 0, y: 0 };

export type RenderableEdgeVisibility = Exclude<EdgeVisibility, { kind: 'hidden' }>;

export function edgeStyle(sourcePos: Point, targetPos: Point): string {
	const dx = targetPos.x - sourcePos.x;
	const dy = targetPos.y - sourcePos.y;
	const length = Math.sqrt(dx ** 2 + dy ** 2);
	const angle = Math.atan2(dy, dx);

	return `left: calc(50% + ${sourcePos.x}px); top: calc(50% + ${sourcePos.y}px); width: ${length}px; transform: translateY(-50%) rotate(${angle}rad);`;
}

export function edgeRenderPoints(
	visibility: RenderableEdgeVisibility,
	layout: Pick<GraphLayout, 'posByNodeId' | 'radiusByNodeId'>,
	posByNodeId: Record<string, Point>
): {
	source: Point;
	target: Point;
} {
	if (visibility.kind === 'visible') {
		const source = layout.posByNodeId[visibility.edge.sourceNodeId] ?? CENTERED_POSITION;
		const target = layout.posByNodeId[visibility.edge.targetNodeId] ?? CENTERED_POSITION;
		return trimSegmentToNodeBorders(
			source,
			target,
			layout.radiusByNodeId[visibility.edge.sourceNodeId] ?? 0,
			layout.radiusByNodeId[visibility.edge.targetNodeId] ?? 0
		);
	}

	const visiblePos = layout.posByNodeId[visibility.visibleNodeId] ?? CENTERED_POSITION;
	const hiddenPos = posByNodeId[visibility.hiddenNodeId] ?? visiblePos;
	return {
		source: visiblePos,
		target: {
			x: visiblePos.x + (hiddenPos.x - visiblePos.x) * visibility.fadeRatio,
			y: visiblePos.y + (hiddenPos.y - visiblePos.y) * visibility.fadeRatio
		}
	};
}

export function edgeBackground(visibility: RenderableEdgeVisibility, color: string): string {
	if (visibility.kind === 'visible') return color;
	return `linear-gradient(to right, ${color}, transparent)`;
}

export function edgeArrowScale(
	visibility: RenderableEdgeVisibility,
	scaleByNodeId: Record<string, number>
): number {
	if (visibility.kind !== 'visible' || visibility.edge.directed !== true) return 1;
	const targetScale = scaleByNodeId[visibility.edge.targetNodeId] ?? 1;
	return targetScale / EDGE_ARROW_REFERENCE_NODE_SCALE;
}

export function edgeStrokeScale(
	visibility: RenderableEdgeVisibility,
	scaleByNodeId: Record<string, number>
): number {
	if (visibility.kind === 'boundary') {
		return nodeScale(scaleByNodeId, visibility.visibleNodeId) / EDGE_STROKE_REFERENCE_NODE_SCALE;
	}

	const edge = visibility.edge;
	if (edge.directed === true) {
		return nodeScale(scaleByNodeId, edge.targetNodeId) / EDGE_STROKE_REFERENCE_NODE_SCALE;
	}

	return (
		(nodeScale(scaleByNodeId, edge.sourceNodeId) + nodeScale(scaleByNodeId, edge.targetNodeId)) /
		2 /
		EDGE_STROKE_REFERENCE_NODE_SCALE
	);
}

function nodeScale(scaleByNodeId: Record<string, number>, nodeId: string): number {
	return scaleByNodeId[nodeId] ?? 1;
}
