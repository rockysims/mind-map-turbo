<script lang="ts">
	import type { LegendTag, TagColorChangePhase } from './lib/tagColors';
	import {
		factorForSliderPosition,
		formatTagPhysicsFactor,
		sliderPositionForFactor
	} from './lib/tagPhysics';

	let {
		tags = [],
		onColorChange,
		onPhysicsChange,
		onDelete,
		onClose
	}: {
		tags: LegendTag[];
		/**
		 * Fires per scrub frame with `'scrub'`, then once with `'commit'` when the
		 * picker closes. Both carry a colour worth previewing; only the second says
		 * the gesture is over, which is what lets the history record one entry for
		 * a scrub instead of dozens — or one for every scrub ever made of this tag.
		 */
		onColorChange?: (
			namespace: LegendTag['namespace'],
			tag: string,
			color: string,
			phase: TagColorChangePhase
		) => void;
		/**
		 * The tag's edge length (edge tags) or node spacing (node tags) factor.
		 * Same phases as colour: `'scrub'` per slider frame, `'commit'` when the
		 * thumb is let go, so one drag is one undo entry while the graph follows
		 * the thumb live.
		 */
		onPhysicsChange?: (
			namespace: LegendTag['namespace'],
			tag: string,
			factor: number,
			phase: TagColorChangePhase
		) => void;
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

	/** What the slider scales, as the screen reader names it. */
	function physicsNameFor(legendTag: LegendTag): string {
		const quantity = legendTag.namespace === 'nodeTags' ? 'Node spacing' : 'Edge length';
		return `${quantity} for ${labelFor(legendTag.namespace)} ${legendTag.tag}`;
	}

	/**
	 * The visible readout. One word says what the factor scales — a bare `×1.4`
	 * beside a colour swatch would not — and it survives the stacked layout,
	 * where a column header would not.
	 */
	function physicsReadoutFor(legendTag: LegendTag): string {
		const quantity = legendTag.namespace === 'nodeTags' ? 'spacing' : 'length';
		return `${quantity} ${formatTagPhysicsFactor(legendTag.physicsFactor)}`;
	}

	function emitPhysicsChange(
		legendTag: LegendTag,
		slider: HTMLInputElement,
		phase: TagColorChangePhase
	) {
		onPhysicsChange?.(
			legendTag.namespace,
			legendTag.tag,
			factorForSliderPosition(Number(slider.value)),
			phase
		);
	}
</script>

<div class="legend-layer" role="presentation">
	<button class="legend-backdrop" type="button" aria-label="Close tags" onclick={onClose}></button>
	<div
		class="tag-color-legend"
		role="dialog"
		aria-modal="true"
		aria-labelledby="tag-color-legend-title"
	>
		<header>
			<h2 id="tag-color-legend-title">Tags</h2>
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

								<div class="physics-control">
									<label>
										<span class="sr-only">{physicsNameFor(legendTag)}</span>
										<!-- The track runs over log2(factor), so ×1 sits at the centre and
										     ×0.5 and ×2 sit equally far either side; `aria-valuetext`
										     announces the factor rather than the log position. -->
										<input
											type="range"
											min="-3"
											max="3"
											step="0.05"
											value={sliderPositionForFactor(legendTag.physicsFactor)}
											aria-valuetext={formatTagPhysicsFactor(legendTag.physicsFactor)}
											oninput={(event) =>
												emitPhysicsChange(legendTag, event.currentTarget, 'scrub')}
											onchange={(event) =>
												emitPhysicsChange(legendTag, event.currentTarget, 'commit')}
										/>
									</label>
									<!-- Hidden from the accessibility tree: the slider's own
									     `aria-valuetext` already says the factor, and a second copy
									     would be read out on every scrub frame. -->
									<span class="physics-readout" aria-hidden="true">
										{physicsReadoutFor(legendTag)}
									</span>
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
												event.currentTarget.value,
												'scrub'
											)}
										onchange={(event) =>
											onColorChange?.(
												legendTag.namespace,
												legendTag.tag,
												event.currentTarget.value,
												'commit'
											)}
									/>
								</label>

								<!-- Icon-only so the row's controls fit on one line beside the tag's
								     name. The name rides in `aria-label`; the title is the pointer's
								     hint, not a substitute for it. A drawn bin, like the toolbar's
								     gear, rather than an emoji each platform's font restyles. -->
								<button
									type="button"
									class="danger icon-button"
									aria-label={`Delete ${labelFor(legendTag.namespace)} ${legendTag.tag}`}
									title="Delete this tag from everything that uses it"
									onclick={() => onDelete?.(legendTag.namespace, legendTag.tag)}
								>
									<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
										<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 10.5v6M14 10.5v6" />
									</svg>
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
		/* A scroller gets back the one gesture it wants: `none` is right for the
		   backdrop above, and wrong here, where a long tag list put every row
		   below the fold out of a finger's reach. */
		touch-action: pan-y;
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

	ul {
		display: grid;
		gap: 0.5rem;
		padding: 0;
		margin: 0;
		list-style: none;
	}

	/* Wraps rather than squeezing the tag's name to nothing: between the stacked
	   layout and a full-width dialog, the controls drop to a second line and
	   keep to the right, under the controls of the rows that fit. */
	li {
		flex-wrap: wrap;
		justify-content: flex-end;
		padding: 0.625rem;
		border: 1px solid #e2e8f0;
		border-radius: 0.75rem;
	}

	.tag-copy {
		flex: 1 1 8rem;
		min-width: 0;
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

	/* A column, readout under the track: beside it, the readout pushed the
	   delete button onto a second line at the dialog's normal width. */
	.physics-control {
		display: flex;
		flex: 0 0 auto;
		flex-direction: column;
		align-items: stretch;
	}

	.physics-control label {
		display: flex;
		align-items: center;
	}

	/* The input's own box is the hit area, so its height is the touch target:
	   2.75rem (44px) at every width, though the drawn track stays thin. */
	input[type='range'] {
		width: 6.5rem;
		height: 2.75rem;
		margin: 0;
	}

	.physics-readout {
		/* Tucked up into the slack below the drawn track, inside the slider's
		   44px box, so the column is barely taller than the slider alone. It
		   takes no pointer, so the whole box still grabs the thumb. The column is
		   the slider's fixed width, so the text cannot shift the row as it moves. */
		margin-top: -0.625rem;
		pointer-events: none;
		text-align: center;
		color: #475569;
		font-size: 0.8125rem;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
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

	/* The glyph is small; the button around it is the 44px target. */
	.icon-button {
		display: inline-flex;
		flex: 0 0 auto;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		min-width: 2.75rem;
		min-height: 2.75rem;
		padding: 0;
	}

	.icon-button svg {
		display: block;
		width: 1.125rem;
		height: 1.125rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.9;
		stroke-linecap: round;
		stroke-linejoin: round;
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

		/* In a column, the wide-row `flex-basis: 8rem` would be a height, leaving
		   a tall blank band under the tag's name. */
		.tag-copy {
			flex: 0 0 auto;
		}

		/* Its own full-width line: a short track under a thumb is a coarse one. */
		.physics-control label {
			flex: 1 1 auto;
		}

		.physics-control input[type='range'] {
			width: 100%;
		}
	}
</style>
