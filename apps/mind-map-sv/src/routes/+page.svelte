<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { APP_CONFIG } from '$lib/appConfig';
	import { downloadFileArtifact, openHtmlTextInNewTab, readFileText } from '$lib/browserGraphFile';
	import {
		usePersistedGraph,
		type PersistedGraph
	} from '$lib/components/ui/GraphPersistence/usePersistedGraph.svelte';
	import GraphToolbar from '$lib/components/ui/GraphToolbar/GraphToolbar.svelte';
	import Multigraph from '$lib/components/ui/Multigraph/Multigraph.svelte';
	import type { MultigraphData } from '$lib/components/ui/types/multigraph';
	import {
		GRAPH_HTML_PAYLOAD_SCRIPT_ID,
		parseGraphFileText,
		type GraphFileDocument
	} from '$lib/graphFile';
	import { graphIdFromUrl, resolveGraphHref } from '$lib/graphRoute';
	import { isSelfContainedHtmlShell, OFFLINE_APP_SHELL_PATH } from '$lib/htmlShell';
	import {
		createPersistence,
		documentDraftGraphId,
		estimateNamespaceUsageBytes
	} from '$lib/persistence';
	import { SaveScheduler } from '$lib/saveScheduler';

	let persisted = $state<PersistedGraph | null>(null);
	let hasRequestedInitialLoad = $state(false);
	let selectedGraphId = $state(graphIdFromUrl(page.url));
	let activeDocumentId = $state<string | null>(null);
	const defaultPrimaryNodeId = $derived(persisted?.graph.nodes[0]?.id ?? '');

	$effect(() => {
		if (persisted === null) return;
		if (!hasRequestedInitialLoad) return;
		const graphId = selectedGraphId;
		if (graphId === persisted.loadedGraphId) return;
		void persisted.load(graphId, {
			flushCurrent: persisted.loadedGraphId !== '',
			documentId: activeDocumentId
		});
	});

	onMount(() => {
		selectedGraphId = graphIdFromUrl(new URL(window.location.href));

		const persistence = createPersistence('local', {
			storage: localStorage,
			namespace: APP_CONFIG.persistence.storageNamespace
		});

		const embeddedGraph = readEmbeddedGraphDocument();
		const initialLoad = seedEmbeddedGraphDraft(persistence, embeddedGraph);

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
			navigate: async (graphId) => {
				selectedGraphId = graphId;
				// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolveGraphHref delegates the root path through SvelteKit's resolve().
				await goto(resolveGraphHref(resolve, graphId));
			},
			storageNamespace: APP_CONFIG.persistence.storageNamespace,
			confirmGraphImportReplace: ({ loadedGraphId }) =>
				window.confirm(
					`Replace the current graph "${loadedGraphId}" with the imported graph? This cannot be undone.`
				),
			minScale: APP_CONFIG.multigraph.zoom.minScale,
			maxScale: APP_CONFIG.multigraph.zoom.maxScale,
			createDocumentId: () =>
				typeof crypto.randomUUID === 'function'
					? crypto.randomUUID()
					: `doc-${Date.now().toString(36)}`,
			openUnsupportedHtmlFile: openHtmlTextInNewTab
		});
		persisted = persistedGraph;
		void initialLoad.then(async (seeded) => {
			if (seeded) {
				selectedGraphId = seeded.graphId;
				activeDocumentId = seeded.documentId;
			}
			await persistedGraph.load(selectedGraphId, {
				flushCurrent: false,
				documentId: activeDocumentId
			});
			hasRequestedInitialLoad = true;
		});

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
			nodes: [{ id: 'n0', title: 'Node 0', description: 'Description for node 0', tags: [] }],
			edges: [],
			posByNodeId: { n0: { x: 0, y: 0 } },
			tagColorConfig: {
				nodeTags: {},
				edgeTags: {}
			}
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

	async function handleExport(): Promise<void> {
		if (!persisted) return;
		downloadFileArtifact(persisted.exportGraphDocument(await exportHtmlShell()));
	}

	async function handleImport(file: File): Promise<void> {
		await persisted?.importGraphDocumentFromReader(() => readFileText(file));
	}

	function readEmbeddedGraphDocument(): GraphFileDocument | null {
		if (document.getElementById(GRAPH_HTML_PAYLOAD_SCRIPT_ID) === null) return null;
		try {
			return parseGraphFileText(currentHtmlShell(), {
				minScale: APP_CONFIG.multigraph.zoom.minScale,
				maxScale: APP_CONFIG.multigraph.zoom.maxScale
			});
		} catch {
			return null;
		}
	}

	async function seedEmbeddedGraphDraft(
		persistence: ReturnType<typeof createPersistence>,
		doc: GraphFileDocument | null
	): Promise<{ graphId: string; documentId: string } | null> {
		if (!doc?.documentId) return null;
		const graphId = documentDraftGraphId(doc.documentId);
		const existingDraft = await persistence.load(graphId);
		if (existingDraft === null) {
			await persistence.save(graphId, {
				data: doc.data,
				viewState: doc.viewState
			});
		}
		return { graphId, documentId: doc.documentId };
	}

	function currentHtmlShell(): string {
		return `<!doctype html>\n${document.documentElement.outerHTML}`;
	}

	async function exportHtmlShell(): Promise<string> {
		const currentShell = currentHtmlShell();
		if (isSelfContainedHtmlShell(currentShell)) return currentShell;

		try {
			const response = await fetch(OFFLINE_APP_SHELL_PATH, { cache: 'no-store' });
			if (!response.ok) return currentShell;
			return await response.text();
		} catch {
			return currentShell;
		}
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
		onExport={() => void handleExport()}
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
