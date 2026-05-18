import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeGraph } from './components/ui/Multigraph/lib/testFixtures';
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

		scheduler.schedule('graph', first);
		scheduler.schedule('graph', latest);
		await vi.advanceTimersByTimeAsync(499);
		expect(persistence.save).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);

		expect(persistence.save).toHaveBeenCalledTimes(1);
		expect(persistence.save).toHaveBeenCalledWith('graph', latest);
	});

	it('flushes pending graph changes immediately', async () => {
		vi.useFakeTimers();
		const persistence = makePersistence();
		const scheduler = new SaveScheduler({ persistence, debounceMs: 500 });
		const graph = makeGraph({ nodeCount: 1 });

		scheduler.schedule('graph', graph);
		await scheduler.flush();
		await vi.advanceTimersByTimeAsync(500);

		expect(persistence.save).toHaveBeenCalledTimes(1);
		expect(persistence.save).toHaveBeenCalledWith('graph', graph);
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

		scheduler.schedule('graph', graph);
		await expect(scheduler.flush()).rejects.toThrow('quota exceeded');
		await scheduler.flush();

		expect(persistence.save).toHaveBeenCalledTimes(2);
		expect(statuses).toContainEqual({ state: 'error', message: 'quota exceeded' });
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

		scheduler.schedule('graph', makeGraph({ nodeCount: 1 }));
		await scheduler.flush();

		expect(statuses).toContainEqual({
			state: 'warning',
			savedAt: 42,
			message: 'Stored graphs use 81% of the local budget.'
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
