<script lang="ts">
	import {
		NODE_BORDER_WIDTH,
		NODE_RADIUS,
		NODE_TEXT_FONT_SIZE,
		PINNED_NODE_BORDER_WIDTH
	} from '$lib/constants';
	import type { NodeData } from '$lib/components/ui/types/node';
	import type { TagColorSegment } from '$lib/components/ui/Multigraph/lib/tagColors';
	import NodeChrome from './NodeChrome.svelte';
	import NodeCompactContent from './NodeCompactContent.svelte';

	const {
		nodeData = {
			id: 'id_fallback',
			title: 'title_fallback',
			description: 'description_fallback',
			tags: []
		},
		isTitleEditing = false,
		borderSegments = [],
		spotlightColor,
		onTitleCommit
	} = $props<{
		nodeData: NodeData;
		isTitleEditing?: boolean;
		borderSegments?: TagColorSegment[];
		spotlightColor?: string;
		onTitleCommit?: (title: string) => void;
	}>();

	const borderBackground = $derived(
		borderSegments.length === 0 ? 'transparent' : borderGradient(borderSegments)
	);

	function borderGradient(segments: TagColorSegment[]): string {
		return `conic-gradient(${segments
			.map((segment) => `${segment.color} ${segment.startTurn}turn ${segment.endTurn}turn`)
			.join(', ')})`;
	}
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
			diameterPx={NODE_RADIUS * 2}
			fontSizePx={NODE_TEXT_FONT_SIZE}
			{onTitleCommit}
		/>
	</NodeChrome>
</div>
