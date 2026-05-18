import { describe, expect, it, vi } from 'vitest';
import { makeGraph } from './components/ui/Multigraph/lib/testFixtures';
import type { MultigraphData } from './components/ui/types/multigraph';
import {
	GraphPersistenceController,
	statusToNotice,
	type ControllerStatus,
	type GraphSaveScheduler
} from './graphPersistenceController';
import { DEFAULT_GRAPH_ID } from './graphRoute';
import { graphStorageKey, type GraphSummary, type Persistence } from './persistence';
import type { SaveStatus } from './saveScheduler';

class MemoryPersistence implements Persistence {
	private readonly graphs = new Map<string, { data: MultigraphData; updatedAt: number }>();
	private clock = 0;

	load = vi.fn(async (id: string): Promise<MultigraphData | null> => {
		return this.graphs.get(id)?.data ?? null;
	});

	save = vi.fn(async (id: string, data: MultigraphData): Promise<void> => {
		this.clock += 1;
		this.graphs.set(id, { data, updatedAt: this.clock });
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
	private pending: { id: string; data: MultigraphData } | null = null;
	failFlushOnce = false;
	dispose = vi.fn();

	constructor(
		private readonly persistence: Persistence,
		private readonly onStatus: (status: SaveStatus) => void,
		private readonly events: string[]
	) {}

	schedule = vi.fn((id: string, data: MultigraphData): void => {
		this.pending = { id, data };
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
		await this.persistence.save(save.id, save.data);
		this.pending = null;
		this.onStatus({ state: 'saved', savedAt: 123 });
	});
}

function createDefaultGraph(): MultigraphData {
	return makeGraph({ nodeCount: 1 });
}

function setup() {
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
		expect(scheduler.schedule).toHaveBeenCalledWith('missing', createDefaultGraph());
		expect(persistence.save).toHaveBeenCalledWith('missing', createDefaultGraph());
		expect(controller.getView()).toMatchObject({
			graph: createDefaultGraph(),
			loadedGraphId: 'missing',
			status: { state: 'saved', savedAt: 123 },
			graphSummaries: [{ id: 'missing', updatedAt: 1 }]
		});
	});

	it('loads existing graphs and reports loaded status', async () => {
		const { controller, persistence } = setup();
		const graph = makeGraph({ nodeCount: 2 });
		await persistence.save('saved', graph);

		await controller.load('saved');

		expect(controller.getView()).toMatchObject({
			graph,
			loadedGraphId: 'saved',
			status: { state: 'loaded', graphId: 'saved' }
		});
	});

	it('schedules saves when the graph changes', async () => {
		const { controller, scheduler } = setup();
		const graph = makeGraph({ nodeCount: 2 });

		await controller.load('active');
		controller.notifyGraphChanged(graph);

		expect(controller.getView().graph).toEqual(graph);
		expect(scheduler.schedule).toHaveBeenLastCalledWith('active', graph);
	});

	it('flushes pending saves before navigating to another graph', async () => {
		const { controller, navigate, events } = setup();

		await controller.load('active');
		controller.notifyGraphChanged(makeGraph({ nodeCount: 2 }));
		await controller.selectGraph('next');

		expect(navigate).toHaveBeenCalledWith('next');
		expect(events).toEqual(['save', 'save', 'navigate:next']);
	});

	it('creates generated graph ids through navigation', async () => {
		const { controller, navigate } = setup();
		await controller.load('active');

		await controller.createGraph();

		expect(navigate).toHaveBeenCalledWith('graph-new');
	});

	it('deletes the selected graph and navigates to an existing graph when one remains', async () => {
		const { controller, persistence, navigate } = setup();
		await persistence.save('first', makeGraph({ nodeCount: 1 }));
		await persistence.save('second', makeGraph({ nodeCount: 2 }));
		await controller.load('second');

		await controller.deleteGraph('second');

		expect(persistence.delete).toHaveBeenCalledWith('second');
		expect(navigate).toHaveBeenCalledWith('first');
		expect(controller.getView().graphSummaries).toEqual([{ id: 'first', updatedAt: 1 }]);
	});

	it('reloads the default graph in place when deleting the only default graph', async () => {
		const { controller, persistence, navigate } = setup();
		await persistence.save(DEFAULT_GRAPH_ID, makeGraph({ nodeCount: 2 }));
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
		await persistence.save('active', first);
		await controller.load('active');
		await persistence.save('active', updated);
		await persistence.save('other', makeGraph({ nodeCount: 2 }));

		await controller.handleStorageEvent({ key: graphStorageKey('test', 'other') });
		expect(controller.getView().graph).toEqual(first);

		await controller.handleStorageEvent({ key: graphStorageKey('test', 'active') });
		expect(controller.getView()).toMatchObject({
			graph: updated,
			status: { state: 'reloaded', graphId: 'active' }
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
			[{ state: 'error', message: 'quota exceeded' }, 'Save failed: quota exceeded']
		];

		for (const [status, notice] of cases) {
			expect(statusToNotice(status)).toBe(notice);
		}
	});
});
