<script lang="ts">
	import { APP_CONFIG } from '$lib/appConfig';
	import {
		backdropOpacityFor,
		clampDialogOpacity,
		formatDialogOpacity,
		readDialogOpacity,
		writeDialogOpacity
	} from './lib/dialogOpacity';
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
		onClose,
		reduceMotion = false
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
		/**
		 * Forces the reduced-motion path (no fade on a dipped slider), for the
		 * canvas's own reduced-motion flag; the media query covers the OS setting.
		 */
		reduceMotion?: boolean;
	} = $props();

	/**
	 * `localStorage`, or null where touching it throws (blocked site data) or
	 * there is no window. The opacity is a viewing preference, so a browser that
	 * refuses storage just gets the default every time.
	 */
	function browserStorage(): Storage | null {
		try {
			return typeof localStorage === 'undefined' ? null : localStorage;
		} catch {
			return null;
		}
	}

	const storageNamespace = APP_CONFIG.persistence.storageNamespace;

	/** The reader's chosen opacity for everything in the dialog but its own slider. */
	let dialogOpacity = $state(readDialogOpacity(browserStorage(), storageNamespace));
	const backdropOpacity = $derived(backdropOpacityFor(dialogOpacity));

	function previewDialogOpacity(slider: HTMLInputElement) {
		dialogOpacity = clampDialogOpacity(Number(slider.value));
	}

	/** Saved on release (and on each arrow press, which fires `change` too), not per frame. */
	function commitDialogOpacity(slider: HTMLInputElement) {
		previewDialogOpacity(slider);
		writeDialogOpacity(browserStorage(), storageNamespace, dialogOpacity);
	}

	/**
	 * The length/spacing slider under the pointer, and the one holding keyboard
	 * focus. Either dips that slider's own control to half opacity while it is
	 * being tuned; the dialog keeps the reader's chosen opacity.
	 */
	let hoveredSliderKey = $state<string | null>(null);
	let keyboardSliderKey = $state<string | null>(null);

	function sliderKeyFor(legendTag: LegendTag): string {
		return `${legendTag.namespace}:${legendTag.tag}`;
	}

	/**
	 * Keyboard focus only: a pointer press also focuses the range input, and
	 * would otherwise leave the control dipped after the pointer has gone.
	 * Chrome and Firefox do not match `:focus-visible` for a range input focused
	 * by a press, so it is the keyboard test.
	 */
	function noteSliderFocus(legendTag: LegendTag, slider: HTMLInputElement) {
		keyboardSliderKey = slider.matches(':focus-visible') ? sliderKeyFor(legendTag) : null;
	}

	function clearSliderKey(current: string | null, legendTag: LegendTag): string | null {
		return current === sliderKeyFor(legendTag) ? null : current;
	}

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

<div
	class="legend-layer"
	class:reduced-motion={reduceMotion}
	role="presentation"
	data-dialog-opacity={dialogOpacity}
	data-backdrop-opacity={backdropOpacity}
>
	<button
		class="legend-backdrop"
		type="button"
		aria-label="Close tags"
		style:opacity={backdropOpacity}
		onclick={onClose}
	></button>
	<!--
		The dialog is two siblings: the panel, which fades as one element with the
		chosen opacity, and the header controls, which sit over the panel's pinned
		header. CSS opacity on an ancestor cannot be undone by a descendant, so the
		opacity slider lives outside the faded panel rather than inside it, and Close
		beside it takes the same opacity as the panel on its own. Both still take
		every pointer event at any opacity: this stays a modal dialog.
	-->
	<div
		class="legend-dialog"
		role="dialog"
		aria-modal="true"
		aria-labelledby="tag-color-legend-title"
	>
		<div class="legend-controls">
			<div class="opacity-control">
				<label>
					<span class="sr-only">Dialog opacity</span>
					<input
						type="range"
						min="0"
						max="1"
						step="0.05"
						value={dialogOpacity}
						aria-valuetext={formatDialogOpacity(dialogOpacity)}
						data-dialog-opacity-slider
						oninput={(event) => previewDialogOpacity(event.currentTarget)}
						onchange={(event) => commitDialogOpacity(event.currentTarget)}
					/>
				</label>
				<span class="opacity-readout" aria-hidden="true">
					opacity {formatDialogOpacity(dialogOpacity)}
				</span>
			</div>
			<button
				type="button"
				class="secondary close-button"
				style:opacity={dialogOpacity}
				onclick={onClose}>Close</button
			>
		</div>

		<div class="tag-color-legend" style:opacity={dialogOpacity}>
			<!-- Pinned while the list scrolls; its right side is the room the
			     controls above occupy, so the title never runs under them. -->
			<header>
				<h2 id="tag-color-legend-title">Tags</h2>
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

									<div
										class="physics-control"
										data-dipped={hoveredSliderKey === sliderKeyFor(legendTag) ||
											keyboardSliderKey === sliderKeyFor(legendTag)}
									>
										<label>
											<span class="sr-only">{physicsNameFor(legendTag)}</span>
											<!-- The track runs over log2(factor) from ×1 at the left end to ×8
										     at the right, so every doubling is the same distance along it;
										     `aria-valuetext` announces the factor rather than the log
										     position. -->
											<input
												type="range"
												min="0"
												max="3"
												step="0.05"
												value={sliderPositionForFactor(legendTag.physicsFactor)}
												aria-valuetext={formatTagPhysicsFactor(legendTag.physicsFactor)}
												onpointerenter={() => (hoveredSliderKey = sliderKeyFor(legendTag))}
												onpointerleave={() =>
													(hoveredSliderKey = clearSliderKey(hoveredSliderKey, legendTag))}
												onfocus={(event) => noteSliderFocus(legendTag, event.currentTarget)}
												onkeydown={() => (keyboardSliderKey = sliderKeyFor(legendTag))}
												onblur={() =>
													(keyboardSliderKey = clearSliderKey(keyboardSliderKey, legendTag))}
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
</div>

