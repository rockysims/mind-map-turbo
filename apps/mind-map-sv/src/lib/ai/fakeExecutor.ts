/**
 * A `PyExecutor` that runs nothing.
 *
 * Stories and the run-loop specs need an executor that answers instantly,
 * deterministically, and offline; the real one downloads tens of megabytes and
 * takes ten seconds to say hello. The scripted function is handed the code the
 * caller passed, so a spec can branch on it — first call fails, second
 * succeeds — which is how the tool-call loop gets exercised without a model.
 *
 * It records what it was asked to do rather than exposing spies, so a spec
 * asserts on `calls` and reads like the story it is testing.
 */

import type {
	ExecutionResult,
	ExecutorFile,
	LoadProgress,
	PyExecutor,
	RunOptions
} from './pyExecutor';
import { PyExecutorError } from './pyExecutor';
import type { MeasuredFileDigest } from './probeScript';

interface FakeRunCall {
	script: string;
	files: ExecutorFile[];
	timeoutMs?: number;
}

interface FakeDigestCall {
	files: ExecutorFile[];
	previewRows: number;
}

interface FakeExecutor extends PyExecutor {
	readonly runs: FakeRunCall[];
	readonly digests: FakeDigestCall[];
	readonly loadCount: number;
	readonly disposed: boolean;
}

/** The progress a load reports, so the workbench's runtime line has something to show. */
const FAKE_PROGRESS: LoadProgress[] = [
	{ phase: 'runtime', message: 'Downloading the Python runtime', loadedBytes: 5_600_000 },
	{ phase: 'packages', message: 'Loading pandas, numpy, matplotlib', loadedBytes: 25_000_000 }
];

export function createFakeExecutor(
	script: (code: string) => ExecutionResult | Promise<ExecutionResult>,
	digests: MeasuredFileDigest[] = []
): FakeExecutor {
	const runs: FakeRunCall[] = [];
	const digestCalls: FakeDigestCall[] = [];
	let loadCount = 0;
	let disposed = false;
	let abortPending: (() => void) | undefined;

	return {
		runs,
		digests: digestCalls,
		get loadCount() {
			return loadCount;
		},
		get disposed() {
			return disposed;
		},

		async load(onProgress) {
			loadCount += 1;
			for (const progress of FAKE_PROGRESS) onProgress?.(progress);
		},

		async digest(files: ExecutorFile[], previewRows: number) {
			digestCalls.push({ files, previewRows });
			return digests;
		},

		run(code: string, files: ExecutorFile[], options: RunOptions = {}) {
			runs.push({
				script: code,
				files,
				...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
			});
			// Cancel has to be observable even when the scripted result never
			// settles, because a spec's cancel case is exactly a run in flight.
			return new Promise<ExecutionResult>((resolve, reject) => {
				const fail = (): void =>
					reject(new PyExecutorError('aborted', 'The run was cancelled before it finished.'));
				if (options.signal?.aborted) {
					fail();
					return;
				}
				abortPending = fail;
				options.signal?.addEventListener('abort', fail, { once: true });
				Promise.resolve(script(code)).then(resolve, reject);
			});
		},

		dispose() {
			disposed = true;
			abortPending?.();
			abortPending = undefined;
		}
	};
}
