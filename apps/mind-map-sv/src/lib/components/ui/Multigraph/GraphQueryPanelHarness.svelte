<script lang="ts">
	/**
	 * Holds the query so a panel story can click a tag button more than once.
	 *
	 * The panel is controlled: it reports a new query or preview and expects the
	 * caller to feed it back. `Multigraph.svelte` is that caller in the app; this
	 * harness is the same loop without the canvas — the query and the preview in
	 * `$state`, the legend from `collectLegendTags`, and the result from
	 * `evaluateGraphQuery` over the preview while there is one, as the canvas
	 * does. A committed change clears the preview, also as the canvas does.
	 *
	 * What the story asserts on comes back as `data-*` attributes on the
	 * wrapper: `data-query` is the committed query and `data-preview` the hover
	 * or keyboard-focus preview (empty when there is none).
	 */
	import { untrack } from 'svelte';
	import GraphQueryPanel from './GraphQueryPanel.svelte';
	import type { MultigraphData } from '../types/multigraph';
	import { evaluateGraphQuery } from './lib/graphQuery';
	import { collectLegendTags } from './lib/tagColors';

	let { graph, initialQuery = '' }: { graph: MultigraphData; initialQuery?: string } = $props();

	// Seeded once and owned from then on: the story states a starting query, and
	// every later value is one the panel reported. `untrack` says the initial
	// read is deliberate rather than a missed dependency.
	let query = $state(untrack(() => initialQuery));
	let preview = $state<string | null>(null);

	const tags = $derived(collectLegendTags(graph));
	const result = $derived(evaluateGraphQuery(graph, preview ?? query));
</script>

<div data-graph-query-panel-harness data-query={query} data-preview={preview ?? ''}>
	<GraphQueryPanel
		{query}
		{tags}
		{result}
		onQueryChange={(next) => {
			query = next;
			preview = null;
		}}
		onPreviewQueryChange={(next) => (preview = next)}
	/>
</div>
