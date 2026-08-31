<script lang="ts">
	import {
		NODE_BORDER_WIDTH,
		NODE_RADIUS,
		NODE_TEXT_FONT_SIZE,
		PINNED_NODE_BORDER_WIDTH
	} from '$lib/constants';
	import type { NodeData } from '$lib/components/ui/types/node';
	import {
		tagBorderBackground,
		type TagColorSegment
	} from '$lib/components/ui/Multigraph/lib/tagColors';
	import NodeChrome from './NodeChrome.svelte';
	import NodeCompactContent from './NodeCompactContent.svelte';

	let {
		nodeData = {
			id: 'id_fallback',
			title: 'title_fallback',
			description: 'description_fallback',
			tags: []
		},
		isTitleEditing = false,
		titleCaretAt,
		borderSegments = [],
		spotlightColor,
		quantityLabels = [],
		quantityOverflowCount = 0,
		onTitleCommit,
		// Chrome measurements default to the shipped constants so a story can mount
		// a node with none of them. A parent that owns a live config (Multigraph)
		// passes all four explicitly — a prop default is evaluated once, so it must
		// never be the path a changing value takes.
		radiusPx = NODE_RADIUS,
		borderWidthPx = NODE_BORDER_WIDTH,
		pinnedBorderWidthPx = PINNED_NODE_BORDER_WIDTH,
		fontSizePx = NODE_TEXT_FONT_SIZE
	}: {
		nodeData: NodeData;
		isTitleEditing?: boolean;
		/** Caret offset for the opening title input; omitted means select-all. */
		titleCaretAt?: number;
		borderSegments?: TagColorSegment[];
		spotlightColor?: string;
		/** Quantities this node defines. The caller decides whether there is room. */
		quantityLabels?: string[];
		quantityOverflowCount?: number;
		onTitleCommit?: (title: string) => void;
		/** Node radius in logical pixels; the circle is drawn at twice this. */
		radiusPx?: number;
		/** Border width of an unpinned node. */
		borderWidthPx?: number;
		/** Border width of a pinned node. */
		pinnedBorderWidthPx?: number;
		/** Title font size inside the compact circle. */
		fontSizePx?: number;
	} = $props();

	const borderBackground = $derived(tagBorderBackground(borderSegments));
</script>

<div
	class="node"
	data-node-id={nodeData.id}
	data-pinned={nodeData.pinned ? 'true' : undefined}
	data-tag-border={borderSegments.length > 0 ? 'true' : undefined}
	data-spotlight={spotlightColor ? 'true' : undefined}
	style="--node-spotlight-color: {spotlightColor ?? 'transparent'};"
>
	<NodeChrome
		diameterPx={radiusPx * 2}
		borderRadiusPx={radiusPx}
		{borderWidthPx}
		{pinnedBorderWidthPx}
		pinned={nodeData.pinned ?? false}
		hasTagBorder={borderSegments.length > 0}
		tagBorderBackground={borderBackground}
		spotlight={!!spotlightColor}
		spotlightColor={spotlightColor ?? 'transparent'}
	>
		<NodeCompactContent
			title={nodeData.title}
			{isTitleEditing}
			{titleCaretAt}
			diameterPx={radiusPx * 2}
			{fontSizePx}
			{quantityLabels}
			{quantityOverflowCount}
			{onTitleCommit}
		/>
	</NodeChrome>
</div>
