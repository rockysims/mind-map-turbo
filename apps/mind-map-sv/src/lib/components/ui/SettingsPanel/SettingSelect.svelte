<script lang="ts">
	/**
	 * One-of-several string field control. Like a toggle, a select has no preview
	 * concept — choosing an option is already the whole gesture, so every change
	 * commits immediately.
	 *
	 * A native `<select>` rather than a segmented control: a handful of options
	 * does not fit side by side in the panel's width, and on touch devices the
	 * native element opens the platform picker.
	 *
	 * `label` names the control for assistive tech and for `getByRole` in stories;
	 * the visible label row lives in `SettingField`.
	 */
	let {
		label,
		help,
		options,
		value,
		isModified,
		onCommit,
		onReset
	}: {
		label: string;
		help?: string;
		options: readonly { value: string; label: string }[];
		value: string;
		isModified: boolean;
		onCommit: (value: string) => void;
		onReset: () => void;
	} = $props();

	function handleChange(event: Event & { currentTarget: HTMLSelectElement }): void {
		const next = event.currentTarget.value;
		if (next !== value) onCommit(next);
	}
</script>

<div class="control-row">
	<select class="select" aria-label={label} title={help} {value} onchange={handleChange}>
		{#each options as option (option.value)}
			<option value={option.value}>{option.label}</option>
		{/each}
	</select>
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

	/* Drawn like the numeric inputs (border, radius, type size), but the box is
	   the whole hit area, so it keeps the 44px touch floor. */
	.select {
		flex: 1 1 auto;
		min-width: 0;
		min-height: 2.75rem;
		box-sizing: border-box;
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		padding: 0.125rem 0.375rem;
		background: #ffffff;
		color: #0f172a;
		font: inherit;
		font-size: 0.75rem;
		cursor: pointer;
	}

	.select:focus-visible {
		outline: 2px solid #0f172a;
		outline-offset: 1px;
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
