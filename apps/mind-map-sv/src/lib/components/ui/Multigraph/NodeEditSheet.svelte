<script lang="ts">
	import { untrack } from 'svelte';
	import type { EdgeData } from '../types/edge';
	import type { NodeData } from '../types/node';
	import { normalizeNodeTitle, type EdgePatch } from './lib/graph';
	import { normalizeTagList } from './lib/titleSyntax';

	type ActiveTab = 'node' | 'edges';
	type DirectionChoice = 'undirected' | 'outgoing' | 'incoming';

	let {
		node,
		nodes,
		edges,
		onSave,
		onSaveEdge,
		onCancel,
		onTogglePinned,
		onDelete
	}: {
		node: NodeData;
		nodes: NodeData[];
		edges: EdgeData[];
		onSave: (content: { title: string; description: string; tags: string[] }) => void;
		onSaveEdge: (edgeId: string, patch: EdgePatch) => void;
		onCancel: () => void;
		onTogglePinned: () => void;
		onDelete: () => void;
	} = $props();

	let activeTab = $state<ActiveTab>('node');
	let title = $state('');
	let description = $state('');
	let nodeTags = $state('');
	let edgeTagTextById = $state<Record<string, string>>({});
	let titleInput = $state<HTMLInputElement | null>(null);

	const incidentEdges = $derived(
		edges.filter((edge) => edge.sourceNodeId === node.id || edge.targetNodeId === node.id)
	);

	$effect(() => {
		title = node.title;
		description = node.description;
		nodeTags = node.tags.join(' ');
		requestAnimationFrame(() => titleInput?.focus());
	});

	$effect(() => {
		const currentTagText = untrack(() => edgeTagTextById);
		edgeTagTextById = Object.fromEntries(
			incidentEdges.map((edge) => [edge.id, currentTagText[edge.id] ?? edge.tags.join(' ')])
		);
	});

	function save() {
		onSave({
			title: normalizeNodeTitle(title),
			description,
			tags: normalizeTagList(nodeTags)
		});
	}

	function saveEdgeTags(edge: EdgeData) {
		onSaveEdge(edge.id, { tags: normalizeTagList(edgeTagTextById[edge.id] ?? '') });
	}

	function edgeTagsFor(edge: EdgeData): string[] {
		return normalizeTagList(edgeTagTextById[edge.id] ?? '');
	}

	function moveEdgeTag(edge: EdgeData, index: number, direction: -1 | 1) {
		const tags = edgeTagsFor(edge);
		const nextIndex = index + direction;
		if (nextIndex < 0 || nextIndex >= tags.length) return;

		const reordered = [...tags];
		[reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
		edgeTagTextById = {
			...edgeTagTextById,
			[edge.id]: reordered.join(' ')
		};
		onSaveEdge(edge.id, { tags: reordered });
	}

	function saveEdgeDirection(edge: EdgeData, direction: DirectionChoice) {
		const neighborId = otherEndpoint(edge);
		if (!neighborId) return;

		if (direction === 'undirected') {
			onSaveEdge(edge.id, { directed: false });
			return;
		}

		onSaveEdge(edge.id, {
			sourceNodeId: direction === 'outgoing' ? node.id : neighborId,
			targetNodeId: direction === 'outgoing' ? neighborId : node.id,
			directed: true
		});
	}

	function directionFor(edge: EdgeData): DirectionChoice {
		if (edge.directed !== true) return 'undirected';
		return edge.sourceNodeId === node.id ? 'outgoing' : 'incoming';
	}

	function parseDirectionChoice(value: string): DirectionChoice {
		if (value === 'outgoing' || value === 'incoming') return value;
		return 'undirected';
	}

	function otherEndpoint(edge: EdgeData): string | null {
		if (edge.sourceNodeId === node.id) return edge.targetNodeId;
		if (edge.targetNodeId === node.id) return edge.sourceNodeId;
		return null;
	}

	function neighborTitle(edge: EdgeData): string {
		const neighborId = otherEndpoint(edge);
		return nodes.find((candidate) => candidate.id === neighborId)?.title ?? 'Unknown node';
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onCancel();
	}
</script>

<div class="sheet-layer" role="presentation" onkeydown={handleKeydown}>
	<button class="sheet-backdrop" type="button" aria-label="Cancel editing" onclick={onCancel}
	></button>
	<div
		class="node-edit-sheet"
		role="dialog"
		aria-modal="true"
		aria-labelledby="node-edit-sheet-title"
	>
		<header>
			<div>
				<p class="eyebrow">Editing node</p>
				<h2 id="node-edit-sheet-title">{node.title}</h2>
			</div>
			<button type="button" class="secondary" onclick={onCancel}>Close</button>
		</header>

		<div class="tabs" role="tablist" aria-label="Edit node and edges">
			<button
				type="button"
				role="tab"
				aria-selected={activeTab === 'node'}
				aria-controls="node-edit-tabpanel"
				id="node-edit-tab"
				class:active={activeTab === 'node'}
				onclick={() => (activeTab = 'node')}
			>
				Node
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={activeTab === 'edges'}
				aria-controls="edge-edit-tabpanel"
				id="edge-edit-tab"
				class:active={activeTab === 'edges'}
				onclick={() => (activeTab = 'edges')}
			>
				Edges
			</button>
		</div>

		{#if activeTab === 'node'}
			<div
				id="node-edit-tabpanel"
				role="tabpanel"
				aria-labelledby="node-edit-tab"
				class="tabpanel"
				tabindex="0"
			>
				<label>
					Title
					<input bind:this={titleInput} bind:value={title} name="title" />
				</label>

				<label>
					Description
					<textarea bind:value={description} name="description" rows="6"></textarea>
				</label>

				<label>
					Node tags
					<input bind:value={nodeTags} name="node-tags" placeholder="abc urgent" />
				</label>

				<div class="actions">
					<button type="button" class="secondary" onclick={onTogglePinned}>
						{node.pinned ? 'Unpin' : 'Pin'}
					</button>
					<button type="button" class="danger" onclick={onDelete}>Delete</button>
					<button type="button" class="secondary" onclick={onCancel}>Cancel</button>
					<button type="button" class="primary" onclick={save}>Save</button>
				</div>
			</div>
		{:else}
			<div
				id="edge-edit-tabpanel"
				role="tabpanel"
				aria-labelledby="edge-edit-tab"
				class="tabpanel edges-tab"
				tabindex="0"
			>
				{#if incidentEdges.length === 0}
					<p class="empty-state">No connected edges yet.</p>
				{:else}
					{#each incidentEdges as edge (edge.id)}
						{@const neighbor = neighborTitle(edge)}
						<div class="edge-row" data-edit-edge-id={edge.id}>
							<div>
								<p class="edge-neighbor">Connected to {neighbor}</p>
								<p class="edge-id">{edge.id}</p>
							</div>

							<label>
								Direction for {neighbor}
								<select
									value={directionFor(edge)}
									onchange={(event) =>
										saveEdgeDirection(edge, parseDirectionChoice(event.currentTarget.value))}
								>
									<option value="undirected">Undirected</option>
									<option value="outgoing">From this node</option>
									<option value="incoming">To this node</option>
								</select>
							</label>

							<label>
								Edge tags for {neighbor}
								<input
									name={`edge-tags-${edge.id}`}
									value={edgeTagTextById[edge.id] ?? ''}
									placeholder="rel strong"
									oninput={(event) =>
										(edgeTagTextById = {
											...edgeTagTextById,
											[edge.id]: event.currentTarget.value
										})}
								/>
							</label>

							{#if edgeTagsFor(edge).length > 0}
								<ol class="edge-tag-list" aria-label={`Ordered edge tags for ${neighbor}`}>
									{#each edgeTagsFor(edge) as tag, index (`${edge.id}:${tag}:${index}`)}
										<li>
											<span>{tag}</span>
											<div class="edge-tag-actions">
												<button
													type="button"
													class="secondary"
													disabled={index === 0}
													aria-label={`Move edge tag ${tag} earlier`}
													onclick={() => moveEdgeTag(edge, index, -1)}
												>
													Up
												</button>
												<button
													type="button"
													class="secondary"
													disabled={index === edgeTagsFor(edge).length - 1}
													aria-label={`Move edge tag ${tag} later`}
													onclick={() => moveEdgeTag(edge, index, 1)}
												>
													Down
												</button>
											</div>
										</li>
									{/each}
								</ol>
							{/if}

							<button
								type="button"
								class="secondary edge-save"
								aria-label={`Save edge to ${neighbor}`}
								onclick={() => saveEdgeTags(edge)}
							>
								Save edge
							</button>
						</div>
					{/each}
				{/if}
			</div>
		{/if}
	</div>
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
	.eyebrow,
	.edge-neighbor,
	.edge-id,
	.empty-state {
		margin: 0;
	}

	.eyebrow,
	.edge-id {
		color: #64748b;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.tabs {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.tabs button {
		background: #e2e8f0;
		color: #0f172a;
	}

	.tabs button.active {
		background: #0f172a;
		color: #ffffff;
	}

	.tabpanel {
		display: grid;
		gap: 0.875rem;
	}

	label {
		display: grid;
		gap: 0.375rem;
		color: #334155;
		font-weight: 600;
	}

	input,
	select,
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

	.edges-tab {
		max-height: min(60vh, 28rem);
		overflow: auto;
		padding-right: 0.125rem;
	}

	.edge-row {
		display: grid;
		gap: 0.75rem;
		border: 1px solid #e2e8f0;
		border-radius: 0.875rem;
		padding: 0.875rem;
	}

	.edge-neighbor {
		color: #0f172a;
		font-weight: 700;
	}

	.edge-tag-list {
		display: grid;
		gap: 0.5rem;
		padding: 0;
		margin: 0;
		list-style: none;
	}

	.edge-tag-list li,
	.edge-tag-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.edge-tag-list li {
		justify-content: space-between;
		padding: 0.5rem;
		border: 1px solid #e2e8f0;
		border-radius: 0.75rem;
	}

	.edge-tag-list span {
		font-weight: 700;
	}

	.edge-save {
		justify-self: stretch;
	}

	button {
		min-height: 44px;
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
