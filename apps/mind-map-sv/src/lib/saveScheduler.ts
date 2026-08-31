import type { MultigraphData } from './components/ui/types/multigraph';
import { graphFingerprint } from './documentStatus';
import type { ViewState } from './migrations';
import type { Persistence } from './persistence';

export type SaveStatus =
	| { state: 'idle' }
	| { state: 'saving' }
	// `fingerprint` identifies the graph data that actually reached storage, so
	// callers can tell "saved" from "not saved yet" instead of inferring it.
	| { state: 'saved'; savedAt: number; fingerprint: string }
	| { state: 'warning'; savedAt: number; fingerprint: string; message: string }
	| { state: 'error'; message: string };

type QuotaWarning = {
	usedBytes: number;
	budgetBytes: number;
	ratio: number;
	shouldWarn: boolean;
};

type PendingSave = {
	id: string;
	graph: {
		data: MultigraphData;
		viewState: ViewState;
	};
};

/**
 * Debounced writer for the storage layer shared with the server backend, so its
 * names stay generic ("save"). In UI vocabulary this layer *caches* the draft;
 * "saved" is reserved for exporting the self-contained HTML file.
 */
export class SaveScheduler {
	private pending: PendingSave | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private saving = false;

	constructor(
		private readonly options: {
			persistence: Persistence;
			debounceMs: number;
			now?: () => number;
			setTimer?: typeof setTimeout;
			clearTimer?: typeof clearTimeout;
			estimateUsageBytes?: () => number;
			quotaBudgetBytes?: number;
			quotaWarningRatio?: number;
			onStatus?: (status: SaveStatus) => void;
		}
	) {}

	schedule(id: string, data: MultigraphData, viewState: ViewState): void {
		this.pending = { id, graph: { data, viewState } };
		this.clearPendingTimer();
		this.timer = this.setTimer(() => {
			this.timer = null;
			// The debounced path has nobody to catch a rejection, so the failure is
			// reported through onStatus and swallowed here rather than surfacing as
			// an unhandled promise rejection on every failed autosave.
			void this.persistPending();
		}, this.options.debounceMs);
	}

	async flush(): Promise<void> {
		this.clearPendingTimer();
		await this.persistPending({ rethrow: true });
	}

	dispose(): void {
		this.clearPendingTimer();
	}

	private async persistPending(options: { rethrow?: boolean } = {}): Promise<void> {
		if (this.pending === null || this.saving) return;

		const save = this.pending;
		this.saving = true;
		this.report({ state: 'saving' });

		try {
			await this.options.persistence.save(save.id, save.graph);
			if (this.pending === save) this.pending = null;
			const savedAt = this.now();
			const fingerprint = graphFingerprint(save.graph.data);
			const warning = calculateQuotaWarning(
				this.options.estimateUsageBytes?.() ?? 0,
				this.options.quotaBudgetBytes ?? Number.POSITIVE_INFINITY,
				this.options.quotaWarningRatio ?? 1
			);

			if (warning.shouldWarn) {
				this.report({
					state: 'warning',
					savedAt,
					fingerprint,
					message: `Local cache is ${Math.round(warning.ratio * 100)}% full.`
				});
			} else {
				this.report({ state: 'saved', savedAt, fingerprint });
			}
		} catch (error) {
			this.report({ state: 'error', message: errorMessage(error) });
			if (options.rethrow) throw error;
		} finally {
			this.saving = false;
			if (this.pending !== null && this.pending !== save) {
				this.schedule(this.pending.id, this.pending.graph.data, this.pending.graph.viewState);
			}
		}
	}

	private clearPendingTimer(): void {
		if (this.timer === null) return;
		this.clearTimer(this.timer);
		this.timer = null;
	}

	private report(status: SaveStatus): void {
		this.options.onStatus?.(status);
	}

	private now(): number {
		return this.options.now?.() ?? Date.now();
	}

	private setTimer(callback: () => void, ms: number): ReturnType<typeof setTimeout> {
		return (this.options.setTimer ?? setTimeout)(callback, ms);
	}

	private clearTimer(timer: ReturnType<typeof setTimeout>): void {
		(this.options.clearTimer ?? clearTimeout)(timer);
	}
}

export function calculateQuotaWarning(
	usedBytes: number,
	budgetBytes: number,
	warningRatio: number
): QuotaWarning {
	const ratio = budgetBytes <= 0 ? 1 : usedBytes / budgetBytes;
	return {
		usedBytes,
		budgetBytes,
		ratio,
		shouldWarn: ratio >= warningRatio
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'Unable to save graph.';
}
