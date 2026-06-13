<script lang="ts">
	import type { LegendTag } from './lib/tagColors';

	let {
		tags = [],
		onColorChange,
		onDelete,
		onClose
	}: {
		tags: LegendTag[];
		onColorChange?: (namespace: LegendTag['namespace'], tag: string, color: string) => void;
		onDelete?: (namespace: LegendTag['namespace'], tag: string) => void;
		onClose?: () => void;
	} = $props();

	const nodeTags = $derived(tags.filter((tag) => tag.namespace === 'nodeTags'));
	const edgeTags = $derived(tags.filter((tag) => tag.namespace === 'edgeTags'));
	const groups = $derived([
		{ title: 'Node tags', tags: nodeTags },
		{ title: 'Edge tags', tags: edgeTags }
	]);

	function labelFor(namespace: LegendTag['namespace']): string {
		return namespace === 'nodeTags' ? 'node tag' : 'edge tag';
	}
</script>

<div class="legend-layer" role="presentation">
	<button
		class="legend-backdrop"
		type="button"
		aria-label="Close tag color legend"
		onclick={onClose}
	></button>
	<div
		class="tag-color-legend"
		role="dialog"
		aria-modal="true"
		aria-labelledby="tag-color-legend-title"
	>
		<header>
			<div>
				<p class="eyebrow">Graph tags</p>
				<h2 id="tag-color-legend-title">Tag colors</h2>
			</div>
			<button type="button" class="secondary" onclick={onClose}>Close</button>
		</header>

		{#each groups as group (group.title)}
			<section class="tag-group" aria-label={group.title}>
				<h3>{group.title}</h3>
				{#if group.tags.length === 0}
					<p class="empty-state">No {group.title.toLowerCase()} yet.</p>
				{:else}
					<ul>
						{#each group.tags as legendTag (`${legendTag.namespace}:${legendTag.tag}`)}
							<li>
								<div class="tag-copy">
									<span class="swatch" style={`--swatch-color: ${legendTag.color}`}></span>
									<div>
										<p class="tag-name">{legendTag.tag}</p>
										<p class="tag-meta">
											{legendTag.usageCount}
											{legendTag.usageCount === 1 ? 'use' : 'uses'}
											{legendTag.hasExplicitColor ? ' · configured' : ' · fallback'}
										</p>
									</div>
								</div>

								<label>
									<span class="sr-only">
										Color for {labelFor(legendTag.namespace)}
										{legendTag.tag}
									</span>
									<input
										type="color"
										value={legendTag.color}
										oninput={(event) =>
											onColorChange?.(
												legendTag.namespace,
												legendTag.tag,
												event.currentTarget.value
											)}
									/>
								</label>

								<button
									type="button"
									class="danger"
									aria-label={`Delete ${labelFor(legendTag.namespace)} ${legendTag.tag}`}
									onclick={() => onDelete?.(legendTag.namespace, legendTag.tag)}
								>
									Delete
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/each}
	</div>
</div>

<style>
	.legend-layer {
		position: absolute;
		inset: 0;
		z-index: 35;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		pointer-events: auto;
	}

	.legend-backdrop {
		position: absolute;
		inset: 0;
		border: 0;
		background: rgb(15 23 42 / 24%);
		touch-action: none;
	}

	.tag-color-legend {
		position: relative;
		z-index: 1;
		box-sizing: border-box;
		width: min(100%, 34rem);
		max-height: calc(100% - 2rem);
		overflow: auto;
		border-radius: 1rem 1rem 0 0;
		padding: 1rem;
		background: #ffffff;
		box-shadow: 0 -12px 40px rgb(0 0 0 / 22%);
		touch-action: none;
	}

	header,
	li,
	.tag-copy {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	header {
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	h2,
	h3,
	p {
		margin: 0;
	}

	h3 {
		margin: 1rem 0 0.5rem;
		color: #0f172a;
		font-size: 0.95rem;
	}

	.eyebrow {
		color: #64748b;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	ul {
		display: grid;
		gap: 0.5rem;
		padding: 0;
		margin: 0;
		list-style: none;
	}

	li {
		justify-content: space-between;
		padding: 0.625rem;
		border: 1px solid #e2e8f0;
		border-radius: 0.75rem;
	}

	.tag-copy {
		min-width: 0;
		margin-right: auto;
	}

	.swatch {
		width: 1.5rem;
		height: 1.5rem;
		flex: 0 0 auto;
		border: 1px solid #cbd5e1;
		border-radius: 999px;
		background: var(--swatch-color);
	}

	.tag-name {
		font-weight: 700;
		color: #0f172a;
	}

	.tag-meta,
	.empty-state {
		color: #64748b;
		font-size: 0.8125rem;
	}

	input[type='color'] {
		width: 2.5rem;
		height: 2.25rem;
		padding: 0;
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		background: #ffffff;
	}

	button {
		border: 0;
		border-radius: 999px;
		padding: 0.5rem 0.75rem;
		font: inherit;
	}

	.secondary {
		background: #e2e8f0;
		color: #0f172a;
	}

	.danger {
		background: #fee2e2;
		color: #991b1b;
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

	@media (min-width: 640px) {
		.legend-layer {
			align-items: center;
		}

		.tag-color-legend {
			border-radius: 1rem;
			box-shadow: 0 20px 60px rgb(0 0 0 / 24%);
		}
	}

	@media (max-width: 420px) {
		li {
			align-items: stretch;
			flex-direction: column;
		}
	}
</style>
