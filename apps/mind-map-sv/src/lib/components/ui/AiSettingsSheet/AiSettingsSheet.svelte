<script lang="ts">
	/**
	 * The one screen the AI nodes ask for: a key, and the handful of choices
	 * that change what leaves the machine.
	 *
	 * Everything past the key is behind a collapsed `<details>`, because the
	 * first run should be a field and a button and nothing else. The two
	 * sentences under the field are the whole security story a reader gets, so
	 * they say where the key lives and what bounds the damage if it leaks.
	 */
	import { untrack } from 'svelte';
	import { APP_CONFIG } from '$lib/appConfig';
	import { prefersReducedMotion } from '$lib/reducedMotion';
	import type { AiKeyValidation, AiSettings } from '$lib/ai/aiSettings';

	let {
		settings,
		connected = false,
		connectedDelayMs = 600,
		validateKey,
		onSave,
		onForget,
		onClose,
		onConnected
	}: {
		settings: AiSettings;
		/** Whether a key is already in hand, shown rather than inferred from the field. */
		connected?: boolean;
		/**
		 * How long the sheet stands on "Connected." before handing back to
		 * `onConnected`, which closes it. Long enough to be read as an answer,
		 * short enough not to be a wait — a sheet that vanishes the instant the
		 * key is accepted leaves nothing behind that says it was. Stories pass 0.
		 */
		connectedDelayMs?: number;
		validateKey: (key: string) => Promise<AiKeyValidation>;
		onSave: (settings: AiSettings) => void;
		onForget: () => void;
		onClose: () => void;
		/**
		 * Called after a Connect that saved, so an interrupted run can pick up
		 * where the missing key stopped it (T08).
		 */
		onConnected?: () => void;
	} = $props();

	const KEY_CONSOLE_URL = 'https://console.anthropic.com/settings/keys';

	/**
	 * Seeded once, not tracked: the sheet is mounted for one sitting, and the
	 * only thing that changes `settings` while it is open is this component
	 * saving. Re-seeding from that would fight the reader's own typing, so the
	 * `untrack` is the intent rather than a way past the warning.
	 */
	const seed = untrack(() => settings);
	let apiKeyDraft = $state(seed.apiKey ?? '');
	let rememberKey = $state(seed.rememberKey);
	let model = $state(seed.model);
	let previewRows = $state(seed.previewRows);
	let sendPlots = $state(seed.sendPlots);

	let connecting = $state(false);
	/** Set by a Connect that succeeded, and never cleared: the sheet closes next. */
	let justConnected = $state(false);
	let errorMessage = $state<string | null>(null);
	let keyInput = $state<HTMLInputElement | null>(null);

	/**
	 * The sheet exists to take a key, so the key field is where the caret goes.
	 * It is also what puts Escape within reach: the handler is on the layer, and
	 * a keystroke only reaches it from something inside.
	 */
	$effect(() => {
		keyInput?.focus();
	});

	const reduceMotion = $derived(prefersReducedMotion());
	const trimmedKey = $derived(apiKeyDraft.trim());

	/**
	 * One line, three states: what this browser had when the sheet opened, and —
	 * for the moment between a successful Connect and the sheet closing — the
	 * answer to the press the reader just made.
	 */
	const showsConnected = $derived(justConnected || connected);
	const connectionText = $derived(
		justConnected
			? 'Connected.'
			: connected
				? 'Connected on this browser.'
				: 'No key on this browser yet.'
	);

	function currentSettings(): AiSettings {
		return {
			model,
			previewRows,
			sendPlots,
			rememberKey,
			...(trimmedKey === '' ? {} : { apiKey: trimmedKey })
		};
	}

	/**
	 * The section's controls have no Save of their own: each change is a
	 * preference, and a preference the reader has to confirm is a preference
	 * they will leave wrong. Connect is the only control that gates on
	 * anything, because it is the only one that can fail.
	 *
	 * Written as explicit handlers rather than `bind:` plus `onchange`, so the
	 * save is guaranteed to read the value the reader just chose instead of
	 * depending on which listener the binding registered first.
	 */
	function savePreferences(): void {
		onSave(currentSettings());
	}

	async function connect(): Promise<void> {
		if (connecting) return;
		connecting = true;
		errorMessage = null;
		try {
			const result = await validateKey(trimmedKey);
			if (!result.ok) {
				errorMessage = result.message;
				return;
			}
			onSave(currentSettings());
			// Say so, then hand back. The caller closes the sheet from
			// `onConnected`, so anything shown after that call is shown to nobody —
			// the pause is the whole of the reader's evidence that the key took.
			justConnected = true;
			if (connectedDelayMs > 0) {
				await new Promise<void>((resolve) => setTimeout(resolve, connectedDelayMs));
			}
			onConnected?.();
		} finally {
			connecting = false;
		}
	}

	function forget(): void {
		apiKeyDraft = '';
		errorMessage = null;
		onForget();
	}

	function previewRowsLabel(rows: number): string {
		return rows === 0 ? 'None' : `First ${rows} rows`;
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') onClose();
	}
