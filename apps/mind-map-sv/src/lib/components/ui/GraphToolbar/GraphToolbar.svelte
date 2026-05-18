<script lang="ts">
	import type { GraphSummary } from '$lib/persistence';

	let {
		selectedGraphId,
		graphSummaries = [],
		notice = '',
		onGraphSelected,
		onNewGraph,
		onDeleteGraph
	}: {
		selectedGraphId: string;
		graphSummaries?: GraphSummary[];
		notice?: string;
		onGraphSelected?: (graphId: string) => void;
		onNewGraph?: () => void;
		onDeleteGraph?: () => void;
	} = $props();

	function handleGraphSelection(event: Event): void {
		const target = event.currentTarget as HTMLSelectElement;
		onGraphSelected?.(target.value);
	}
</script>

<div class="graph-toolbar" aria-label="Graph persistence controls">
	<label>
		Graph
		<select aria-label="Load graph" value={selectedGraphId} onchange={handleGraphSelection}>
			{#if graphSummaries.length === 0}
				<option value={selectedGraphId}>{selectedGraphId}</option>
			{/if}
			{#each graphSummaries as summary (summary.id)}
				<option value={summary.id}>{summary.id}</option>
			{/each}
		</select>
	</label>
	<button type="button" onclick={() => onNewGraph?.()}>New graph</button>
	<button type="button" onclick={() => onDeleteGraph?.()}>Delete graph</button>
	<p role="status">{notice}</p>
</div>

<style>
	.graph-toolbar {
		position: fixed;
		z-index: 40;
		top: 0.75rem;
		left: 50%;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		max-width: calc(100vw - 1.5rem);
		padding: 0.5rem;
		border: 1px solid #cbd5e1;
		border-radius: 999px;
		background: rgb(255 255 255 / 92%);
		box-shadow: 0 8px 24px rgb(15 23 42 / 12%);
		transform: translateX(-50%);
	}

	.graph-toolbar label {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.875rem;
		font-weight: 600;
	}

	.graph-toolbar select,
	.graph-toolbar button {
		border: 0;
		border-radius: 999px;
		padding: 0.375rem 0.625rem;
		background: #e2e8f0;
		color: #0f172a;
		font: inherit;
	}

	.graph-toolbar p {
		margin: 0;
		color: #475569;
		font-size: 0.8125rem;
		white-space: nowrap;
	}

	@media (max-width: 640px) {
		.graph-toolbar {
			right: 0.75rem;
			left: 0.75rem;
			flex-wrap: wrap;
			justify-content: center;
			border-radius: 1rem;
			transform: none;
		}
	}
</style>
