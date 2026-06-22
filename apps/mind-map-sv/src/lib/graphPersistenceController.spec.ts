import { describe, expect, it, vi } from 'vitest';
import { makeGraph } from './components/ui/Multigraph/lib/testFixtures';
import type { MultigraphData } from './components/ui/types/multigraph';
import { parseGraphFileText, serializeGraphHtmlFile } from './graphFile';
import { CURRENT_SCHEMA_VERSION, NEUTRAL_VIEW_STATE, type ViewState } from './migrations';
import {
	GraphPersistenceController,
	statusToNotice,
	type ControllerStatus,
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
		this.onStatus({ state: 'saved', savedAt: 123 });
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
		confirmGraphImportReplace: options.confirmGraphImportReplace,
		confirmNewGraphReplace: options.confirmNewGraphReplace,
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

		await controller.load('missing');

		expect(persistence.load).toHaveBeenCalledWith('missing');
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

		await controller.load('saved');

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

	it('does not confirm before replacing a graph that matches the last download', async () => {
		const confirmNewGraphReplace = vi.fn(() => true);
		const { controller } = setup({ confirmNewGraphReplace });
		await controller.load('active');
		controller.exportGraphDocument();

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
			status: { state: 'notice', message: 'New graph cancelled.' }
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

	it('loads embedded HTML documents when no local draft exists', async () => {
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

	it('prefers a dirty local document draft over the embedded file payload', async () => {
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
				message: 'Kept local draft; another tab changed this document.'
			}
		});
	});

	it('exports current graph and view state as a self-contained HTML artifact', async () => {
		const { controller } = setup();
		const graph = makeGraph({
			nodeCount: 3,
			edges: [
				[0, 1],
				[1, 2]
			]
		});
		const viewState = nonNeutralViewState();
		await controller.load('active');
		controller.notifyGraphChanged(graph, { syncView: true });
		controller.notifyViewStateChanged(viewState, { syncView: true });

		const artifact = controller.exportGraphDocument('<!doctype html><html><body></body></html>');
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

	it('imports a valid graph file into the active graph id and refreshes summaries', async () => {
		const confirmReplace = vi.fn(() => true);
		const { controller, persistence } = setup({ confirmGraphImportReplace: confirmReplace });
		const existing = makeGraph({ nodeCount: 2 });
		await persistence.save('active', { data: existing, viewState: NEUTRAL_VIEW_STATE });
		await controller.load('active');
		const generationBeforeImport = controller.getView().graphGeneration;

		controller.notifyGraphChanged(makeGraph({ nodeCount: 4 }));
		const importedGraph = makeGraph({ nodeCount: 3, edges: [[0, 1]] });
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
			status: { state: 'notice', message: 'Imported graph into "active".' }
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
		}).replace('"minReaderVersion": 1', '"minReaderVersion": 999');

		const result = await controller.importGraphDocument(html);

		expect(result).toBe('opened-in-new-tab');
		expect(openUnsupportedHtmlFile).toHaveBeenCalledWith(html);
		expect(controller.getView().status).toEqual({
			state: 'notice',
			message: 'Opened newer graph file in a new tab.'
		});
	});

	it('autosaves pan and zoom changes without mutating graph positions', async () => {
		const { controller, persistence, scheduler } = setup();
		await controller.load('active');
		const graphBefore = controller.getView().graph;
		const positionsBefore = graphBefore.posByNodeId;
		const updatedViewState = { panX: 25, panY: 10, scale: 0.8 };

		controller.notifyViewStateChanged(updatedViewState, { syncView: true });
		await scheduler.flush();

		expect(controller.getView().graph).toEqual(graphBefore);
		expect(controller.getView().graph.posByNodeId).toEqual(positionsBefore);
		expect(persistence.save).toHaveBeenLastCalledWith('active', {
			data: graphBefore,
			viewState: updatedViewState
		});
		expect(controller.getView().graphSummaries).toEqual([{ id: 'active', updatedAt: 2 }]);
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
			message: 'Import failed: unable to read file.'
		});
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
			[{ state: 'reloaded', graphId: 'graph' }, 'Reloaded "graph" from another tab.'],
			[{ state: 'saving' }, 'Saving...'],
			[{ state: 'saved', savedAt: 1 }, 'Saved.'],
			[
				{ state: 'warning', savedAt: 1, message: 'Stored graphs use 81% of the local budget.' },
				'Stored graphs use 81% of the local budget.'
			],
			[{ state: 'notice', message: 'Import cancelled.' }, 'Import cancelled.'],
			[{ state: 'error', message: 'quota exceeded' }, 'Save failed: quota exceeded']
		];

		for (const [status, notice] of cases) {
			expect(statusToNotice(status)).toBe(notice);
		}
	});
});
