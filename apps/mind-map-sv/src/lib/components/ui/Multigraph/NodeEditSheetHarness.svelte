<script lang="ts">
	/**
	 * Holds a graph so an edit-sheet story can watch a real edit land.
	 *
	 * The sheet only reports what the reader did; the mutations belong to
	 * `lib/graph.ts` and the storage to the canvas. Stories about "attach a CSV
	 * and see a row" need both halves, so this harness supplies the missing one —
	 * the same pure functions `Multigraph.svelte` calls, over a graph in `$state`,
	 * with a fake asset id in place of the IndexedDB write.
	 *
	 * What the story asserts on comes back as `data-*` attributes beside the
	 * sheet: `data-last-intent` is the label the commit would carry into the undo
	 * list, and the node's title, tags and add-ons are the committed values.
	 */
	import { untrack } from 'svelte';
	import NodeEditSheet from './NodeEditSheet.svelte';
	import type { GraphAssetMetadata, MultigraphData } from '../types/multigraph';
	import type { NodeContentBlock, QuantityDesignation } from '../types/node';
	import {
		addNodeContentBlock,
		commitSheetTitleSyntax,
		moveNodeContentBlock,
		removeNodeAddon,
		removeNodeContentBlock,
		setNodeAddon,
		updateNodeContent,
		updateNodeFileContent,
		updateNodeImageContent
	} from './lib/graph';
	import { addonIntentLabel, type NodeAddonName } from './lib/nodeAddons';

	let {
		baseGraph,
		nodeId,
		confirmAttachment,
		warnBytesPerFile,
		storeFails = false
	}: {
		baseGraph: MultigraphData;
		nodeId: string;
		confirmAttachment?: (message: string) => boolean;
		warnBytesPerFile?: number;
		/** Makes the fake asset store refuse, the way a full quota would. */
		storeFails?: boolean;
	} = $props();

	// Seeded once and owned from then on: the story states a starting graph, and
	// every later value is one this harness committed. `untrack` says that the
	// initial read is deliberate rather than a missed dependency.
	let graph = $state(untrack(() => baseGraph));
	let lastIntent = $state('');
	let assetSequence = 0;

	const node = $derived(graph.nodes.find((candidate) => candidate.id === nodeId));

	function commit(next: MultigraphData, intent: string) {
		graph = next;
		lastIntent = intent;
	}

	/** The canvas's `addAttachmentToNode`, minus the IndexedDB write. */
	async function addAttachment(file: File): Promise<'added' | 'store-failed'> {
		if (storeFails) return 'store-failed';
		const isImage = file.type.startsWith('image/');
		assetSequence += 1;
		const assetId = `asset-${assetSequence}`;
		const asset: GraphAssetMetadata = {
			id: assetId,
			kind: isImage ? 'image' : 'file',
			mimeType: file.type,
			name: file.name,
			size: file.size,
			createdAt: 1
		};
		const block: NodeContentBlock = isImage
			? { type: 'image', assetId, alt: file.name }
			: { type: 'file', assetId, name: file.name };
		commit(addNodeContentBlock(graph, nodeId, block, asset), isImage ? 'add image' : 'add file');
		return 'added';
	}

	function save(content: {
		title: string;
		description: string;
		tags: string[];
		inputs: QuantityDesignation[];
		outputs: QuantityDesignation[];
	}) {
		const withFields = updateNodeContent(graph, nodeId, content);
		commit(commitSheetTitleSyntax(withFields, nodeId, content.title, content.tags), 'edit node');
	}
</script>

{#if node}
	<div
		data-edit-sheet-harness
		data-last-intent={lastIntent}
		data-node-title={node.title}
		data-node-tags={node.tags.join(' ')}
		data-node-addons={Object.keys(node.addons ?? {}).join(' ')}
	></div>
	<NodeEditSheet
		{node}
		nodes={graph.nodes}
		edges={graph.edges}
		assets={graph.assets ?? {}}
		{confirmAttachment}
		{warnBytesPerFile}
		onSave={save}
		onAddAttachment={addAttachment}
		onSaveImage={(assetId, details) =>
			commit(updateNodeImageContent(graph, nodeId, assetId, details), 'edit image')}
		onSaveFile={(assetId, details) =>
			commit(updateNodeFileContent(graph, nodeId, assetId, details), 'edit attachment')}
		onMoveAttachment={(fromIndex, direction) =>
			commit(
				moveNodeContentBlock(graph, nodeId, fromIndex, fromIndex + direction),
				'move attachment'
			)}
		onDeleteAttachment={(assetId) =>
			commit(removeNodeContentBlock(graph, nodeId, assetId).graph, 'remove attachment')}
		onToggleAddon={(name: NodeAddonName, enabled: boolean) =>
			commit(
				enabled ? setNodeAddon(graph, nodeId, name) : removeNodeAddon(graph, nodeId, name),
				addonIntentLabel(name, enabled ? 'add' : 'remove')
			)}
		onSaveEdge={() => {}}
		onCancel={() => {}}
		onTogglePinned={() => {}}
		onDelete={() => {}}
	/>
{/if}
