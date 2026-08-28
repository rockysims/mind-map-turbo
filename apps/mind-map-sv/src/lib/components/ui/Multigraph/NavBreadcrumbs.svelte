<script lang="ts">
	/**
	 * The jump trail, as the reader's own path back out.
	 *
	 * A nav stack three deep is real navigation history, and offering only "back
	 * one" made retracing it three round trips through three cameras. Rendering it
	 * as a trail turns "get me back to where this started" into one click, and
	 * turns the depth itself into something visible — a reader four jumps in
	 * otherwise has no way to tell how far they have come.
	 *
	 * Presentational on purpose: it reports the index a crumb stands for and knows
	 * nothing about unwinding. The trail is a projection of the stack (see
	 * `navBreadcrumbs`), so a crumb's `index` is its place in the stack, never in
	 * this rendered array.
	 */
	import type { NavCrumb } from './lib/navStack';

	let {
		crumbs,
		titleForNodeId,
		onNavigate
	}: {
		crumbs: readonly NavCrumb[];
		titleForNodeId: (nodeId: string) => string;
		/** Unwind to this entry's index in the nav stack. */
		onNavigate: (index: number) => void;
	} = $props();
</script>

<nav class="nav-breadcrumbs" aria-label="Jump history" data-nav-breadcrumbs>
	<ol>
		{#each crumbs as crumb, position (crumb.kind === 'entry' ? `entry:${crumb.index}` : `${crumb.kind}:${position}`)}
			<li>
				{#if position > 0}
					<!-- Decorative: the list already carries the ordering for a reader who
					     is not looking at it. -->
					<span class="separator" aria-hidden="true">›</span>
				{/if}
				{#if crumb.kind === 'entry'}
					<button
						type="button"
						class="crumb"
						data-nav-crumb={crumb.index}
						data-nav-crumb-node={crumb.nodeId}
						title={`Back to ${titleForNodeId(crumb.nodeId)}`}
						onclick={() => onNavigate(crumb.index)}
					>
						{titleForNodeId(crumb.nodeId)}
					</button>
				{:else if crumb.kind === 'ellipsis'}
					<span
						class="crumb elided"
						data-nav-crumb-elided={crumb.hiddenCount}
						title={`${crumb.hiddenCount} more`}>…</span
					>
				{:else}
					<!-- Where the reader already is, so there is nothing to navigate to. -->
					<span class="crumb current" data-nav-crumb-current={crumb.nodeId} aria-current="page"
						>{titleForNodeId(crumb.nodeId)}</span
					>
				{/if}
			</li>
		{/each}
	</ol>
</nav>

<style>
	.nav-breadcrumbs {
		font-size: 0.875rem;
	}

	ol {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.15rem 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
	}

	.separator {
		color: #94a3b8;
	}

	/* Node titles are the author's, so their length is not ours to predict: one
	   long title must not push the crumb the reader wants off the edge. */
	.crumb {
		display: block;
		max-width: 8rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		border: 0;
		border-radius: 0.35rem;
		padding: 0.15rem 0.4rem;
		background: rgb(255 255 255 / 88%);
		color: #334155;
		font: inherit;
		box-shadow: 0 4px 12px rgb(15 23 42 / 12%);
	}

	button.crumb {
		cursor: pointer;
	}

	.crumb.current {
		background: #0f172a;
		color: #ffffff;
	}

	.crumb.elided {
		color: #64748b;
	}
</style>
