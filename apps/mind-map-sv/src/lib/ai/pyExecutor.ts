/**
 * The Python executor: what runs an AI node's `analysis.py`, and the only
 * thing in the app that talks to the worker.
 *
 * The shape of this module follows from three facts recorded by the T01 spike.
 * The worker is built from a blob URL as a **classic** worker, because a module
 * blob worker is refused on `file://` (see `pyWorker.ts`). That refusal is
 * silent, so a worker that has not said `ready` within a timeout is treated as
 * failed rather than waited on forever. And `terminate()` leaves every promise
 * the worker owed still pending, so the driver keeps its own pending map and
 * rejects all of it whenever it kills a worker — a cancelled run must not leave
 * the run loop waiting on a thread that no longer exists.
 *
 * Everything the executor kills is recoverable: the next `load` builds a fresh
 * worker, and the runtime comes back from the browser cache in about a second.
 * That is the whole cancel story for `file://`, which cannot use the shared
 * memory that interrupting Pyodide in place would need.
 */

import { APP_CONFIG } from '$lib/appConfig';
import { executorInputName } from './inputFileName';
import { PROBE_SCRIPT, parseProbeOutput, type FileDigest } from './probeScript';
import { pyWorkerSource, type PyRuntimeConfig } from './pyWorker';

/** How long a worker has to post `ready` before the construction is called broken. */
const DEFAULT_READY_TIMEOUT_MS = 15000;

/** Where input files land, and where the script is asked to write its outputs. */
const INPUT_DIR = '/inputs';
const OUTPUT_DIR = '/outputs';

/** One file on its way into the runtime, named as the attachment is named. */
export interface ExecutorFile {
	name: string;
	bytes: Uint8Array;
}

/** One file the script wrote to `/outputs`. */
export interface ExecutionOutput {
	name: string;
	mimeType: string;
	bytes: Uint8Array;
}

/**
 * What one script execution produced. A script that raised is a *result*, not a
 * rejection: exit code 1 with the traceback in `stderr` is what the run loop
 * sends back to Claude so it can fix its own script.
 */
export interface ExecutionResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	outputs: ExecutionOutput[];
	/** Wall time in the worker, including any package the script's imports pulled. */
	durationMs: number;
}

/** What the workbench's runtime line is drawn from. */
export interface LoadProgress {
	phase: 'runtime' | 'packages';
	message: string;
	/** Cumulative bytes over the network, when the browser will say. */
	loadedBytes?: number;
}

export interface RunOptions {
	/** Defaults to `APP_CONFIG.ai.scriptTimeoutMs`. Zero or less means no timeout. */
	timeoutMs?: number;
	signal?: AbortSignal;
}

export interface PyExecutor {
	/** Idempotent: the second call awaits the first load rather than starting another. */
	load(onProgress?: (progress: LoadProgress) => void): Promise<void>;
	digest(files: ExecutorFile[], previewRows: number): Promise<FileDigest[]>;
	run(script: string, files: ExecutorFile[], options?: RunOptions): Promise<ExecutionResult>;
	dispose(): void;
}

export type PyExecutorErrorKind = 'timeout' | 'aborted' | 'load-failed' | 'worker-error';

/** Every rejection this module produces, so a caller can branch on `kind`. */
export class PyExecutorError extends Error {
	readonly kind: PyExecutorErrorKind;

	constructor(kind: PyExecutorErrorKind, message: string) {
		super(message);
		this.name = 'PyExecutorError';
		this.kind = kind;
	}
}

const MIME_TYPES: Record<string, string> = {
	png: 'image/png',
	svg: 'image/svg+xml',
	csv: 'text/csv',
	json: 'application/json',
	txt: 'text/plain',
	pdf: 'application/pdf'
};

/**
 * The MIME type an output is stored under, from its extension alone.
 *
 * The runtime hands back bytes and a filename and nothing else, and the script
 * chose the name — so this is a naming convention, not a sniff. Anything
 * unrecognised is `application/octet-stream`, which milestone 13 stores as a
 * plain file attachment.
 */
