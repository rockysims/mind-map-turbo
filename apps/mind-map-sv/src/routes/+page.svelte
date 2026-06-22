<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { APP_CONFIG } from '$lib/appConfig';
	import { downloadFileArtifact, openHtmlTextInNewTab } from '$lib/browserGraphFile';
	import {
		usePersistedGraph,
		type PersistedGraph
	} from '$lib/components/ui/GraphPersistence/usePersistedGraph.svelte';
	import GraphToolbar from '$lib/components/ui/GraphToolbar/GraphToolbar.svelte';
	import Multigraph from '$lib/components/ui/Multigraph/Multigraph.svelte';
	import type { MultigraphData } from '$lib/components/ui/types/multigraph';
	import { newGraphConfirmationMessage } from '$lib/documentStatus';
	import {
		GRAPH_HTML_PAYLOAD_SCRIPT_ID,
		parseGraphFileText,
		type GraphFileDocument
	} from '$lib/graphFile';
	import {
		DEFAULT_GRAPH_ID,
		graphHash,
		graphIdFromUrl,
		graphRouteModeForProtocol,
		graphSearch
	} from '$lib/graphRoute';
	import { isSelfContainedHtmlShell, OFFLINE_APP_SHELL_PATH } from '$lib/htmlShell';
	import { createPersistence, estimateNamespaceUsageBytes } from '$lib/persistence';
	import { SaveScheduler } from '$lib/saveScheduler';

	let persisted = $state<PersistedGraph | null>(null);
	let selectedGraphId = $state(graphIdFromUrl(page.url));
	const defaultPrimaryNodeId = $derived(persisted?.graph.nodes[0]?.id ?? '');

	onMount(() => {
		selectedGraphId = graphIdFromUrl(
			new URL(window.location.href),
			graphRouteModeForProtocol(window.location.protocol)
		);

		const persistence = createPersistence('local', {
			storage: localStorage,
			namespace: APP_CONFIG.persistence.storageNamespace
		});

		const embeddedGraph = readEmbeddedGraphDocument();

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
				const routeMode = graphRouteModeForProtocol(window.location.protocol);
				if (routeMode === 'hash') {
					window.history.pushState(
						window.history.state,
						'',
						`${window.location.href.split('#')[0]}${graphHash(graphId)}`
					);
					return;
				}

				const currentWithoutHash = window.location.href.split('#')[0];
				const currentPath = currentWithoutHash.split('?')[0];
				window.history.pushState(
					window.history.state,
					'',
					`${currentPath}${graphId === DEFAULT_GRAPH_ID ? '' : graphSearch(graphId)}`
				);
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
			confirmNewGraphReplace: ({ documentStatus }) => {
				const message = newGraphConfirmationMessage(documentStatus);
				return message === null || window.confirm(message);
			},
			openUnsupportedHtmlFile: openHtmlTextInNewTab
		});
		persisted = persistedGraph;
		if (embeddedGraph?.documentId) {
			void persistedGraph.loadEmbeddedDocument(embeddedGraph);
		} else {
			void persistedGraph.load(selectedGraphId, { flushCurrent: false });
		}

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

	function createNewGraph(): void {
		void persisted?.createGraph();
	}

	async function handleDownload(): Promise<void> {
		if (!persisted) return;
		downloadFileArtifact(persisted.exportGraphDocument(await exportHtmlShell()));
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
		notice={persisted?.notice ?? 'Loading graph...'}
		onNewGraph={createNewGraph}
		onDownload={() => void handleDownload()}
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
