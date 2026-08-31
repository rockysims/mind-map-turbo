import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeGraph } from './components/ui/Multigraph/lib/testFixtures';
import { graphFingerprint } from './documentStatus';
import { NEUTRAL_VIEW_STATE } from './migrations';
import { SaveScheduler, calculateQuotaWarning, type SaveStatus } from './saveScheduler';
import type { Persistence } from './persistence';

function makePersistence(): Persistence {
	return {
		load: vi.fn(),
		save: vi.fn(async () => undefined),
		list: vi.fn(),
		delete: vi.fn()
	};
}

describe('SaveScheduler', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('debounces bursts and saves only the latest graph', async () => {
		vi.useFakeTimers();
		const persistence = makePersistence();
		const scheduler = new SaveScheduler({ persistence, debounceMs: 500 });
		const first = makeGraph({ nodeCount: 1 });
		const latest = makeGraph({ nodeCount: 2 });

		scheduler.schedule('graph', first, NEUTRAL_VIEW_STATE);
		scheduler.schedule('graph', latest, NEUTRAL_VIEW_STATE);
		await vi.advanceTimersByTimeAsync(499);
		expect(persistence.save).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);

		expect(persistence.save).toHaveBeenCalledTimes(1);
		expect(persistence.save).toHaveBeenCalledWith('graph', {
			data: latest,
			viewState: NEUTRAL_VIEW_STATE
		});
	});

	it('flushes pending graph changes immediately', async () => {
		vi.useFakeTimers();
		const persistence = makePersistence();
		const scheduler = new SaveScheduler({ persistence, debounceMs: 500 });
		const graph = makeGraph({ nodeCount: 1 });

		scheduler.schedule('graph', graph, NEUTRAL_VIEW_STATE);
		await scheduler.flush();
		await vi.advanceTimersByTimeAsync(500);

		expect(persistence.save).toHaveBeenCalledTimes(1);
		expect(persistence.save).toHaveBeenCalledWith('graph', {
			data: graph,
			viewState: NEUTRAL_VIEW_STATE
		});
	});

	it('reports save errors without dropping the pending graph', async () => {
		const statuses: SaveStatus[] = [];
		const persistence = makePersistence();
		vi.mocked(persistence.save).mockRejectedValueOnce(new Error('quota exceeded'));
		const scheduler = new SaveScheduler({
			persistence,
			debounceMs: 500,
			onStatus: (status) => statuses.push(status)
		});
		const graph = makeGraph({ nodeCount: 1 });

		scheduler.schedule('graph', graph, NEUTRAL_VIEW_STATE);
		await expect(scheduler.flush()).rejects.toThrow('quota exceeded');
		await scheduler.flush();

		expect(persistence.save).toHaveBeenCalledTimes(2);
		expect(statuses).toContainEqual({ state: 'error', message: 'quota exceeded' });
	});

	it('reports a failed debounced save without an unhandled rejection', async () => {
		vi.useFakeTimers();
		const statuses: SaveStatus[] = [];
		const unhandled: unknown[] = [];
		const pushUnhandled = (reason: unknown): void => {
			unhandled.push(reason);
		};
		const persistence = makePersistence();
		vi.mocked(persistence.save).mockRejectedValueOnce(new Error('quota exceeded'));
		const scheduler = new SaveScheduler({
			persistence,
			debounceMs: 500,
			onStatus: (status) => statuses.push(status)
		});
		process.on('unhandledRejection', pushUnhandled);

		try {
			scheduler.schedule('graph', makeGraph({ nodeCount: 1 }), NEUTRAL_VIEW_STATE);
			await vi.advanceTimersByTimeAsync(500);
			// Give any rejection that escaped the scheduler a turn to be reported.
			vi.useRealTimers();
			await new Promise((resolve) => setTimeout(resolve, 0));
		} finally {
			process.off('unhandledRejection', pushUnhandled);
		}

		expect(statuses).toContainEqual({ state: 'error', message: 'quota exceeded' });
		expect(unhandled).toEqual([]);
	});

	it('reports the fingerprint of the graph data that was persisted', async () => {
		const statuses: SaveStatus[] = [];
		const scheduler = new SaveScheduler({
			persistence: makePersistence(),
			debounceMs: 0,
			now: () => 7,
			onStatus: (status) => statuses.push(status)
		});
		const graph = makeGraph({ nodeCount: 2 });

		scheduler.schedule('graph', graph, NEUTRAL_VIEW_STATE);
		await scheduler.flush();

		expect(statuses).toContainEqual({
			state: 'saved',
			savedAt: 7,
			fingerprint: graphFingerprint(graph)
		});
	});

	it('reports quota warnings after successful saves', async () => {
		const statuses: SaveStatus[] = [];
		const scheduler = new SaveScheduler({
			persistence: makePersistence(),
			debounceMs: 0,
			now: () => 42,
			estimateUsageBytes: () => 81,
			quotaBudgetBytes: 100,
			quotaWarningRatio: 0.8,
			onStatus: (status) => statuses.push(status)
		});
		const graph = makeGraph({ nodeCount: 1 });

		scheduler.schedule('graph', graph, NEUTRAL_VIEW_STATE);
		await scheduler.flush();

		expect(statuses).toContainEqual({
			state: 'warning',
			savedAt: 42,
			fingerprint: graphFingerprint(graph),
			message: 'Local cache is 81% full.'
		});
	});
});

describe('calculateQuotaWarning', () => {
	it('calculates deterministic warning thresholds', () => {
		expect(calculateQuotaWarning(79, 100, 0.8)).toMatchObject({
			ratio: 0.79,
			shouldWarn: false
		});
		expect(calculateQuotaWarning(80, 100, 0.8)).toMatchObject({
			ratio: 0.8,
			shouldWarn: true
		});
	});
});
