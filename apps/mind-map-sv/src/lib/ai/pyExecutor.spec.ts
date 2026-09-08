/**
 * The executor without a runtime.
 *
 * Everything here runs in Node against a fake worker: the protocol, the id
 * correlation, and every way a worker can be killed. What needs a real Pyodide
 * — that a script writes a PNG, that a traceback comes back, that a loop is
 * cut — lives in `pyExecutor.svelte.spec.ts`, behind an env switch, because it
 * downloads tens of megabytes and the gate suite has to stay offline.
 */

import { describe, expect, it } from 'vitest';
import {
	PyExecutorError,
	PyWorkerChannel,
	createPyExecutor,
	mimeTypeForName,
	type PyExecutorErrorKind,
	type WorkerLike
} from './pyExecutor';
import { pyWorkerSource, type PyRuntimeConfig } from './pyWorker';

const RUNTIME: PyRuntimeConfig = {
	version: '0.27.7',
	indexUrl: 'https://cdn.example/pyodide/v0.27.7/full/',
	packages: ['pandas', 'numpy', 'matplotlib']
};

type Message = Record<string, unknown>;

function asRecord(value: unknown): Message | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
	// Every non-null, non-array object indexes by string at runtime; the guard
	// above is what TS cannot see for itself.
	return value as Message;
}

interface FakeWorkerOptions {
	/** Whether the worker announces itself. One that never does is the broken construction. */
	ready?: boolean;
	/** Hold the `load` reply until `finishLoad()`, the way a real download does. */
	deferLoad?: boolean;
	/** Reply payload for a `run`; `undefined` leaves the call hanging forever. */
	run?: (message: Message) => Message | undefined;
}

function defaultRun(): Message {
	return { exitCode: 0, durationMs: 12, stdout: '', stderr: '', outputs: [] };
}

/** A worker-shaped object that plays the protocol with no runtime behind it. */
class FakeWorker implements WorkerLike {
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	readonly received: Message[] = [];
	terminated = false;
	#heldLoadId: unknown;
	readonly #options: FakeWorkerOptions;

	constructor(options: FakeWorkerOptions = {}) {
		this.#options = options;
		if (options.ready !== false) queueMicrotask(() => this.emit({ type: 'ready' }));
	}

	postMessage(message: unknown): void {
		const record = asRecord(message);
		if (!record) return;
		this.received.push(record);

		if (record.type === 'load' && this.#options.deferLoad) {
			this.#heldLoadId = record.id;
			return;
		}
		if (record.type === 'run') {
			const answer = (this.#options.run ?? defaultRun)(record);
			if (answer) this.#reply(record.id, answer);
			return;
		}
		this.#reply(record.id, {});
	}

	terminate(): void {
		this.terminated = true;
	}

	emit(message: Message): void {
		this.onmessage?.({ data: message });
	}

	finishLoad(): void {
		this.#reply(this.#heldLoadId, { version: RUNTIME.version });
	}

	sentOfType(type: string): Message[] {
		return this.received.filter((message) => message.type === type);
	}

	#reply(id: unknown, payload: Message): void {
		this.emit({ type: 'result', id, ok: true, ...payload });
	}
}

/** An executor wired to fakes, with the workers it built and their behaviour to hand. */
function executorWithFakes(options: FakeWorkerOptions = {}) {
	const workers: FakeWorker[] = [];
	const executor = createPyExecutor(RUNTIME, {
		createWorker: () => {
			const worker = new FakeWorker(options);
			workers.push(worker);
			return worker;
		},
		readyTimeoutMs: 1000,
		defaultTimeoutMs: 1000
	});
	return { executor, workers, options };
}

async function kindOf(promise: Promise<unknown>): Promise<PyExecutorErrorKind | string> {
	try {
		await promise;
		return 'resolved';
	} catch (error) {
		return error instanceof PyExecutorError ? error.kind : String(error);
	}
}

function file(name: string, text: string) {
	return { name, bytes: new TextEncoder().encode(text) };
}

