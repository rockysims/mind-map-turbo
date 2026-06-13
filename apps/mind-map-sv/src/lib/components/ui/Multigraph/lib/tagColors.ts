import type { EdgeData } from '../../types/edge';
import type { MultigraphData, TagColorNamespace } from '../../types/multigraph';
import type { NodeData } from '../../types/node';

export const DEFAULT_NODE_BORDER_COLOR = '#aaaaaa';
export const DEFAULT_EDGE_STROKE_COLOR = '#888888';

export interface TagColorSegment {
	color: string;
	startTurn: number;
	endTurn: number;
}

export interface LegendTag {
	namespace: TagColorNamespace;
	tag: string;
	color: string;
	usageCount: number;
	hasExplicitColor: boolean;
}

export function fallbackTagColor(tag: string): string {
	let hash = 0;
	for (let index = 0; index < tag.length; index += 1) {
		hash = (hash * 31 + tag.charCodeAt(index)) >>> 0;
	}

	const hue = hash % 360;
	return hslToHex(hue, 62, 45);
}

export function colorForTag(
	config: Record<string, string>,
	tag: string
): { color: string; hasExplicitColor: boolean } {
	const explicit = config[tag];
	return {
		color: explicit ?? fallbackTagColor(tag),
		hasExplicitColor: explicit !== undefined
	};
}

export function nodeBorderSegments(
	node: NodeData,
	nodeTagColors: Record<string, string>
): TagColorSegment[] {
	if (node.tags.length === 0) return [];

	const segmentSize = 1 / node.tags.length;
	return node.tags.map((tag, index) => ({
		color: colorForTag(nodeTagColors, tag).color,
		startTurn: index * segmentSize,
		endTurn: (index + 1) * segmentSize
	}));
}

export function edgeStrokeColor(edge: EdgeData, edgeTagColors: Record<string, string>): string {
	const firstTag = edge.tags[0];
	return firstTag ? colorForTag(edgeTagColors, firstTag).color : DEFAULT_EDGE_STROKE_COLOR;
}

export function collectLegendTags(data: MultigraphData): LegendTag[] {
	return [
		...collectNamespaceLegendTags(data, 'nodeTags'),
		...collectNamespaceLegendTags(data, 'edgeTags')
	];
}

export function tagUsageCount(
	data: MultigraphData,
	namespace: TagColorNamespace,
	tag: string
): number {
	const tagLists =
		namespace === 'nodeTags'
			? data.nodes.map((node) => node.tags)
			: data.edges.map((edge) => edge.tags);

	return tagLists.reduce(
		(count, tags) => count + tags.filter((candidate) => candidate === tag).length,
		0
	);
}

function collectNamespaceLegendTags(
	data: MultigraphData,
	namespace: TagColorNamespace
): LegendTag[] {
	const config = data.tagColorConfig[namespace];
	const usedTags = new Set<string>();
	const tagLists =
		namespace === 'nodeTags'
			? data.nodes.map((node) => node.tags)
			: data.edges.map((edge) => edge.tags);

	for (const tags of tagLists) {
		for (const tag of tags) usedTags.add(tag);
	}
	for (const tag of Object.keys(config)) usedTags.add(tag);

	return [...usedTags].sort().map((tag) => {
		const lookup = colorForTag(config, tag);
		return {
			namespace,
			tag,
			color: lookup.color,
			usageCount: tagUsageCount(data, namespace, tag),
			hasExplicitColor: lookup.hasExplicitColor
		};
	});
}

function hslToHex(h: number, s: number, l: number): string {
	const saturation = s / 100;
	const lightness = l / 100;
	const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
	const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = lightness - chroma / 2;
	const [r1, g1, b1] =
		h < 60
			? [chroma, x, 0]
			: h < 120
				? [x, chroma, 0]
				: h < 180
					? [0, chroma, x]
					: h < 240
						? [0, x, chroma]
						: h < 300
							? [x, 0, chroma]
							: [chroma, 0, x];

	return `#${[r1, g1, b1]
		.map((channel) =>
			Math.round((channel + m) * 255)
				.toString(16)
				.padStart(2, '0')
		)
		.join('')}`;
}
