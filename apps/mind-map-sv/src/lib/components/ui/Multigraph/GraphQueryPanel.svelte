<script lang="ts">
	import { APP_CONFIG } from '$lib/appConfig';
	import type { LegendTag } from './lib/tagColors';
	import type { GraphQueryResult, GraphQueryTokenMode } from './lib/graphQuery';
	import { cycleTagToken, tagTokenMode, tagTokenText } from './lib/queryTokenCycle';

	let {
		query = '',
		tags = [],
		result,
		activeRegionIndex = 0,
		onQueryChange,
		onPreviewQueryChange,
		onRegionNavigate,
		onClose
	}: {
		query: string;
		tags: LegendTag[];
		result: GraphQueryResult;
		activeRegionIndex?: number;
		onQueryChange?: (query: string) => void;
		onPreviewQueryChange?: (query: string | null) => void;
		onRegionNavigate?: (direction: 'previous' | 'next') => void;
		onClose?: () => void;
	} = $props();

	const tagSyntax = APP_CONFIG.multigraph.tagSyntax;
	const nodeTagMarker = tagSyntax.nodeTagMarker;
	const edgeTagMarker = tagSyntax.edgeTagMarker;
	const addonMarker = tagSyntax.addonMarker;
	const nodeTags = $derived(tags.filter((tag) => tag.namespace === 'nodeTags'));
	const edgeTags = $derived(tags.filter((tag) => tag.namespace === 'edgeTags'));

	function updateQuery(nextQuery: string) {
		onQueryChange?.(nextQuery);
	}

	type TagTarget = 'nodeTag' | 'edgeTag';

	/**
	 * Spoken after the tag's name. "Focused" is avoided on purpose: screen
	 * readers already announce keyboard focus with that word.
	 */
	const TAG_STATE_NAME: Record<GraphQueryTokenMode | 'none', string> = {
		none: 'not in query',
		focus: 'in focus',
		spotlight: 'spotlighted',
		exclude: 'excluded'
	};

	function cycleTag(target: TagTarget, tag: string) {
		updateQuery(cycleTagToken(query, target, tag, tagSyntax));
	}

	/**
	 * Show a whole query on the canvas in place of the typed one, or stop with
	 * null. It replaces rather than appends, so a preview can remove a token.
	 */
	function previewQuery(previewed: string | null) {
		onPreviewQueryChange?.(previewed);
	}

	/**
	 * Hover and keyboard focus show exactly what a click would do: the whole
	 * query `cycleTag` would commit. A tag not in the query previews its
	 * spotlight, a spotlighted tag previews its exclusion — so the excluded
	 * nodes leave the layout while hovered — and an excluded tag previews the
	 * query without it, bringing them back. Clicking commits the previewed
	 * query, so the canvas does not move again on the click itself.
	 */
	function previewTag(target: TagTarget, tag: string) {
		previewQuery(cycleTagToken(query, target, tag, tagSyntax));
	}
</script>

