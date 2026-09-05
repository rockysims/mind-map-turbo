import { describe, expect, it, vi } from 'vitest';
import { blobToBase64 } from './assets/assetEncoding';
import { MemoryGraphAssetStore } from './assets/assetStore';
import { tombstoneAsset } from './assets/assetTrash';
import type { GraphAssetStore } from './assets/assetStore';
import { addNode, setTagColor } from './components/ui/Multigraph/lib/graph';
import { makeGraph } from './components/ui/Multigraph/lib/testFixtures';
import type { GraphCommitIntent } from './components/ui/types/history';
import type { MultigraphData } from './components/ui/types/multigraph';
import {
	GRAPH_HTML_READER_VERSION,
	parseGraphFileText,
	serializeGraphHtmlFile,
	type GraphFileEmbeddedAsset
} from './graphFile';
import { graphFingerprint } from './documentStatus';
import { CURRENT_SCHEMA_VERSION, NEUTRAL_VIEW_STATE, type ViewState } from './migrations';
import {
	GraphPersistenceController,
	MEMORY_ONLY_STORAGE_NOTICE,
	controllerNotice,
	controllerNoticeSeverity,
	statusToNotice,
	type ControllerStatus,
	type EmbeddedDocumentConflictChoice,
	type GraphSaveScheduler
} from './graphPersistenceController';
import { DEFAULT_GRAPH_ID } from './graphRoute';
import { APP_CONFIG } from './appConfig';
import {
	LocalStoragePersistence,
	documentDraftGraphId,
	graphStorageKey,
	type GraphSummary,
	type PersistedGraphRecord,
	type Persistence,
	type StorageLike
} from './persistence';
import type { ReadHistoryTail, SaveStatus } from './saveScheduler';

class MemoryPersistence implements Persistence {
	private readonly graphs = new Map<string, { graph: PersistedGraphRecord; updatedAt: number }>();
	private clock = 0;

	load = vi.fn(async (id: string): Promise<PersistedGraphRecord | null> => {
		return this.graphs.get(id)?.graph ?? null;
	});

	save = vi.fn(async (id: string, graph: PersistedGraphRecord): Promise<void> => {
		this.clock += 1;
		this.graphs.set(id, { graph, updatedAt: this.clock });
	});

	list = vi.fn(async (): Promise<GraphSummary[]> => {
		return Array.from(this.graphs.entries())
			.map(([id, { updatedAt }]) => ({ id, updatedAt }))
			.sort((left, right) => right.updatedAt - left.updatedAt);
	});

	delete = vi.fn(async (id: string): Promise<void> => {
		this.graphs.delete(id);
	});
}

class TestScheduler implements GraphSaveScheduler {
	private pending: {
		id: string;
		graph: PersistedGraphRecord;
		readHistory?: ReadHistoryTail;
	} | null = null;
	failFlushOnce = false;
	warnOnFlush = false;
	dispose = vi.fn();

	constructor(
		private readonly persistence: Persistence,
		private readonly onStatus: (status: SaveStatus) => void,
		private readonly events: string[]
	) {}

	schedule = vi.fn(
		(
			id: string,
			data: MultigraphData,
			viewState: ViewState,
			readHistory?: ReadHistoryTail
		): void => {
			this.pending = { id, graph: { data, viewState }, readHistory };
		}
	);

	flush = vi.fn(async (): Promise<void> => {
		if (this.failFlushOnce) {
			this.failFlushOnce = false;
			this.onStatus({ state: 'error', message: 'quota exceeded' });
			throw new Error('quota exceeded');
		}

		if (this.pending === null) return;
		const save = this.pending;
		this.onStatus({ state: 'saving' });
		this.events.push('save');
		await this.persistence.save(save.id, { ...save.graph, history: save.readHistory?.() });
		this.pending = null;
		const fingerprint = graphFingerprint(save.graph.data);
		if (this.warnOnFlush) {
			this.onStatus({
				state: 'warning',
				savedAt: 123,
				fingerprint,
				message: 'Local cache is 85% full.'
			});
			return;
		}
		this.onStatus({ state: 'saved', savedAt: 123, fingerprint });
	});
}

/** Stands in for `localStorage`, which the node test environment does not have. */
class MemoryStorage implements StorageLike {
	private readonly items = new Map<string, string>();

	get length(): number {
		return this.items.size;
	}

	getItem(key: string): string | null {
		return this.items.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.items.set(key, value);
	}

	removeItem(key: string): void {
		this.items.delete(key);
	}

	key(index: number): string | null {
		return Array.from(this.items.keys())[index] ?? null;
	}
}

function createDefaultGraph(): MultigraphData {
	return makeGraph({ nodeCount: 1 });
}

function nonNeutralViewState(): ViewState {
	return { panX: 120, panY: -80, scale: 1.5 };
}

/** A graph whose nodes each carry one image block, so the asset ids are referenced. */
function imageGraph(assetIds: string[]): MultigraphData {
	return makeGraph({
		nodes: assetIds.map((assetId, index) => ({
			id: `n${index}`,
			title: `Image ${index}`,
			description: '',
			content: [{ type: 'image' as const, assetId, alt: '' }]
		}))
	});
}

/** The same, for file attachments: one `file` block and its metadata per asset id. */
function fileGraph(assetIds: string[]): MultigraphData {
	const graph = makeGraph({
		nodes: assetIds.map((assetId, index) => ({
			id: `n${index}`,
			title: `File ${index}`,
			description: '',
			content: [{ type: 'file' as const, assetId, name: `${assetId}.csv` }]
		}))
	});
	return {
		...graph,
		assets: Object.fromEntries(
			assetIds.map((assetId) => [
				assetId,
				{
					id: assetId,
					kind: 'file' as const,
					mimeType: 'text/csv',
					name: `${assetId}.csv`,
					size: 1,
					createdAt: 1
				}
			])
		)
	};
}

async function storeFileAsset(
	store: GraphAssetStore,
	scope: string,
	assetId: string,
	body: string
) {
	const blob = new Blob([body], { type: 'text/csv' });
	await store.put({
		scope,
		assetId,
		blob,
		mimeType: 'text/csv',
		name: `${assetId}.csv`,
		size: blob.size,
		updatedAt: 1
	});
}

async function embeddedAsset(assetId: string, body: string): Promise<GraphFileEmbeddedAsset> {
	const blob = new Blob([body], { type: 'image/png' });
	return {
		assetId,
		mimeType: 'image/png',
		name: `${assetId}.png`,
		size: blob.size,
		base64: await blobToBase64(blob)
	};
}

async function storeAsset(store: GraphAssetStore, scope: string, assetId: string, body: string) {
	const blob = new Blob([body], { type: 'image/png' });
	await store.put({
		scope,
		assetId,
		blob,
		mimeType: 'image/png',
		name: `${assetId}.png`,
		size: blob.size,
		updatedAt: 1
	});
}

async function readAsset(
	store: GraphAssetStore,
	scope: string,
	assetId: string
): Promise<string | null> {
	const result = await store.get(scope, assetId);
	return result.ok ? await result.value.blob.text() : null;
}

function setup(
	options: {
		confirmGraphImportReplace?: (context: {
			loadedGraphId: string;
			currentGraph: MultigraphData;
			incomingGraph: MultigraphData;
		}) => boolean | Promise<boolean>;
		confirmNewGraphReplace?: (context: {
			currentGraph: MultigraphData;
			documentStatus: ReturnType<GraphPersistenceController['getView']>['documentStatus'];
		}) => boolean | Promise<boolean>;
		chooseEmbeddedDocumentConflict?: (context: {
			documentId: string;
			draftGraph: MultigraphData;
			fileGraph: MultigraphData;
		}) => EmbeddedDocumentConflictChoice | Promise<EmbeddedDocumentConflictChoice>;
		assetStore?: GraphAssetStore;
		durability?: 'durable' | 'memory-only';
		historyCeiling?: number;
		/** Share one store between two controllers, the way a reload shares a draft. */
		persistence?: MemoryPersistence;
		appVersion?: string;
	} = {}
) {
	const persistence = options.persistence ?? new MemoryPersistence();
	const events: string[] = [];
	const navigate = vi.fn(async (graphId: string) => {
		events.push(`navigate:${graphId}`);
	});
	let scheduler: TestScheduler | null = null;
	const controller = new GraphPersistenceController({
		persistence,
		createScheduler: (onStatus) => {
			scheduler = new TestScheduler(persistence, onStatus, events);
			return scheduler;
		},
		createDefaultGraph,
		navigate,
		storageNamespace: 'test',
		durability: options.durability,
		confirmGraphImportReplace: options.confirmGraphImportReplace,
		confirmNewGraphReplace: options.confirmNewGraphReplace,
		chooseEmbeddedDocumentConflict: options.chooseEmbeddedDocumentConflict,
		assetStore: options.assetStore,
		historyCeiling: options.historyCeiling,
		createDocumentId: () => 'doc-new',
		now: () => 456,
		createGraphId: () => 'graph-new',
		appVersion: options.appVersion
	});

	if (scheduler === null) throw new Error('Expected scheduler to be created');
	return { controller, persistence, scheduler: scheduler as TestScheduler, navigate, events };
}

const APP_STAMP = '2026-08-30T21:41:32-07:00 efa2bbc';
const NEWER_STAMP = '2026-09-15T10:02:00-07:00 abc1234';

