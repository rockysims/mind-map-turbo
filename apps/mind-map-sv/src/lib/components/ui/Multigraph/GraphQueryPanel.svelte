<script lang="ts">
	import { APP_CONFIG } from '$lib/appConfig';
	import type { LegendTag } from './lib/tagColors';
	import type { GraphQueryResult, GraphQueryToken } from './lib/graphQuery';
	import { parseGraphQuery } from './lib/graphQuery';

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
	const tokens = $derived(parseGraphQuery(query, tagSyntax));
	const nodeTags = $derived(tags.filter((tag) => tag.namespace === 'nodeTags'));
	const edgeTags = $derived(tags.filter((tag) => tag.namespace === 'edgeTags'));

	function updateQuery(nextQuery: string) {
		onQueryChange?.(nextQuery);
	}

	function appendToken(token: string) {
		updateQuery(`${query.trim()} ${token}`.trim());
	}

	function previewToken(token: string | null) {
		onPreviewQueryChange?.(token ? `${query.trim()} ${token}`.trim() : null);
	}

	function tokenLabel(token: GraphQueryToken): string {
		const prefix = token.mode === 'spotlight' ? '+' : token.mode === 'exclude' ? '-' : '';
		const marker =
			token.target === 'nodeTag' ? nodeTagMarker : token.target === 'edgeTag' ? edgeTagMarker : '';
		return `${prefix}${marker}${token.value}`;
	}
</script>

<section class="graph-query-panel" aria-label="Find and filter graph">
	<header>
		<h2>Find / Filter</h2>
		<button type="button" class="quiet" onclick={onClose}>Close</button>
	</header>

	<label>
		<span class="sr-only">Graph query</span>
		<input
			value={query}
			placeholder={`${nodeTagMarker}tag ${edgeTagMarker}edge "quoted phrase" +${nodeTagMarker}spotlight -${edgeTagMarker}hide`}
			oninput={(event) => updateQuery(event.currentTarget.value)}
		/>
	</label>

	{#if tokens.length > 0}
		<ul class="chips" aria-label="Parsed query tokens">
			{#each tokens as token, index (`${index}:${token.target}:${token.mode}:${token.value}`)}
				<li data-mode={token.mode} data-target={token.target}>{tokenLabel(token)}</li>
			{/each}
		</ul>
	{/if}

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
						<button
							type="button"
							onclick={() => appendToken(`${nodeTagMarker}${tag.tag}`)}
							onmouseenter={() => previewToken(`+${nodeTagMarker}${tag.tag}`)}
							onmouseleave={() => previewToken(null)}
							onfocus={() => previewToken(`+${nodeTagMarker}${tag.tag}`)}
							onblur={() => previewToken(null)}
						>
							<span class="swatch" style={`--tag-color: ${tag.color}`}></span>
							<span>{nodeTagMarker}{tag.tag}</span>
						</button>
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
						<button
							type="button"
							onclick={() => appendToken(`${edgeTagMarker}${tag.tag}`)}
							onmouseenter={() => previewToken(`+${edgeTagMarker}${tag.tag}`)}
							onmouseleave={() => previewToken(null)}
							onfocus={() => previewToken(`+${edgeTagMarker}${tag.tag}`)}
							onblur={() => previewToken(null)}
						>
							<span class="swatch" style={`--tag-color: ${tag.color}`}></span>
							<span>{edgeTagMarker}{tag.tag}</span>
						</button>
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
	.tag-list,
	.chips {
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

	.chips {
		flex-wrap: wrap;
		padding: 0;
		margin: 0;
		list-style: none;
	}

	.chips li,
	.counts span {
		border-radius: 999px;
		padding: 0.25rem 0.5rem;
		background: #e2e8f0;
		color: #0f172a;
		font-size: 0.8rem;
	}

	.chips li[data-mode='spotlight'] {
		background: #fef3c7;
	}

	.chips li[data-mode='exclude'] {
		background: #fee2e2;
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
