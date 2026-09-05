/**
 * The Python worker, as source text rather than as a module.
 *
 * The offline shell is one HTML file. `inline-static-build.mjs` inlines the
 * module scripts the built page references and then deletes every sibling
 * asset, so anything Vite emits as its own chunk — which is exactly what
 * `new Worker(new URL('./pyWorker.ts', import.meta.url))` produces — would be
 * deleted out from under the page. Keeping the worker as a string that the
 * driver turns into a blob URL sidesteps Vite's worker handling entirely: the
 * text travels inside the main bundle, and the single-file build needs no
 * change to carry it.
 *
 * Two more constraints from the T01 spike, both about `file://`:
 *
 * - The worker must be **classic**, not a module. Chrome refuses a module
 *   worker from a blob URL on `file://` with a bare error event and nothing
 *   ever settles. A classic blob worker that does a dynamic `import()` of the
 *   CDN's `pyodide.mjs` works from `file://` and from `http://` alike, and
 *   needs only `worker-src blob:` in the page's CSP.
 * - Because the broken construction never reports a useful error, the driver
 *   treats "no `ready` within the timeout" as the failure signal. So the very
 *   last thing this source does is post `ready`.
 *
 * ## The protocol
 *
 * Main → worker, each carrying an `id` the worker echoes on its reply:
 *
 * | message     | payload                            | reply                            |
 * | ----------- | ---------------------------------- | -------------------------------- |
 * | `load`      | —                                  | `result` with `version`          |
 * | `reset`     | `paths`                            | `result`                         |
 * | `writeFile` | `path`, `bytes` (transferred)      | `result`                         |
 * | `run`       | `code`, `stdin?`, `collectOutputs` | `result` with the execution      |
 * | `readFile`  | `path`                             | `result` with `bytes`            |
 *
 * Worker → main: `ready` (once, at startup), `progress` (`phase`, `message`,
 * `loadedBytes`), `stdout` / `stderr` chunks as they are written, `result`
 * (correlated by `id`), and `error` (also correlated) for anything the handler
 * threw. A script that raises is *not* an `error`: it comes back as a normal
 * `result` with exit code 1 and the traceback in `stderr`, because a failing
 * analysis is an outcome the run loop shows Claude, not a broken executor.
 */

/** The pinned runtime, as `APP_CONFIG.ai.runtime` records it. */
export interface PyRuntimeConfig {
	/** Recorded on each run so a later runtime is a visible difference. */
	version: string;
	/** CDN directory holding `pyodide.mjs` and the wheels; needs its trailing slash. */
	indexUrl: string;
	/**
	 * The **preload** set, loaded once with the runtime. Anything else a script
	 * imports is fetched per run by `loadPackagesFromImports`, which is how
	 * scipy's 13 MB is paid only by the scripts that use it (T01 decision).
	 */
	packages: readonly string[];
}

/**
 * The worker's JavaScript, with the runtime configuration baked in.
 *
 * Written as one template literal on purpose: nothing here is imported, so
 * Vite sees a string and not a module graph, and the driver can hand it
 * straight to `new Blob([...])`. Keep it free of backticks and `${` so the
 * only interpolation is the configuration below.
 */