describe('opening a document written by another app version', () => {
	function documentFrom(appVersion: string | undefined): string {
		return serializeGraphHtmlFile({
			data: makeGraph({ nodeCount: 2, edges: [[0, 1]] }),
			viewState: NEUTRAL_VIEW_STATE,
			documentId: 'doc-1',
			appVersion
		});
	}

	it('warns when importing a document from a newer app', async () => {
		const { controller } = setup({ appVersion: APP_STAMP });
		await controller.load(DEFAULT_GRAPH_ID);

		await controller.importGraphDocument(documentFrom(NEWER_STAMP));

		expect(controller.getView().status).toEqual({
			state: 'notice',
			// Sticky: the reader has to act on it, so it outranks the document status.
			sticky: true,
			severity: 'warning',
			message: 'Newer app: 2026-09-15. Saving here downgrades it.'
		});
	});

	it('surfaces that warning over the document status', async () => {
		// controllerNotice normally lets documentStatusNotice win. If it ever
		// stops making an exception for this message the warning becomes
		// invisible, which is a silent failure rather than a loud one.
		const { controller } = setup({ appVersion: APP_STAMP });
		await controller.load(DEFAULT_GRAPH_ID);

		await controller.importGraphDocument(documentFrom(NEWER_STAMP));

		expect(controllerNotice(controller.getView())).toBe(
			'Newer app: 2026-09-15. Saving here downgrades it.'
		);
	});

	it('reports the ordinary import when the document is from an older app', async () => {
		const { controller } = setup({ appVersion: APP_STAMP });
		await controller.load(DEFAULT_GRAPH_ID);

		await controller.importGraphDocument(documentFrom('2026-05-07T09:00:00-07:00 0000001'));

		// Neither sticky nor amber: an ordinary import is not something to act on.
		expect(controller.getView().status).toEqual({
			state: 'notice',
			message: `Imported into "${DEFAULT_GRAPH_ID}".`
		});
	});

	it('says nothing about a document written before the stamp existed', async () => {
		const { controller } = setup({ appVersion: APP_STAMP });
		await controller.load(DEFAULT_GRAPH_ID);

		await controller.importGraphDocument(documentFrom(undefined));

		expect(controllerNotice(controller.getView())).not.toMatch(/newer/);
	});

	it('warns when a document opened from the picker is from a newer app', async () => {
		const { controller } = setup({ appVersion: APP_STAMP });
		const doc = parseGraphFileText(documentFrom(NEWER_STAMP));

		await controller.loadEmbeddedDocument(doc, { openedFromPicker: true });

		expect(controllerNotice(controller.getView())).toBe(
			'Newer app: 2026-09-15. Saving here downgrades it.'
		);
	});

	it('records the running app version on every document it writes', async () => {
		const { controller } = setup({ appVersion: APP_STAMP });
		await controller.load(DEFAULT_GRAPH_ID);

		const artifact = await controller.exportGraphDocument();

		expect(parseGraphFileText(artifact.content).appVersion).toBe(APP_STAMP);
	});
});

