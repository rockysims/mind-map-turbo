<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { APP_CONFIG } from '$lib/appConfig';
	import { IndexedDbGraphAssetStore } from '$lib/assets/assetStore';
	import {
		downloadFileArtifact,
		OPEN_HTML_FILE_FROM_PICKER_SESSION_KEY,
		OPEN_HTML_FILE_TEXT_SESSION_KEY,
		OPEN_HTML_FILE_WINDOW_NAME_PREFIX,
		openHtmlFilePickerInNewTab,
		openHtmlTextInNewTab
	} from '$lib/browserGraphFile';
	import {
		usePersistedGraph,
		type PersistedGraph
	} from '$lib/components/ui/GraphPersistence/usePersistedGraph.svelte';
	import GraphToolbar from '$lib/components/ui/GraphToolbar/GraphToolbar.svelte';
	import Multigraph from '$lib/components/ui/Multigraph/Multigraph.svelte';
	import { createDefaultGraph, shouldEditInitialRootTitle } from '$lib/defaultGraph';
	import { documentStatusHasUndownloadedChanges } from '$lib/documentStatus';
	import type { EmbeddedDocumentConflictChoice } from '$lib/graphPersistenceController';
	import {
		GRAPH_HTML_PAYLOAD_SCRIPT_ID,
		parseGraphFileText,
		type GraphFileDocument
	} from '$lib/graphFile';
	import {
		appUrlWithoutGraphRoute,
		DEFAULT_GRAPH_ID,
		graphHash,
		graphIdFromUrl,
		graphRouteModeForProtocol,
		graphSearch,
		urlWithoutHash
	} from '$lib/graphRoute';
	import {
		cleanExportHtmlShell,
		EXPORT_HTML_SHELL_WINDOW_KEY,
		isSelfContainedHtmlShell,
		OFFLINE_APP_SHELL_PATH
	} from '$lib/htmlShell';
	import { createPersistence, estimateNamespaceUsageBytes } from '$lib/persistence';
	import { SaveScheduler } from '$lib/saveScheduler';
	import { resolveGraphStorage, type StorageDurability } from '$lib/storageAvailability';

	const EDIT_ROOT_PARAM = 'editRoot';
	const STARTUP_ERROR_NOTICE =
		'The app could not start in this browser, so your work cannot be saved here. Try reloading, or open it in another browser.';

	let persisted = $state<PersistedGraph | null>(null);
	let storageDurability = $state<StorageDurability>('durable');
	let startupError = $state<string | null>(null);
	let graphAssetStore = $state<IndexedDbGraphAssetStore | null>(null);
	let selectedGraphId = $state(graphIdFromUrl(page.url));
	let initialTitleEditNodeId = $state<string | null>(null);
	let embeddedDocumentConflict = $state<{
		documentId: string;
		resolve: (choice: EmbeddedDocumentConflictChoice) => void;
	} | null>(null);
	const defaultPrimaryNodeId = $derived(persisted?.graph.nodes[0]?.id ?? '');

	onMount(() => {
		try {
			selectedGraphId = graphIdFromUrl(
				new URL(window.location.href),
				graphRouteModeForProtocol(window.location.protocol)
			);

			// Reading window.localStorage throws outright in browsers configured to
			// block site data, so the app never touches it directly: it runs on
			// whatever storage this resolves to, in memory if it has to.
			const { storage, durability } = resolveGraphStorage();
			storageDurability = durability;

			const persistence = createPersistence('local', {
				storage,
				namespace: APP_CONFIG.persistence.storageNamespace
			});
			const assetStore = new IndexedDbGraphAssetStore();
			graphAssetStore = assetStore;

			const selectedGraphFileText = consumeOpenFileWindowName() ?? consumeOpenFileText();
			const embeddedGraph =
				readSelectedGraphDocument(selectedGraphFileText) ?? readEmbeddedGraphDocument();
			const openedFromFilePicker =
				selectedGraphFileText !== null || consumeOpenFileFromPickerFlag();

			const persistedGraph = usePersistedGraph({
				persistence,
				createScheduler: (onStatus) =>
					new SaveScheduler({
						persistence,
						debounceMs: APP_CONFIG.persistence.saveDebounceMs,
						estimateUsageBytes: () =>
							estimateNamespaceUsageBytes(storage, APP_CONFIG.persistence.storageNamespace),
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
							`${urlWithoutHash(window.location.href)}${graphHash(graphId)}`
						);
						return;
					}

					const currentPath = appUrlWithoutGraphRoute(window.location.href);
					window.history.pushState(
						window.history.state,
						'',
						`${currentPath}${graphId === DEFAULT_GRAPH_ID ? '' : graphSearch(graphId)}`
					);
				},
				storageNamespace: APP_CONFIG.persistence.storageNamespace,
				durability,
				confirmGraphImportReplace: ({ loadedGraphId }) =>
					window.confirm(
						`Replace the current graph "${loadedGraphId}" with the imported graph? This cannot be undone.`
					),
				minScale: APP_CONFIG.multigraph.zoom.minScale,
				maxScale: APP_CONFIG.multigraph.zoom.maxScale,
				assetStore,
				createDocumentId: () =>
					typeof crypto.randomUUID === 'function'
						? crypto.randomUUID()
						: `doc-${Date.now().toString(36)}`,
				openUnsupportedHtmlFile: openHtmlTextInNewTab,
				chooseEmbeddedDocumentConflict: ({ documentId }) =>
					new Promise<EmbeddedDocumentConflictChoice>((resolve) => {
						embeddedDocumentConflict = { documentId, resolve };
					})
			});
			persisted = persistedGraph;
			void loadRouteGraph(persistedGraph, embeddedGraph, {
				flushCurrent: false,
				openedFromPicker: openedFromFilePicker
			});

			const onStorage = (event: StorageEvent) => {
				void persistedGraph.handleStorageEvent({ key: event.key });
			};
			const onRouteChange = () => {
				void loadRouteGraph(persistedGraph, embeddedGraph, { flushCurrent: true });
			};
			const onBeforeUnload = (event: BeforeUnloadEvent) => {
				if (!hasUnsafeUnsavedChanges()) return;
				event.preventDefault();
				event.returnValue = '';
			};

			window.addEventListener('storage', onStorage);
			window.addEventListener('hashchange', onRouteChange);
			window.addEventListener('popstate', onRouteChange);
			window.addEventListener('beforeunload', onBeforeUnload);

			return () => {
				persistedGraph.dispose();
				window.removeEventListener('storage', onStorage);
				window.removeEventListener('hashchange', onRouteChange);
				window.removeEventListener('popstate', onRouteChange);
				window.removeEventListener('beforeunload', onBeforeUnload);
			};
		} catch {
			// Startup itself failed. Say so instead of leaving a blank page that
			// looks like it is still loading.
			startupError = STARTUP_ERROR_NOTICE;
			return undefined;
		}
	});

	/**
	 * True only when leaving would lose work: undownloaded changes that are not
	 * safely in durable storage. Refreshing a saved draft must stay silent.
	 */
	function hasUnsafeUnsavedChanges(): boolean {
		if (persisted === null) return false;
		if (!documentStatusHasUndownloadedChanges(persisted.documentStatus)) return false;
		return !persisted.draftSaved || storageDurability === 'memory-only';
	}

	function createNewGraph(): void {
		openNewGraphInNewTab();
	}

	function openGraphFilePicker(): void {
		openHtmlFilePickerInNewTab(appUrlWithoutGraphRoute(window.location.href));
	}

	function consumeOpenFileFromPickerFlag(): boolean {
		try {
			const openedFromPicker =
				sessionStorage.getItem(OPEN_HTML_FILE_FROM_PICKER_SESSION_KEY) === '1';
			sessionStorage.removeItem(OPEN_HTML_FILE_FROM_PICKER_SESSION_KEY);
			return openedFromPicker;
		} catch {
			return false;
		}
	}

	function consumeOpenFileWindowName(): string | null {
		if (!window.name.startsWith(OPEN_HTML_FILE_WINDOW_NAME_PREFIX)) return null;
		const payload = window.name.slice(OPEN_HTML_FILE_WINDOW_NAME_PREFIX.length);
		window.name = '';
		try {
			const parsed = JSON.parse(payload) as { text?: unknown };
			return typeof parsed.text === 'string' ? parsed.text : null;
		} catch {
			return null;
		}
	}

	function consumeOpenFileText(): string | null {
		try {
			const text = sessionStorage.getItem(OPEN_HTML_FILE_TEXT_SESSION_KEY);
			sessionStorage.removeItem(OPEN_HTML_FILE_TEXT_SESSION_KEY);
			return text;
		} catch {
			return null;
		}
	}

	function resolveEmbeddedDocumentConflict(choice: EmbeddedDocumentConflictChoice): void {
		const conflict = embeddedDocumentConflict;
		if (conflict === null) return;
		embeddedDocumentConflict = null;
		conflict.resolve(choice);
	}

	async function loadRouteGraph(
		persistedGraph: PersistedGraph,
		embeddedGraph: GraphFileDocument | null,
		options: { flushCurrent: boolean; openedFromPicker?: boolean }
	): Promise<void> {
		const graphId = graphIdFromUrl(
			new URL(window.location.href),
			graphRouteModeForProtocol(window.location.protocol)
		);
		if (graphId === selectedGraphId && persistedGraph.loadedGraphId !== '') return;
		selectedGraphId = graphId;
		if (embeddedGraph?.documentId && graphId === DEFAULT_GRAPH_ID) {
			initialTitleEditNodeId = null;
			await persistedGraph.loadEmbeddedDocument(embeddedGraph, {
				openedFromPicker: options.openedFromPicker
			});
			return;
		}
		const loadResult = await persistedGraph.load(graphId, options);
		const requestedRootEdit = shouldEditRootTitleFromUrl();
		const shouldEditRoot = shouldEditInitialRootTitle({
			graphId,
			requestedByUrl: requestedRootEdit,
			createdDefaultGraph: loadResult.createdDefaultGraph
		});
		initialTitleEditNodeId = shouldEditRoot ? 'n0' : null;
		if (requestedRootEdit) removeEditRootTitleFlagFromUrl();
	}

	async function handleDownload(): Promise<void> {
		if (!persisted) return;
		downloadFileArtifact(await persisted.exportGraphDocument(await exportHtmlShell()));
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

	function readSelectedGraphDocument(text: string | null): GraphFileDocument | null {
		if (text === null) return null;
		try {
			return parseGraphFileText(text, {
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

	function capturedExportHtmlShell(): string | null {
		const captured = window[EXPORT_HTML_SHELL_WINDOW_KEY];
		return typeof captured === 'string' ? cleanExportHtmlShell(captured) : null;
	}

	function currentHtmlShellWithoutEmbeddedGraph(): string {
		const html = document.documentElement.cloneNode(true) as HTMLElement;
		html.querySelector(`#${GRAPH_HTML_PAYLOAD_SCRIPT_ID}`)?.remove();
		const appRoot = html.querySelector('body > div');
		if (appRoot) {
			for (const child of [...appRoot.childNodes]) {
				if (
					child.nodeType === Node.ELEMENT_NODE &&
					(child as Element).tagName.toLowerCase() === 'script'
				) {
					continue;
				}
				child.remove();
			}
		}
		return `<!doctype html>\n${html.outerHTML}`;
	}

	function openNewGraphInNewTab(): void {
		const graphId =
			typeof crypto.randomUUID === 'function'
				? `graph-${crypto.randomUUID()}`
				: `graph-${Date.now().toString(36)}`;
		const routeMode = graphRouteModeForProtocol(window.location.protocol);
		if (
			routeMode === 'hash' &&
			(window.location.protocol === 'file:' || window.location.protocol === 'blob:')
		) {
			window.open(
				`${urlWithoutHash(window.location.href)}${graphHash(graphId, { editRoot: true })}`,
				'_blank'
			);
			return;
		}
		if (routeMode === 'hash' && isSelfContainedHtmlShell(currentHtmlShell())) {
			openHtmlTextInNewTab(
				currentHtmlShellWithoutEmbeddedGraph(),
				graphHash(graphId, { editRoot: true })
			);
			return;
		}

		const currentPath = appUrlWithoutGraphRoute(window.location.href);
		window.open(
			`${currentPath}${
				routeMode === 'hash'
					? graphHash(graphId, { editRoot: true })
					: graphSearch(graphId, { editRoot: true })
			}`,
			'_blank'
		);
	}

	function shouldEditRootTitleFromUrl(): boolean {
		const url = new URL(window.location.href);
		const routeMode = graphRouteModeForProtocol(window.location.protocol);
		if (routeMode === 'hash') {
			const hash = url.hash.slice(1);
			if (hash.startsWith('/')) {
				return new URL(hash, 'https://hash-route.local').searchParams.get(EDIT_ROOT_PARAM) === '1';
			}
			const params = new SvelteURLSearchParams(hash.startsWith('?') ? hash.slice(1) : hash);
			return params.get(EDIT_ROOT_PARAM) === '1';
		}
		return url.searchParams.get(EDIT_ROOT_PARAM) === '1';
	}

	function removeEditRootTitleFlagFromUrl(): void {
		const url = new URL(window.location.href);
		const routeMode = graphRouteModeForProtocol(window.location.protocol);
		if (routeMode === 'hash') {
			const hash = url.hash.slice(1);
			if (hash.startsWith('/')) {
				const hashRoute = new URL(hash, 'https://hash-route.local');
				hashRoute.searchParams.delete(EDIT_ROOT_PARAM);
				window.history.replaceState(
					window.history.state,
					'',
					`${urlWithoutHash(url.href)}#${hashRoute.pathname}${hashRoute.search}`
				);
				return;
			}
			const params = new SvelteURLSearchParams(hash.startsWith('?') ? hash.slice(1) : hash);
			params.delete(EDIT_ROOT_PARAM);
			window.history.replaceState(
				window.history.state,
				'',
				`${urlWithoutHash(url.href)}#${params}`
			);
			return;
		}
		url.searchParams.delete(EDIT_ROOT_PARAM);
		window.history.replaceState(window.history.state, '', url);
	}

	async function exportHtmlShell(): Promise<string> {
		const capturedShell = capturedExportHtmlShell();
		if (capturedShell !== null && isSelfContainedHtmlShell(capturedShell)) {
			return capturedShell;
		}

		const currentShell = currentHtmlShell();
		if (isSelfContainedHtmlShell(currentShell)) return currentHtmlShellWithoutEmbeddedGraph();

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
		notice={startupError ?? persisted?.notice ?? 'Loading graph...'}
		severity={startupError !== null ? 'warning' : (persisted?.noticeSeverity ?? 'info')}
		onNewGraph={createNewGraph}
		onOpenGraphFilePicker={openGraphFilePicker}
		onDownload={() => void handleDownload()}
	/>

	{#if embeddedDocumentConflict !== null}
		<div
			class="conflict-layer"
			role="alertdialog"
			aria-labelledby="conflict-title"
			aria-modal="true"
		>
			<section class="conflict-panel">
				<h2 id="conflict-title">Local edits found</h2>
				<p>This browser has local edits for this graph. What do you want to open?</p>
				<div class="conflict-actions">
					<button type="button" onclick={() => resolveEmbeddedDocumentConflict('recover-draft')}>
						Recover local edits
					</button>
					<button
						type="button"
						class="primary"
						onclick={() => resolveEmbeddedDocumentConflict('open-file')}
					>
						Open selected file
					</button>
				</div>
			</section>
		</div>
	{/if}

	{#if persisted !== null}
		{#key `${persisted.loadedGraphId}:${persisted.graphGeneration}`}
			<Multigraph
				multigraphData={persisted.graph}
				graphGeneration={persisted.graphGeneration}
				initialViewState={persisted.viewState}
				{initialTitleEditNodeId}
				{defaultPrimaryNodeId}
				assetStore={graphAssetStore}
				assetScope={persisted.loadedGraphId}
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

	.conflict-layer {
		position: fixed;
		inset: 0;
		z-index: 80;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: rgb(15 23 42 / 32%);
	}

	.conflict-panel {
		display: grid;
		gap: 1rem;
		width: min(100%, 28rem);
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		padding: 1rem;
		background: white;
		box-shadow: 0 20px 60px rgb(15 23 42 / 24%);
	}

	.conflict-panel h2,
	.conflict-panel p {
		margin: 0;
	}

	.conflict-panel h2 {
		color: #0f172a;
		font-size: 1.125rem;
	}

	.conflict-panel p {
		color: #475569;
	}

	.conflict-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	.conflict-actions button {
		min-height: 2.5rem;
		border: 0;
		border-radius: 999px;
		padding: 0.625rem 0.875rem;
		background: #e2e8f0;
		color: #0f172a;
		font: inherit;
		cursor: pointer;
	}

	.conflict-actions button.primary {
		background: #0f172a;
		color: white;
	}
</style>
