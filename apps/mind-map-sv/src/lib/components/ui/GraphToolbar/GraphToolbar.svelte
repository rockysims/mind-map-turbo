<script lang="ts">
	import { resetFileInput } from '$lib/browserGraphFile';
	import { noticeLines } from './lib/noticeLines';

	let {
		notice = '',
		severity = 'info',
		canUndo = false,
		canRedo = false,
		undoLabel = null,
		redoLabel = null,
		undoBlockedReason = 'Nothing to undo. Opened files start fresh.',
		redoBlockedReason = 'Nothing to redo.',
		aiConnected = false,
		onOpenAiSettings,
		settingsOpen = false,
		onNewGraph,
		onOpenGraphFilePicker,
		onImportGraphFile,
		onSave,
		onUndo,
		onRedo,
		onBlockedAction,
		onOpenSettings
	}: {
		notice?: string;
		/** 'warning' announces assertively and wraps: the work is at risk. */
		severity?: 'info' | 'warning';
		canUndo?: boolean;
		canRedo?: boolean;
		/** What undo/redo would do, spoken as part of the button's name. */
		undoLabel?: string | null;
		redoLabel?: string | null;
		/** Why the control is standing down, spoken and — on a tap — written to the notice. */
		undoBlockedReason?: string;
		redoBlockedReason?: string;
		/** Whether an Anthropic API key is in hand, so the control can say so. */
		aiConnected?: boolean;
		onOpenAiSettings?: () => void;
		/** Drives `aria-expanded` on the Settings button; the panel lives elsewhere. */
		settingsOpen?: boolean;
		onNewGraph?: () => void;
		onOpenGraphFilePicker?: () => void;
		/** Given the chosen file, to fold into the graph already on screen. */
		onImportGraphFile?: (file: File) => void;
		onSave?: () => void;
		onUndo?: () => void;
		onRedo?: () => void;
		/** A tap on a control with nothing to do, carrying the reason to say so. */
		onBlockedAction?: (reason: string) => void;
		onOpenSettings?: () => void;
	} = $props();

	let importInput = $state<HTMLInputElement | null>(null);

	const lines = $derived(noticeLines(notice));

	/**
	 * Import picks its file in this page, not in the picker tab Open uses: that
	 * tab hands the file over by reloading the app, which would remount the canvas
	 * and cost the reader the pan, zoom and focus an additive import is meant to
	 * leave alone.
	 */
	function chooseImportFile(): void {
		importInput?.click();
	}

	function handleImportFileChange(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0] ?? null;
		// Reset first, so choosing the same file twice fires `change` both times.
		resetFileInput(input);
		if (file !== null) onImportGraphFile?.(file);
	}

	/**
	 * Stacked lines are separate elements, so this trailing space is what keeps
	 * the notice reading as one message ('browser. Save') rather than running the
	 * sentences together ('browser.Save'). It collapses away inside a block line.
	 */
	function spoken(line: string): string {
		return `${line} `;
	}

	/**
	 * A disabled control that explains itself when tapped.
	 *
	 * `aria-disabled` rather than `disabled`, so the button still takes the tap
	 * and can answer it. `title` would be the obvious place for the reason, but it
	 * is hover-only and this app is mobile-first
	 * (`docs/debt/2026-08-30-tooltips-are-hover-only.md`) — the notice column is
	 * the one channel that reaches a thumb.
	 */
	function step(available: boolean, reason: string, run: (() => void) | undefined): void {
		if (!available) {
			onBlockedAction?.(reason);
			return;
		}
		run?.();
	}
</script>

<!--
	Two pills, centred as one unit. Settings is a separate pill because it acts on
	the view rather than on the document the other three share, and the row is what
	keeps the pair adjacent: each pill keeps its own chrome, and neither can drift
	from the other as the toolbar's contents change.