describe('GraphPersistenceController', () => {
	it('loads a missing graph by creating and saving the default graph', async () => {
		const { controller, persistence, scheduler } = setup();

		const result = await controller.load('missing');

		expect(persistence.load).toHaveBeenCalledWith('missing');
		expect(result).toEqual({ createdDefaultGraph: true });
		expect(scheduler.schedule).toHaveBeenCalledWith(
			'missing',
			createDefaultGraph(),
			NEUTRAL_VIEW_STATE,
			expect.any(Function)
		);
		expect(persistence.save).toHaveBeenCalledWith('missing', {
			data: createDefaultGraph(),
			viewState: NEUTRAL_VIEW_STATE
		});
		expect(controller.getView()).toMatchObject({
			graph: createDefaultGraph(),
			viewState: NEUTRAL_VIEW_STATE,
			loadedGraphId: 'missing',
			status: { state: 'saved', savedAt: 123 },
			graphSummaries: [{ id: 'missing', updatedAt: 1 }]
		});
	});

	it('loads existing graphs and reports loaded status', async () => {
		const { controller, persistence } = setup();
		const graph = makeGraph({ nodeCount: 2 });
		await persistence.save('saved', { data: graph, viewState: nonNeutralViewState() });

		const result = await controller.load('saved');

		expect(result).toEqual({ createdDefaultGraph: false });
		expect(controller.getView()).toMatchObject({
			graph,
			viewState: nonNeutralViewState(),
			loadedGraphId: 'saved',
			status: { state: 'loaded', graphId: 'saved' }
		});
	});

	it('schedules saves when the graph changes without syncing the loaded view', async () => {
		const { controller, scheduler } = setup();
		const loaded = makeGraph({ nodeCount: 1 });
		const edited = makeGraph({ nodeCount: 2 });

		await controller.load('active');
		const generationAfterLoad = controller.getView().graphGeneration;
		controller.notifyGraphChanged(edited);

		expect(controller.getView().graph).toEqual(loaded);
		expect(controller.getView().graphGeneration).toBe(generationAfterLoad);
		expect(scheduler.schedule).toHaveBeenLastCalledWith(
			'active',
			edited,
			NEUTRAL_VIEW_STATE,
			expect.any(Function)
		);
	});

	it('can optionally sync the loaded view for display-only callers', async () => {
		const { controller } = setup();
		const graph = makeGraph({ nodeCount: 2 });

		await controller.load('active');
		controller.notifyGraphChanged(graph, { syncView: true });

		expect(controller.getView().graph).toEqual(graph);
	});

	it('bumps graphGeneration only when loading a graph', async () => {
		const { controller, persistence } = setup();
		const first = makeGraph({ nodeCount: 1 });
		const second = makeGraph({ nodeCount: 2 });

		await persistence.save('first', { data: first, viewState: NEUTRAL_VIEW_STATE });
		await persistence.save('second', { data: second, viewState: NEUTRAL_VIEW_STATE });
		await controller.load('first');
		const firstGeneration = controller.getView().graphGeneration;
		controller.notifyGraphChanged(first);
		expect(controller.getView().graphGeneration).toBe(firstGeneration);

		await controller.load('second');
		expect(controller.getView().graphGeneration).toBe(firstGeneration + 1);
		expect(controller.getView().graph).toEqual(second);
	});

	it('flushes pending saves before navigating to another graph', async () => {
		const { controller, navigate, events } = setup();

		await controller.load('active');
		controller.notifyGraphChanged(makeGraph({ nodeCount: 2 }));
		await controller.selectGraph('next');

		expect(navigate).toHaveBeenCalledWith('next');
		expect(events).toEqual(['save', 'save', 'navigate:next']);
	});

	it('creates generated graph ids and persists the active route', async () => {
		const { controller, navigate } = setup();
		await controller.load('active');

		await controller.createGraph();

		expect(navigate).toHaveBeenCalledWith('graph-new');
		expect(controller.getView()).toMatchObject({
			loadedGraphId: 'graph-new',
			graph: createDefaultGraph(),
			documentStatus: 'new-clean'
		});
	});

	it('does not confirm before replacing a graph that matches the last saved file', async () => {
		const confirmNewGraphReplace = vi.fn(() => true);
		const { controller } = setup({ confirmNewGraphReplace });
		await controller.load('active');
		await controller.exportGraphDocument();

		await controller.createGraph();

		expect(confirmNewGraphReplace).not.toHaveBeenCalled();
		expect(controller.getView()).toMatchObject({
			loadedGraphId: 'graph-new',
			documentStatus: 'new-clean'
		});
	});

	it('confirms before replacing a dirty graph', async () => {
		const confirmNewGraphReplace = vi.fn(() => false);
		const { controller } = setup({ confirmNewGraphReplace });
		await controller.load('active');
		controller.notifyGraphChanged(makeGraph({ nodeCount: 2 }), { syncView: true });

		await controller.createGraph();

		expect(confirmNewGraphReplace).toHaveBeenCalledWith({
			currentGraph: makeGraph({ nodeCount: 2 }),
			documentStatus: 'new-dirty'
		});
		expect(controller.getView()).toMatchObject({
			loadedGraphId: 'active',
			documentStatus: 'new-dirty',
			status: { state: 'saved', savedAt: 123 }
		});
	});

	it('deletes the selected graph and navigates to an existing graph when one remains', async () => {
		const { controller, persistence, navigate } = setup();
		await persistence.save('first', {
			data: makeGraph({ nodeCount: 1 }),
			viewState: NEUTRAL_VIEW_STATE
		});
		await persistence.save('second', {
			data: makeGraph({ nodeCount: 2 }),
			viewState: NEUTRAL_VIEW_STATE
		});
		await controller.load('second');

		await controller.deleteGraph('second');

		expect(persistence.delete).toHaveBeenCalledWith('second');
		expect(navigate).toHaveBeenCalledWith('first');
		expect(controller.getView().graphSummaries).toEqual([{ id: 'first', updatedAt: 1 }]);
	});

	it('reloads the default graph in place when deleting the only default graph', async () => {
		const { controller, persistence, navigate } = setup();
		await persistence.save(DEFAULT_GRAPH_ID, {
			data: makeGraph({ nodeCount: 2 }),
			viewState: NEUTRAL_VIEW_STATE
		});
		await controller.load(DEFAULT_GRAPH_ID);

		await controller.deleteGraph(DEFAULT_GRAPH_ID);

		expect(navigate).not.toHaveBeenCalled();
		expect(controller.getView()).toMatchObject({
			loadedGraphId: DEFAULT_GRAPH_ID,
			status: { state: 'saved', savedAt: 123 },
			graphSummaries: [{ id: DEFAULT_GRAPH_ID, updatedAt: 2 }]
		});
	});

	it('keeps navigation non-blocking when flushing pending saves fails', async () => {
		const { controller, scheduler, navigate } = setup();
		await controller.load('active');
		controller.notifyGraphChanged(makeGraph({ nodeCount: 2 }));
		scheduler.failFlushOnce = true;

		await controller.selectGraph('next');

		expect(controller.getView().status).toEqual({
			state: 'error',
			message: 'quota exceeded'
		});
		expect(navigate).toHaveBeenCalledWith('next');
	});

	it('reloads only active graph storage events', async () => {
		const { controller, persistence } = setup();
		const first = makeGraph({ nodeCount: 1 });
		const updated = makeGraph({ nodeCount: 3 });
		await persistence.save('active', { data: first, viewState: NEUTRAL_VIEW_STATE });
		await controller.load('active');
		await persistence.save('active', { data: updated, viewState: NEUTRAL_VIEW_STATE });
		await persistence.save('other', {
			data: makeGraph({ nodeCount: 2 }),
			viewState: NEUTRAL_VIEW_STATE
		});

		await controller.handleStorageEvent({ key: graphStorageKey('test', 'other') });
		expect(controller.getView().graph).toEqual(first);

		await controller.handleStorageEvent({ key: graphStorageKey('test', 'active') });
		expect(controller.getView()).toMatchObject({
			graph: updated,
			status: { state: 'reloaded', graphId: 'active' }
		});
	});

	it('loads embedded HTML documents when no cached draft exists', async () => {
		const { controller, persistence } = setup();
		const graph = makeGraph({ nodeCount: 2 });
		const viewState = nonNeutralViewState();

		await controller.loadEmbeddedDocument({ documentId: 'doc-file', data: graph, viewState });

		expect(controller.getView()).toMatchObject({
			loadedGraphId: documentDraftGraphId('doc-file'),
			documentId: 'doc-file',
			graph,
			viewState,
			documentStatus: 'file-clean'
		});
		expect(persistence.save).not.toHaveBeenCalled();
	});

	it('prefers a dirty cached document draft over the embedded file payload', async () => {
		const { controller, persistence } = setup();
		const fileGraph = makeGraph({ nodeCount: 1 });
		const draftGraph = makeGraph({ nodeCount: 3 });
		await persistence.save(documentDraftGraphId('doc-dirty'), {
			data: draftGraph,
			viewState: nonNeutralViewState()
		});

		await controller.loadEmbeddedDocument({
			documentId: 'doc-dirty',
			data: fileGraph,
			viewState: NEUTRAL_VIEW_STATE
		});

		expect(controller.getView()).toMatchObject({
			loadedGraphId: documentDraftGraphId('doc-dirty'),
			documentId: 'doc-dirty',
			graph: draftGraph,
			viewState: nonNeutralViewState(),
			documentStatus: 'file-recovered-draft'
		});
		expect(persistence.save).toHaveBeenCalledTimes(1);
	});

	it('can prefer an opened embedded file over a dirty cached document draft', async () => {
		const chooseEmbeddedDocumentConflict = vi.fn(() => 'open-file' as const);
		const { controller, persistence, scheduler } = setup({ chooseEmbeddedDocumentConflict });
		const fileGraph = makeGraph({ nodeCount: 1 });
		const draftGraph = makeGraph({ nodeCount: 3 });
		const fileViewState = { panX: 8, panY: 13, scale: 1.2 };
		await persistence.save(documentDraftGraphId('doc-opened'), {
			data: draftGraph,
			viewState: nonNeutralViewState()
		});

		await controller.loadEmbeddedDocument(
			{
				documentId: 'doc-opened',
				data: fileGraph,
				viewState: fileViewState
			},
			{ openedFromPicker: true }
		);

		expect(chooseEmbeddedDocumentConflict).toHaveBeenCalledWith({
			documentId: 'doc-opened',
			draftGraph,
			fileGraph
		});
		expect(controller.getView()).toMatchObject({
			loadedGraphId: documentDraftGraphId('doc-opened'),
			documentId: 'doc-opened',
			graph: fileGraph,
			viewState: fileViewState,
			documentStatus: 'file-clean'
		});
		expect(scheduler.schedule).toHaveBeenLastCalledWith(
			documentDraftGraphId('doc-opened'),
			fileGraph,
			fileViewState,
			expect.any(Function)
		);
		expect(await persistence.load(documentDraftGraphId('doc-opened'))).toEqual({
			data: fileGraph,
			viewState: fileViewState
		});
	});

	it('recovers a dirty cached document draft when the opened file conflict is declined', async () => {
		const chooseEmbeddedDocumentConflict = vi.fn(() => 'recover-draft' as const);
		const { controller, persistence, scheduler } = setup({ chooseEmbeddedDocumentConflict });
		const fileGraph = makeGraph({ nodeCount: 1 });
		const draftGraph = makeGraph({ nodeCount: 3 });
		await persistence.save(documentDraftGraphId('doc-recover'), {
			data: draftGraph,
			viewState: nonNeutralViewState()
		});

		await controller.loadEmbeddedDocument(
			{
				documentId: 'doc-recover',
				data: fileGraph,
				viewState: NEUTRAL_VIEW_STATE
			},
			{ openedFromPicker: true }
		);

		expect(chooseEmbeddedDocumentConflict).toHaveBeenCalledWith({
			documentId: 'doc-recover',
			draftGraph,
			fileGraph
		});
		expect(controller.getView()).toMatchObject({
			loadedGraphId: documentDraftGraphId('doc-recover'),
			documentId: 'doc-recover',
			graph: draftGraph,
			viewState: nonNeutralViewState(),
			documentStatus: 'file-recovered-draft'
		});
		expect(scheduler.schedule).not.toHaveBeenCalledWith(
			documentDraftGraphId('doc-recover'),
			fileGraph,
			NEUTRAL_VIEW_STATE
		);
		expect(await persistence.load(documentDraftGraphId('doc-recover'))).toEqual({
			data: draftGraph,
			viewState: nonNeutralViewState()
		});
	});

	it('does not silently reload external storage over a dirty current graph', async () => {
		const { controller, persistence } = setup();
		await controller.load('active');
		controller.notifyGraphChanged(makeGraph({ nodeCount: 2 }), { syncView: true });
		await persistence.save('active', {
			data: makeGraph({ nodeCount: 4 }),
			viewState: NEUTRAL_VIEW_STATE
		});

		await controller.handleStorageEvent({ key: graphStorageKey('test', 'active') });

		expect(controller.getView()).toMatchObject({
			graph: makeGraph({ nodeCount: 2 }),
			documentStatus: 'new-dirty',
			status: {
				state: 'notice',
				message: 'Changed in another tab. Kept your cached draft.'
			}
		});
	});

	it('exports current graph and view state as a self-contained HTML artifact', async () => {
		const { controller } = setup();
		// Pinned so the export/parse round trip compares like with like: loading a
		// graph with zero pins seeds a pin per component.
		const graph = makeGraph({
			nodeCount: 3,
			pinned: [0],
			edges: [
				[0, 1],
				[1, 2]
			]
		});
		const viewState = nonNeutralViewState();
		await controller.load('active');
		controller.notifyGraphChanged(graph, { syncView: true });
		controller.notifyViewStateChanged(viewState, { syncView: true });

		const artifact = await controller.exportGraphDocument(
			'<!doctype html><html><body></body></html>'
		);
		const exported = parseGraphFileText(artifact.content);
		expect(artifact).toMatchObject({
			filename: 'active.html',
			mimeType: 'text/html'
		});
		expect(exported).toEqual({
			data: graph,
			viewState,
			documentId: 'doc-new',
			exportedAt: 456
		});
	});

	it('confirms the save by naming the file it wrote', async () => {
		const { controller } = setup();
		await controller.load('active');
		controller.notifyGraphChanged(makeGraph({ nodeCount: 2 }), { syncView: true });

		await controller.exportGraphDocument('<!doctype html><html><body></body></html>');

		expect(controller.getView().status).toEqual({ state: 'exported', filename: 'active.html' });
		expect(controllerNotice(controller.getView())).toBe('Saved active.html. Check your downloads.');
		expect(controllerNoticeSeverity(controller.getView())).toBe('info');
	});

	it('keeps the blocked-storage warning above the save confirmation', async () => {
		const { controller } = setup({ durability: 'memory-only' });
		await controller.load('active');

		await controller.exportGraphDocument('<!doctype html><html><body></body></html>');

		// The file is safe, but this browser is still caching nothing: the standing
		// condition outranks the confirmation.
		expect(controller.getView().status).toEqual({ state: 'exported', filename: 'active.html' });
		expect(controllerNotice(controller.getView())).toBe(MEMORY_ONLY_STORAGE_NOTICE);
		expect(controllerNoticeSeverity(controller.getView())).toBe('warning');
	});

	it('imports a valid graph file into the active graph id and refreshes summaries', async () => {
		const confirmReplace = vi.fn(() => true);
		const { controller, persistence } = setup({ confirmGraphImportReplace: confirmReplace });
		const existing = makeGraph({ nodeCount: 2 });
		await persistence.save('active', { data: existing, viewState: NEUTRAL_VIEW_STATE });
		await controller.load('active');
		const generationBeforeImport = controller.getView().graphGeneration;

		controller.notifyGraphChanged(makeGraph({ nodeCount: 4 }));
		const importedGraph = makeGraph({ nodeCount: 3, pinned: [0], edges: [[0, 1]] });
		const importedViewState = { panX: 50, panY: -20, scale: 1.25 };
		const importResult = await controller.importGraphDocument(
			serializeGraphHtmlFile({
				documentId: 'doc-imported',
				data: importedGraph,
				viewState: importedViewState
			})
		);

		expect(importResult).toBe('imported');
		expect(confirmReplace).toHaveBeenCalledTimes(1);
		expect(controller.getView()).toMatchObject({
			loadedGraphId: 'active',
			graph: importedGraph,
			viewState: importedViewState,
			documentId: 'doc-imported',
			graphGeneration: generationBeforeImport + 1,
			status: { state: 'notice', message: 'Imported into "active".' }
		});
		expect(persistence.save).toHaveBeenLastCalledWith('active', {
			data: importedGraph,
			viewState: importedViewState
		});
		expect(controller.getView().graphSummaries).toEqual([{ id: 'active', updatedAt: 3 }]);
	});

	it('leaves graph, generation, and view state unchanged on invalid import payloads', async () => {
		const { controller, persistence } = setup();
		await controller.load('active');
		const before = controller.getView();
		const saveCallsBefore = persistence.save.mock.calls.length;

		const result = await controller.importGraphDocument(
			JSON.stringify({
				schemaVersion: CURRENT_SCHEMA_VERSION,
				data: { nodes: [] }
			})
		);

		expect(result).toBe('invalid');
		expect(controller.getView()).toMatchObject({
			graph: before.graph,
			viewState: before.viewState,
			graphGeneration: before.graphGeneration
		});
		expect(persistence.save).toHaveBeenCalledTimes(saveCallsBefore);
	});

	it('leaves graph, generation, and view state unchanged on unsupported versions', async () => {
		const { controller, persistence } = setup();
		await controller.load('active');
		const before = controller.getView();
		const saveCallsBefore = persistence.save.mock.calls.length;

		const result = await controller.importGraphDocument(
			JSON.stringify({
				schemaVersion: 999,
				data: makeGraph({ nodeCount: 1 })
			})
		);

		expect(result).toBe('unsupported');
		expect(controller.getView()).toMatchObject({
			graph: before.graph,
			viewState: before.viewState,
			graphGeneration: before.graphGeneration
		});
		expect(persistence.save).toHaveBeenCalledTimes(saveCallsBefore);
	});

	it('opens newer HTML graph files in a new tab when the app reader is unsupported', async () => {
		const openUnsupportedHtmlFile = vi.fn(() => true);
		const persistence = new MemoryPersistence();
		const events: string[] = [];
		const controller = new GraphPersistenceController({
			persistence,
			createScheduler: (onStatus) => new TestScheduler(persistence, onStatus, events),
			createDefaultGraph,
			navigate: vi.fn(),
			storageNamespace: 'test',
			openUnsupportedHtmlFile
		});
		await controller.load('active');
		const html = serializeGraphHtmlFile({
			data: makeGraph({ nodeCount: 1 }),
			viewState: NEUTRAL_VIEW_STATE
		}).replace(`"minReaderVersion": ${GRAPH_HTML_READER_VERSION}`, '"minReaderVersion": 999');

		const result = await controller.importGraphDocument(html);

		expect(result).toBe('opened-in-new-tab');
		expect(openUnsupportedHtmlFile).toHaveBeenCalledWith(html);
		expect(controller.getView().status).toEqual({
			state: 'notice',
			sticky: true,
			message: 'Newer graph file. Opened in a new tab.'
		});
	});

	it('keeps pan and zoom out of the cache write path', async () => {
		const { controller, persistence, scheduler } = setup();
		await controller.load('active');
		const graphBefore = controller.getView().graph;
		const positionsBefore = graphBefore.posByNodeId;
		const saveCallsBefore = persistence.save.mock.calls.length;
		scheduler.schedule.mockClear();

		controller.notifyViewStateChanged({ panX: 25, panY: 10, scale: 0.8 }, { syncView: true });

		expect(scheduler.schedule).not.toHaveBeenCalled();
		expect(persistence.save.mock.calls).toHaveLength(saveCallsBefore);
		// The camera is a view concern: the document must be untouched by it, and
		// the toolbar must not claim a cache write is happening.
		expect(controller.getView().graph).toEqual(graphBefore);
		expect(controller.getView().graph.posByNodeId).toEqual(positionsBefore);
		expect(controllerNotice(controller.getView())).not.toBe('Caching draft...');
	});

	it('carries the latest camera along with the next edit', async () => {
		const { controller, persistence, scheduler } = setup();
		await controller.load('active');
		const updatedViewState = { panX: 25, panY: 10, scale: 0.8 };
		const edited = makeGraph({ nodeCount: 2 });

		controller.notifyViewStateChanged(updatedViewState, { syncView: true });
		controller.notifyGraphChanged(edited, { syncView: true });
		await scheduler.flush();

		expect(persistence.save).toHaveBeenLastCalledWith('active', {
			data: edited,
			viewState: updatedViewState
		});
	});

	it('flushes a camera-only change so leaving the page does not lose it', async () => {
		const { controller, persistence } = setup();
		await controller.load('active');
		const graphBefore = controller.getView().graph;
		const updatedViewState = { panX: 25, panY: 10, scale: 0.8 };

		controller.notifyViewStateChanged(updatedViewState, { syncView: true });
		await controller.flushPendingSave();

		expect(persistence.save).toHaveBeenLastCalledWith('active', {
			data: graphBefore,
			viewState: updatedViewState
		});
		// A second flush has nothing left to write.
		const saveCallsAfter = persistence.save.mock.calls.length;
		await controller.flushPendingSave();
		expect(persistence.save.mock.calls).toHaveLength(saveCallsAfter);
	});

	it('ignores an edit committed by the graph that was just replaced', async () => {
		const { controller, persistence, scheduler } = setup();
		await persistence.save('active', {
			data: makeGraph({ nodeCount: 3 }),
			viewState: NEUTRAL_VIEW_STATE
		});
		await controller.load('first');
		const staleGeneration = controller.getView().graphGeneration;
		await controller.load('active');
		const loaded = controller.getView().graph;
		scheduler.schedule.mockClear();

		// The canvas for 'first' blurs a title edit while it is being torn down.
		controller.notifyGraphChanged(makeGraph({ nodeCount: 1 }), {
			syncView: true,
			generation: staleGeneration
		});

		expect(scheduler.schedule).not.toHaveBeenCalled();
		expect(controller.getView().graph).toEqual(loaded);
	});

	it('accepts an edit committed by the current graph', async () => {
		const { controller, scheduler } = setup();
		await controller.load('active');
		const edited = makeGraph({ nodeCount: 2 });

		controller.notifyGraphChanged(edited, {
			syncView: true,
			generation: controller.getView().graphGeneration
		});

		expect(scheduler.schedule).toHaveBeenLastCalledWith(
			'active',
			edited,
			NEUTRAL_VIEW_STATE,
			expect.any(Function)
		);
	});

	it('skips a cache write for a change event that matches the cached graph', async () => {
		const { controller, scheduler } = setup();
		await controller.load('active');
		const edited = makeGraph({ nodeCount: 2 });
		controller.notifyGraphChanged(edited, { syncView: true });
		await scheduler.flush();
		scheduler.schedule.mockClear();

		controller.notifyGraphChanged(edited, { syncView: true });

		expect(scheduler.schedule).not.toHaveBeenCalled();
		expect(controller.getView().draftCached).toBe(true);
	});

	it('cancels import when replacement confirmation is declined for non-empty graphs', async () => {
		const confirmReplace = vi.fn(() => false);
		const { controller, persistence } = setup({ confirmGraphImportReplace: confirmReplace });
		await persistence.save('active', {
			data: makeGraph({ nodeCount: 2 }),
			viewState: NEUTRAL_VIEW_STATE
		});
		await controller.load('active');
		const before = controller.getView();
		const saveCallsBefore = persistence.save.mock.calls.length;

		const result = await controller.importGraphDocument(
			JSON.stringify({
				schemaVersion: CURRENT_SCHEMA_VERSION,
				data: makeGraph({ nodeCount: 1 }),
				viewState: nonNeutralViewState()
			})
		);

		expect(result).toBe('cancelled');
		expect(confirmReplace).toHaveBeenCalledTimes(1);
		expect(controller.getView()).toMatchObject({
			graph: before.graph,
			viewState: before.viewState,
			graphGeneration: before.graphGeneration,
			status: { state: 'notice', message: 'Import cancelled.' }
		});
		expect(persistence.save).toHaveBeenCalledTimes(saveCallsBefore);
	});

	it('imports without confirmation when current graph is default-safe', async () => {
		const confirmReplace = vi.fn(() => true);
		const { controller } = setup({ confirmGraphImportReplace: confirmReplace });
		await controller.load('active');

		const result = await controller.importGraphDocument(
			JSON.stringify({
				schemaVersion: CURRENT_SCHEMA_VERSION,
				data: makeGraph({ nodeCount: 1 }),
				viewState: nonNeutralViewState()
			})
		);

		expect(result).toBe('imported');
		expect(confirmReplace).not.toHaveBeenCalled();
	});

	it('emits a read failure notice when import text cannot be read', async () => {
		const { controller } = setup();
		await controller.load('active');

		const result = await controller.importGraphDocumentFromReader(async () => {
			throw new Error('read failed');
		});

		expect(result).toBe('read-failed');
		expect(controller.getView().status).toEqual({
			state: 'notice',
			sticky: true,
			message: 'Import failed. Could not read the file.'
		});
	});

	it('treats a graph read back from storage as already cached', async () => {
		const { controller, persistence } = setup();
		const graph = makeGraph({ nodeCount: 2 });
		await persistence.save('saved', { data: graph, viewState: NEUTRAL_VIEW_STATE });

		await controller.load('saved');

		expect(controller.getView().draftCached).toBe(true);
		expect(controllerNotice(controller.getView())).toBe(
			'Draft cached in this browser. Save to keep it.'
		);
		expect(controllerNoticeSeverity(controller.getView())).toBe('info');
	});

	it('calls an edit cached only once the write has landed', async () => {
		const { controller, scheduler } = setup();
		await controller.load('active');
		expect(controller.getView().draftCached).toBe(true);

		controller.notifyGraphChanged(makeGraph({ nodeCount: 2 }), { syncView: true });

		// Debounce window: the write is owed but not yet attempted, so the notice
		// reads as in-flight rather than flashing an alarm between keystrokes.
		expect(controller.getView()).toMatchObject({ draftCached: false, cachePending: true });
		expect(controllerNotice(controller.getView())).toBe('Caching draft...');
		expect(controllerNoticeSeverity(controller.getView())).toBe('info');

		await scheduler.flush();

		expect(controller.getView()).toMatchObject({ draftCached: true, cachePending: false });
		expect(controllerNotice(controller.getView())).toBe(
			'Draft cached in this browser. Save to keep it.'
		);
		expect(controllerNoticeSeverity(controller.getView())).toBe('info');
	});

	it('does not call a draft cached after the cache write fails', async () => {
		const { controller, scheduler } = setup();
		await controller.load('active');
		controller.notifyGraphChanged(makeGraph({ nodeCount: 2 }), { syncView: true });
		scheduler.failFlushOnce = true;

		await controller.selectGraph('next');

		// The failure clears the pending flag, which is what lets the warning
		// through instead of leaving a permanent 'Caching draft...'.
		expect(controller.getView()).toMatchObject({ draftCached: false, cachePending: false });
		expect(controllerNotice(controller.getView())).toBe('Could not cache draft. quota exceeded');
		expect(controllerNoticeSeverity(controller.getView())).toBe('warning');
	});

	it('keeps a pending cache write calm while a quota warning is standing', async () => {
		const { controller, scheduler } = setup();
		await controller.load('active');
		scheduler.warnOnFlush = true;
		controller.notifyGraphChanged(makeGraph({ nodeCount: 2 }), { syncView: true });
		await scheduler.flush();

		expect(controllerNotice(controller.getView())).toBe('Local cache is 85% full.');
		expect(controllerNoticeSeverity(controller.getView())).toBe('warning');

		controller.notifyGraphChanged(makeGraph({ nodeCount: 3 }), { syncView: true });

		// Text and styling must agree during the debounce window: 'Caching draft...'
		// is not amber, even though the quota warning status is still standing by.
		expect(controllerNotice(controller.getView())).toBe('Caching draft...');
		expect(controllerNoticeSeverity(controller.getView())).toBe('info');
	});

	it('leads with the storage warning when the browser blocks site data', async () => {
		const { controller, persistence } = setup({ durability: 'memory-only' });
		await persistence.save('saved', {
			data: makeGraph({ nodeCount: 2 }),
			viewState: NEUTRAL_VIEW_STATE
		});

		await controller.load('saved');

		// A write to tab-lifetime storage is not caching, and the warning outranks
		// the transient 'Loaded "saved".' that would otherwise reassure the user.
		expect(controller.getView().draftCached).toBe(false);
		expect(controllerNotice(controller.getView())).toBe(MEMORY_ONLY_STORAGE_NOTICE);
		expect(controllerNoticeSeverity(controller.getView())).toBe('warning');
	});

	it('still surfaces cache failures over the blocked-storage warning', async () => {
		const { controller, scheduler } = setup({ durability: 'memory-only' });
		await controller.load('active');
		controller.notifyGraphChanged(makeGraph({ nodeCount: 2 }), { syncView: true });
		scheduler.failFlushOnce = true;

		await controller.selectGraph('next');

		expect(controllerNotice(controller.getView())).toBe('Could not cache draft. quota exceeded');
		expect(controllerNoticeSeverity(controller.getView())).toBe('warning');
	});

	it('disposes the scheduler and stops future listener notifications', async () => {
		const { controller, scheduler } = setup();
		const listener = vi.fn();
		controller.subscribe(listener);

		controller.dispose();
		await controller.load('after-dispose');

		expect(scheduler.dispose).toHaveBeenCalled();
		expect(listener).toHaveBeenCalledTimes(1);
	});
});

