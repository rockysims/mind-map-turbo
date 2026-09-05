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
	import { addonBadges } from './lib/addonBadges';

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
		onTitleCommit
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
	} = $props();

	const borderBackground = $derived(tagBorderBackground(borderSegments));
	/**
	 * Derived here rather than handed down as a prop: a badge is a fact about the
	 * node's own data, so every place that draws a `<Node>` — the canvas, the
	 * ghost nodes of an exit animation, the Stage harness — gets the same answer
	 * without a wiring step it could forget.
	 */
	const badges = $derived(addonBadges(nodeData));
	const taskDone = $derived(nodeData.addons?.task?.done === true);
</script>

<div
	class="node"
	data-node-id={nodeData.id}
	data-task-done={taskDone ? 'true' : undefined}
	data-pinned={nodeData.pinned ? 'true' : undefined}
	data-tag-border={borderSegments.length > 0 ? 'true' : undefined}
	data-spotlight={spotlightColor ? 'true' : undefined}
	style="--node-spotlight-color: {spotlightColor ?? 'transparent'};"
>
	<NodeChrome
		diameterPx={NODE_RADIUS * 2}
		borderRadiusPx={NODE_RADIUS}
		borderWidthPx={NODE_BORDER_WIDTH}
		pinnedBorderWidthPx={PINNED_NODE_BORDER_WIDTH}
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
			diameterPx={NODE_RADIUS * 2}
			fontSizePx={NODE_TEXT_FONT_SIZE}
			{quantityLabels}
			{quantityOverflowCount}
			{badges}
			{taskDone}
			{onTitleCommit}
		/>
	</NodeChrome>
</div>
