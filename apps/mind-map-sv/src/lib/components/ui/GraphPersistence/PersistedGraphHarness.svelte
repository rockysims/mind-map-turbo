<script lang="ts">
	import { onMount } from 'svelte';
	import { APP_CONFIG } from '$lib/appConfig';
	import { readFileText } from '$lib/browserGraphFile';
	import Multigraph from '$lib/components/ui/Multigraph/Multigraph.svelte';
	import GraphToolbar from '$lib/components/ui/GraphToolbar/GraphToolbar.svelte';
	import RevertBanner from '$lib/components/ui/RevertBanner/RevertBanner.svelte';
	import type { LayoutSettings } from '$lib/components/ui/Multigraph/lib/layoutSettings';
	import type { MultigraphData } from '$lib/components/ui/types/multigraph';
	import { createDefaultGraph, shouldEditInitialRootTitle } from '$lib/defaultGraph';
	import { DEFAULT_GRAPH_ID } from '$lib/graphRoute';
	import { NEUTRAL_VIEW_STATE } from '$lib/migrations';
	import { graphStorageKey, type StorageLike } from '$lib/persistence';
	import { SaveScheduler } from '$lib/saveScheduler';
	import { InMemoryPersistence } from './inMemoryPersistence';
	import { usePersistedGraph } from './usePersistedGraph.svelte';

	let {
		initialGraphId = DEFAULT_GRAPH_ID,
		graphs = {},
		layoutSettings = {},
		/** Controls whether confirmGraphImportReplace returns true or false in stories. */
		confirmResponse = true,
		/** Text to import when the "Import text" harness button is clicked. */
		simulateImportText = '',
		/** Mirrors the root route's fresh-default inline edit behavior for stories. */
		editFreshDefaultRoot = false
	}: {
		initialGraphId?: string;
		graphs?: Record<string, MultigraphData>;
		layoutSettings?: Partial<LayoutSettings>;
		confirmResponse?: boolean;
		simulateImportText?: string;
		editFreshDefaultRoot?: boolean;
	} = $props();

	let now = 0;
	const namespace = `storybook-${initialGraphIdAtMount()}`;
	/**
	 * Snapshots live in a Map here rather than in the real `localStorage`, so a
	 * story that imports leaves no revert offer behind for the next one.
	 */
	const snapshotStorage: StorageLike = createMemoryStorage();
	const persistence = new InMemoryPersistence(graphsAtMount(), () => {
		now += 1;
		return now;
	});
	let routedGraphId = $state(initialGraphIdAtMount());
	let lastDownload = $state('');
	let lastImportResult = $state('');
	let lastImportIntoCurrent = $state('');
	let initialTitleEditNodeId = $state<string | null>(null);
	const persisted = usePersistedGraph({
		persistence,
		createScheduler: (onStatus) =>
			new SaveScheduler({
				persistence,
				debounceMs: 0,
				now: () => {
					now += 1;
					return now;
				},
				estimateUsageBytes: () => 0,
				quotaBudgetBytes: APP_CONFIG.persistence.quotaBudgetBytes,
				quotaWarningRatio: APP_CONFIG.persistence.quotaWarningRatio,
				onStatus
			}),
		createDefaultGraph,
		navigate: async (graphId) => {
			routedGraphId = graphId;
			await persisted.load(graphId, { flushCurrent: false });
		},
		storageNamespace: namespace,
		snapshotStorage,
		createGraphId: () => 'graph-new',
		confirmNewGraphReplace: () => confirmResponse,
		confirmGraphImportReplace: () => confirmResponse,
		minScale: APP_CONFIG.multigraph.zoom.minScale,
		maxScale: APP_CONFIG.multigraph.zoom.maxScale
	});

	const graphIds = $derived(persisted.graphSummaries.map((summary) => summary.id).join(','));
	const primaryTitle = $derived(persisted.graph.nodes[0]?.title ?? '');
	const defaultPrimaryNodeId = $derived(persisted.graph.nodes[0]?.id ?? '');

	onMount(() => {
		void loadRoutedGraph(routedGraphId);

		return () => {
			persisted.dispose();
		};
	});

	function initialGraphIdAtMount(): string {
		return initialGraphId;
	}

	function createMemoryStorage(): StorageLike {
		const items: Record<string, string> = {};
		return {
			get length() {
				return Object.keys(items).length;
			},
			getItem: (key) => items[key] ?? null,
			setItem: (key, value) => {
				items[key] = value;
			},
			removeItem: (key) => {
				delete items[key];
			},
			key: (index) => Object.keys(items)[index] ?? null
		};
	}

	function graphsAtMount(): Record<string, MultigraphData> {
		return graphs;
	}

	async function loadRoutedGraph(graphId: string): Promise<void> {
		const loadResult = await persisted.load(graphId);
		initialTitleEditNodeId =
			editFreshDefaultRoot &&
			shouldEditInitialRootTitle({
				graphId,
				requestedByUrl: false,
				createdDefaultGraph: loadResult.createdDefaultGraph
			})
				? 'n0'
				: null;
	}

	function changeGraph(): void {
		persisted.notifyGraphChanged(renamePrimaryNode(persisted.graph, 'Changed Node'), {
			syncView: true
		});
	}

	async function simulateExternalReload(): Promise<void> {
		const graphId = persisted.loadedGraphId || routedGraphId;
		await persistence.save(graphId, {
			data: renamePrimaryNode(persisted.graph, 'Externally Reloaded'),
			viewState: { ...NEUTRAL_VIEW_STATE }
		});
		await persisted.handleStorageEvent({ key: graphStorageKey(namespace, graphId) });
	}

	function renamePrimaryNode(graph: MultigraphData, title: string): MultigraphData {
		return {
			...graph,
			nodes: graph.nodes.map((node, index) => (index === 0 ? { ...node, title } : node))
		};
	}

	async function handleDownload(): Promise<void> {
		lastDownload = (await persisted.exportGraphDocument()).content;
	}

	async function handleImportLastDownload(): Promise<void> {
		if (!lastDownload) return;
		lastImportResult = await persisted.importGraphDocument(lastDownload);
	}

	async function handleImportText(): Promise<void> {
		lastImportResult = await persisted.importGraphDocument(simulateImportText);
	}

	/** The toolbar's additive Import, taking the file exactly as the route does. */
	async function handleImportFileIntoCurrent(file: File): Promise<void> {
		const result = await persisted.importGraphIntoCurrentFromReader(() => readFileText(file));
		lastImportIntoCurrent =
			result.outcome === 'imported' ? `imported:${result.importedNodeCount}` : result.outcome;
	}