-->
<div class="toolbar-row">
	<div class="graph-toolbar" aria-label="Graph persistence controls">
		<button type="button" title="Start a blank graph in a new tab" onclick={() => onNewGraph?.()}
			>New</button
		>
		<button
			type="button"
			title="Open a saved graph file in a new tab"
			onclick={() => onOpenGraphFilePicker?.()}>Open</button
		>
		<button
			type="button"
			title="Add a saved graph file to this graph, keeping both"
			onclick={chooseImportFile}>Import…</button
		>
		<input
			bind:this={importInput}
			class="import-input"
			type="file"
			accept=".html,.json,text/html,application/json"
			aria-label="Graph file to import"
			onchange={handleImportFileChange}
		/>
		<button
			type="button"
			title="Download this graph as a file you can reopen later"
			onclick={() => onSave?.()}>Save</button
		>
		<!--
			Icon-only in an otherwise text toolbar: two more *text* buttons wrap the
			phone toolbar to a third row (the four above already fill a 375px width),
			and ↶/↷ are as close to self-explanatory as icons get. The operation rides
			in the accessible name instead.
		-->
		<!--
			One flex item, not three: at a 375px width the row runs out after Save, and
			letting the icons wrap independently drops one onto a line of its own, which
			reads as a mistake rather than as a control.
		-->
		<div class="icon-controls">
			<button
				type="button"
				class="icon"
				aria-disabled={!canUndo}
				aria-label={canUndo && undoLabel ? `Undo ${undoLabel}` : 'Undo'}
				aria-describedby={canUndo ? undefined : 'graph-toolbar-undo-reason'}
				onclick={() => step(canUndo, undoBlockedReason, onUndo)}>↶</button
			>
			<button
				type="button"
				class="icon"
				aria-disabled={!canRedo}
				aria-label={canRedo && redoLabel ? `Redo ${redoLabel}` : 'Redo'}
				aria-describedby={canRedo ? undefined : 'graph-toolbar-redo-reason'}
				onclick={() => step(canRedo, redoBlockedReason, onRedo)}>↷</button
			>
			{#if !canUndo}
				<span id="graph-toolbar-undo-reason" class="sr-only">{undoBlockedReason}</span>
			{/if}
			{#if !canRedo}
				<span id="graph-toolbar-redo-reason" class="sr-only">{redoBlockedReason}</span>
			{/if}
			<!--
				Connected state rides in the accessible name, not in the fill alone: the
				colour is the glance, the name is the answer for anyone who cannot see it.
				The dot is the glance made legible — a filled glyph and an unfilled one
				are the same shape, and a reader who has just pressed Connect wants a
				difference they can name. `aria-hidden`, because the name already says it.
			-->
			<button
				type="button"
				class="icon ai"
				class:connected={aiConnected}
				title="Anthropic API key, model and data settings"
				aria-label={aiConnected ? 'AI settings, connected' : 'AI settings, not connected'}
				data-ai-connected={aiConnected}
				onclick={() => onOpenAiSettings?.()}
				>✦<span class="ai-dot" data-ai-connected-dot={aiConnected} aria-hidden="true"
				></span></button
			>
		</div>
		{#if severity === 'warning'}
			<p class="notice warning" role="alert" aria-live="assertive">
				{#each lines as line, index (index)}<span class="notice-line">{spoken(line)}</span>{/each}
			</p>
		{:else}
			<p class="notice" role="status">
				{#each lines as line, index (index)}<span class="notice-line">{spoken(line)}</span>{/each}
			</p>
		{/if}
	</div>

	<div class="settings-toolbar" aria-label="Graph settings controls">
		<!--
			A gear rather than the word: this pill sits beside three verbs that each
			act on the document, and an icon is what keeps it from reading as a
			fourth. `aria-label` carries the name the buttons beside it wear openly,
			so nothing is lost to anyone reading by name rather than by shape.
		-->
		<button
			type="button"
			class="icon-button"
			title="Adjust how this graph looks and behaves"
			aria-label="Settings"
			aria-haspopup="dialog"
			aria-expanded={settingsOpen}
			onclick={() => onOpenSettings?.()}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
				<!-- Eight teeth on a ring: a gear reads as one at this size from the
				     silhouette, so it is drawn from that rather than an outline. -->
				<circle cx="12" cy="12" r="5.5" />
				<circle cx="12" cy="12" r="2.1" />
				<path
					class="teeth"
					d="M17.5 12h2.7M15.889 15.889l1.909 1.909M12 17.5v2.7M8.111 15.889 6.202 17.798M6.5 12H3.8M8.111 8.111 6.202 6.202M12 6.5V3.8M15.889 8.111 17.798 6.202"
				/>
			</svg>
		</button>
	</div>
</div>

<style>
	/* The row owns the placement; the pills inside it own their own chrome. */
	.toolbar-row {
		position: fixed;
		z-index: 40;
		top: 0.75rem;
		left: 50%;
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		max-width: calc(100vw - 1.5rem);
		transform: translateX(-50%);
	}

	.graph-toolbar,
	.settings-toolbar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		border: 1px solid #cbd5e1;
		border-radius: 999px;
		background: rgb(255 255 255 / 92%);
		box-shadow: 0 8px 24px rgb(15 23 42 / 12%);
	}

	.graph-toolbar {
		min-width: 0;
	}

	.icon-button {
		/* Square, so the gear sits centred in a target the same height as the
		   lettered buttons beside it rather than in a wider slab. */
		padding: 0.375rem;
		aspect-ratio: 1;
	}

	.icon-button svg {
		display: block;
		width: 1.125rem;
		height: 1.125rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.9;
		stroke-linecap: round;
	}

	/* Thicker than the ring, and squared off: tooth weight is what separates a
	   gear from a sun at this size. */
	.icon-button svg .teeth {
		stroke-width: 2.9;
		stroke-linecap: butt;
	}

	.graph-toolbar button,
	.settings-toolbar button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2rem;
		border: 0;
		border-radius: 999px;
		padding: 0.375rem 0.625rem;
		background: #e2e8f0;
		color: #0f172a;
		font: inherit;
		cursor: pointer;
	}

	.graph-toolbar .icon-controls {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.graph-toolbar button.ai {
		position: relative;
	}

	.graph-toolbar button.ai.connected {
		background: #0f172a;
		color: #ffffff;
	}

	/*
	 * Parked in the corner of the glyph rather than beside it, so the control
	 * keeps its 44px square and the state is read as belonging to it. The ring
	 * is the button's own background, which keeps the dot legible on either fill.
	 */
	.graph-toolbar .ai-dot {
		position: absolute;
		right: 0.5rem;
		bottom: 0.5rem;
		width: 0.4rem;
		height: 0.4rem;
		border-radius: 999px;
		background: #94a3b8;
		box-shadow: 0 0 0 2px #e2e8f0;
	}

	.graph-toolbar button.ai.connected .ai-dot {
		background: #4ade80;
		box-shadow: 0 0 0 2px #0f172a;
	}

	/*
	 * 44px touch targets: these are the only controls in the pill a thumb reaches
	 * for repeatedly, and an icon gives it nothing else to aim at.
	 */
	.graph-toolbar button.icon {
		min-width: 2.75rem;
		min-height: 2.75rem;
		padding: 0;
		font-size: 1.125rem;
		line-height: 1;
	}

	/* The toolbar had no disabled precedent; this is GraphQueryPanel's. */
	.graph-toolbar button[aria-disabled='true'] {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.graph-toolbar .sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		border: 0;
		margin: -1px;
		clip-path: inset(50%);
		overflow: hidden;
		white-space: nowrap;
	}

	/* Kept in the layout but out of sight: the Import button is the visible control. */
	.graph-toolbar .import-input {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		border: 0;
		margin: -1px;
		clip-path: inset(50%);
		overflow: hidden;
		white-space: nowrap;
	}

	/*
	 * Fixed basis and a two-line floor: the toolbar must not resize as the notice
	 * changes between 'Caching draft...' and a two-sentence status. Every notice
	 * is written as sentences that fit this column on their own (the widest
	 * measures ~11.5rem in the bold warning face), and they stack one per line,
	 * so the bar stays the same compact size whatever it is saying.
	 */
	.graph-toolbar .notice {
		flex: 0 0 12rem;
		min-height: 2rem;
		margin: 0;
		color: #475569;
		font-size: 0.8125rem;
		line-height: 1.25;
	}

	.graph-toolbar .notice-line {
		display: block;
		white-space: normal;
	}

	.graph-toolbar p.warning {
		color: #b45309;
		font-weight: 600;
	}

	@media (max-width: 640px) {
		.toolbar-row {
			right: 0.75rem;
			left: 0.75rem;
			flex-wrap: wrap;
			justify-content: center;
			transform: none;
		}

		.graph-toolbar {
			flex-wrap: wrap;
			justify-content: center;
			border-radius: 1rem;
		}

		.settings-toolbar {
			border-radius: 1rem;
		}

		.graph-toolbar .notice {
			flex-basis: 100%;
			text-align: center;
		}
	}
</style>