describe('GraphPersistenceController additive import', () => {
	/** A loaded 'active' graph of two nodes, viewed at a non-neutral pan and zoom. */
	async function loadedHost(options: Parameters<typeof setup>[0] = {}) {
		const context = setup(options);
		await context.persistence.save('active', {
			data: makeGraph({ nodeCount: 2, edges: [[0, 1]] }),
			viewState: NEUTRAL_VIEW_STATE
		});
		await context.controller.load('active');
		context.controller.notifyViewStateChanged(nonNeutralViewState(), { syncView: true });
		return { ...context, before: context.controller.getView() };
	}

	it('keeps every existing node and adds the incoming ones', async () => {
		const { controller, persistence, before } = await loadedHost();

		const result = await controller.importGraphIntoCurrent(
			serializeGraphHtmlFile({
				documentId: 'doc-incoming',
				data: makeGraph({ nodeCount: 3, edges: [[0, 1]] }),
				viewState: { panX: 900, panY: 900, scale: 0.5 }
			})
		);

		expect(result).toEqual({ outcome: 'imported', importedNodeCount: 3 });
		const after = controller.getView();
		expect(after.graph.nodes.slice(0, 2)).toEqual(before.graph.nodes);
		expect(after.graph.nodes).toHaveLength(5);
		expect(new Set(after.graph.nodes.map((node) => node.id)).size).toBe(5);
		expect(after.graph.edges).toHaveLength(2);
		expect(persistence.save).toHaveBeenLastCalledWith('active', {
			data: after.graph,
			viewState: nonNeutralViewState(),
			history: expect.objectContaining({ head: expect.objectContaining({ label: 'import' }) })
		});
	});

	it('leaves the reader where they were: no remount, no view state change', async () => {
		const { controller, before } = await loadedHost();

		await controller.importGraphIntoCurrent(
			serializeGraphHtmlFile({
				documentId: 'doc-incoming',
				data: makeGraph({ nodeCount: 1 }),
				viewState: { panX: 900, panY: 900, scale: 0.5 }
			})
		);

		expect(controller.getView()).toMatchObject({
			graphGeneration: before.graphGeneration,
			viewState: nonNeutralViewState(),
			documentId: before.documentId,
			loadedGraphId: 'active'
		});
	});

	it('bumps the graph revision exactly once so the mounted canvas adopts the nodes', async () => {
		const { controller, before } = await loadedHost();
		const revisions: number[] = [];
		controller.subscribe((view) => revisions.push(view.graphRevision));

		await controller.importGraphIntoCurrent(
			serializeGraphHtmlFile({
				data: makeGraph({ nodeCount: 2 }),
				viewState: NEUTRAL_VIEW_STATE
			})
		);

		const after = controller.getView();
		expect(after.graphRevision).toBe(before.graphRevision + 1);
		// One step, not a run of them: every emission is either the old value or the
		// new one, so no listener ever saw the revision move twice for one import.
		expect(new Set(revisions)).toEqual(new Set([before.graphRevision, before.graphRevision + 1]));
		// The revision is what makes the import visible without a remount, so the
		// generation must stay exactly where it was.
		expect(after.graphGeneration).toBe(before.graphGeneration);
	});

	it('leaves the revision alone for loads and for changes coming from the canvas', async () => {
		const { controller, persistence } = await loadedHost();
		await controller.importGraphIntoCurrent(
			serializeGraphHtmlFile({ data: makeGraph({ nodeCount: 2 }), viewState: NEUTRAL_VIEW_STATE })
		);
		const afterImport = controller.getView();

		// From the canvas: echoing this back as a revision would tell the canvas to
		// re-adopt what it just committed.
		controller.notifyGraphChanged(makeGraph({ nodeCount: 4 }), { syncView: true });
		expect(controller.getView().graphRevision).toBe(afterImport.graphRevision);

		await persistence.save('other', {
			data: makeGraph({ nodeCount: 1 }),
			viewState: NEUTRAL_VIEW_STATE
		});
		await controller.load('other');
		expect(controller.getView().graphRevision).toBe(afterImport.graphRevision);
	});

	it('records the import as exactly one undo entry', async () => {
		const { controller, before } = await loadedHost();

		await controller.importGraphIntoCurrent(
			serializeGraphHtmlFile({
				data: makeGraph({ nodeCount: 1 }),
				viewState: NEUTRAL_VIEW_STATE
			})
		);

		expect(controller.getView().undoLabel).toBe('import');
		controller.undo();
		expect(controller.getView().graph.nodes).toEqual(before.graph.nodes);
		expect(controller.getView().canUndo).toBe(false);
	});

	it('imports a version 1 payload through the migration path', async () => {
		const { controller, before } = await loadedHost();

		const result = await controller.importGraphIntoCurrent(
			JSON.stringify({
				schemaVersion: 1,
				data: {
					nodes: [{ id: 'n0', title: 'Ancient', description: 'From a version 1 file' }],
					edges: [],
					posByNodeId: { n0: { x: 0, y: 0 } }
				}
			})
		);

		expect(result).toEqual({ outcome: 'imported', importedNodeCount: 1 });
		const titles = controller.getView().graph.nodes.map((node) => node.title);
		expect(titles).toEqual([...before.graph.nodes.map((node) => node.title), 'Ancient']);
	});

	it('changes nothing and offers no revert when the file will not parse', async () => {
		const { controller, persistence, before } = await loadedHost();
		const saveCallsBefore = persistence.save.mock.calls.length;

		const result = await controller.importGraphIntoCurrent(
			JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION, data: { nodes: [] } })
		);

		expect(result).toEqual({ outcome: 'invalid' });
		expect(controller.getView()).toMatchObject({
			graph: before.graph,
			viewState: before.viewState,
			graphGeneration: before.graphGeneration,
			snapshot: null,
			status: { state: 'notice', sticky: true, message: 'Import failed. Not a valid graph file.' }
		});
		expect(persistence.save).toHaveBeenCalledTimes(saveCallsBefore);
	});

	it('reports an unsupported version without touching the graph', async () => {
		const { controller, before } = await loadedHost();

		const result = await controller.importGraphIntoCurrent(
			JSON.stringify({ schemaVersion: 999, data: makeGraph({ nodeCount: 1 }) })
		);

		expect(result).toEqual({ outcome: 'unsupported' });
		expect(controller.getView()).toMatchObject({
			graph: before.graph,
			snapshot: null,
			status: {
				state: 'notice',
				sticky: true,
				message: 'Import failed. Unsupported file version.'
			}
		});
	});

	it('reports a file it cannot read without touching the graph', async () => {
		const { controller, before } = await loadedHost();

		const result = await controller.importGraphIntoCurrentFromReader(async () => {
			throw new Error('read failed');
		});

		expect(result).toEqual({ outcome: 'read-failed' });
		expect(controller.getView()).toMatchObject({
			graph: before.graph,
			snapshot: null,
			status: {
				state: 'notice',
				sticky: true,
				message: 'Import failed. Could not read the file.'
			}
		});
	});

	it('copies the incoming assets in without sweeping the host graph own images', async () => {
		const assetStore = new MemoryGraphAssetStore();
		const { controller } = setup({ assetStore });
		await controller.load('active');
		controller.notifyGraphChanged(imageGraph(['host-asset']), { syncView: true });
		await storeAsset(assetStore, 'active', 'host-asset', 'host bytes');

		const result = await controller.importGraphIntoCurrent(
			serializeGraphHtmlFile({
				data: imageGraph(['incoming-asset']),
				viewState: NEUTRAL_VIEW_STATE,
				embeddedAssets: [await embeddedAsset('incoming-asset', 'incoming bytes')]
			})
		);

		expect(result).toMatchObject({ outcome: 'imported' });
		expect(await readAsset(assetStore, 'active', 'host-asset')).toBe('host bytes');
		expect(await readAsset(assetStore, 'active', 'incoming-asset')).toBe('incoming bytes');
	});
});