/** Let every queued microtask run, so a run really is in flight before it is cut. */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('mimeTypeForName', () => {
	it('names the six kinds a script is asked to write', () => {
		expect(mimeTypeForName('figure.png')).toBe('image/png');
		expect(mimeTypeForName('figure.svg')).toBe('image/svg+xml');
		expect(mimeTypeForName('cleaned.csv')).toBe('text/csv');
		expect(mimeTypeForName('fit.json')).toBe('application/json');
		expect(mimeTypeForName('notes.txt')).toBe('text/plain');
		expect(mimeTypeForName('report.pdf')).toBe('application/pdf');
	});

	it('reads the extension case-insensitively and through dotted names', () => {
		expect(mimeTypeForName('CH2.SWEEP.PNG')).toBe('image/png');
	});

	it('falls back to octet-stream for anything else', () => {
		expect(mimeTypeForName('model.pkl')).toBe('application/octet-stream');
		expect(mimeTypeForName('LICENSE')).toBe('application/octet-stream');
		expect(mimeTypeForName('trailing.')).toBe('application/octet-stream');
	});
});

describe('pyWorkerSource', () => {
	const source = pyWorkerSource(RUNTIME);

	it('carries every message name the protocol uses', () => {
		for (const inbound of ['load', 'reset', 'writeFile', 'run', 'readFile']) {
			expect(source).toContain(`case '${inbound}'`);
		}
		for (const outbound of ['ready', 'progress', 'stdout', 'stderr', 'result', 'error']) {
			expect(source).toContain(`'${outbound}'`);
		}
	});

	it('forces the Agg backend and loads a script own imports on demand', () => {
		expect(source).toContain('matplotlib.use("agg")');
		expect(source).toContain('loadPackagesFromImports');
	});

	it('bakes in the configured runtime and preload set', () => {
		expect(source).toContain(`"indexUrl":"${RUNTIME.indexUrl}"`);
		expect(source).toContain('"packages":["pandas","numpy","matplotlib"]');
		expect(source).toContain("import(/* @vite-ignore */ CONFIG.indexUrl + 'pyodide.mjs')");
		expect(source).toContain('loadPyodide');
	});

	it('is finished text, with no interpolation left in it', () => {
		expect(source).not.toContain('${');
	});
});

describe('PyWorkerChannel', () => {
	it('correlates replies by id, whatever order they come back in', async () => {
		const worker = new FakeWorker({ run: () => undefined });
		const channel = new PyWorkerChannel(worker, 1000);
		await channel.ready();

		const first = channel.send({ type: 'run', code: 'a' });
		const second = channel.send({ type: 'run', code: 'b' });
		const ids = worker.sentOfType('run').map((message) => message.id);
		worker.emit({ type: 'result', id: ids[1], stdout: 'second' });
		worker.emit({ type: 'result', id: ids[0], stdout: 'first' });

		expect(await first).toMatchObject({ stdout: 'first' });
		expect(await second).toMatchObject({ stdout: 'second' });
		channel.close(new PyExecutorError('aborted', 'done'));
	});

	it('walks past a reply nobody is waiting for', async () => {
		const worker = new FakeWorker();
		const channel = new PyWorkerChannel(worker, 1000);
		await channel.ready();

		expect(() => worker.emit({ type: 'result', id: 99, stdout: 'stray' })).not.toThrow();
		channel.close(new PyExecutorError('aborted', 'done'));
	});

	it('turns an error reply into a worker-error rejection', async () => {
		const worker = new FakeWorker({ run: () => undefined });
		const channel = new PyWorkerChannel(worker, 1000);
		await channel.ready();

		const call = channel.send({ type: 'run', code: 'a' });
		worker.emit({ type: 'error', id: worker.sentOfType('run')[0].id, message: 'FS is gone' });

		await expect(call).rejects.toThrow('FS is gone');
		expect(await kindOf(call)).toBe('worker-error');
	});

	it('reports progress to the handler that is listening', async () => {
		const worker = new FakeWorker();
		const channel = new PyWorkerChannel(worker, 1000);
		const seen: unknown[] = [];
		channel.setProgressHandler((progress) => seen.push(progress));
		await channel.ready();

		worker.emit({ type: 'progress', id: 1, phase: 'packages', message: 'pandas', loadedBytes: 42 });

		expect(seen).toEqual([{ phase: 'packages', message: 'pandas', loadedBytes: 42 }]);
		channel.close(new PyExecutorError('aborted', 'done'));
	});

	it('gives up on a worker that never says ready, and kills it', async () => {
		const worker = new FakeWorker({ ready: false });
		const channel = new PyWorkerChannel(worker, 5);

		expect(await kindOf(channel.ready())).toBe('load-failed');
		expect(worker.terminated).toBe(true);
		expect(channel.closed).toBe(true);
	});

	it('rejects everything outstanding when it closes, because terminate never will', async () => {
		const worker = new FakeWorker({ run: () => undefined });
		const channel = new PyWorkerChannel(worker, 1000);
		await channel.ready();

		const call = channel.send({ type: 'run', code: 'a' });
		channel.close(new PyExecutorError('timeout', 'too long'));

		expect(await kindOf(call)).toBe('timeout');
		expect(worker.terminated).toBe(true);
		// A later call reads the same way: the worker is gone for that reason.
		expect(await kindOf(channel.send({ type: 'run', code: 'b' }))).toBe('timeout');
	});
});

