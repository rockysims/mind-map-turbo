import { describe, expect, it } from 'vitest';
import { createFakeExecutor } from './fakeExecutor';
import { PyExecutorError, type ExecutionResult } from './pyExecutor';
import type { MeasuredFileDigest } from './probeScript';

const OK: ExecutionResult = {
	exitCode: 0,
	stdout: 'done\n',
	stderr: '',
	outputs: [{ name: 'plot.png', mimeType: 'image/png', bytes: new Uint8Array([1]) }],
	durationMs: 5
};

const DIGEST: MeasuredFileDigest = {
	name: 'sweep.csv',
	size: 12,
	kind: 'table',
	columns: ['t'],
	rows: 3
};

function file(name: string) {
	return { name, bytes: new Uint8Array([1, 2]) };
}

describe('createFakeExecutor', () => {
	it('answers with the scripted result and records what it was asked to run', async () => {
		const executor = createFakeExecutor(() => OK);

		const result = await executor.run('print(1)', [file('sweep.csv')], { timeoutMs: 900 });

		expect(result).toEqual(OK);
		expect(executor.runs).toEqual([
			{ script: 'print(1)', files: [file('sweep.csv')], timeoutMs: 900 }
		]);
	});

	it('lets the script branch on the code, which is how a retry loop is tested', async () => {
		const executor = createFakeExecutor((code) =>
			code.includes('log') ? OK : { ...OK, exitCode: 1, stderr: 'ValueError' }
		);

		expect((await executor.run('plot()', [])).exitCode).toBe(1);
		expect((await executor.run('plot(log=True)', [])).exitCode).toBe(0);
	});

	it('reports load progress and hands back the scripted digests', async () => {
		const executor = createFakeExecutor(() => OK, [DIGEST]);
		const progress: string[] = [];

		await executor.load((entry) => progress.push(entry.phase));
		const digests = await executor.digest([file('sweep.csv')], 5);

		expect(progress).toEqual(['runtime', 'packages']);
		expect(executor.loadCount).toBe(1);
		expect(digests).toEqual([DIGEST]);
		expect(executor.digests).toEqual([{ files: [file('sweep.csv')], previewRows: 5 }]);
	});

	it('rejects a run in flight when the signal aborts', async () => {
		const executor = createFakeExecutor(() => new Promise<ExecutionResult>(() => {}));
		const controller = new AbortController();
		const running = executor.run('while True: pass', [], { signal: controller.signal });
		controller.abort();

		await expect(running).rejects.toBeInstanceOf(PyExecutorError);
	});

	it('rejects a run in flight when it is disposed, and says so', async () => {
		const executor = createFakeExecutor(() => new Promise<ExecutionResult>(() => {}));
		const running = executor.run('while True: pass', []);
		executor.dispose();

		await expect(running).rejects.toThrow('cancelled');
		expect(executor.disposed).toBe(true);
	});
});