describe('file attachments across export and import', () => {
	const CSV_BODY = 'time,value\n1,2\n';

	// The whole portability claim for schema 7 in one test: a CSV attached here
	// comes back out of a document opened by an app that has never seen it.
	it('embeds a file attachment on export and a fresh app hydrates it on import', async () => {
		const assetStore = new MemoryGraphAssetStore();
		const { controller } = setup({ assetStore });
		await controller.load('active');
		controller.notifyGraphChanged(fileGraph(['readings']), { syncView: true });
		await storeFileAsset(assetStore, 'active', 'readings', CSV_BODY);

		const artifact = await controller.exportGraphDocument(
			'<!doctype html><html><body></body></html>'
		);

		// The exported bytes are all a fresh profile has: new store, new controller.
		const freshStore = new MemoryGraphAssetStore();
		const fresh = setup({ assetStore: freshStore });
		await fresh.controller.load('active');

		expect(await fresh.controller.importGraphDocument(artifact.content)).toBe('imported');
		expect(fresh.controller.getView().graph.nodes[0].content).toEqual([
			{ type: 'file', assetId: 'readings', name: 'readings.csv' }
		]);
		expect(await readAsset(freshStore, 'active', 'readings')).toBe(CSV_BODY);
	});

	it('carries a file and an image out of the same document', async () => {
		const assetStore = new MemoryGraphAssetStore();
		const { controller } = setup({ assetStore });
		await controller.load('active');
		const mixed = fileGraph(['readings']);
		controller.notifyGraphChanged(
			{
				...mixed,
				nodes: [
					{
						...mixed.nodes[0],
						content: [
							...(mixed.nodes[0].content ?? []),
							{ type: 'image', assetId: 'photo', alt: 'A photo' }
						]
					}
				],
				assets: {
					...mixed.assets,
					photo: {
						id: 'photo',
						kind: 'image',
						mimeType: 'image/png',
						size: 1,
						createdAt: 1
					}
				}
			},
			{ syncView: true }
		);
		await storeFileAsset(assetStore, 'active', 'readings', CSV_BODY);
		await storeAsset(assetStore, 'active', 'photo', 'picture bytes');

		const artifact = await controller.exportGraphDocument(
			'<!doctype html><html><body></body></html>'
		);

		const freshStore = new MemoryGraphAssetStore();
		const fresh = setup({ assetStore: freshStore });
		await fresh.controller.load('active');
		await fresh.controller.importGraphDocument(artifact.content);

		expect(await readAsset(freshStore, 'active', 'readings')).toBe(CSV_BODY);
		expect(await readAsset(freshStore, 'active', 'photo')).toBe('picture bytes');
	});

	// `deleteUnreferenced` counts file blocks through `referencedAssetIds`, so a
	// file the incoming document does not name is swept like an unreferenced image.
	it('sweeps a file blob the imported document no longer references', async () => {
		const assetStore = new MemoryGraphAssetStore();
		const { controller } = setup({ assetStore, confirmGraphImportReplace: () => true });
		await controller.load('active');
		controller.notifyGraphChanged(fileGraph(['stale']), { syncView: true });
		await storeFileAsset(assetStore, 'active', 'stale', 'old rows');

		await controller.importGraphDocument(
			serializeGraphHtmlFile({
				data: makeGraph({ nodeCount: 1, pinned: [0] }),
				viewState: NEUTRAL_VIEW_STATE
			})
		);

		expect(await readAsset(assetStore, 'active', 'stale')).toBeNull();
	});
});

