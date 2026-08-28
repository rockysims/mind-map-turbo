<script lang="ts">
	import { untrack } from 'svelte';
	import type { EdgeData } from '../types/edge';
	import type { GraphAssetMetadata } from '../types/multigraph';
	import type { NodeData, NodeImageContent } from '../types/node';
	import { prefersReducedMotion } from '$lib/reducedMotion';
	import MathText from '../MathText/MathText.svelte';
	import { hasMath } from '../MathText/lib/mathSegments';
	import { mathPlainText } from '../MathText/lib/mathPlainText';
	import { normalizeNodeTitle, type EdgePatch } from './lib/graph';
	import { normalizeTagList } from './lib/titleSyntax';

	type ActiveTab = 'node' | 'edges';
	type DirectionChoice = 'undirected' | 'outgoing' | 'incoming';

	let {
		node,
		nodes,
		edges,
		assets = {},
		onSave,
		onAddImage,
		onSaveImage,
		onMoveImage,
		onDeleteImage,
		onSaveEdge,
		onCancel,
		onTogglePinned,
		onDelete
	}: {
		node: NodeData;
		nodes: NodeData[];
		edges: EdgeData[];
		assets?: Record<string, GraphAssetMetadata>;
		onSave: (content: { title: string; description: string; tags: string[] }) => void;
		onAddImage?: (
			file: File,
			details: { alt: string; caption?: string }
		) => Promise<'added' | 'unsupported' | 'store-failed'>;
		onSaveImage?: (assetId: string, details: { alt: string; caption?: string }) => void;
		onMoveImage?: (fromIndex: number, direction: -1 | 1) => void;
		onDeleteImage?: (assetId: string) => void;
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
	let imageDraftByAssetId = $state<Record<string, { alt: string; caption: string }>>({});
	let imageStatus = $state('');
	let titleInput = $state<HTMLInputElement | null>(null);
	let imageInput = $state<HTMLInputElement | null>(null);
	let reduceMotion = $derived(prefersReducedMotion());
	// Only surface the preview once the draft actually contains math, so nodes
	// without any keep the compact form the sheet has today.
	const descriptionHasMath = $derived(hasMath(description));

	const incidentEdges = $derived(
		edges.filter((edge) => edge.sourceNodeId === node.id || edge.targetNodeId === node.id)
	);
	const imageBlocks = $derived(
		(node.content ?? []).filter((block): block is NodeImageContent => block.type === 'image')
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

	$effect(() => {
		const currentDrafts = untrack(() => imageDraftByAssetId);
		imageDraftByAssetId = Object.fromEntries(
			imageBlocks.map((image) => [
				image.assetId,
				currentDrafts[image.assetId] ?? { alt: image.alt, caption: image.caption ?? '' }
			])
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

	async function addSelectedImage(event: Event) {
		// Svelte types currentTarget broadly, but this handler is attached to the file input.
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || !onAddImage) return;
		imageStatus = '';
		const result = await onAddImage(file, { alt: file.name, caption: '' });
		if (result === 'unsupported') imageStatus = 'Unsupported image type.';
		if (result === 'store-failed') imageStatus = 'Unable to store image.';
		if (result === 'added') imageStatus = 'Image added.';
		if (imageInput) imageInput.value = '';
	}

	function saveImage(image: NodeImageContent) {
		const draft = imageDraftByAssetId[image.assetId] ?? {
			alt: image.alt,
			caption: image.caption ?? ''
		};
		onSaveImage?.(image.assetId, {
			alt: draft.alt,
			caption: draft.caption.trim() ? draft.caption : undefined
		});
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

	/**
	 * Projected: every use of this is a label naming which edge a control acts on,
	 * both on screen and in the accessible name. None of them is an editing
	 * surface, so none of them wants LaTeX source.
	 */
	function neighborTitle(edge: EdgeData): string {
		const neighborId = otherEndpoint(edge);
		const title = nodes.find((candidate) => candidate.id === neighborId)?.title;
		return title === undefined ? 'Unknown node' : mathPlainText(title);
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
		class:reduced-motion={reduceMotion}
		role="dialog"
		aria-modal="true"
		aria-labelledby="node-edit-sheet-title"
	>
		<header>
			<div>
				<p class="eyebrow">Editing node</p>
				<h2 id="node-edit-sheet-title" aria-label={mathPlainText(node.title)}>
					<MathText text={node.title} singleLine />
				</h2>
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

				{#if descriptionHasMath}
					<section class="math-preview" aria-label="Math preview" data-math-preview>
						<h3>Preview</h3>
						<div class="math-preview-body"><MathText text={description} /></div>
					</section>
				{/if}

				<label>
					Node tags
					<input bind:value={nodeTags} name="node-tags" placeholder="abc urgent" />
				</label>

				<section class="images-panel" aria-label="Image attachments">
					<div class="images-header">
						<h3>Images</h3>
						<label class="image-upload">
							Add image
							<input
								bind:this={imageInput}
								type="file"
								accept="image/*"
								onchange={addSelectedImage}
							/>
						</label>
					</div>

					{#if imageBlocks.length === 0}
						<p class="empty-state">No images attached.</p>
					{:else}
						<ol class="image-list" aria-label="Attached images">
							{#each imageBlocks as image, index (image.assetId)}
								{@const asset = assets[image.assetId]}
								{@const draft = imageDraftByAssetId[image.assetId] ?? {
									alt: image.alt,
									caption: image.caption ?? ''
								}}
								<li>
									<div class="image-meta">
										<strong>{asset?.name ?? image.assetId}</strong>
										<span>{asset?.mimeType ?? 'image'}</span>
									</div>
									<label>
										Alt text
										<input
											value={draft.alt}
											oninput={(event) =>
												(imageDraftByAssetId = {
													...imageDraftByAssetId,
													[image.assetId]: {
														...draft,
														alt: event.currentTarget.value
													}
												})}
										/>
									</label>
									<label>
										Caption
										<input
											value={draft.caption}
											oninput={(event) =>
												(imageDraftByAssetId = {
													...imageDraftByAssetId,
													[image.assetId]: {
														...draft,
														caption: event.currentTarget.value
													}
												})}
										/>
									</label>
									<div class="image-actions">
										<button
											type="button"
											class="secondary"
											disabled={index === 0}
											onclick={() => onMoveImage?.(index, -1)}
										>
											Up
										</button>
										<button
											type="button"
											class="secondary"
											disabled={index === imageBlocks.length - 1}
											onclick={() => onMoveImage?.(index, 1)}
										>
											Down
										</button>
										<button type="button" class="secondary" onclick={() => saveImage(image)}>
											Save image
										</button>
										<button
											type="button"
											class="danger"
											onclick={() => onDeleteImage?.(image.assetId)}
										>
											Remove
										</button>
									</div>
								</li>
							{/each}
						</ol>
					{/if}

					{#if imageStatus}
						<p class="image-status" role="status">{imageStatus}</p>
					{/if}
				</section>

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

	.math-preview {
		display: grid;
		gap: 0.5rem;
		border: 1px solid #e2e8f0;
		border-radius: 0.875rem;
		padding: 0.875rem;
		background: #f8fafc;
	}

	.math-preview h3 {
		margin: 0;
		color: #475569;
		font-size: 0.8125rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.math-preview-body {
		color: #0f172a;
		line-height: 1.65;
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

	.images-panel,
	.image-list {
		display: grid;
		gap: 0.75rem;
	}

	.images-header,
	.image-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.images-header {
		justify-content: space-between;
	}

	.images-header h3,
	.image-status {
		margin: 0;
	}

	.image-upload {
		display: inline-flex;
		min-height: 44px;
		align-items: center;
		border-radius: 999px;
		padding: 0.625rem 0.875rem;
		background: #e2e8f0;
		color: #0f172a;
		font-weight: 400;
		cursor: pointer;
	}

	.image-upload input {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}

	.image-list {
		padding: 0;
		margin: 0;
		list-style: none;
	}

	.image-list li {
		display: grid;
		gap: 0.625rem;
		border: 1px solid #e2e8f0;
		border-radius: 0.75rem;
		padding: 0.75rem;
	}

	.image-meta {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		color: #475569;
	}

	.image-actions {
		justify-content: flex-end;
		flex-wrap: wrap;
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

	.node-edit-sheet.reduced-motion {
		animation: none;
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
