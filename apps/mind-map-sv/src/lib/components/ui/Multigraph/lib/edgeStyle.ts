import type { Point } from '../../types/multigraph';
import {
	EDGE_ARROW_REFERENCE_NODE_SCALE,
	EDGE_STROKE_REFERENCE_NODE_SCALE
} from '$lib/constants.js';
import type { EdgeVisibility } from './boundedVisibility';
import { DEFAULT_EDGE_OCCLUSION_MIN_OPACITY, type EdgeOcclusionWindow } from './edgeOcclusion';
import type { GraphLayout } from './graphLayout';
import { EDGE_NODE_GAP_PX, trimSegmentToNodeBorders } from './edgeRender';

const CENTERED_POSITION: Point = { x: 0, y: 0 };
const PERCENT_PRECISION_FACTOR = 10_000;

export type RenderableEdgeVisibility = Exclude<EdgeVisibility, { kind: 'hidden' }>;

export interface EdgeBackgroundOptions {
	occlusionWindows?: readonly EdgeOcclusionWindow[];
	edgeLengthPx?: number;
	edgeArrowLengthPx?: number;
	edgeOcclusionMinOpacity?: number;
}

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
			layout.radiusByNodeId[visibility.edge.targetNodeId] ?? 0,
			0,
			visibility.edge.directed === true ? EDGE_NODE_GAP_PX : 0
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

export function edgeBackground(
	visibility: RenderableEdgeVisibility,
	color: string,
	options: EdgeBackgroundOptions = {}
): string {
	if (visibility.kind === 'visible') {
		const windows = normalizedOcclusionWindows(options.occlusionWindows ?? []);
		if (windows.length === 0) return color;

		const minOpacity = options.edgeOcclusionMinOpacity ?? DEFAULT_EDGE_OCCLUSION_MIN_OPACITY;
		if (!Number.isFinite(minOpacity) || minOpacity >= 1) return color;

		const percentageScale = edgeBackgroundPercentageScale(visibility, options);
		const fullColorStops = [gradientStop(color, 0)];
		const fadedColor = fadedEdgeColor(color, minOpacity);
		const occlusionStops = windows.flatMap((window) => [
			gradientStop(color, window.fadeStart * percentageScale),
			gradientStop(fadedColor, window.coreStart * percentageScale),
			gradientStop(fadedColor, window.coreEnd * percentageScale),
			gradientStop(color, window.fadeEnd * percentageScale)
		]);
		const stops = [...fullColorStops, ...occlusionStops, gradientStop(color, 1)].sort(
			(a, b) => a.position - b.position
		);

		return `linear-gradient(to right, ${stops.map(formatGradientStop).join(', ')})`;
	}
	return `linear-gradient(to right, ${color}, transparent)`;
}

function normalizedOcclusionWindows(
	windows: readonly EdgeOcclusionWindow[]
): EdgeOcclusionWindow[] {
	return windows
		.filter(
			(window) =>
				Number.isFinite(window.fadeStart) &&
				Number.isFinite(window.coreStart) &&
				Number.isFinite(window.coreEnd) &&
				Number.isFinite(window.fadeEnd) &&
				window.fadeStart <= window.coreStart &&
				window.coreStart <= window.coreEnd &&
				window.coreEnd <= window.fadeEnd &&
				window.fadeEnd >= 0 &&
				window.fadeStart <= 1
		)
		.map((window) => ({
			...window,
			fadeStart: clamp(window.fadeStart, 0, 1),
			coreStart: clamp(window.coreStart, 0, 1),
			coreEnd: clamp(window.coreEnd, 0, 1),
			fadeEnd: clamp(window.fadeEnd, 0, 1)
		}))
		.sort(
			(a, b) =>
				a.fadeStart - b.fadeStart ||
				a.coreStart - b.coreStart ||
				a.coreEnd - b.coreEnd ||
				a.fadeEnd - b.fadeEnd
		);
}

function edgeBackgroundPercentageScale(
	visibility: Extract<RenderableEdgeVisibility, { kind: 'visible' }>,
	options: EdgeBackgroundOptions
): number {
	if (visibility.edge.directed !== true) return 1;

	const edgeLength = options.edgeLengthPx;
	const arrowLength = options.edgeArrowLengthPx;
	if (
		edgeLength === undefined ||
		arrowLength === undefined ||
		!Number.isFinite(edgeLength) ||
		!Number.isFinite(arrowLength)
	) {
		return 1;
	}

	const renderedLineLength = edgeLength - arrowLength / 2;
	if (edgeLength <= 0 || renderedLineLength <= 0) return 1;

	return edgeLength / renderedLineLength;
}

interface GradientStop {
	color: string;
	position: number;
}

function gradientStop(color: string, position: number): GradientStop {
	return { color, position: clamp(position, 0, 1) };
}

function formatGradientStop(stop: GradientStop): string {
	return `${stop.color} ${formatPercentage(stop.position)}`;
}

function fadedEdgeColor(color: string, opacity: number): string {
	const opacityPercentage = formatNumber(clamp(opacity, 0, 1) * 100);
	return `color-mix(in srgb, ${color} ${opacityPercentage}%, transparent)`;
}

function formatPercentage(position: number): string {
	return `${formatNumber(position * 100)}%`;
}

function formatNumber(value: number): string {
	return `${Math.round(value * PERCENT_PRECISION_FACTOR) / PERCENT_PRECISION_FACTOR}`;
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

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
