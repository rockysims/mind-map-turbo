import type { MultigraphData } from './components/ui/types/multigraph';
import type { ViewState } from './migrations';
import type { Persistence } from './persistence';

export type SaveStatus =
	| { state: 'idle' }
	| { state: 'saving' }
	| { state: 'saved'; savedAt: number }
	| { state: 'warning'; savedAt: number; message: string }
	| { state: 'error'; message: string };

export type QuotaWarning = {
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
			void this.persistPending();
		}, this.options.debounceMs);
	}

	async flush(): Promise<void> {
		this.clearPendingTimer();
		await this.persistPending();
	}

	dispose(): void {
		this.clearPendingTimer();
	}

	private async persistPending(): Promise<void> {
		if (this.pending === null || this.saving) return;

		const save = this.pending;
		this.saving = true;
		this.report({ state: 'saving' });

		try {
			await this.options.persistence.save(save.id, save.graph);
			if (this.pending === save) this.pending = null;
			const savedAt = this.now();
			const warning = calculateQuotaWarning(
				this.options.estimateUsageBytes?.() ?? 0,
				this.options.quotaBudgetBytes ?? Number.POSITIVE_INFINITY,
				this.options.quotaWarningRatio ?? 1
			);

			if (warning.shouldWarn) {
				this.report({
					state: 'warning',
					savedAt,
					message: `Stored graphs use ${Math.round(warning.ratio * 100)}% of the local budget.`
				});
			} else {
				this.report({ state: 'saved', savedAt });
			}
		} catch (error) {
			this.report({ state: 'error', message: errorMessage(error) });
			throw error;
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
