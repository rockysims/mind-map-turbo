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
	boundaryFadeRadiusPx?: number;
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
		const stops = occlusionGradientStops(color, windows, minOpacity, percentageScale);

		return `linear-gradient(to right, ${stops.map(formatGradientStop).join(', ')})`;
	}
	return boundaryEdgeBackground(color, options);
}

function occlusionGradientStops(
	color: string,
	windows: readonly EdgeOcclusionWindow[],
	minOpacity: number,
	percentageScale: number
): GradientStop[] {
	const ramps = windows.map((window) => scaledOcclusionRamp(window, percentageScale));
	const positions = new Set<number>([0, 1]);
	for (const ramp of ramps) {
		positions.add(ramp.fadeStart);
		positions.add(ramp.coreStart);
		positions.add(ramp.coreEnd);
		positions.add(ramp.fadeEnd);
	}

	for (let i = 0; i < ramps.length; i += 1) {
		for (let j = i + 1; j < ramps.length; j += 1) {
			for (const position of opacityIntersectionPositions(ramps[i], ramps[j], minOpacity)) {
				positions.add(position);
			}
		}
	}

	return [...positions]
		.filter((position) => Number.isFinite(position) && position >= 0 && position <= 1)
		.sort((a, b) => a - b)
		.map((position) =>
			gradientStop(edgeColorAtOpacity(color, opacityAt(position, ramps, minOpacity)), position)
		);
}

function boundaryEdgeBackground(color: string, options: EdgeBackgroundOptions): string {
	const edgeLength = options.edgeLengthPx;
	const fadeRadius = options.boundaryFadeRadiusPx;
	if (
		edgeLength === undefined ||
		fadeRadius === undefined ||
		!Number.isFinite(edgeLength) ||
		!Number.isFinite(fadeRadius) ||
		edgeLength <= 0 ||
		fadeRadius <= 0
	) {
		return `linear-gradient(to right, ${color}, transparent)`;
	}

	const fadeStart = clamp(fadeRadius / edgeLength, 0, 1);
	const fadeEnd = clamp((fadeRadius * 2) / edgeLength, 0, 1);
	return `linear-gradient(to right, ${formatGradientStop(gradientStop(color, 0))}, ${formatGradientStop(
		gradientStop(color, fadeStart)
	)}, transparent ${formatPercentage(fadeEnd)})`;
}

interface OcclusionRamp {
	fadeStart: number;
	coreStart: number;
	coreEnd: number;
	fadeEnd: number;
}

function scaledOcclusionRamp(window: EdgeOcclusionWindow, percentageScale: number): OcclusionRamp {
	return {
		fadeStart: clamp(window.fadeStart * percentageScale, 0, 1),
		coreStart: clamp(window.coreStart * percentageScale, 0, 1),
		coreEnd: clamp(window.coreEnd * percentageScale, 0, 1),
		fadeEnd: clamp(window.fadeEnd * percentageScale, 0, 1)
	};
}

function opacityAt(position: number, ramps: readonly OcclusionRamp[], minOpacity: number): number {
	return Math.min(...ramps.map((ramp) => opacityAtRampPosition(position, ramp, minOpacity)), 1);
}

function opacityAtRampPosition(position: number, ramp: OcclusionRamp, minOpacity: number): number {
	if (position >= ramp.coreStart && position <= ramp.coreEnd) return minOpacity;
	if (position <= ramp.fadeStart || position >= ramp.fadeEnd) return 1;
	if (position < ramp.coreStart) {
		return interpolate(1, minOpacity, ramp.fadeStart, ramp.coreStart, position);
	}
	return interpolate(minOpacity, 1, ramp.coreEnd, ramp.fadeEnd, position);
}

function opacityIntersectionPositions(
	a: OcclusionRamp,
	b: OcclusionRamp,
	minOpacity: number
): number[] {
	const positions = new Set<number>([
		a.fadeStart,
		a.coreStart,
		a.coreEnd,
		a.fadeEnd,
		b.fadeStart,
		b.coreStart,
		b.coreEnd,
		b.fadeEnd
	]);
	const sortedPositions = [...positions].sort((left, right) => left - right);
	const intersections: number[] = [];

	for (let i = 0; i < sortedPositions.length - 1; i += 1) {
		const start = sortedPositions[i];
		const end = sortedPositions[i + 1];
		if (start === end) continue;

		const startDelta =
			opacityAtRampPosition(start, a, minOpacity) - opacityAtRampPosition(start, b, minOpacity);
		const endDelta =
			opacityAtRampPosition(end, a, minOpacity) - opacityAtRampPosition(end, b, minOpacity);
		if (startDelta === 0) intersections.push(start);
		if (startDelta * endDelta >= 0) continue;

		const ratio = Math.abs(startDelta) / (Math.abs(startDelta) + Math.abs(endDelta));
		intersections.push(start + (end - start) * ratio);
	}

	return intersections;
}

function interpolate(
	startValue: number,
	endValue: number,
	startPosition: number,
	endPosition: number,
	position: number
): number {
	if (startPosition === endPosition) return endValue;
	const ratio = (position - startPosition) / (endPosition - startPosition);
	return startValue + (endValue - startValue) * ratio;
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

function edgeColorAtOpacity(color: string, opacity: number): string {
	if (opacity >= 1) return color;
	return fadedEdgeColor(color, opacity);
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