export function pyWorkerSource(config: PyRuntimeConfig): string {
	const settings = JSON.stringify({
		indexUrl: config.indexUrl,
		packages: [...config.packages]
	});

	return `'use strict';

const CONFIG = ${settings};
// Prepended as its own execution, never spliced into the user's script, so a
// traceback still points at the line the author wrote.
const AGG_PREAMBLE = 'import matplotlib\\nmatplotlib.use("agg")\\n';
const MATPLOTLIB_MENTION = /matplotlib|pyplot/;

let pyodide = null;
let stdoutChunks = [];
let stderrChunks = [];

function post(message, transfer) {
	self.postMessage(message, transfer || []);
}

function describeError(error) {
	if (error && typeof error.message === 'string' && error.message !== '') return error.message;
	return String(error);
}

/** Cumulative transfer since a mark, for the workbench's runtime line. */
function loadedBytesSince(startTime) {
	try {
		let total = 0;
		for (const entry of performance.getEntriesByType('resource')) {
			if (entry.startTime < startTime) continue;
			total += entry.transferSize || entry.encodedBodySize || 0;
		}
		return total;
	} catch (error) {
		return undefined;
	}
}

function mkdirp(path) {
	let dir = '';
	for (const part of path.split('/')) {
		if (part === '') continue;
		dir += '/' + part;
		try {
			pyodide.FS.mkdir(dir);
		} catch (error) {
			// Already there. There is no mkdir -p in Emscripten's FS.
		}
	}
}

/** Empty a directory and make sure it exists, so a run starts from nothing. */
function resetDir(path) {
	try {
		for (const name of pyodide.FS.readdir(path)) {
			if (name === '.' || name === '..') continue;
			try {
				pyodide.FS.unlink(path + '/' + name);
			} catch (error) {
				// A subdirectory or an open handle; the run overwrites by name anyway.
			}
		}
	} catch (error) {
		// Not there yet.
	}
	mkdirp(path);
}

function collectOutputs(dir) {
	const outputs = [];
	let names;
	try {
		names = pyodide.FS.readdir(dir);
	} catch (error) {
		return outputs;
	}
	names.sort();
	for (const name of names) {
		if (name === '.' || name === '..') continue;
		try {
			// slice() so the transferred buffer is ours: transferring the array the
			// filesystem handed back would detach part of the WASM heap.
			const bytes = pyodide.FS.readFile(dir + '/' + name).slice();
			outputs.push({ name: name, bytes: bytes.buffer });
		} catch (error) {
			// A subdirectory, or unreadable. Skipped rather than failing the run.
		}
	}
	return outputs;
}

function captureOutput(id) {
	const capture = (chunks, type) => (text) => {
		// Pyodide batches by line; whether the newline survives is a detail we
		// refuse to depend on, because the probe's output is read line by line.
		const chunk = text.endsWith('\\n') ? text : text + '\\n';
		chunks.push(chunk);
		post({ type: type, id: id, chunk: chunk });
	};
	pyodide.setStdout({ batched: capture(stdoutChunks, 'stdout') });
	pyodide.setStderr({ batched: capture(stderrChunks, 'stderr') });
}

async function handleLoad(id) {
	const started = performance.now();
	post({ type: 'progress', id: id, phase: 'runtime', message: 'Downloading the Python runtime' });
	// A runtime import of a CDN module. Inside a string Vite never sees it, and
	// the annotation says so to anyone who inlines this text some other way.
	const module = await import(/* @vite-ignore */ CONFIG.indexUrl + 'pyodide.mjs');
	pyodide = await module.loadPyodide({ indexURL: CONFIG.indexUrl });
	post({
		type: 'progress',
		id: id,
		phase: 'packages',
		message: 'Loading ' + CONFIG.packages.join(', '),
		loadedBytes: loadedBytesSince(started)
	});
	await pyodide.loadPackage(CONFIG.packages, {
		messageCallback: (text) =>
			post({
				type: 'progress',
				id: id,
				phase: 'packages',
				message: text,
				loadedBytes: loadedBytesSince(started)
			})
	});
	captureOutput(id);
	mkdirp('/inputs');
	mkdirp('/outputs');
	post({
		type: 'result',
		id: id,
		ok: true,
		version: pyodide.version,
		loadedBytes: loadedBytesSince(started)
	});
}

async function handleRun(message) {
	const id = message.id;
	stdoutChunks = [];
	stderrChunks = [];
	captureOutput(id);
	if (typeof message.stdin === 'string') {
		const text = message.stdin;
		let sent = false;
		pyodide.setStdin({
			stdin: () => {
				if (sent) return null;
				sent = true;
				return text;
			},
			autoEOF: true
		});
	}

	const started = performance.now();
	let exitCode = 0;
	try {
		try {
			await pyodide.loadPackagesFromImports(message.code);
		} catch (error) {
			// Not fatal: the script's own ImportError says it better, and a bad
			// import name must not cost the run its traceback.
			stderrChunks.push('Could not preload packages: ' + describeError(error) + '\\n');
		}
		if (MATPLOTLIB_MENTION.test(message.code)) {
			await pyodide.runPythonAsync(AGG_PREAMBLE);
		}
		await pyodide.runPythonAsync(message.code);
	} catch (error) {
		exitCode = 1;
		stderrChunks.push(describeError(error) + '\\n');
	}
	const durationMs = performance.now() - started;

	const outputs = message.collectOutputs ? collectOutputs('/outputs') : [];
	post(
		{
			type: 'result',
			id: id,
			ok: exitCode === 0,
			exitCode: exitCode,
			durationMs: durationMs,
			stdout: stdoutChunks.join(''),
			stderr: stderrChunks.join(''),
			outputs: outputs
		},
		outputs.map((output) => output.bytes)
	);
}

self.onmessage = async (event) => {
	const message = event.data;
	const id = message ? message.id : undefined;
	try {
		switch (message.type) {
			case 'load':
				await handleLoad(id);
				break;
			case 'reset':
				for (const path of message.paths) resetDir(path);
				post({ type: 'result', id: id, ok: true });
				break;
			case 'writeFile':
				mkdirp(message.path.slice(0, message.path.lastIndexOf('/')));
				pyodide.FS.writeFile(message.path, new Uint8Array(message.bytes));
				post({ type: 'result', id: id, ok: true });
				break;
			case 'run':
				await handleRun(message);
				break;
			case 'readFile': {
				const bytes = pyodide.FS.readFile(message.path).slice();
				post({ type: 'result', id: id, ok: true, name: message.path, bytes: bytes.buffer }, [
					bytes.buffer
				]);
				break;
			}
			default:
				post({ type: 'error', id: id, message: 'Unknown message type ' + message.type });
		}
	} catch (error) {
		post({ type: 'error', id: id, message: describeError(error) });
	}
};

post({ type: 'ready' });
`;
}
