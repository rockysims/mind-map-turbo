import { describe, expect, it, vi } from 'vitest';
import { makeGraph } from './components/ui/Multigraph/lib/testFixtures';
import type { MultigraphData } from './components/ui/types/multigraph';
import { GRAPH_HTML_READER_VERSION, parseGraphFileText, serializeGraphHtmlFile } from './graphFile';
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
import {
	documentDraftGraphId,
	graphStorageKey,
	type GraphSummary,
	type PersistedGraphRecord,
	type Persistence
} from './persistence';
import type { SaveStatus } from './saveScheduler';

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
	private pending: { id: string; graph: PersistedGraphRecord } | null = null;
	failFlushOnce = false;
	warnOnFlush = false;
	dispose = vi.fn();

	constructor(
		private readonly persistence: Persistence,
		private readonly onStatus: (status: SaveStatus) => void,
		private readonly events: string[]
	) {}

	schedule = vi.fn((id: string, data: MultigraphData, viewState: ViewState): void => {
		this.pending = { id, graph: { data, viewState } };
	});

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
		await this.persistence.save(save.id, save.graph);
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

function createDefaultGraph(): MultigraphData {
	return makeGraph({ nodeCount: 1 });
}

function nonNeutralViewState(): ViewState {
	return { panX: 120, panY: -80, scale: 1.5 };
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
		durability?: 'durable' | 'memory-only';
	} = {}
) {
	const persistence = new MemoryPersistence();
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
		createDocumentId: () => 'doc-new',
		now: () => 456,
		createGraphId: () => 'graph-new'
	});

	if (scheduler === null) throw new Error('Expected scheduler to be created');
	return { controller, persistence, scheduler: scheduler as TestScheduler, navigate, events };
}

describe('GraphPersistenceController', () => {
	it('loads a missing graph by creating and saving the default graph', async () => {
		const { controller, persistence, scheduler } = setup();

		const result = await controller.load('missing');

		expect(persistence.load).toHaveBeenCalledWith('missing');
		expect(result).toEqual({ createdDefaultGraph: true });
		expect(scheduler.schedule).toHaveBeenCalledWith(
			'missing',
			createDefaultGraph(),
			NEUTRAL_VIEW_STATE
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
		expect(scheduler.schedule).toHaveBeenLastCalledWith('active', edited, NEUTRAL_VIEW_STATE);
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
			fileViewState
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

		expect(scheduler.schedule).toHaveBeenLastCalledWith('active', edited, NEUTRAL_VIEW_STATE);
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
