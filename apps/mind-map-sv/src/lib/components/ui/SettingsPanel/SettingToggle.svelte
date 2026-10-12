<script lang="ts">
	/**
	 * Boolean field control. Toggles have no preview concept — a checkbox change
	 * is already the whole gesture, so every change commits immediately.
	 *
	 * `label` names the control for assistive tech and for `getByRole` in stories;
	 * the visible label row lives in `SettingField`.
	 */
	let {
		label,
		help,
		value,
		isModified,
		onCommit,
		onReset
	}: {
		label: string;
		help?: string;
		value: boolean;
		isModified: boolean;
		onCommit: (value: boolean) => void;
		onReset: () => void;
	} = $props();

	function handleChange(event: Event & { currentTarget: HTMLInputElement }): void {
		onCommit(event.currentTarget.checked);
	}
</script>

<div class="control-row">
	<input
		type="checkbox"
		role="switch"
		class="switch"
		aria-label={label}
		title={help}
		checked={value}
		onchange={handleChange}
	/>
	<span class="state" aria-hidden="true">{value ? 'On' : 'Off'}</span>
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

	.switch {
		width: 1rem;
		height: 1rem;
		accent-color: #0f172a;
		cursor: pointer;
	}

	.state {
		color: #475569;
		font-size: 0.75rem;
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