describe('createPyExecutor', () => {
	it('builds one worker on load and reuses it', async () => {
		const { executor, workers } = executorWithFakes();

		await executor.load();
		await executor.load();

		expect(workers).toHaveLength(1);
		expect(workers[0].sentOfType('load')).toHaveLength(1);
		executor.dispose();
	});

	it('passes progress through while the load is in flight, and stops after it', async () => {
		const { executor, workers } = executorWithFakes({ deferLoad: true });
		const progress: unknown[] = [];
		const loading = executor.load((entry) => progress.push(entry));
		await flush();

		workers[0].emit({ type: 'progress', id: 1, phase: 'runtime', message: 'downloading' });
		workers[0].finishLoad();
		await loading;
		workers[0].emit({ type: 'progress', id: 1, phase: 'packages', message: 'too late' });

		expect(progress).toEqual([{ phase: 'runtime', message: 'downloading' }]);
		executor.dispose();
	});

	it('resets the work directory and its outputs, writes the inputs, and runs the script', async () => {
		const { executor, workers } = executorWithFakes({
			run: () => ({
				exitCode: 0,
				durationMs: 34,
				stdout: 'wrote 2 files\n',
				stderr: '',
				outputs: [
					{ name: 'plot.png', bytes: new Uint8Array([1, 2, 3]).buffer },
					{ name: 'summary.csv', bytes: new Uint8Array([52]).buffer }
				]
			})
		});

		const result = await executor.run('print("hi")', [file('sweep.csv', 't,ch1\n0,1\n')]);

		const worker = workers[0];
		expect(worker.sentOfType('reset')[0].paths).toEqual(['/work', '/work/outputs']);
		expect(worker.sentOfType('writeFile')[0].path).toBe('/work/sweep.csv');
		expect(worker.sentOfType('run')[0]).toMatchObject({
			code: 'print("hi")',
			collectOutputs: true
		});
		expect(result).toMatchObject({ exitCode: 0, durationMs: 34, stdout: 'wrote 2 files\n' });
		expect(result.outputs.map((output) => [output.name, output.mimeType])).toEqual([
			['plot.png', 'image/png'],
			['summary.csv', 'text/csv']
		]);
		expect([...result.outputs[0].bytes]).toEqual([1, 2, 3]);
		executor.dispose();
	});

	it('sends a copy of each input, so the caller keeps its bytes', async () => {
		const { executor, workers } = executorWithFakes();
		const input = file('sweep.csv', 't,ch1\n');

		await executor.run('pass', [input]);

		expect(input.bytes.byteLength).toBeGreaterThan(0);
		expect(workers[0].sentOfType('writeFile')[0].bytes).not.toBe(input.bytes.buffer);
		executor.dispose();
	});

	it('strips any path out of an attachment name', async () => {
		const { executor, workers } = executorWithFakes();

		await executor.run('pass', [file('../../etc/passwd', 'x'), file('  ', 'y')]);

		expect(workers[0].sentOfType('writeFile').map((message) => message.path)).toEqual([
			'/work/passwd',
			'/work/input'
		]);
		executor.dispose();
	});

	// The caller decides the names — `collectAiInputs` decides all of them at
	// once — and the executor writes what it is handed. If it re-derived a name
	// here, two files the collection had already told apart would land on one
	// path and the model would be reading a file it was never shown.
	it('writes each file under the name it was handed, collisions already resolved', async () => {
		const { executor, workers } = executorWithFakes();

		await executor.run('pass', [
			file('plot.png', 'a'),
			file('plot-2.png', 'b'),
			file('outputs.input', 'c')
		]);

		expect(workers[0].sentOfType('writeFile').map((message) => message.path)).toEqual([
			'/work/plot.png',
			'/work/plot-2.png',
			'/work/outputs.input'
		]);
		executor.dispose();
	});

	it('reports a script that raised as a result, never as a rejection', async () => {
		const { executor } = executorWithFakes({
			run: () => ({
				exitCode: 1,
				durationMs: 8,
				stdout: '',
				stderr: 'Traceback (most recent call last):\nKeyError: "ch9"\n',
				outputs: []
			})
		});

		const result = await executor.run('df["ch9"]', []);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('Traceback');
		executor.dispose();
	});

	it('digests through the probe on stdin and reads the lines back', async () => {
		const digest = { name: 'sweep.csv', size: 10, kind: 'table', columns: ['t'], rows: 2 };
		const { executor, workers } = executorWithFakes({
			run: () => ({ exitCode: 0, durationMs: 3, stdout: `${JSON.stringify(digest)}\n`, stderr: '' })
		});

		const digests = await executor.digest([file('sweep.csv', 't\n1\n')], 5);

		const run = workers[0].sentOfType('run')[0];
		expect(workers[0].sentOfType('reset')[0].paths).toEqual(['/work']);
		expect(run.collectOutputs).toBe(false);
		expect(run.stdin).toBe(JSON.stringify({ paths: ['/work/sweep.csv'], previewRows: 5 }));
		expect(digests).toEqual([digest]);
		executor.dispose();
	});

	it('cuts a run that will not end, and works again on the next load', async () => {
		const { executor, workers, options } = executorWithFakes({ run: () => undefined });

		expect(await kindOf(executor.run('while True: pass', [], { timeoutMs: 5 }))).toBe('timeout');
		expect(workers[0].terminated).toBe(true);

		options.run = defaultRun;
		await executor.load();

		expect(workers).toHaveLength(2);
		await expect(executor.run('print(1)', [])).resolves.toMatchObject({ exitCode: 0 });
		executor.dispose();
	});

	it('rejects with aborted when the signal fires mid-run', async () => {
		const { executor, workers } = executorWithFakes({ run: () => undefined });
		await executor.load();
		const controller = new AbortController();
		const running = executor.run('while True: pass', [], {
			timeoutMs: 0,
			signal: controller.signal
		});
		await flush();
		controller.abort();

		expect(await kindOf(running)).toBe('aborted');
		expect(workers[0].terminated).toBe(true);
		executor.dispose();
	});

	it('rejects with aborted when the signal was already spent', async () => {
		const { executor } = executorWithFakes({ run: () => undefined });

		expect(
			await kindOf(executor.run('pass', [], { signal: AbortSignal.abort(), timeoutMs: 0 }))
		).toBe('aborted');
		executor.dispose();
	});

	it('rejects a run in flight when it is disposed, and refuses to load again', async () => {
		const { executor, workers } = executorWithFakes({ run: () => undefined });
		await executor.load();
		const running = executor.run('while True: pass', [], { timeoutMs: 0 });
		await flush();
		executor.dispose();

		expect(await kindOf(running)).toBe('aborted');
		expect(workers[0].terminated).toBe(true);
		expect(await kindOf(executor.load())).toBe('aborted');
	});

	it('fails the load when the worker never starts, and can be retried', async () => {
		const workers: FakeWorker[] = [];
		const options: FakeWorkerOptions = { ready: false };
		const executor = createPyExecutor(RUNTIME, {
			createWorker: () => {
				const worker = new FakeWorker(options);
				workers.push(worker);
				return worker;
			},
			readyTimeoutMs: 5
		});

		expect(await kindOf(executor.load())).toBe('load-failed');
		options.ready = true;

		await expect(executor.load()).resolves.toBeUndefined();
		expect(workers).toHaveLength(2);
		executor.dispose();
	});
});