describe('GraphPersistenceController revert', () => {
	/** A loaded 'active' graph with one import already folded into it. */
	async function importedInto(options: Parameters<typeof setup>[0] = {}) {
		const context = setup(options);
		await context.persistence.save('active', {
			data: makeGraph({ nodeCount: 2, edges: [[0, 1]] }),
			viewState: NEUTRAL_VIEW_STATE
		});
		await context.controller.load('active');
		context.controller.notifyViewStateChanged(nonNeutralViewState(), { syncView: true });
		const beforeImport = context.controller.getView();
		await context.controller.importGraphIntoCurrent(
			serializeGraphHtmlFile({
				data: makeGraph({ nodeCount: 3, edges: [[0, 1]] }),
				viewState: { panX: 900, panY: 900, scale: 0.5 }
			})
		);
		return { ...context, beforeImport };
	}

	it('offers the revert once an import has landed, naming exactly what arrived', async () => {
		const { controller } = await importedInto();

		expect(controller.getView().snapshot).toEqual({
			label: 'import',
			createdAt: 456,
			addedNodeCount: 3
		});
	});

	it('keeps offering it across later edits', async () => {
		const { controller } = await importedInto();

		controller.notifyGraphChanged(addNode(controller.getView().graph, { title: 'After' }), {
			syncView: true,
			intent: {
				label: 'add node',
				primaryNodeId: 'n0',
				severedBeaconPreference: []
			}
		});

		// Load-bearing: the offer outlives the edits made after the import it
		// offers to undo, so it is the newest import entry on the undo side rather
		// than the top entry.
		expect(controller.getView().snapshot).not.toBeNull();
	});

	it('hides once the import has been undone past', async () => {
		const { controller } = await importedInto();

		controller.undo();

		expect(controller.getView().snapshot).toBeNull();
		// Nothing is lost: the offer comes back as a plain redo.
		controller.redo();
		expect(controller.getView().snapshot).not.toBeNull();
	});

	it('is served by the persisted tail after a reload', async () => {
		const persistence = new MemoryPersistence();
		await importedInto({ persistence });

		const reloaded = setup({ persistence });
		await reloaded.controller.load('active');

		expect(reloaded.controller.getView().snapshot).toEqual({
			label: 'import',
			createdAt: 456,
			addedNodeCount: 3
		});
	});

	it('offers no revert for a graph with no import behind it', async () => {
		const { controller, persistence } = await importedInto();
		await persistence.save('other', {
			data: makeGraph({ nodeCount: 1 }),
			viewState: NEUTRAL_VIEW_STATE
		});

		await controller.load('other');

		expect(controller.getView().snapshot).toBeNull();
	});

	it('restores the pre-import graph as one new entry, without a remount', async () => {
		const { controller, persistence, beforeImport } = await importedInto();
		const generationBeforeRevert = controller.getView().graphGeneration;
		const revisionBeforeRevert = controller.getView().graphRevision;

		const reverted = await controller.revertToSnapshot();

		expect(reverted).toBe(true);
		const after = controller.getView();
		expect(after.graph.nodes).toEqual(beforeImport.graph.nodes);
		expect(after.graph.edges).toEqual(beforeImport.graph.edges);
		// The canvas stays mounted and keeps the reader's camera: a revert is a
		// history operation now, not a document swap.
		expect(after.graphGeneration).toBe(generationBeforeRevert);
		expect(after.graphRevision).toBe(revisionBeforeRevert + 1);
		expect(after.viewState).toEqual(nonNeutralViewState());
		expect(after.snapshot).toBeNull();
		expect(persistence.save).toHaveBeenLastCalledWith('active', {
			data: after.graph,
			viewState: nonNeutralViewState(),
			history: expect.anything()
		});
	});

	it('lands as an entry a redo can walk back', async () => {
		const { controller } = await importedInto();
		const imported = controller.getView().graph;

		await controller.revertToSnapshot();
		expect(controller.getView().undoLabel).toBe('revert import');

		controller.undo();

		// Strictly kinder than the one-way door it replaces.
		expect(controller.getView().graph.nodes).toEqual(imported.nodes);
	});

	it('leaves both the host and the imported assets in place', async () => {
		const assetStore = new MemoryGraphAssetStore();
		const { controller } = setup({ assetStore });
		await controller.load('active');
		// With an intent, as every canvas commit carries one: the revert goes back
		// to the entry behind the import, which is this edit.
		controller.notifyGraphChanged(imageGraph(['host-asset']), {
			syncView: true,
			intent: { label: 'add image', primaryNodeId: 'n0', severedBeaconPreference: [] }
		});
		await storeAsset(assetStore, 'active', 'host-asset', 'host bytes');
		await controller.importGraphIntoCurrent(
			serializeGraphHtmlFile({
				data: imageGraph(['incoming-asset']),
				viewState: NEUTRAL_VIEW_STATE,
				embeddedAssets: [await embeddedAsset('incoming-asset', 'incoming bytes')]
			})
		);

		await controller.revertToSnapshot();

		expect(controller.getView().graph.nodes).toEqual(imageGraph(['host-asset']).nodes);
		expect(await readAsset(assetStore, 'active', 'host-asset')).toBe('host bytes');
		expect(await readAsset(assetStore, 'active', 'incoming-asset')).toBe('incoming bytes');
	});

	it('reports that there was nothing to revert to', async () => {
		const { controller } = setup();
		await controller.load('active');
		const before = controller.getView();

		const reverted = await controller.revertToSnapshot();

		expect(reverted).toBe(false);
		expect(controller.getView()).toMatchObject({
			graph: before.graph,
			graphGeneration: before.graphGeneration,
			snapshot: null
		});
	});

	it('hides the offer on dismiss, touching neither the graph nor the history', async () => {
		const { controller } = await importedInto();
		const imported = controller.getView();

		controller.dismissSnapshot();

		expect(controller.getView()).toMatchObject({
			graph: imported.graph,
			graphGeneration: imported.graphGeneration,
			snapshot: null
		});
		// The import is still one plain undo away — dismissing hides a card.
		expect(controller.getView().undoLabel).toBe('import');
		expect(await controller.revertToSnapshot()).toBe(false);
	});
});