export function mimeTypeForName(name: string): string {
	const dot = name.lastIndexOf('.');
	if (dot < 0) return 'application/octet-stream';
	return MIME_TYPES[name.slice(dot + 1).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * The slice of `Worker` the driver uses. Narrow on purpose: a spec can stand a
 * plain object in its place and drive the whole protocol in Node.
 */
export interface WorkerLike {
	postMessage(message: unknown, transfer?: Transferable[]): void;
	onmessage: ((event: { data: unknown }) => void) | null;
	onerror?: ((event: unknown) => void) | null;
	terminate(): void;
}

interface PyExecutorOptions {
	/** Swapped in specs for a fake worker; defaults to the classic blob worker. */
	createWorker?: (source: string) => WorkerLike;
	readyTimeoutMs?: number;
	/** Timeout used when `run` is given none; defaults to `APP_CONFIG.ai.scriptTimeoutMs`. */
	defaultTimeoutMs?: number;
}

/** A worker reply's fields, left unparsed until a caller says what it wants. */
type ResultPayload = Record<string, unknown>;

interface PendingCall {
	resolve(payload: ResultPayload): void;
	reject(error: Error): void;
}

/**
 * One worker and the promises it owes.
 *
 * Correlation is by a monotonic id the worker echoes. The channel is the only
 * thing that knows a worker can die with promises outstanding, and `close` is
 * the single door every death goes through: ready, every pending call, and the
 * worker itself, all settled with the same error.
 */
export class PyWorkerChannel {
	readonly #worker: WorkerLike;
	readonly #pending = new Map<number, PendingCall>();
	readonly #ready: Promise<void>;
	#resolveReady: () => void = () => {};
	#rejectReady: (error: Error) => void = () => {};
	#readyTimer: ReturnType<typeof setTimeout> | undefined;
	#nextId = 1;
	#closeError: PyExecutorError | undefined;
	#onProgress: ((progress: LoadProgress) => void) | undefined;

	constructor(worker: WorkerLike, readyTimeoutMs: number) {
		this.#worker = worker;
		this.#ready = new Promise<void>((resolve, reject) => {
			this.#resolveReady = resolve;
			this.#rejectReady = reject;
		});
		// Nobody may be awaiting ready when the watchdog fires; an unhandled
		// rejection here would fail the whole test run for a failure we report.
		this.#ready.catch(() => {});
		this.#readyTimer = setTimeout(() => {
			this.close(
				new PyExecutorError(
					'load-failed',
					`The Python worker did not start within ${readyTimeoutMs} ms.`
				)
			);
		}, readyTimeoutMs);
		worker.onmessage = (event) => this.#receive(event.data);
		worker.onerror = (event) =>
			this.close(new PyExecutorError('worker-error', describeWorkerError(event)));
	}

	get closed(): boolean {
		return this.#closeError !== undefined;
	}

	/** Resolves when the worker has posted `ready`; rejects when it never does. */
	ready(): Promise<void> {
		return this.#ready;
	}

	setProgressHandler(handler: ((progress: LoadProgress) => void) | undefined): void {
		this.#onProgress = handler;
	}

	send(message: ResultPayload, transfer?: Transferable[]): Promise<ResultPayload> {
		// A call made after the close reads the same way as one that was in
		// flight during it: a run cancelled between two messages was still
		// cancelled, not broken.
		if (this.#closeError) return Promise.reject(this.#closeError);
		const id = this.#nextId++;
		return new Promise<ResultPayload>((resolve, reject) => {
			this.#pending.set(id, { resolve, reject });
			this.#worker.postMessage({ ...message, id }, transfer ?? []);
		});
	}

	/** Terminate, and settle everything outstanding with `error`. */
	close(error: PyExecutorError): void {
		if (this.#closeError) return;
		this.#closeError = error;
		clearTimeout(this.#readyTimer);
		this.#readyTimer = undefined;
		this.#rejectReady(error);
		const outstanding = [...this.#pending.values()];
		this.#pending.clear();
		for (const call of outstanding) call.reject(error);
		this.#worker.terminate();
	}

	#receive(data: unknown): void {
		const message = asRecord(data);
		if (!message) return;

		if (message.type === 'ready') {
			clearTimeout(this.#readyTimer);
			this.#readyTimer = undefined;
			this.#resolveReady();
			return;
		}
		if (message.type === 'progress') {
			this.#onProgress?.(toProgress(message));
			return;
		}
		if (message.type !== 'result' && message.type !== 'error') return;

		const id = message.id;
		if (typeof id !== 'number') return;
		const call = this.#pending.get(id);
		if (!call) return;
		this.#pending.delete(id);

		if (message.type === 'error') {
			call.reject(new PyExecutorError('worker-error', readString(message, 'message')));
			return;
		}
		call.resolve(message);
	}
}

/**
 * A real worker, built classic from a blob URL.
 *
 * The URL is revoked on terminate rather than right after construction: Chrome
 * is happy either way, but a revoked URL makes the failure mode of a worker
 * that has not finished fetching its own source impossible to read.
 */
class BlobWorker implements WorkerLike {
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	readonly #url: string;
	readonly #worker: Worker;

	constructor(source: string) {
		this.#url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
		this.#worker = new Worker(this.#url);
		this.#worker.onmessage = (event) => this.onmessage?.({ data: event.data });
		this.#worker.onerror = (event) => this.onerror?.(event);
	}

	postMessage(message: unknown, transfer: Transferable[] = []): void {
		this.#worker.postMessage(message, transfer);
	}

	terminate(): void {
		this.#worker.terminate();
		URL.revokeObjectURL(this.#url);
	}
}

interface Session {
	channel: PyWorkerChannel;
	loaded: Promise<void>;
}

/**
 * One executor owns one worker at a time.
 *
 * `load` is the only thing that builds one; everything else waits on the load
 * in flight. A timeout, an abort or a `dispose` retires the worker and forgets
 * the session, so the next `load` starts a fresh one — which is what makes the
 * executor usable again after a script that would not stop.
 */
export function createPyExecutor(
	config: PyRuntimeConfig = APP_CONFIG.ai.runtime,
	options: PyExecutorOptions = {}
): PyExecutor {
	const createWorker = options.createWorker ?? ((source: string) => new BlobWorker(source));
	const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
	const defaultTimeoutMs = options.defaultTimeoutMs ?? APP_CONFIG.ai.scriptTimeoutMs;

	let session: Session | undefined;
	let disposed = false;

	function startSession(): Session {
		const channel = new PyWorkerChannel(createWorker(pyWorkerSource(config)), readyTimeoutMs);
		const loaded = (async () => {
			await channel.ready();
			await channel.send({ type: 'load' });
		})();
		// Held for the next caller; the caller that awaits it sees the rejection.
		loaded.catch(() => {});
		return { channel, loaded };
	}

	/** Retire a channel so the next load builds a new one. */
	function retire(channel: PyWorkerChannel, error: PyExecutorError): void {
		channel.close(error);
		if (session?.channel === channel) session = undefined;
	}

	async function ensureLoaded(
		onProgress?: (progress: LoadProgress) => void
	): Promise<PyWorkerChannel> {
		if (disposed) throw new PyExecutorError('aborted', 'This executor has been disposed.');
		if (!session || session.channel.closed) session = startSession();
		const active = session;
		active.channel.setProgressHandler(onProgress);
		try {
			await active.loaded;
		} catch (error) {
			const failure = asExecutorError(error, 'load-failed');
			retire(active.channel, failure);
			throw failure;
		} finally {
			active.channel.setProgressHandler(undefined);
		}
		// A dispose that lands while the runtime is still downloading must not
		// hand the caller a channel that is already gone.
		if (disposed) throw new PyExecutorError('aborted', 'This executor has been disposed.');
		return active.channel;
	}

	/**
	 * Run `body` under the timeout and the abort signal. Either one kills the
	 * worker, which is what makes them work at all: Pyodide cannot be
	 * interrupted from outside without shared memory, and `file://` has none.
	 */
	async function guarded<T>(
		channel: PyWorkerChannel,
		timeoutMs: number,
		signal: AbortSignal | undefined,
		body: () => Promise<T>
	): Promise<T> {
		let settled = false;
		let rejectHalted: (error: PyExecutorError) => void = () => {};
		const halted = new Promise<never>((_, reject) => {
			rejectHalted = reject;
		});
		halted.catch(() => {});

		const halt = (error: PyExecutorError): void => {
			if (settled) return;
			settled = true;
			retire(channel, error);
			rejectHalted(error);
		};
		const onAbort = (): void =>
			halt(new PyExecutorError('aborted', 'The run was cancelled before it finished.'));

		const timer =
			timeoutMs > 0
				? setTimeout(
						() =>
							halt(new PyExecutorError('timeout', `The script ran longer than ${timeoutMs} ms.`)),
						timeoutMs
					)
				: undefined;
		signal?.addEventListener('abort', onAbort);
		if (signal?.aborted) onAbort();

		try {
			return await Promise.race([body(), halted]);
		} finally {
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener('abort', onAbort);
		}
	}

	async function writeFiles(channel: PyWorkerChannel, files: ExecutorFile[]): Promise<string[]> {
		const paths: string[] = [];
		for (const file of files) {
			const path = `${INPUT_DIR}/${executorInputName(file.name)}`;
			// A copy, then a transfer: transferring the caller's own buffer would
			// detach the asset bytes it still holds — and digest is routinely
			// called with the same files a run is about to use.
			const buffer = new Uint8Array(file.bytes).buffer;
			await channel.send({ type: 'writeFile', path, bytes: buffer }, [buffer]);
			paths.push(path);
		}
		return paths;
	}

	return {
		async load(onProgress) {
			await ensureLoaded(onProgress);
		},

		async digest(files, previewRows) {
			const channel = await ensureLoaded();
			return guarded(channel, defaultTimeoutMs, undefined, async () => {
				await channel.send({ type: 'reset', paths: [INPUT_DIR] });
				const paths = await writeFiles(channel, files);
				const result = await channel.send({
					type: 'run',
					code: PROBE_SCRIPT,
					stdin: JSON.stringify({ paths, previewRows }),
					collectOutputs: false
				});
				return parseProbeOutput(readString(result, 'stdout')).digests;
			});
		},

		async run(script, files, runOptions = {}) {
			const timeoutMs = runOptions.timeoutMs ?? defaultTimeoutMs;
			const channel = await ensureLoaded();
			return guarded(channel, timeoutMs, runOptions.signal, async () => {
				await channel.send({ type: 'reset', paths: [INPUT_DIR, OUTPUT_DIR] });
				await writeFiles(channel, files);
				const result = await channel.send({
					type: 'run',
					code: script,
					collectOutputs: true
				});
				return toExecutionResult(result);
			});
		},

		dispose() {
			disposed = true;
			const active = session;
			session = undefined;
			active?.channel.close(new PyExecutorError('aborted', 'The executor was disposed.'));
		}
	};
}

function toExecutionResult(payload: ResultPayload): ExecutionResult {
	return {
		exitCode: readNumber(payload, 'exitCode') ?? 0,
		stdout: readString(payload, 'stdout'),
		stderr: readString(payload, 'stderr'),
		durationMs: readNumber(payload, 'durationMs') ?? 0,
		outputs: readOutputs(payload.outputs)
	};
}

function readOutputs(value: unknown): ExecutionOutput[] {
	if (!Array.isArray(value)) return [];
	const outputs: ExecutionOutput[] = [];
	for (const entry of value) {
		const record = asRecord(entry);
		if (!record) continue;
		const name = record.name;
		const bytes = toBytes(record.bytes);
		if (typeof name !== 'string' || !bytes) continue;
		outputs.push({ name, mimeType: mimeTypeForName(name), bytes });
	}
	return outputs;
}

function toBytes(value: unknown): Uint8Array | undefined {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	return undefined;
}

function toProgress(message: ResultPayload): LoadProgress {
	const loadedBytes = readNumber(message, 'loadedBytes');
	return {
		phase: message.phase === 'runtime' ? 'runtime' : 'packages',
		message: readString(message, 'message'),
		...(loadedBytes === undefined ? {} : { loadedBytes })
	};
}

function asRecord(value: unknown): ResultPayload | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
	// Every non-null, non-array object indexes by string at runtime; TS keeps
	// `unknown` opaque until something says so, and the guard above is that.
	return value as ResultPayload;
}

function readString(payload: ResultPayload, key: string): string {
	const value = payload[key];
	return typeof value === 'string' ? value : '';
}

function readNumber(payload: ResultPayload, key: string): number | undefined {
	const value = payload[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function describeWorkerError(event: unknown): string {
	const record = asRecord(event);
	const message = record ? record.message : undefined;
	return typeof message === 'string' && message !== ''
		? message
		: 'The Python worker failed to start.';
}

function asExecutorError(error: unknown, fallback: PyExecutorErrorKind): PyExecutorError {
	if (error instanceof PyExecutorError) return error;
	return new PyExecutorError(fallback, error instanceof Error ? error.message : String(error));
}
