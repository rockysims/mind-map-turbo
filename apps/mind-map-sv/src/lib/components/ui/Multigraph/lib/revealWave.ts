import type { EdgeData } from '../../types/edge';
import type { NodeScaleAnimation } from './scaleAnimation';

export const DEFAULT_REVEAL_FRONT_WIDTH_HOPS = 1;

export type RevealWaveDirection = 'reveal' | 'hide';

export interface RevealWaveNodeOpacityOptions {
	frontWidthHops?: number;
	direction?: RevealWaveDirection;
}

export function revealWaveNodeOpacities(
	hopsByNodeId: Record<string, number>,
	displayedLayers: number,
	progress: number,
	options: RevealWaveNodeOpacityOptions = {}
): Record<string, number> {
	const resolvedDisplayedLayers = normalizeDisplayedLayers(displayedLayers);
	const resolvedProgress = normalizeProgress(progress, options.direction);
	const frontWidthHops = normalizeFrontWidthHops(options.frontWidthHops);
	const frontHop = resolvedProgress * resolvedDisplayedLayers;

	return Object.fromEntries(
		Object.entries(hopsByNodeId).map(([nodeId, hopCount]) => [
			nodeId,
			revealWaveNodeOpacityForHop(hopCount, resolvedDisplayedLayers, frontHop, frontWidthHops)
		])
	);
}

export function revealWaveNodeOpacityForHop(
	hopCount: number,
	displayedLayers: number,
	frontHop: number,
	frontWidthHops = DEFAULT_REVEAL_FRONT_WIDTH_HOPS
): number {
	const resolvedDisplayedLayers = normalizeDisplayedLayers(displayedLayers);
	const resolvedFrontWidthHops = normalizeFrontWidthHops(frontWidthHops);
	if (!Number.isFinite(hopCount) || hopCount < 0 || hopCount > resolvedDisplayedLayers) return 0;
	if (frontHop >= resolvedDisplayedLayers) return 1;

	if (resolvedFrontWidthHops === 0) return hopCount <= frontHop ? 1 : 0;

	const frontStart = frontHop - resolvedFrontWidthHops / 2;
	const frontEnd = frontHop + resolvedFrontWidthHops / 2;
	if (hopCount <= frontStart) return 1;
	if (hopCount >= frontEnd) return 0;

	const t = (frontEnd - hopCount) / (frontEnd - frontStart);
	return smoothstep(t);
}

export function revealWaveEdgeOpacity(
	edge: EdgeData,
	hopsByNodeId: Record<string, number>,
	nodeOpacityByNodeId: Record<string, number>,
	displayedLayers: number
): number {
	const inRangeNodeId = inRangeEndpointNodeId(edge, hopsByNodeId, displayedLayers);
	if (inRangeNodeId === null) return 0;
	return clamp(nodeOpacityByNodeId[inRangeNodeId] ?? 0, 0, 1);
}

export function inRangeEndpointNodeId(
	edge: EdgeData,
	hopsByNodeId: Record<string, number>,
	displayedLayers: number
): string | null {
	const resolvedDisplayedLayers = normalizeDisplayedLayers(displayedLayers);
	const sourceHop = hopsByNodeId[edge.sourceNodeId];
	const targetHop = hopsByNodeId[edge.targetNodeId];
	const sourceInRange = Number.isFinite(sourceHop) && sourceHop <= resolvedDisplayedLayers;
	const targetInRange = Number.isFinite(targetHop) && targetHop <= resolvedDisplayedLayers;

	if (!sourceInRange && !targetInRange) return null;
	if (sourceInRange && !targetInRange) return edge.sourceNodeId;
	if (!sourceInRange && targetInRange) return edge.targetNodeId;

	return sourceHop <= targetHop ? edge.sourceNodeId : edge.targetNodeId;
}

export function revealWaveProgressFromScaleAnimation(
	animation: NodeScaleAnimation | null | undefined,
	nowMs: number
): number {
	if (!animation) return 1;
	if (animation.durationMs <= 0) return 1;
	return clamp((nowMs - animation.startedAtMs) / animation.durationMs, 0, 1);
}

export function revealWaveProgressFromFocalAnimation(
	animations: Record<string, NodeScaleAnimation>,
	focalNodeId: string | null,
	nowMs: number
): number {
	if (focalNodeId === null) return 1;
	return revealWaveProgressFromScaleAnimation(animations[focalNodeId], nowMs);
}

function normalizeDisplayedLayers(displayedLayers: number): number {
	if (!Number.isFinite(displayedLayers)) return 0;
	return Math.max(0, Math.floor(displayedLayers));
}

function normalizeFrontWidthHops(frontWidthHops: number | undefined): number {
	if (frontWidthHops === undefined) return DEFAULT_REVEAL_FRONT_WIDTH_HOPS;
	if (!Number.isFinite(frontWidthHops)) return DEFAULT_REVEAL_FRONT_WIDTH_HOPS;
	return Math.max(0, frontWidthHops);
}

function normalizeProgress(progress: number, direction: RevealWaveDirection | undefined): number {
	const clampedProgress = clamp(progress, 0, 1);
	return direction === 'hide' ? 1 - clampedProgress : clampedProgress;
}

function smoothstep(value: number): number {
	const t = clamp(value, 0, 1);
	return t * t * (3 - 2 * t);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
