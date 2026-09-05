/**
 * The executor against a real Pyodide, in a real browser.
 *
 * **This suite is off by default.** It fetches the runtime and the preload
 * wheels from the CDN — about 20 MB, tens of seconds on a cold cache — and the
 * gate suite has to stay offline and under a minute. Turn it on with:
 *
 * ```sh
 * VITE_PYODIDE_SPEC=1 pnpm --filter mind-map-sv test:unit -- --run --project client
 * ```
 *
 * (`VITE_` is the prefix Vite exposes to `import.meta.env`, which is the only
 * env a browser-mode spec can read.) With the switch off it reports as skipped,
 * with the reason in the suite name.
 *
 * The `.svelte.spec.ts` suffix is not decoration: it is what puts a spec in the
 * `client` Vitest project, the one that runs in Chromium through Playwright.
 * This spec needs `Worker`, `Blob`, `URL.createObjectURL` and the network, so
 * Node is not an option.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { APP_CONFIG } from '$lib/appConfig';
import { PyExecutorError, createPyExecutor, type PyExecutor } from './pyExecutor';

const ENABLED = import.meta.env.VITE_PYODIDE_SPEC === '1';

const TITLE = ENABLED
	? 'createPyExecutor against the real runtime'
	: 'createPyExecutor against the real runtime (skipped: set VITE_PYODIDE_SPEC=1 to run; it downloads ~20 MB)';

/** A cold load is tens of seconds; a run after it is a couple. */
const LOAD_TIMEOUT_MS = 300_000;

const CSV = ['t,ch1,ch2', '0,1.5,2.5', '1,2.5,3.5', '2,3.5,4.5', '3,4.5,5.5'].join('\n');

const PLOT_SCRIPT = [
	'import os',
	'import pandas as pd',
	'import matplotlib.pyplot as plt',
	"df = pd.read_csv('/inputs/sweep.csv')",
	'fig, ax = plt.subplots()',
	"ax.plot(df['t'], df['ch1'])",
	"fig.savefig('/outputs/plot.png')",
	"df.describe().to_csv('/outputs/summary.csv')",
	"print('wrote', sorted(os.listdir('/outputs')))"
].join('\n');

function inputs() {
	return [{ name: 'sweep.csv', bytes: new TextEncoder().encode(`${CSV}\n`) }];
}

describe(TITLE, () => {
	let executor: PyExecutor | undefined;

	function live(): PyExecutor {
		executor ??= createPyExecutor(APP_CONFIG.ai.runtime);
		return executor;
	}

	afterAll(() => {
		executor?.dispose();
		executor = undefined;
	});

	it.runIf(ENABLED)(
		'loads the runtime and reports progress on the way',
		async () => {
			const phases: string[] = [];
			await live().load((progress) => phases.push(progress.phase));

			expect(phases).toContain('runtime');
			expect(phases).toContain('packages');
		},
		LOAD_TIMEOUT_MS
	);

	it.runIf(ENABLED)(
		'returns the PNG and the CSV a script wrote, typed by their names',
		async () => {
			const result = await live().run(PLOT_SCRIPT, inputs(), { timeoutMs: 120_000 });

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain('plot.png');
			expect(result.outputs.map((output) => [output.name, output.mimeType])).toEqual([
				['plot.png', 'image/png'],
				['summary.csv', 'text/csv']
			]);
			const png = result.outputs[0].bytes;
			expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
			expect(new TextDecoder().decode(result.outputs[1].bytes)).toContain('ch1');
		},
		LOAD_TIMEOUT_MS
	);

	it.runIf(ENABLED)(
		'reports a raising script as exit 1 with the traceback in stderr',
		async () => {
			const result = await live().run('raise ValueError("no channel 9")', [], {
				timeoutMs: 60_000
			});

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain('Traceback');
			expect(result.stderr).toContain('no channel 9');
			expect(result.outputs).toEqual([]);
		},
		LOAD_TIMEOUT_MS
	);

	it.runIf(ENABLED)(
		'digests a CSV into columns, dtypes and the rows that were asked for',
		async () => {
			const digests = await live().digest(inputs(), 2);

			expect(digests).toHaveLength(1);
			expect(digests[0]).toMatchObject({ name: 'sweep.csv', kind: 'table', rows: 4 });
			expect(digests[0].columns).toEqual(['t', 'ch1', 'ch2']);
			expect(digests[0].dtypes).toEqual(['int64', 'float64', 'float64']);
			expect(digests[0].head).toHaveLength(2);
		},
		LOAD_TIMEOUT_MS
	);

	it.runIf(ENABLED)(
		'cuts a script that will not stop, and works again after a fresh load',
		async () => {
			const running = live().run('while True:\n    pass\n', [], { timeoutMs: 3000 });

			await expect(running).rejects.toBeInstanceOf(PyExecutorError);
			const kind = await running.catch((error: unknown) =>
				error instanceof PyExecutorError ? error.kind : 'other'
			);
			expect(kind).toBe('timeout');

			await live().load();
			const after = await live().run("print('alive')", [], { timeoutMs: 60_000 });
			expect(after.stdout).toContain('alive');
		},
		LOAD_TIMEOUT_MS
	);

	it.runIf(ENABLED)(
		'rejects a run in flight when the executor is disposed',
		async () => {
			const running = live().run('while True:\n    pass\n', [], { timeoutMs: 0 });
			await new Promise((resolve) => setTimeout(resolve, 200));
			live().dispose();
			executor = undefined;

			const kind = await running.then(
				() => 'resolved',
				(error: unknown) => (error instanceof PyExecutorError ? error.kind : 'other')
			);
			expect(kind).toBe('aborted');
		},
		LOAD_TIMEOUT_MS
	);
});
