<script lang="ts">
	import { toast } from 'svelte-sonner';
	import Toaster from './sonner.svelte';
</script>

<Toaster />

<div class="demo">
	<p class="demo-title">Click a button to show a toast</p>
	<div class="demo-actions">
		<button type="button" onclick={() => toast('Default toast')}>
			Default
		</button>
		<button type="button" onclick={() => toast.success('Success!')}>
			Success
		</button>
		<button type="button" onclick={() => toast.error('Something went wrong')}>
			Error
		</button>
		<button type="button" onclick={() => toast.info('Here’s some info')}>
			Info
		</button>
		<button type="button" onclick={() => toast.warning('Heads up')}>
			Warning
		</button>
	</div>
</div>

<style>
	.demo {
		padding: 1.5rem;
	}
	.demo-title {
		margin-bottom: 1rem;
		font-size: 0.875rem;
		color: var(--color-muted-foreground, #71717a);
	}
	.demo-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.demo-actions button {
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-border, #e4e4e7);
		background: var(--color-background, #fff);
		cursor: pointer;
	}
	.demo-actions button:hover {
		background: var(--color-muted, #f4f4f5);
	}
</style>