<style>
	/*
	 * The top padding is the toolbar's measured clearance (published by
	 * GraphToolbar as `--graph-toolbar-clearance`), so the dialog can never grow
	 * under the toolbar that sits above it in z-order; it scrolls inside instead.
	 * The fallback is the old 1rem margin, for a canvas shown without a toolbar.
	 */
	.legend-layer {
		position: absolute;
		inset: 0;
		z-index: 35;
		box-sizing: border-box;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		padding-top: var(--graph-toolbar-clearance, 1rem);
		pointer-events: auto;
	}

	.legend-backdrop {
		position: absolute;
		inset: 0;
		border: 0;
		background: rgb(15 23 42 / 24%);
		touch-action: none;
	}

	/* Sized here, not on the panel, so the controls can sit over the panel's
	   pinned header without being inside the element that fades. */
	.legend-dialog {
		position: relative;
		z-index: 1;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		width: min(100%, 34rem);
		max-height: 100%;
	}

	.tag-color-legend {
		box-sizing: border-box;
		flex: 0 1 auto;
		min-height: 0;
		overflow: auto;
		border-radius: 1rem 1rem 0 0;
		/* No top padding: the pinned header carries its own, so nothing scrolls
		   into a gap above it. */
		padding: 0 1rem 1rem;
		background: #ffffff;
		box-shadow: 0 -12px 40px rgb(0 0 0 / 22%);
		/* A scroller gets back the one gesture it wants: `none` is right for the
		   backdrop above, and wrong here, where a long tag list put every row
		   below the fold out of a finger's reach. */
		touch-action: pan-y;
	}

	header,
	li,
	.tag-copy,
	.legend-controls {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	/*
	 * Pinned to the top of the scrolling panel, full-bleed over the panel's side
	 * padding so rows scroll under it rather than beside it. Its right padding is
	 * the width the header controls take, so the title never runs under them.
	 */
	header {
		position: sticky;
		top: 0;
		z-index: 1;
		box-sizing: border-box;
		min-height: 4.25rem;
		margin: 0 -1rem 0.25rem;
		padding: 0.5rem calc(1rem + var(--legend-controls-width)) 0.5rem 1rem;
		background: #ffffff;
	}

	/*
	 * Over the panel's pinned header, outside the faded panel: the slider keeps
	 * full opacity at every setting, so a dialog faded to nothing still shows the
	 * way back. Its own white chip keeps the track legible over any graph.
	 */
	.legend-controls {
		position: absolute;
		z-index: 2;
		top: 0.5rem;
		right: 1rem;
		gap: 0.5rem;
		min-height: 3.25rem;
	}

	/* The opacity chip (7.5rem), the gap and Close (4.5rem), with slack for a
	   desktop scrollbar narrowing the header under them. */
	.legend-dialog {
		--legend-controls-width: 13rem;
	}

	.opacity-control {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		padding: 0 0.5rem;
		border-radius: 0.75rem;
		background: #ffffff;
	}

	.opacity-control label {
		display: flex;
		align-items: center;
	}

	.opacity-readout {
		margin-top: -0.625rem;
		pointer-events: none;
		text-align: center;
		color: #475569;
		font-size: 0.8125rem;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	/* A fixed width, so the room the header reserves for it is exact. */
	.close-button {
		box-sizing: border-box;
		width: 4.5rem;
		min-height: 2.75rem;
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
	/*
	 * The slider being tuned dips to half opacity while it is hovered or holds
	 * keyboard focus, so the graph shows through the control the reader is
	 * working; the rest of the dialog keeps the chosen opacity.
	 */
	.physics-control {
		display: flex;
		flex: 0 0 auto;
		flex-direction: column;
		align-items: stretch;
		transition: opacity 200ms ease;
	}

	.physics-control[data-dipped='true'] {
		opacity: 0.5;
	}

	.legend-layer.reduced-motion .physics-control {
		transition: none;
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

	@media (prefers-reduced-motion: reduce) {
		.physics-control {
			transition: none;
		}
	}

	@media (min-width: 640px) {
		.legend-layer {
			align-items: center;
			padding-bottom: 1rem;
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