</script>

<div
	class="harness"
	data-loaded-graph-id={persisted.loadedGraphId}
	data-routed-graph-id={routedGraphId}
	data-notice={persisted.notice}
	data-graph-ids={graphIds}
	data-node-count={persisted.graph.nodes.length}
	data-primary-title={primaryTitle}
	data-graph-generation={persisted.graphGeneration}
	data-document-status={persisted.documentStatus}
	data-scale-animation-duration-ms={layoutSettings.scaleAnimationDurationMs ?? ''}
	data-last-download={lastDownload}
	data-last-import-result={lastImportResult}
	data-last-import-into-current={lastImportIntoCurrent}
	data-snapshot-label={persisted.snapshot?.label ?? ''}
	data-snapshot-node-count={persisted.snapshot?.nodeCount ?? ''}
	data-view-pan-x={persisted.viewState.panX}
	data-view-pan-y={persisted.viewState.panY}
	data-view-scale={persisted.viewState.scale}
>
	<GraphToolbar
		notice={persisted.notice}
		onNewGraph={() => void persisted.createGraph()}
		onImportGraphFile={(file) => void handleImportFileIntoCurrent(file)}
		onDownload={() => void handleDownload()}
	/>

	{#if persisted.snapshot !== null}
		<RevertBanner
			label={persisted.snapshot.label}
			createdAt={persisted.snapshot.createdAt}
			snapshotNodeCount={persisted.snapshot.nodeCount}
			currentNodeCount={persisted.graph.nodes.length}
			onRevert={() => void persisted.revertToSnapshot()}
			onDismiss={() => persisted.dismissSnapshot()}
		/>
	{/if}

	<div class="harness-actions" aria-label="Story harness controls">
		<button type="button" onclick={changeGraph}>Simulate graph change</button>
		<button type="button" onclick={() => void simulateExternalReload()}>
			Simulate external reload
		</button>
		<button type="button" onclick={() => void handleImportLastDownload()}>
			Import last download
		</button>
		{#if simulateImportText !== ''}
			<button type="button" onclick={() => void handleImportText()}>Import text</button>
		{/if}
	</div>

	{#key `${persisted.loadedGraphId}:${persisted.graphGeneration}`}
		<Multigraph
			multigraphData={persisted.graph}
			graphGeneration={persisted.graphGeneration}
			initialViewState={persisted.viewState}
			{initialTitleEditNodeId}
			{defaultPrimaryNodeId}
			{layoutSettings}
			onMultigraphChange={(graph) => persisted.notifyGraphChanged(graph, { syncView: true })}
			onViewStateChange={(viewState) =>
				persisted.notifyViewStateChanged(viewState, { syncView: true })}
		/>
	{/key}
</div>

<style>
	.harness {
		position: relative;
		min-height: 100vh;
	}

	.harness-actions {
		position: fixed;
		z-index: 41;
		right: 1rem;
		bottom: 1rem;
		display: flex;
		gap: 0.5rem;
	}

	/*
	 * Story-only placement: the phone viewport these stories run in drops the
	 * banner to the bottom of the screen, where the fixed harness controls sit on
	 * top of it and swallow the clicks a play function aims at Revert.
	 */
	.harness :global(.revert-banner) {
		top: 7rem;
		right: auto;
		bottom: auto;
		left: 0.75rem;
		transform: none;
	}
</style>