describe('the persisted undo tail', () => {
	const intent = (label: string): GraphCommitIntent => ({
		label,
		primaryNodeId: 'n0',
		severedBeaconPreference: []
	});

	/** Edit, cache, then load the same graph into a fresh controller. */
	async function reopened(
		edit: (controller: GraphPersistenceController) => void,
		options: { storage?: MemoryStorage } = {}
	) {
		const storage = options.storage ?? new MemoryStorage();
		const first = setupWithStorage(storage);
		await first.controller.load('graph-1');
		edit(first.controller);
		await first.controller.flushPendingSave();

		const second = setupWithStorage(storage);
		await second.controller.load('graph-1');
		return { storage, before: first.controller, after: second.controller };
	}

	/** Like `setup`, but over real `LocalStoragePersistence` so the envelope is exercised. */
	function setupWithStorage(storage: MemoryStorage) {
		const events: string[] = [];
		const persistence = new LocalStoragePersistence(storage, 'test', () => 1);
		let scheduler: TestScheduler | null = null;
		const controller = new GraphPersistenceController({
			persistence,
			createScheduler: (onStatus) => {
				scheduler = new TestScheduler(persistence, onStatus, events);
				return scheduler;
			},
			createDefaultGraph,
			navigate: vi.fn(),
			storageNamespace: 'test',
			now: () => 456
		});
		if (scheduler === null) throw new Error('Expected scheduler to be created');
		return { controller, scheduler: scheduler as TestScheduler };
	}

	it('rebuilds the states the in-memory stack held, with their canvas fields', async () => {
		const { before, after } = await reopened((controller) => {
			controller.notifyGraphChanged(addNode(controller.getView().graph, { title: 'Added' }), {
				syncView: true,
				intent: intent('add node')
			});
			controller.notifyGraphChanged(
				setTagColor(controller.getView().graph, 'nodeTags', 'physics', '#123456'),
				{ syncView: true, intent: intent('tag color') }
			);
		});

		expect(after.getView().canUndo).toBe(true);
		expect(after.getView().undoLabel).toBe('tag color');

		after.undo();
		expect(after.getView().graph.tagColorConfig.nodeTags).toEqual({});
		expect(after.getView().graph.nodes.map((node) => node.title)).toEqual(
			before.getView().graph.nodes.map((node) => node.title)
		);
		expect(after.getView().restoredCanvasState).toEqual({
			primaryNodeId: 'n0',
			severedBeaconPreference: []
		});

		after.undo();
		expect(after.getView().graph.nodes).toHaveLength(1);
		// The seed is the state the graph loaded in, and there is nothing behind it.
		expect(after.getView().canUndo).toBe(false);
	});

	it('does not survive a redo across the reload', async () => {
		const { after } = await reopened((controller) => {
			controller.notifyGraphChanged(addNode(controller.getView().graph, {}), {
				syncView: true,
				intent: intent('add node')
			});
			controller.undo();
		});

		// The tail chains backwards from the draft's own graph, so nothing forward
		// of it can be described — which is what every mainstream editor does.
		expect(after.getView().canRedo).toBe(false);
	});

	it('drops the tail on a schema-version mismatch, leaving the graph intact', async () => {
		const storage = new MemoryStorage();
		const { after: first } = await reopened(
			(controller) => {
				controller.notifyGraphChanged(addNode(controller.getView().graph, { title: 'Added' }), {
					syncView: true,
					intent: intent('add node')
				});
			},
			{ storage }
		);
		expect(first.getView().canUndo).toBe(true);

		const key = graphStorageKey('test', 'graph-1');
		const payload = JSON.parse(storage.getItem(key) ?? '{}');
		storage.setItem(key, JSON.stringify({ ...payload, schemaVersion: CURRENT_SCHEMA_VERSION - 1 }));

		const reloaded = setupWithStorage(storage);
		await reloaded.controller.load('graph-1');

		expect(reloaded.controller.getView().canUndo).toBe(false);
		expect(reloaded.controller.getView().graph.nodes).toHaveLength(2);
	});

	it('drops a tail that does not describe the graph the draft holds', async () => {
		const storage = new MemoryStorage();
		await reopened(
			(controller) => {
				controller.notifyGraphChanged(addNode(controller.getView().graph, { title: 'Added' }), {
					syncView: true,
					intent: intent('add node')
				});
			},
			{ storage }
		);

		// What the losing tab leaves behind: a tail describing a graph the winning
		// tab has already replaced.
		const key = graphStorageKey('test', 'graph-1');
		const payload = JSON.parse(storage.getItem(key) ?? '{}');
		storage.setItem(
			key,
			JSON.stringify({ ...payload, data: { ...payload.data, nodes: [], edges: [] } })
		);

		const reloaded = setupWithStorage(storage);
		await reloaded.controller.load('graph-1');

		expect(reloaded.controller.getView().canUndo).toBe(false);
		expect(reloaded.controller.getView().graph.nodes).toHaveLength(0);
	});

	it('caps the tail at the configured entry count', async () => {
		const storage = new MemoryStorage();
		await reopened(
			(controller) => {
				for (let index = 0; index < APP_CONFIG.history.persistedEntryCount + 5; index += 1) {
					controller.notifyGraphChanged(
						addNode(controller.getView().graph, { title: `Node ${index}` }),
						{ syncView: true, intent: intent('add node') }
					);
				}
			},
			{ storage }
		);

		const payload = JSON.parse(storage.getItem(graphStorageKey('test', 'graph-1')) ?? '{}');
		expect(payload.history.entries).toHaveLength(APP_CONFIG.history.persistedEntryCount);
	});

	it('writes no tail into an exported file', async () => {
		const { controller } = setup();
		await controller.load('graph-1');
		controller.notifyGraphChanged(addNode(controller.getView().graph, {}), {
			syncView: true,
			intent: intent('add node')
		});

		const artifact = await controller.exportGraphDocument();

		// An entry holds the content an edit removed, so a tail in a document would
		// send deleted material along with it.
		expect(artifact.content).not.toContain('"history"');
	});
});

