import type { EdgeData } from '../../types/edge';
import type { Point } from '../../types/multigraph';

export const DEFAULT_PARALLEL_EDGE_SPACING_PX = 12;
export const DEFAULT_PARALLEL_EDGE_MAX_OFFSET_RADIUS_FACTOR = 0.5;

const ZERO_OFFSET: Point = { x: 0, y: 0 };

export interface ParallelEdgeOptions {
	spacingPx?: number;
	maxOffsetRadiusFactor?: number;
}

export interface ParallelEdgeGeometry {
	posByNodeId: Readonly<Record<string, Point | undefined>>;
	radiusByNodeId: Readonly<Record<string, number | undefined>>;
}

export interface ParallelEdgeOffset {
	edgeId: string;
	groupKey: string;
	groupCount: number;
	slot: number;
	offsetDistance: number;
	offsetVector: Point;
}

export function computeParallelEdgeOffsets(
	edges: readonly EdgeData[],
	geometry: ParallelEdgeGeometry,
	options: ParallelEdgeOptions = {}
): Record<string, ParallelEdgeOffset> {
	const spacingPx = nonNegativeFiniteOrDefault(options.spacingPx, DEFAULT_PARALLEL_EDGE_SPACING_PX);
	const maxOffsetRadiusFactor = nonNegativeFiniteOrDefault(
		options.maxOffsetRadiusFactor,
		DEFAULT_PARALLEL_EDGE_MAX_OFFSET_RADIUS_FACTOR
	);
	const groups = groupParallelEdges(edges);
	const offsets: Record<string, ParallelEdgeOffset> = {};

	for (const [groupKey, groupEdges] of groups) {
		const sortedEdges = [...groupEdges].sort((left, right) => compareStableIds(left.id, right.id));
		const groupCount = sortedEdges.length;

		sortedEdges.forEach((edge, index) => {
			const slot = centeredSlot(index, groupCount);
			const offsetDistance = clampedOffsetDistance(
				edge,
				geometry,
				slot,
				spacingPx,
				maxOffsetRadiusFactor
			);
			const offsetVector = parallelOffsetVector(edge, geometry, offsetDistance);

			offsets[edge.id] = {
				edgeId: edge.id,
				groupKey,
				groupCount,
				slot,
				offsetDistance: offsetVector === ZERO_OFFSET ? 0 : offsetDistance,
				offsetVector
			};
		});
	}

	return offsets;
}

export function applyParallelEdgeOffset(
	source: Point,
	target: Point,
	offset: Pick<ParallelEdgeOffset, 'offsetVector'>
): { source: Point; target: Point } {
	return {
		source: addPoints(source, offset.offsetVector),
		target: addPoints(target, offset.offsetVector)
	};
}

export function parallelEdgeGroupKey(
	edge: Pick<EdgeData, 'sourceNodeId' | 'targetNodeId'>
): string {
	const [first, second] = canonicalPairNodeIds(edge);
	return `${first}\u0000${second}`;
}

function groupParallelEdges(edges: readonly EdgeData[]): Map<string, EdgeData[]> {
	const groups = new Map<string, EdgeData[]>();

	for (const edge of edges) {
		const groupKey = parallelEdgeGroupKey(edge);
		const group = groups.get(groupKey);
		if (group) {
			group.push(edge);
		} else {
			groups.set(groupKey, [edge]);
		}
	}

	return groups;
}

function centeredSlot(index: number, count: number): number {
	return index - (count - 1) / 2;
}

function clampedOffsetDistance(
	edge: EdgeData,
	geometry: ParallelEdgeGeometry,
	slot: number,
	spacingPx: number,
	maxOffsetRadiusFactor: number
): number {
	if (slot === 0) return 0;

	const sourceRadius = nonNegativeFiniteOrDefault(geometry.radiusByNodeId[edge.sourceNodeId], 0);
	const targetRadius = nonNegativeFiniteOrDefault(geometry.radiusByNodeId[edge.targetNodeId], 0);
	const maxOffset = Math.min(sourceRadius, targetRadius) * maxOffsetRadiusFactor;
	const desiredOffset = slot * spacingPx;

	return clamp(desiredOffset, -maxOffset, maxOffset);
}

function parallelOffsetVector(
	edge: EdgeData,
	geometry: ParallelEdgeGeometry,
	offsetDistance: number
): Point {
	if (offsetDistance === 0) return ZERO_OFFSET;

	const [sourceNodeId, targetNodeId] = canonicalPairNodeIds(edge);
	const source = geometry.posByNodeId[sourceNodeId];
	const target = geometry.posByNodeId[targetNodeId];
	if (!source || !target) return ZERO_OFFSET;

	const dx = target.x - source.x;
	const dy = target.y - source.y;
	const length = Math.hypot(dx, dy);
	if (length === 0) return ZERO_OFFSET;

	return {
		x: withoutNegativeZero((-dy / length) * offsetDistance),
		y: withoutNegativeZero((dx / length) * offsetDistance)
	};
}

function addPoints(left: Point, right: Point): Point {
	return {
		x: left.x + right.x,
		y: left.y + right.y
	};
}

function nonNegativeFiniteOrDefault(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function compareStableIds(left: string, right: string): number {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

function canonicalPairNodeIds(
	edge: Pick<EdgeData, 'sourceNodeId' | 'targetNodeId'>
): [string, string] {
	return edge.sourceNodeId <= edge.targetNodeId
		? [edge.sourceNodeId, edge.targetNodeId]
		: [edge.targetNodeId, edge.sourceNodeId];
}

function withoutNegativeZero(value: number): number {
	return Object.is(value, -0) ? 0 : value;
}
