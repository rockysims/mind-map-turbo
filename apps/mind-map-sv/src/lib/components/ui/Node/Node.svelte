<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		NODE_BORDER_WIDTH,
		NODE_RADIUS,
		NODE_TEXT_FONT_SIZE,
		PINNED_NODE_BORDER_WIDTH
	} from '$lib/constants';
	import type { NodeData } from '$lib/components/ui/types/node';
	import type { TagColorSegment } from '$lib/components/ui/Multigraph/lib/tagColors';
	import { borderRadiusForProgress } from '$lib/components/ui/Multigraph/lib/zoomBoundary';
	import NodeChrome from './NodeChrome.svelte';
	import NodeCompactContent from './NodeCompactContent.svelte';
	import NodeDetailsLayer from './NodeDetailsLayer.svelte';

	const {
		nodeData = {
			id: 'id_fallback',
			title: 'title_fallback',
			description: 'description_fallback',
			tags: []
		},
		isTitleEditing = false,
		borderSegments = [],
		detailsMode = false,
		detailsProgress = 0,
		detailsWidthPx,
		detailsHeightPx,
		borderWidthPx,
		detailsTitleId,
		spotlightColor,
		onTitleCommit,
		children
	} = $props<{
		nodeData: NodeData;
		isTitleEditing?: boolean;
		borderSegments?: TagColorSegment[];
		detailsMode?: boolean;
		detailsProgress?: number;
		detailsWidthPx?: number;
		detailsHeightPx?: number;
		borderWidthPx?: number;
		detailsTitleId?: string;
		spotlightColor?: string;
		onTitleCommit?: (title: string) => void;
		children?: Snippet;
	}>();

	const borderBackground = $derived(
		borderSegments.length === 0 ? 'transparent' : borderGradient(borderSegments)
	);
	const clampedDetailsProgress = $derived(Math.min(1, Math.max(0, detailsProgress)));
	const borderRadiusPx = $derived(borderRadiusForProgress(NODE_RADIUS * 2, clampedDetailsProgress));
	const previewDetailsShape = $derived(
		!detailsMode &&
			clampedDetailsProgress > 0 &&
			detailsWidthPx !== undefined &&
			detailsHeightPx !== undefined
	);
	const previewWidthPx = $derived(
		lerp(NODE_RADIUS * 2, detailsWidthPx ?? NODE_RADIUS * 2, clampedDetailsProgress)
	);
	const previewHeightPx = $derived(
		lerp(NODE_RADIUS * 2, detailsHeightPx ?? NODE_RADIUS * 2, clampedDetailsProgress)
	);
	const showDetailsLayer = $derived(detailsMode || previewDetailsShape);
	const showCompactLayer = $derived(!detailsMode || clampedDetailsProgress < 1);
	const compactOpacity = $derived(showDetailsLayer ? 1 - clampedDetailsProgress : 1);
	const detailsOpacity = $derived(showDetailsLayer ? clampedDetailsProgress : 0);
	const nodeBorderWidthPx = $derived(borderWidthPx ?? NODE_BORDER_WIDTH);
	const pinnedNodeBorderWidthPx = $derived(borderWidthPx ?? PINNED_NODE_BORDER_WIDTH);

	function borderGradient(segments: TagColorSegment[]): string {
		return `conic-gradient(${segments
			.map((segment) => `${segment.color} ${segment.startTurn}turn ${segment.endTurn}turn`)
			.join(', ')})`;
	}

	function lerp(from: number, to: number, progress: number): number {
		return from + (to - from) * progress;
	}
</script>

<div
	class="node"
	data-node-id={nodeData.id}
	data-pinned={nodeData.pinned ? 'true' : undefined}
	data-tag-border={borderSegments.length > 0 ? 'true' : undefined}
	data-details-mode={detailsMode ? 'true' : undefined}
	data-details-preview={previewDetailsShape ? 'true' : undefined}
	data-details-progress={clampedDetailsProgress}
	data-content-crossfade={showDetailsLayer ? 'true' : undefined}
	data-spotlight={spotlightColor ? 'true' : undefined}
	style="--node-diameter: {NODE_RADIUS *
		2}px; --node-border-radius: {borderRadiusPx}px; --node-preview-width: {previewWidthPx}px; --node-preview-height: {previewHeightPx}px; --node-compact-opacity: {compactOpacity}; --node-details-opacity: {detailsOpacity}; --node-tag-border: {borderBackground}; --node-text-font-size: {NODE_TEXT_FONT_SIZE}px; --node-border-width: {nodeBorderWidthPx}px; --pinned-node-border-width: {pinnedNodeBorderWidthPx}px; --node-spotlight-color: {spotlightColor ??
		'transparent'};"
>
	<NodeChrome
		diameterPx={NODE_RADIUS * 2}
		{borderRadiusPx}
		borderWidthPx={nodeBorderWidthPx}
		pinnedBorderWidthPx={pinnedNodeBorderWidthPx}
		pinned={nodeData.pinned ?? false}
		hasTagBorder={borderSegments.length > 0}
		tagBorderBackground={borderBackground}
		{detailsMode}
		detailsPreview={previewDetailsShape}
		{previewWidthPx}
		{previewHeightPx}
		spotlight={!!spotlightColor}
		spotlightColor={spotlightColor ?? 'transparent'}
		surfaceBackground={detailsMode ? '#ffffff' : undefined}
	>
		{#if showCompactLayer}
			<NodeCompactContent
				title={nodeData.title}
				{isTitleEditing}
				diameterPx={NODE_RADIUS * 2}
				fontSizePx={NODE_TEXT_FONT_SIZE}
				opacity={compactOpacity}
				{detailsMode}
				{onTitleCommit}
			/>
		{/if}
		{#if showDetailsLayer}
			<NodeDetailsLayer
				title={nodeData.title}
				{detailsTitleId}
				{detailsMode}
				opacity={detailsOpacity}
				{children}
			/>
		{/if}
	</NodeChrome>
</div>

<style>
	.node[data-details-mode='true'] {
		width: var(--node-details-width, min(calc(100vw - 2rem), 52rem));
		height: var(--node-details-height, min(calc(100vh - 2rem), 46rem));
	}
</style>