describe('undo history', () => {
	const intent = (label: string, extra: Partial<GraphCommitIntent> = {}): GraphCommitIntent => ({
		label,
		primaryNodeId: 'n0',
		severedBeaconPreference: [],
		...extra
	});

	/** A graph through the layout path: positions rewritten, everything else shared. */
	const relaxed = (graph: MultigraphData): MultigraphData => ({
		...graph,
		posByNodeId: { ...graph.posByNodeId, n0: { x: 17, y: 17 } }
	});

	async function loadedController(options: Parameters<typeof setup>[0] = {}) {
		const harness = setup(options);
		await harness.controller.load('graph-1');
		return harness;
	}

	it('pushes one entry for one edit, and offers it by name', async () => {
		const { controller } = await loadedController();
		const edited = addNode(controller.getView().graph, {});

		controller.notifyGraphChanged(edited, { syncView: true, intent: intent('add node') });

		expect(controller.getView().canUndo).toBe(true);
		expect(controller.getView().undoLabel).toBe('add node');
		expect(controller.getView().canRedo).toBe(false);
	});

	it('pushes nothing for a position-only change', async () => {
		const { controller } = await loadedController();

		controller.notifyGraphChanged(relaxed(controller.getView().graph), {
			syncView: true,
			intent: intent('layout')
		});

		expect(controller.getView().canUndo).toBe(false);
	});

	it('pushes nothing for a commit that rebuilt an array to an equal value', async () => {
		const { controller } = await loadedController();
		const graph = controller.getView().graph;

		// Fails the O(1) reference test, passes the fingerprint confirmation.
		controller.notifyGraphChanged(
			{ ...graph, nodes: [...graph.nodes], posByNodeId: { ...graph.posByNodeId } },
			{ syncView: true, intent: intent('rename node') }
		);

		expect(controller.getView().canUndo).toBe(false);
	});

	it('lands a coalesce run as one entry keeping the run start as its before-state', async () => {
		const { controller } = await loadedController();
		const loaded = controller.getView().graph;
		const key = 'tag-color:nodeTags:physics';

		for (const color of ['#111111', '#222222', '#333333']) {
			controller.notifyGraphChanged(
				setTagColor(controller.getView().graph, 'nodeTags', 'physics', color),
				{ syncView: true, intent: intent('tag color', { coalesceKey: key }) }
			);
		}

		expect(controller.getView().graph.tagColorConfig.nodeTags.physics).toBe('#333333');
		controller.undo();
		// One undo returns all the way to the colour the run started from.
		expect(controller.getView().graph.tagColorConfig).toEqual(loaded.tagColorConfig);
		expect(controller.getView().canUndo).toBe(false);
	});

	it('ends a run on a different key, so the next edit is its own entry', async () => {
		const { controller } = await loadedController();

		controller.notifyGraphChanged(
			setTagColor(controller.getView().graph, 'nodeTags', 'physics', '#111111'),
			{ syncView: true, intent: intent('tag color', { coalesceKey: 'tag-color:nodeTags:physics' }) }
		);
		controller.notifyGraphChanged(
			setTagColor(controller.getView().graph, 'nodeTags', 'maths', '#222222'),
			{ syncView: true, intent: intent('tag color', { coalesceKey: 'tag-color:nodeTags:maths' }) }
		);

		controller.undo();
		expect(controller.getView().graph.tagColorConfig.nodeTags).toEqual({ physics: '#111111' });
		expect(controller.getView().canUndo).toBe(true);
	});

	it('closes a run so a later scrub of the same tag starts a new entry', async () => {
		const { controller } = await loadedController();
		const key = 'tag-color:nodeTags:physics';

		controller.notifyGraphChanged(
			setTagColor(controller.getView().graph, 'nodeTags', 'physics', '#111111'),
			{ syncView: true, intent: intent('tag color', { coalesceKey: key }) }
		);
		// The swatch's `change`, carrying the colour its last `input` already sent.
		controller.notifyGraphChanged(
			setTagColor(controller.getView().graph, 'nodeTags', 'physics', '#111111'),
			{ syncView: true, intent: intent('tag color', { coalesceKey: key, endsCoalesceRun: true }) }
		);
		controller.notifyGraphChanged(
			setTagColor(controller.getView().graph, 'nodeTags', 'physics', '#999999'),
			{ syncView: true, intent: intent('tag color', { coalesceKey: key }) }
		);

		controller.undo();
		expect(controller.getView().graph.tagColorConfig.nodeTags.physics).toBe('#111111');
	});

	it('restores the graph, the pin pointer and the beacon hint', async () => {
		const { controller } = await loadedController();
		const loaded = controller.getView().graph;

		controller.notifyGraphChanged(addNode(loaded, {}), {
			syncView: true,
			intent: intent('add node', { primaryNodeId: 'n1', severedBeaconPreference: ['n1'] })
		});
		// An edit is not a restore, so the canvas has nothing to put back yet.
		expect(controller.getView().restoredCanvasState).toBeNull();

		controller.undo();

		expect(controller.getView().graph.nodes).toBe(loaded.nodes);
		// The seed records no pointer: nothing had committed when the graph loaded,
		// so the canvas re-derives one from a value that names no node.
		expect(controller.getView().restoredCanvasState).toEqual({
			primaryNodeId: '',
			severedBeaconPreference: []
		});

		controller.redo();
		expect(controller.getView().restoredCanvasState).toEqual({
			primaryNodeId: 'n1',
			severedBeaconPreference: ['n1']
		});
	});

	it('bumps graphRevision and not graphGeneration, so the canvas keeps its place', async () => {
		const { controller } = await loadedController();
		controller.notifyGraphChanged(addNode(controller.getView().graph, {}), {
			syncView: true,
			intent: intent('add node')
		});
		const before = controller.getView();

		controller.undo();

		expect(controller.getView().graphRevision).toBe(before.graphRevision + 1);
		expect(controller.getView().graphGeneration).toBe(before.graphGeneration);
	});

	it('names the operation in the notice, both ways', async () => {
		const { controller } = await loadedController();
		controller.notifyGraphChanged(addNode(controller.getView().graph, {}), {
			syncView: true,
			intent: intent('delete node')
		});

		controller.undo();
		// Sticky, so the restore's own cache write does not cover the answer to the
		// tap that caused it.
		expect(controller.getView().status).toEqual({
			state: 'notice',
			sticky: true,
			message: 'Undid "delete node".'
		});
		expect(controllerNotice(controller.getView())).toBe('Undid "delete node".');
		expect(controllerNoticeSeverity(controller.getView())).toBe('info');

		controller.redo();
		expect(controller.getView().status).toEqual({
			state: 'notice',
			sticky: true,
			message: 'Redid "delete node".'
		});
	});

	it('follows the restored graph with the baseline document status and a cache write', async () => {
		const { controller, scheduler } = await loadedController();
		const loaded = controller.getView().graph;
		controller.notifyGraphChanged(addNode(loaded, {}), {
			syncView: true,
			intent: intent('add node')
		});
		expect(controller.getView().documentStatus).toBe('new-dirty');
		scheduler.schedule.mockClear();

		controller.undo();

		expect(controller.getView().documentStatus).toBe('new-clean');
		expect(scheduler.schedule).toHaveBeenCalled();
	});

	it('redoes back to the state an undo left', async () => {
		const { controller } = await loadedController();
		const edited = addNode(controller.getView().graph, {});
		controller.notifyGraphChanged(edited, { syncView: true, intent: intent('add node') });

		controller.undo();
		expect(controller.getView().canRedo).toBe(true);
		expect(controller.getView().redoLabel).toBe('add node');
		controller.redo();

		expect(controller.getView().graph.nodes).toBe(edited.nodes);
		expect(controller.getView().canRedo).toBe(false);
	});

	it('treats undo at the bottom and redo at the top as no-ops', async () => {
		const { controller } = await loadedController();

		expect(controller.undo()).toBe(false);
		expect(controller.redo()).toBe(false);
	});

	it('drops the redo tail when an edit follows an undo', async () => {
		const { controller } = await loadedController();
		controller.notifyGraphChanged(addNode(controller.getView().graph, {}), {
			syncView: true,
			intent: intent('add node')
		});
		controller.undo();

		controller.notifyGraphChanged(
			setTagColor(controller.getView().graph, 'nodeTags', 'physics', '#111111'),
			{ syncView: true, intent: intent('tag color') }
		);

		expect(controller.getView().canRedo).toBe(false);
	});

	it('clears and re-seeds on a load', async () => {
		const { controller } = await loadedController();
		controller.notifyGraphChanged(addNode(controller.getView().graph, {}), {
			syncView: true,
			intent: intent('add node')
		});

		await controller.load('graph-2');

		expect(controller.getView().canUndo).toBe(false);
		expect(controller.getView().canRedo).toBe(false);
	});

	it('clears on a new graph and on a graph switch', async () => {
		const fresh = await loadedController({ confirmNewGraphReplace: () => true });
		fresh.controller.notifyGraphChanged(addNode(fresh.controller.getView().graph, {}), {
			syncView: true,
			intent: intent('add node')
		});
		await fresh.controller.createGraph('graph-new');
		expect(fresh.controller.getView().canUndo).toBe(false);

		const switched = await loadedController();
		switched.controller.notifyGraphChanged(addNode(switched.controller.getView().graph, {}), {
			syncView: true,
			intent: intent('add node')
		});
		await switched.controller.selectGraph('graph-2');
		expect(switched.controller.getView().canUndo).toBe(false);
	});

	it('neither saves nor pushes for a commit naming a superseded generation', async () => {
		const { controller, scheduler } = await loadedController();
		const staleGeneration = controller.getView().graphGeneration;
		await controller.load('graph-2');
		scheduler.schedule.mockClear();

		controller.notifyGraphChanged(addNode(controller.getView().graph, {}), {
			syncView: true,
			generation: staleGeneration,
			intent: intent('add node')
		});

		expect(scheduler.schedule).not.toHaveBeenCalled();
		expect(controller.getView().canUndo).toBe(false);
	});

	it('evicts oldest-first on the retained-pointer ceiling', async () => {
		// One node per entry, so a ceiling of two admits two entries and no more.
		const { controller } = await loadedController({ historyCeiling: 2 });

		for (const color of ['#111111', '#222222', '#333333', '#444444']) {
			controller.notifyGraphChanged(
				setTagColor(controller.getView().graph, 'nodeTags', 'physics', color),
				{ syncView: true, intent: intent('tag color') }
			);
		}

		controller.undo();
		expect(controller.getView().canUndo).toBe(false);
		expect(controller.getView().graph.tagColorConfig.nodeTags.physics).toBe('#333333');
	});
});

describe('the asset trash and the history', () => {
	const intent = (label: string): GraphCommitIntent => ({
		label,
		primaryNodeId: 'n0',
		severedBeaconPreference: []
	});

	/** A graph whose image block has been removed, as `deleteNodeImage` leaves it. */
	const withoutImages = (): MultigraphData => makeGraph({ nodeCount: 1 });

	async function tombstonedController(options: Parameters<typeof setup>[0] = {}) {
		const assetStore = new MemoryGraphAssetStore();
		const context = setup({ ...options, assetStore });
		await context.controller.load('active');
		context.controller.notifyGraphChanged(imageGraph(['pic']), {
			syncView: true,
			intent: intent('add image')
		});
		await storeAsset(assetStore, 'active', 'pic', 'picture bytes');

		// What the canvas does now: tombstone rather than delete, so the block an
		// undo brings back still resolves to something.
		await tombstoneAsset(assetStore, 'active', 'pic', () => 1);
		context.controller.notifyGraphChanged(withoutImages(), {
			syncView: true,
			intent: intent('remove image')
		});
		await context.controller.flushPendingSave();
		return { ...context, assetStore };
	}

	it('keeps an undone image alive while its entry lives', async () => {
		const { controller, assetStore } = await tombstonedController();

		controller.undo();
		await Promise.resolve();

		expect(controller.getView().graph.nodes[0].content).toBeDefined();
		expect(await readAsset(assetStore, 'active', 'pic')).toBe('picture bytes');
	});

	it('collects the blob once eviction puts its entry out of reach', async () => {
		// One node per entry, so a ceiling of one keeps only the state the document
		// is in — every entry that named the image is evicted.
		const { controller, assetStore } = await tombstonedController({ historyCeiling: 1 });

		controller.notifyGraphChanged(addNode(controller.getView().graph, {}), {
			syncView: true,
			intent: intent('add node')
		});
		await vi.waitFor(async () => expect(await readAsset(assetStore, 'active', 'pic')).toBeNull());

		expect(controller.getView().canUndo).toBe(false);
	});

	it('collects the blob a fresh edit discards with the redo tail', async () => {
		const { controller, assetStore } = await tombstonedController();

		// Back past the state that added the image: it is on the redo side now, and
		// a blob one redo from being on screen is not collectable.
		controller.undo();
		controller.undo();
		await Promise.resolve();
		expect(await readAsset(assetStore, 'active', 'pic')).toBe('picture bytes');

		// Editing here discards that tail, and with it the last entry that could
		// ever put the block back.
		controller.notifyGraphChanged(addNode(controller.getView().graph, {}), {
			syncView: true,
			intent: intent('add node')
		});
		await vi.waitFor(async () => expect(await readAsset(assetStore, 'active', 'pic')).toBeNull());
	});

	it('does not sweep a blob the tail it just rebuilt still names', async () => {
		const persistence = new MemoryPersistence();
		const { assetStore } = await tombstonedController({ persistence });

		const reloaded = setup({ persistence, assetStore });
		await reloaded.controller.load('active');

		// The ordering the load path states at its call site: sweeping before the
		// rebuild would delete exactly the blobs the tail was about to resurrect,
		// and the symptom is a broken image several undos later.
		expect(await readAsset(assetStore, 'active', 'pic')).toBe('picture bytes');
		expect(reloaded.controller.getView().undoLabel).toBe('remove image');
	});
});

describe('statusToNotice', () => {
	it('maps every controller status to deterministic notice text', () => {
		const cases: Array<[ControllerStatus, string]> = [
			[{ state: 'loading', graphId: 'graph' }, 'Loading graph...'],
			[{ state: 'loaded', graphId: 'graph' }, 'Loaded "graph".'],
			[{ state: 'reloaded', graphId: 'graph' }, 'Reloaded from another tab.'],
			[{ state: 'saving' }, 'Caching draft...'],
			[{ state: 'saved', savedAt: 1 }, 'Draft cached.'],
			[
				{ state: 'warning', savedAt: 1, message: 'Local cache is 81% full.' },
				'Local cache is 81% full.'
			],
			[{ state: 'notice', message: 'Import cancelled.' }, 'Import cancelled.'],
			[{ state: 'exported', filename: 'graph.html' }, 'Saved graph.html. Check your downloads.'],
			[{ state: 'error', message: 'quota exceeded' }, 'Could not cache draft. quota exceeded']
		];

		for (const [status, notice] of cases) {
			expect(statusToNotice(status)).toBe(notice);
		}
	});
});
