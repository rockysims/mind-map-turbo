<script lang="ts">
	import { formatSettingValue, parseSettingValue } from './lib/settingValue';

	/**
	 * Unbounded numeric field. Enter or blur commits; text that is not a number
	 * reverts to the current value. `min` / `max` are advisory — they drive the
	 * stepper and assistive tech, but a typed value is passed through as typed and
	 * is bounded (if at all) by the schema-aware clamp in the override model.
	 */
	let {
		label,
		help,
		unit,
		min,
		max,
		step,
		integer = false,
		value,
		isModified,
		onCommit,
		onReset
	}: {
		label: string;
		help?: string;
		unit?: string;
		min?: number;
		max?: number;
		step?: number;
		integer?: boolean;
		value: number;
		isModified: boolean;
		onCommit: (value: number) => void;
		onReset: () => void;
	} = $props();

	let draftText = $state<string | null>(null);

	const displayText = $derived(draftText ?? formatSettingValue(value));
	const stepAttribute = $derived(step ?? (integer ? 1 : 'any'));

	function handleInput(event: Event & { currentTarget: HTMLInputElement }): void {
		draftText = event.currentTarget.value;
	}

	function commitValue(event: Event & { currentTarget: HTMLInputElement }): void {
		const input = event.currentTarget;
		const parsed = parseSettingValue(input.value, integer);
		draftText = null;
		if (parsed !== null && parsed !== value) onCommit(parsed);
		// The box is written to directly: text typed and discarded inside one tick
		// never reaches the template, so Svelte has nothing to revert.
		input.value = formatSettingValue(value);
	}

	function handleKeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }): void {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		commitValue(event);
	}
</script>

<div class="control-row">
	<span class="numeric">
		<input
			type="number"
			class="number"
			aria-label={label}
			title={help}
			{min}
			{max}
			step={stepAttribute}
			value={displayText}
			oninput={handleInput}
			onkeydown={handleKeydown}
			onblur={commitValue}
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

	.numeric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.25rem;
	}

	.number {
		width: 6rem;
		box-sizing: border-box;
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		padding: 0.125rem 0.375rem;
		background: #ffffff;
		color: #0f172a;
		font: inherit;
		font-size: 0.75rem;
		text-align: right;
	}

	.unit {
		color: #475569;
		font-size: 0.7rem;
	}

	.reset {
		margin-left: auto;
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