</script>

<div class="sheet-layer" role="presentation" onkeydown={handleKeydown}>
	<button class="sheet-backdrop" type="button" aria-label="Close AI settings" onclick={onClose}
	></button>
	<div
		class="ai-settings-sheet"
		class:reduced-motion={reduceMotion}
		role="dialog"
		aria-modal="true"
		aria-labelledby="ai-settings-sheet-title"
	>
		<header>
			<div>
				<p class="eyebrow">AI nodes</p>
				<h2 id="ai-settings-sheet-title">Connect to Claude</h2>
			</div>
			<button type="button" onclick={onClose}>Close</button>
		</header>

		<p class="connection" data-ai-connection={showsConnected ? 'connected' : 'disconnected'}>
			<span class="status-dot" class:on={showsConnected} aria-hidden="true"></span>{connectionText}
		</p>

		<label class="field" for="ai-settings-key">Anthropic API key</label>
		<input
			bind:this={keyInput}
			id="ai-settings-key"
			type="password"
			autocomplete="off"
			spellcheck="false"
			placeholder="sk-ant-…"
			aria-describedby="ai-settings-key-notes"
			value={apiKeyDraft}
			oninput={(event) => {
				apiKeyDraft = event.currentTarget.value;
				errorMessage = null;
			}}
		/>

		<p id="ai-settings-key-notes" class="notes">
			<span>Stays in this browser. Never saved in your graph files.</span>
			<span>Use a key from its own workspace with a spending limit.</span>
		</p>

		<label class="checkbox">
			<input
				type="checkbox"
				checked={rememberKey}
				onchange={(event) => {
					rememberKey = event.currentTarget.checked;
					savePreferences();
				}}
			/>Remember on this browser</label
		>

		<div class="actions">
			<a href={KEY_CONSOLE_URL} target="_blank" rel="noreferrer noopener">Get a key</a>
			<button type="button" class="primary" disabled={connecting} onclick={() => void connect()}>
				{justConnected ? 'Connected' : connecting ? 'Connecting…' : 'Connect'}
			</button>
		</div>

		{#if errorMessage !== null}
			<p class="error" role="alert" data-ai-connect-error>{errorMessage}</p>
		{/if}

		<details>
			<summary>Model, cost and data</summary>

			<div class="section-body">
				<!-- "Default", because a node can pick its own on its connection line
				     and keeps it: this is what the ones that have not picked call. -->
				<label class="field" for="ai-settings-model">Default model</label>
				<select
					id="ai-settings-model"
					value={model}
					onchange={(event) => {
						model = event.currentTarget.value;
						savePreferences();
					}}
				>
					{#each APP_CONFIG.ai.models as option (option)}
						<option value={option}>{option}</option>
					{/each}
				</select>

				<label class="field" for="ai-settings-preview-rows">Preview rows sent per file</label>
				<select
					id="ai-settings-preview-rows"
					value={String(previewRows)}
					onchange={(event) => {
						previewRows = Number(event.currentTarget.value);
						savePreferences();
					}}
				>
					{#each APP_CONFIG.ai.previewRowChoices as rows (rows)}
						<option value={String(rows)}>{previewRowsLabel(rows)}</option>
					{/each}
				</select>

				<label class="checkbox">
					<input
						type="checkbox"
						checked={sendPlots}
						onchange={(event) => {
							sendPlots = event.currentTarget.checked;
							savePreferences();
						}}
					/>Send rendered plots back to Claude for checking</label
				>

				<button type="button" class="forget" onclick={forget}>Forget key</button>
			</div>
		</details>
	</div>
</div>

<style>
	.sheet-layer {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		pointer-events: auto;
	}

	.sheet-backdrop {
		position: absolute;
		inset: 0;
		border: 0;
		background: rgb(15 23 42 / 24%);
		touch-action: none;
	}

	.ai-settings-sheet {
		position: relative;
		z-index: 1;
		box-sizing: border-box;
		display: grid;
		gap: 0.625rem;
		width: min(100%, 30rem);
		max-height: calc(100% - 2rem);
		overflow: auto;
		border-radius: 1rem 1rem 0 0;
		padding: 1rem;
		background: #ffffff;
		box-shadow: 0 -12px 40px rgb(0 0 0 / 22%);
		animation: sheet-in 160ms ease-out;
		/* A scroll container, like the node sheet: `none` would strand the section. */
		touch-action: pan-y;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	h2,
	.eyebrow,
	.connection,
	.notes,
	.error {
		margin: 0;
	}

	.eyebrow {
		color: #64748b;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	h2 {
		font-size: 1.125rem;
	}

	.connection {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		color: #475569;
		font-size: 0.8125rem;
	}

	/* The same two states, in the same two colours, as the workbench line and the
	   toolbar glyph — three places that answer one question. */
	.status-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 999px;
		background: #94a3b8;
	}

	.status-dot.on {
		background: #16a34a;
	}

	.field {
		color: #334155;
		font-weight: 600;
	}

	input[type='password'],
	select {
		box-sizing: border-box;
		width: 100%;
		border: 1px solid #cbd5e1;
		border-radius: 0.625rem;
		padding: 0.625rem 0.75rem;
		font: inherit;
	}

	.notes {
		display: grid;
		gap: 0.125rem;
		color: #64748b;
		font-size: 0.8125rem;
	}

	.checkbox {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: #334155;
	}

	.checkbox input {
		width: 1.125rem;
		height: 1.125rem;
	}

	.actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.actions a {
		color: #1d4ed8;
		font-size: 0.875rem;
	}

	button {
		min-height: 2.75rem;
		border: 0;
		border-radius: 999px;
		padding: 0.625rem 1rem;
		background: #e2e8f0;
		color: #0f172a;
		font: inherit;
		cursor: pointer;
	}

	button.primary {
		background: #0f172a;
		color: #ffffff;
	}

	button:disabled {
		cursor: progress;
		opacity: 0.6;
	}

	.error {
		color: #b45309;
		font-size: 0.875rem;
		font-weight: 600;
	}

	/*
	 * `display` stays off the `<details>` itself: giving it a grid or flex box
	 * is what breaks the closed state in some browsers, so the layout lives on
	 * a body element inside instead.
	 */
	details {
		border-top: 1px solid #e2e8f0;
		padding-top: 0.75rem;
	}

	summary {
		color: #334155;
		font-weight: 600;
		cursor: pointer;
	}

	.section-body {
		display: grid;
		gap: 0.625rem;
		padding-top: 0.625rem;
	}

	.section-body .forget {
		justify-self: start;
	}

	.ai-settings-sheet.reduced-motion {
		animation: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.ai-settings-sheet {
			animation: none;
		}
	}

	@keyframes sheet-in {
		from {
			transform: translateY(1rem);
			opacity: 0;
		}

		to {
			transform: translateY(0);
			opacity: 1;
		}
	}
</style>
