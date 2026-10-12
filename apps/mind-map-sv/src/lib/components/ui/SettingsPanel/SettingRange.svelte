<script lang="ts">
	import { clampToSliderRange, formatSettingValue, parseSettingValue } from './lib/settingValue';

	/**
	 * Bounded numeric field: a slider plus a paired numeric box.
	 *
	 * Event contract, which the stories drive directly:
	 * - a slider `input` event that did not come from a key press is a **preview**;
	 * - the following `change` (or `pointerup`) event is the single **commit**;
	 * - a slider `input` event caused by a key press commits on its own, so arrow
	 *   keys never produce a preview storm;
	 * - the numeric box commits on Enter or blur, accepts values outside
	 *   `min..max`, and reverts to the current value when the text is not a number.
	 *
	 * The slider thumb clamps itself to `min..max`; the numeric box always shows
	 * the true value, so the bounds are a convenience rather than a cage.
	 */
	let {
		label,
		help,
		unit,
		min,
		max,
		step,
		value,
		isModified,
		onPreview,
		onCommit,
		onReset
	}: {
		label: string;
		help?: string;
		unit?: string;
		min: number;
		max: number;
		step: number;
		value: number;
		isModified: boolean;
		onPreview: (value: number) => void;
		onCommit: (value: number) => void;
		onReset: () => void;
	} = $props();

	/** Text shown in the numeric box while it is being edited or dragged. */
	let draftText = $state<string | null>(null);
	/** Value previewed by the current drag, waiting for its single commit. */
	let pendingCommit = $state<number | null>(null);
	/** True between a value-changing keydown and the input event it causes. */
	let keyboardActive = $state(false);

	const displayText = $derived(draftText ?? formatSettingValue(value));
	const displayValue = $derived(parseSettingValue(displayText) ?? value);
	const sliderValue = $derived(clampToSliderRange(displayValue, min, max));
	const isOutOfRange = $derived(displayValue < min || displayValue > max);

	const VALUE_KEYS = new Set([
		'ArrowLeft',
		'ArrowRight',
		'ArrowUp',
		'ArrowDown',
		'PageUp',
		'PageDown',
		'Home',
		'End'
	]);

	function handleSliderKeydown(event: KeyboardEvent): void {
		if (VALUE_KEYS.has(event.key)) keyboardActive = true;
	}

	function handleSliderInput(event: Event & { currentTarget: HTMLInputElement }): void {
		const next = parseSettingValue(event.currentTarget.value);
		if (next === null) return;

		if (keyboardActive) {
			keyboardActive = false;
			pendingCommit = null;
			draftText = null;
			onCommit(next);
			return;
		}

		pendingCommit = next;
		draftText = formatSettingValue(next);
		onPreview(next);
	}

	/**
	 * Idempotent: whichever of `change` / `pointerup` arrives first commits, and
	 * the other becomes a no-op, so a release fires `onCommit` exactly once.
	 */
	function commitDrag(): void {
		if (pendingCommit === null) return;
		const next = pendingCommit;
		pendingCommit = null;
		draftText = null;
		onCommit(next);
	}

	function handleNumberInput(event: Event & { currentTarget: HTMLInputElement }): void {
		draftText = event.currentTarget.value;
	}

	function commitNumber(event: Event & { currentTarget: HTMLInputElement }): void {
		const input = event.currentTarget;
		const parsed = parseSettingValue(input.value);
		draftText = null;
		if (parsed !== null && parsed !== value) onCommit(parsed);
		// The box is written to directly: text typed and discarded inside one tick
		// never reaches the template, so Svelte has nothing to revert.
		input.value = formatSettingValue(value);
	}

	function handleNumberKeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }): void {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		commitNumber(event);
	}
</script>

<div class="control-row">
	<input
		type="range"
		class="slider"
		aria-label={label}
		title={help}
		{min}
		{max}
		{step}
		value={sliderValue}
		onkeydown={handleSliderKeydown}
		onkeyup={() => (keyboardActive = false)}
		onpointerdown={() => (keyboardActive = false)}
		oninput={handleSliderInput}
		onchange={commitDrag}
		onpointerup={commitDrag}
		onpointercancel={commitDrag}
	/>

	<span class="numeric" data-out-of-range={isOutOfRange}>
		<input
			type="number"
			class="number"
			aria-label={`${label} value`}
			{step}
			value={displayText}
			oninput={handleNumberInput}
			onkeydown={handleNumberKeydown}
			onblur={commitNumber}
		/>
		{#if unit}<span class="unit" aria-hidden="true">{unit}</span>{/if}
	</span>

	{#if isModified}
		<button type="button" class="reset" aria-label={`Reset ${label}`} onclick={() => onReset()}>
			Reset
		</button>
	{/if}
</div>

<style>
	.control-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 1.75rem;
	}

	.slider {
		flex: 1 1 auto;
		min-width: 4rem;
		accent-color: #0f172a;
		cursor: pointer;
	}

	.numeric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.125rem;
		flex: 0 0 auto;
	}

	.number {
		width: 4.25rem;
		box-sizing: border-box;
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		padding: 0.125rem 0.25rem;
		background: #ffffff;
		color: #0f172a;
		font: inherit;
		font-size: 0.75rem;
		text-align: right;
	}

	.numeric[data-out-of-range='true'] .number {
		border-color: #f59e0b;
	}

	.unit {
		color: #475569;
		font-size: 0.7rem;
	}

	.reset {
		flex: 0 0 auto;
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		padding: 0.125rem 0.375rem;
		background: #f8fafc;
		color: #475569;
		font: inherit;
		font-size: 0.7rem;
		cursor: pointer;
	}

	.reset:hover {
		background: #e2e8f0;
	}
</style>
