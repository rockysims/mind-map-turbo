<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { APP_CONFIG } from '$lib/appConfig';
	import {
		usePersistedGraph,
		type PersistedGraph
	} from '$lib/components/ui/GraphPersistence/usePersistedGraph.svelte';
	import GraphToolbar from '$lib/components/ui/GraphToolbar/GraphToolbar.svelte';
	import Multigraph from '$lib/components/ui/Multigraph/Multigraph.svelte';
	import type { MultigraphData } from '$lib/components/ui/types/multigraph';
	import { DEFAULT_GRAPH_ID, resolveGraphHref } from '$lib/graphRoute';
	import { createPersistence, estimateNamespaceUsageBytes } from '$lib/persistence';
	import { SaveScheduler } from '$lib/saveScheduler';
	import type { PageData } from './$types';

	// Safe to import at module level: functions only use DOM APIs when called,
	// not at import time, so SSR paths never touch Blob/FileReader/anchor.
	import { downloadTextFile, readFileText } from '$lib/browserGraphFile';

	let { data }: { data: PageData } = $props();

	let persisted = $state<PersistedGraph | null>(null);
	let hasRequestedInitialLoad = $state(false);
	const selectedGraphId = $derived(page.url.searchParams.get('graph') ?? DEFAULT_GRAPH_ID);
	const defaultPrimaryNodeId = $derived(persisted?.graph.nodes[0]?.id ?? '');

	$effect(() => {
		if (persisted === null) return;
		const graphId = selectedGraphId;
		if (persisted.loadedGraphId === '' && hasRequestedInitialLoad) return;
		if (graphId === persisted.loadedGraphId) return;
		void persisted.load(graphId, { flushCurrent: persisted.loadedGraphId !== '' });
	});

	onMount(() => {
		const persistence = createPersistence(data.persistenceKind, {
			storage: localStorage,
			namespace: APP_CONFIG.persistence.storageNamespace,
			fetchGraph: window.fetch.bind(window)
		});
		const persistedGraph = usePersistedGraph({
			persistence,
			createScheduler: (onStatus) =>
				new SaveScheduler({
					persistence,
					debounceMs: APP_CONFIG.persistence.saveDebounceMs,
					estimateUsageBytes: () =>
						estimateNamespaceUsageBytes(localStorage, APP_CONFIG.persistence.storageNamespace),
					quotaBudgetBytes: APP_CONFIG.persistence.quotaBudgetBytes,
					quotaWarningRatio: APP_CONFIG.persistence.quotaWarningRatio,
					onStatus
				}),
			createDefaultGraph,
			navigate: (graphId) =>
				// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolveGraphHref delegates the root path through SvelteKit's resolve().
				goto(resolveGraphHref(resolve, graphId)),
			storageNamespace: APP_CONFIG.persistence.storageNamespace,
			confirmGraphImportReplace: ({ loadedGraphId }) =>
				window.confirm(
					`Replace the current graph "${loadedGraphId}" with the imported graph? This cannot be undone.`
				),
			minScale: APP_CONFIG.multigraph.zoom.minScale,
			maxScale: APP_CONFIG.multigraph.zoom.maxScale
		});
		persisted = persistedGraph;
		hasRequestedInitialLoad = true;
		void persistedGraph.load(selectedGraphId, { flushCurrent: false });

		const onStorage = (event: StorageEvent) => {
			void persistedGraph.handleStorageEvent({ key: event.key });
		};

		window.addEventListener('storage', onStorage);

		return () => {
			persistedGraph.dispose();
			window.removeEventListener('storage', onStorage);
		};
	});

	function createDefaultGraph(): MultigraphData {
		return {
			nodes: [{ id: 'n0', title: 'Node 0', description: 'Description for node 0' }],
			edges: [],
			posByNodeId: { n0: { x: 0, y: 0 } }
		};
	}

	function handleGraphSelection(graphId: string): void {
		void persisted?.selectGraph(graphId);
	}

	function createNewGraph(): void {
		void persisted?.createGraph();
	}

	async function deleteSelectedGraph(): Promise<void> {
		await persisted?.deleteGraph(selectedGraphId);
	}

	function handleExport(): void {
		if (!persisted) return;
		const json = persisted.exportGraphDocument();
		const graphId = persisted.loadedGraphId || DEFAULT_GRAPH_ID;
		downloadTextFile(json, `${graphId}.json`);
	}

	async function handleImport(file: File): Promise<void> {
		await persisted?.importGraphDocumentFromReader(() => readFileText(file));
	}
</script>

<div class="page-shell">
	<GraphToolbar
		{selectedGraphId}
		graphSummaries={persisted?.graphSummaries ?? []}
		notice={persisted?.notice ?? 'Loading graph...'}
		onGraphSelected={handleGraphSelection}
		onNewGraph={createNewGraph}
		onDeleteGraph={() => void deleteSelectedGraph()}
		onExport={handleExport}
		onImport={(file) => void handleImport(file)}
	/>

	{#if persisted !== null}
		{#key `${persisted.loadedGraphId}:${persisted.graphGeneration}`}
			<Multigraph
				multigraphData={persisted.graph}
				graphGeneration={persisted.graphGeneration}
				initialViewState={persisted.viewState}
				{defaultPrimaryNodeId}
				onMultigraphChange={(graph) => persisted?.notifyGraphChanged(graph, { syncView: true })}
				onViewStateChange={(viewState) =>
					persisted?.notifyViewStateChanged(viewState, { syncView: true })}
			/>
		{/key}
	{/if}
</div>

<style>
	.page-shell {
		position: relative;
		min-height: 100vh;
	}
</style>
