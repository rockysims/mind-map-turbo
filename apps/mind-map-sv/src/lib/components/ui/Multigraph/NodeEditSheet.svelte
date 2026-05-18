<script lang="ts">
	import type { NodeData } from '../types/node';

	const EMPTY_TITLE = 'Untitled node';

	let {
		node,
		onSave,
		onCancel,
		onTogglePinned,
		onDelete
	}: {
		node: NodeData;
		onSave: (content: { title: string; description: string }) => void;
		onCancel: () => void;
		onTogglePinned: () => void;
		onDelete: () => void;
	} = $props();

	let title = $state('');
	let description = $state('');
	let titleInput = $state<HTMLInputElement | null>(null);

	$effect(() => {
		title = node.title;
		description = node.description;
		requestAnimationFrame(() => titleInput?.focus());
	});

	function save() {
		onSave({
			title: title.trim() || EMPTY_TITLE,
			description
		});
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onCancel();
	}
</script>

<div class="sheet-layer" role="presentation" onkeydown={handleKeydown}>
	<button class="sheet-backdrop" type="button" aria-label="Cancel editing" onclick={onCancel}
	></button>
	<form
		class="node-edit-sheet"
		aria-label={`Edit ${node.title}`}
		onsubmit={(event) => event.preventDefault()}
	>
		<header>
			<div>
				<p class="eyebrow">Editing node</p>
				<h2>{node.title}</h2>
			</div>
			<button type="button" class="secondary" onclick={onCancel}>Close</button>
		</header>

		<label>
			Title
			<input bind:this={titleInput} bind:value={title} name="title" />
		</label>

		<label>
			Description
			<textarea bind:value={description} name="description" rows="6"></textarea>
		</label>

		<div class="actions">
			<button type="button" class="secondary" onclick={onTogglePinned}>
				{node.pinned ? 'Unpin' : 'Pin'}
			</button>
			<button type="button" class="danger" onclick={onDelete}>Delete</button>
			<button type="button" class="secondary" onclick={onCancel}>Cancel</button>
			<button type="button" class="primary" onclick={save}>Save</button>
		</div>
	</form>
</div>

<style>
	.sheet-layer {
		position: absolute;
		inset: 0;
		z-index: 30;
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

	.node-edit-sheet {
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
		animation: sheet-in 160ms ease-out;
		touch-action: none;
	}

	header,
	.actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	header {
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	h2,
	.eyebrow {
		margin: 0;
	}

	.eyebrow {
		color: #64748b;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	label {
		display: grid;
		gap: 0.375rem;
		margin-bottom: 0.875rem;
		color: #334155;
		font-weight: 600;
	}

	input,
	textarea {
		box-sizing: border-box;
		width: 100%;
		border: 1px solid #cbd5e1;
		border-radius: 0.625rem;
		padding: 0.625rem 0.75rem;
		font: inherit;
	}

	.actions {
		justify-content: flex-end;
		flex-wrap: wrap;
	}

	button {
		border: 0;
		border-radius: 999px;
		padding: 0.625rem 0.875rem;
		font: inherit;
	}

	.primary {
		background: #0f172a;
		color: #ffffff;
	}

	.secondary {
		background: #e2e8f0;
		color: #0f172a;
	}

	.danger {
		background: #fee2e2;
		color: #991b1b;
	}

	@media (min-width: 640px) {
		.sheet-layer {
			align-items: center;
		}

		.node-edit-sheet {
			border-radius: 1rem;
			box-shadow: 0 20px 60px rgb(0 0 0 / 24%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.node-edit-sheet {
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