{#snippet tagButton(target: TagTarget, tag: LegendTag)}
	{@const mode = tagTokenMode(query, target, tag.tag, tagSyntax)}
	<!-- The label is the token as it would be typed. At rest it is the bare
	     `#tag`, which a hand-typed focus token also reads as; aria-pressed,
	     data-mode and the pressed styling tell the two apart. -->
	<button
		type="button"
		aria-pressed={mode !== null}
		data-mode={mode ?? 'none'}
		aria-label={`${target === 'nodeTag' ? 'Node' : 'Edge'} tag ${tag.tag}, ${TAG_STATE_NAME[mode ?? 'none']}`}
		onclick={() => cycleTag(target, tag.tag)}
		onmouseenter={() => previewTag(target, tag.tag)}
		onmouseleave={() => previewQuery(null)}
		onfocus={() => previewTag(target, tag.tag)}
		onblur={() => previewQuery(null)}
	>
		<span class="swatch" style={`--tag-color: ${tag.color}`}></span>
		<span class="tag-label">{tagTokenText(mode ?? 'focus', target, tag.tag, tagSyntax)}</span>
	</button>
{/snippet}

<section class="graph-query-panel" aria-label="Find and filter graph">
	<header>
		<h2>Find / Filter</h2>
		<button type="button" class="quiet" onclick={onClose}>Close</button>
	</header>

	<label>
		<span class="sr-only">Graph query</span>
		<input
			value={query}
			placeholder={`${nodeTagMarker}tag ${edgeTagMarker}edge ${addonMarker}task "quoted phrase" +${nodeTagMarker}spotlight -${edgeTagMarker}hide`}
			oninput={(event) => updateQuery(event.currentTarget.value)}
		/>
	</label>

	<!-- No parsed-token chips here: they appeared and vanished as a tag button
	     cycled to and from "not in query", jumping the layout. The input shows
	     the text and each tag button shows its own state. -->
	<div class="counts" aria-label="Query result counts">
		<span>{result.focusedNodeIds.length} nodes</span>
		<span>{result.focusedEdgeIds.length} edges</span>
		<span>{result.regions.length} regions</span>
	</div>

	<div class="region-controls">
		<button
			type="button"
			disabled={result.regions.length === 0}
			onclick={() => onRegionNavigate?.('previous')}
		>
			Previous
		</button>
		<span>
			{result.regions.length === 0 ? 0 : activeRegionIndex + 1}/{result.regions.length}
		</span>
		<button
			type="button"
			disabled={result.regions.length === 0}
			onclick={() => onRegionNavigate?.('next')}
		>
			Next
		</button>
	</div>

	<div class="tag-groups">
		<section aria-label="Node tag suggestions">
			<h3>Node tags</h3>
			{#if nodeTags.length === 0}
				<p>No node tags yet.</p>
			{:else}
				<div class="tag-list">
					{#each nodeTags as tag (`node:${tag.tag}`)}
						{@render tagButton('nodeTag', tag)}
					{/each}
				</div>
			{/if}
		</section>

		<section aria-label="Edge tag suggestions">
			<h3>Edge tags</h3>
			{#if edgeTags.length === 0}
				<p>No edge tags yet.</p>
			{:else}
				<div class="tag-list">
					{#each edgeTags as tag (`edge:${tag.tag}`)}
						{@render tagButton('edgeTag', tag)}
					{/each}
				</div>
			{/if}
		</section>
	</div>
</section>

<style>
	.graph-query-panel {
		position: absolute;
		/* Above the persistence toolbar (z-index 40): at narrower viewports the
		   centred toolbar reaches over this panel's top-right corner and would
		   swallow clicks on the Close button. The reader summoned the panel and
		   can dismiss it, so while open it wins; the toolbar still floats above
		   the canvas, and the focus overlay (60) stays above both. */
		z-index: 45;
		left: 0.75rem;
		top: 0.75rem;
		display: grid;
		gap: 0.75rem;
		box-sizing: border-box;
		width: min(30rem, calc(100vw - 1.5rem));
		max-height: calc(100vh - 1.5rem);
		overflow: auto;
		padding: 0.875rem;
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		background: rgb(255 255 255 / 96%);
		box-shadow: 0 14px 40px rgb(15 23 42 / 18%);
		pointer-events: auto;
	}

	header,
	.counts,
	.region-controls,
	.tag-list {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	header {
		justify-content: space-between;
	}

	h2,
	h3,
	p {
		margin: 0;
	}

	h2 {
		font-size: 1rem;
	}

	h3 {
		font-size: 0.85rem;
		color: #334155;
	}

	input {
		box-sizing: border-box;
		width: 100%;
		border: 1px solid #94a3b8;
		border-radius: 0.375rem;
		padding: 0.625rem 0.75rem;
		font: inherit;
	}

	.counts span {
		border-radius: 999px;
		padding: 0.25rem 0.5rem;
		background: #e2e8f0;
		color: #0f172a;
		font-size: 0.8rem;
	}

	.region-controls {
		justify-content: space-between;
	}

	.tag-groups {
		display: grid;
		gap: 0.75rem;
	}

	.tag-list {
		flex-wrap: wrap;
		margin-top: 0.375rem;
	}

	button {
		border: 0;
		border-radius: 999px;
		padding: 0.45rem 0.625rem;
		background: #0f172a;
		color: #ffffff;
		font: inherit;
		cursor: pointer;
	}

	button:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.quiet {
		background: #e2e8f0;
		color: #0f172a;
	}

	.tag-list button {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		background: #f8fafc;
		color: #0f172a;
		border: 1px solid #cbd5e1;
	}

	/* A tag in the query reads as pressed without relying on hue: the border
	   darkens and thickens (an inset ring, so the button does not grow) and the
	   label goes semibold. The fill tints by mode (slate, amber, rose), and the
	   label's own +/- prefix tells the pressed modes apart. */
	.tag-list button[aria-pressed='true'] {
		border-color: #0f172a;
		box-shadow: inset 0 0 0 1px #0f172a;
		font-weight: 600;
	}

	.tag-list button[data-mode='focus'] {
		background: #e2e8f0;
	}

	.tag-list button[data-mode='spotlight'] {
		background: #fef3c7;
	}

	.tag-list button[data-mode='exclude'] {
		background: #fee2e2;
	}

	.tag-list button[data-mode='exclude'] .tag-label {
		text-decoration: line-through;
	}

	.swatch {
		width: 0.875rem;
		height: 0.875rem;
		border-radius: 999px;
		background: var(--tag-color);
		box-shadow: 0 0 0 1px rgb(15 23 42 / 20%);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	@media (max-width: 640px) {
		.graph-query-panel {
			top: auto;
			right: 0;
			bottom: 0;
			left: 0;
			width: 100%;
			max-height: 70vh;
			border-right: 0;
			border-bottom: 0;
			border-left: 0;
			border-radius: 0.5rem 0.5rem 0 0;
		}
	}
</style>
