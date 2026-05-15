import type { MultigraphData, Point } from '../../types/multigraph';
import { hopsFromPinned, radiusOf, scaleByHops } from './layout';
import type { LayoutSettings } from './layoutSettings';
import { withDefaultLayoutSettings } from './layoutSettings';
import { relaxOverlaps } from './physics';

const CENTERED_POSITION: Point = { x: 0, y: 0 };

export interface NodeLayout {
	nodeId: string;
	hops: number;
	scale: number;
	radius: number;
	position: Point;
	anchored: boolean;
}

export interface GraphLayout {
	hopsByNodeId: Record<string, number>;
	scaleByNodeId: Record<string, number>;
	radiusByNodeId: Record<string, number>;
	posByNodeId: Record<string, Point>;
	nodes: NodeLayout[];
}

export interface GraphLayoutOptions {
	settings?: Partial<LayoutSettings>;
	activeDragNodeId?: string | null;
	relaxIterations?: number;
}

export function deriveGraphLayout(
	data: MultigraphData,
	options: GraphLayoutOptions = {}
): GraphLayout {
	const settings = withDefaultLayoutSettings(options.settings);
	const hopsByNodeId = hopsFromPinned(data);
	const scaleByNodeId = scaleByHops(hopsByNodeId, settings);
	const radiusByNodeId = Object.fromEntries(
		data.nodes.map((node) => [node.id, radiusOf(scaleByNodeId, settings, node.id)])
	);
	const basePositions = positionsForNodes(data);
	const anchoredIds = anchoredNodeIds(data, options.activeDragNodeId);
	const iterations = options.relaxIterations ?? settings.relaxIterations;
	const posByNodeId =
		iterations > 0
			? relaxOverlaps(basePositions, radiusByNodeId, settings.paddingPx, iterations, anchoredIds)
			: basePositions;

	return {
		hopsByNodeId,
		scaleByNodeId,
		radiusByNodeId,
		posByNodeId,
		nodes: data.nodes.map((node) => ({
			nodeId: node.id,
			hops: hopsByNodeId[node.id],
			scale: scaleByNodeId[node.id],
			radius: radiusByNodeId[node.id],
			position: posByNodeId[node.id],
			anchored: anchoredIds.has(node.id)
		}))
	};
}

export function relaxGraphPositions(
	data: MultigraphData,
	options: GraphLayoutOptions = {}
): Record<string, Point> {
	return deriveGraphLayout(data, options).posByNodeId;
}

function positionsForNodes(data: MultigraphData): Record<string, Point> {
	return Object.fromEntries(
		data.nodes.map((node) => [node.id, { ...(data.posByNodeId[node.id] ?? CENTERED_POSITION) }])
	);
}

function anchoredNodeIds(data: MultigraphData, activeDragNodeId?: string | null): Set<string> {
	const anchoredIds = new Set(data.nodes.filter((node) => node.pinned).map((node) => node.id));
	if (activeDragNodeId) anchoredIds.add(activeDragNodeId);
	return anchoredIds;
}
