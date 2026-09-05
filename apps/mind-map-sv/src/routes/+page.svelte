<script lang="ts">
	import { page } from '$app/state';
	import { onMount, tick } from 'svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { APP_CONFIG } from '$lib/appConfig';
	import { BUILD_STAMP_META_NAME, formatBuildStamp, parseBuildStamp } from '$lib/buildInfo';
	import {
		defaultAiSettings,
		forgetAiKey,
		loadAiSettings,
		saveAiSettings,
		type AiKeyValidation,
		type AiSettings
	} from '$lib/ai/aiSettings';
	import { createAnthropicClient } from '$lib/ai/anthropicClient';
	import { createPyExecutor, type PyExecutor } from '$lib/ai/pyExecutor';
	import { IndexedDbGraphAssetStore } from '$lib/assets/assetStore';
	import {
		downloadFileArtifact,
		OPEN_HTML_FILE_FROM_PICKER_SESSION_KEY,
		OPEN_HTML_FILE_TEXT_SESSION_KEY,
		OPEN_HTML_FILE_WINDOW_NAME_PREFIX,
		openHtmlFilePickerInNewTab,
		openHtmlTextInNewTab,
		readFileText
	} from '$lib/browserGraphFile';
	import {
		usePersistedGraph,
		type PersistedGraph
	} from '$lib/components/ui/GraphPersistence/usePersistedGraph.svelte';
	import AiSettingsSheet from '$lib/components/ui/AiSettingsSheet/AiSettingsSheet.svelte';
	import GraphToolbar from '$lib/components/ui/GraphToolbar/GraphToolbar.svelte';
	import Multigraph from '$lib/components/ui/Multigraph/Multigraph.svelte';
	import RevertBanner from '$lib/components/ui/RevertBanner/RevertBanner.svelte';
	import { createDefaultGraph, shouldEditInitialRootTitle } from '$lib/defaultGraph';
	import { documentStatusHasUnsavedChanges } from '$lib/documentStatus';
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
	import {
		createPersistence,
		estimateNamespaceUsageBytes,
		type StorageLike
	} from '$lib/persistence';
	import { SaveScheduler } from '$lib/saveScheduler';
	import { resolveGraphStorage, type StorageDurability } from '$lib/storageAvailability';

	const EDIT_ROOT_PARAM = 'editRoot';
	// Written as short sentences: the toolbar stacks one per line, so each has to
	// stand on its own in a notice column narrower than the message used to be.
	const STARTUP_ERROR_NOTICE =
		'The app could not start. Try reloading the page. Another browser may work.';

	/**
	 * Which app build this document holds, read once from the shell's meta tag.
	 * Kept raw — exports record it verbatim so a later reader can compare it,
	 * which a display string could not support. Null on the dev server, which
	 * injects no stamp.
	 */
	let appBuildStamp: string | null = null;

	let persisted = $state<PersistedGraph | null>(null);
	/**
	 * Why the canvas is refusing an undo right now, or `null`. Reported outward by
	 * the canvas so the toolbar disables and explains from exactly the judgement
	 * the keyboard shortcut obeys.
	 */
	let historyGuardReason = $state<string | null>(null);

	const undoBlockedReason = $derived(
		historyGuardReason ?? 'Nothing to undo. Opened files start fresh.'
	);
	const redoBlockedReason = $derived(historyGuardReason ?? 'Nothing to redo.');

	let storageDurability = $state<StorageDurability>('durable');
	/**
	 * The AI key and run preferences, on the same storage the graph resolved to
	 * (a browser that blocks site data keeps them for the tab and asks again),
	 * but under their own key outside the graph namespace. Held here rather than
	 * per graph because one key serves every `!ai` node in every graph.
	 */
	let aiSettings = $state<AiSettings>(defaultAiSettings());
	let aiSettingsStorage: StorageLike | null = null;
	let aiSheetOpen = $state(false);
	const aiConnected = $derived((aiSettings.apiKey ?? '') !== '');
	/**
	 * The Messages client, rebuilt whenever the key or the model moves.
	 *
	 * `null` without a key, which is how everything downstream knows there is
	 * nothing to run yet: no component holds the key, only the client built from
	 * it. Cheap to rebuild — the client is a closure over `fetch`.
	 */
	const aiClient = $derived.by(() => {
		const apiKey = aiSettings.apiKey ?? '';
		return apiKey === '' ? null : createAnthropicClient({ apiKey, model: aiSettings.model });
	});
	/**
	 * One Python executor for the page's lifetime, built on mount so nothing is
	 * constructed during SSR. It loads the runtime on first use and keeps it
	 * across every run of every AI node; only this page ever disposes it.
	 */
	let aiExecutor = $state<PyExecutor | null>(null);
	/**
	 * What to do once a key arrives, parked by a run that stopped for the want of
	 * one. Cleared whichever way the sheet closes, so a Connect the reader made
	 * for their own reasons never starts a run they did not ask for twice.
	 */
	let aiConnectContinuation: (() => void) | null = null;
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
		appBuildStamp = readBuildStampMeta();
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

			aiSettingsStorage = storage;
			aiSettings = loadAiSettings(storage).settings;

			const persistence = createPersistence('local', {
				storage,
				namespace: APP_CONFIG.persistence.storageNamespace
			});
			const assetStore = new IndexedDbGraphAssetStore();
			graphAssetStore = assetStore;
			// Constructing it downloads nothing: the runtime loads on the first run
			// of the first AI node, and stays loaded for every run after that.
			aiExecutor = createPyExecutor();

			const selectedGraphFileText = consumeOpenFileWindowName() ?? consumeOpenFileText();
			const embeddedGraph =
				readSelectedGraphDocument(selectedGraphFileText) ?? readEmbeddedGraphDocument();
			const openedFromFilePicker =
				selectedGraphFileText !== null || consumeOpenFileFromPickerFlag();

			const persistedGraph = usePersistedGraph({
				appVersion: appBuildStamp ?? undefined,
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
			// Camera moves no longer schedule a cache write of their own, so leaving
			// the page is where the current pan/zoom (and any still-debounced edit)
			// has to reach the cache. 'visibilitychange' covers mobile, where a tab
			// can be discarded without ever firing 'pagehide'.
			const onPageHide = () => {
				void persistedGraph.flushPendingSave();
			};
			const onVisibilityChange = () => {
				if (document.visibilityState === 'hidden') onPageHide();
			};

			window.addEventListener('storage', onStorage);
			window.addEventListener('hashchange', onRouteChange);
			window.addEventListener('popstate', onRouteChange);
			window.addEventListener('beforeunload', onBeforeUnload);
			window.addEventListener('pagehide', onPageHide);
			document.addEventListener('visibilitychange', onVisibilityChange);

			return () => {
				persistedGraph.dispose();
				window.removeEventListener('storage', onStorage);
				window.removeEventListener('hashchange', onRouteChange);
				window.removeEventListener('popstate', onRouteChange);
				window.removeEventListener('beforeunload', onBeforeUnload);
				window.removeEventListener('pagehide', onPageHide);
				document.removeEventListener('visibilitychange', onVisibilityChange);
			};
		} catch {
			// Startup itself failed. Say so instead of leaving a blank page that
			// looks like it is still loading.
			startupError = STARTUP_ERROR_NOTICE;
			return undefined;
		}
	});

	/**
	 * True only when leaving would lose work: unsaved changes that are not even
	 * safely cached. Refreshing a cached draft must stay silent.
	 */
	function hasUnsafeUnsavedChanges(): boolean {
		if (persisted === null) return false;
		if (!documentStatusHasUnsavedChanges(persisted.documentStatus)) return false;
		return !persisted.draftCached || storageDurability === 'memory-only';
	}

	function createNewGraph(): void {
		openNewGraphInNewTab();
	}

	function saveAiSettingsChange(next: AiSettings): void {
		aiSettings = next;
		if (aiSettingsStorage === null) return;
		saveAiSettings(aiSettingsStorage, next);
	}

	function forgetAiSettingsKey(): void {
		aiSettings = { ...aiSettings, apiKey: undefined };
		if (aiSettingsStorage === null) return;
		forgetAiKey(aiSettingsStorage);
	}

	/**
	 * Check the key the reader just typed with a throwaway client built from it —
	 * not the page's own, which is still built from whatever key was there
	 * before, and may be no key at all. The client sends the cheapest Messages
	 * call there is, because the models endpoint refuses browsers.
	 */
	async function validateAiKey(key: string): Promise<AiKeyValidation> {
		if (key === '') return { ok: false, message: 'Enter a key to connect.' };
		return createAnthropicClient({ apiKey: key, model: aiSettings.model }).validateKey(key);
	}

	/** Open the key sheet, remembering what a run wanted to do once it closes. */
	function openAiSettings(afterConnect?: () => void): void {
		aiConnectContinuation = afterConnect ?? null;
		aiSheetOpen = true;
	}

	function closeAiSettings(): void {
		aiSheetOpen = false;
		aiConnectContinuation = null;
	}

	/**
	 * Connect saved a key. Resume whatever was waiting on it, after a tick, so the
	 * client derived from the new settings is the one the resumed run picks up.
	 */
	async function continueAfterAiConnect(): Promise<void> {
		aiSheetOpen = false;
		const resume = aiConnectContinuation;
		aiConnectContinuation = null;
		if (resume === null) return;
		await tick();
		resume();
	}

	function openGraphFilePicker(): void {
		openHtmlFilePickerInNewTab(
			appUrlWithoutGraphRoute(window.location.href),
			formatBuildStamp(parseBuildStamp(appBuildStamp))
		);
	}

	function readBuildStampMeta(): string | null {
		return (
			document.querySelector(`meta[name="${BUILD_STAMP_META_NAME}"]`)?.getAttribute('content') ??
			null
		);
	}

	/**
	 * Fold a chosen file into the graph on screen. Read here rather than through
	 * the picker tab Open uses: that tab reloads the app to hand the file over,
	 * and this import is meant to keep the reader exactly where they are.
	 */
	async function importGraphFile(file: File): Promise<void> {
		await persisted?.importGraphIntoCurrentFromReader(() => readFileText(file));
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

	async function handleSave(): Promise<void> {
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
		onImportGraphFile={(file) => void importGraphFile(file)}
		onSave={() => void handleSave()}
		canUndo={(persisted?.canUndo ?? false) && historyGuardReason === null}
		canRedo={(persisted?.canRedo ?? false) && historyGuardReason === null}
		undoLabel={persisted?.undoLabel ?? null}
		redoLabel={persisted?.redoLabel ?? null}
		{undoBlockedReason}
		{redoBlockedReason}
		onUndo={() => persisted?.undo()}
		onRedo={() => persisted?.redo()}
		onBlockedAction={(reason) => persisted?.reportBlockedAction(reason)}
		{aiConnected}
		onOpenAiSettings={() => openAiSettings()}
	/>

	{#if aiSheetOpen}
		<AiSettingsSheet
			settings={aiSettings}
			connected={aiConnected}
			validateKey={validateAiKey}
			onSave={saveAiSettingsChange}
			onForget={forgetAiSettingsKey}
			onClose={closeAiSettings}
			onConnected={() => void continueAfterAiConnect()}
		/>
	{/if}

	{#if persisted !== null && persisted.snapshot !== null}
		<RevertBanner
			label={persisted.snapshot.label}
			createdAt={persisted.snapshot.createdAt}
			addedNodeCount={persisted.snapshot.addedNodeCount}
			onRevert={() => void persisted?.revertToSnapshot()}
			onDismiss={() => persisted?.dismissSnapshot()}
		/>
	{/if}

	{#if embeddedDocumentConflict !== null}
		<div
			class="conflict-layer"
			role="alertdialog"
			aria-labelledby="conflict-title"
			aria-modal="true"
		>
			<section class="conflict-panel">
				<h2 id="conflict-title">Cached edits found</h2>
				<p>This browser has cached edits for this graph. What do you want to open?</p>
				<div class="conflict-actions">
					<button type="button" onclick={() => resolveEmbeddedDocumentConflict('recover-draft')}>
						Recover cached edits
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
				graphRevision={persisted.graphRevision}
				restoredCanvasState={persisted.restoredCanvasState}
				initialViewState={persisted.viewState}
				{initialTitleEditNodeId}
				{defaultPrimaryNodeId}
				assetStore={graphAssetStore}
				assetScope={persisted.loadedGraphId}
				{aiClient}
				{aiExecutor}
				{aiSettings}
				onOpenAiSettings={openAiSettings}
				onMultigraphChange={(graph, generation, intent) =>
					persisted?.notifyGraphChanged(graph, { syncView: true, generation, intent })}
				onViewStateChange={(viewState) =>
					persisted?.notifyViewStateChanged(viewState, { syncView: true })}
				onHistoryGuardChange={(reason) => (historyGuardReason = reason)}
				onHistoryStep={(direction) =>
					direction === 'undo' ? persisted?.undo() : persisted?.redo()}
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
