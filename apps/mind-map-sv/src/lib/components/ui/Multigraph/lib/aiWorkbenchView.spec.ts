import { describe, expect, it } from 'vitest';
import {
	defaultRunMode,
	latestDoneRun,
	runMetadataLine,
	staleOutputNames
} from './aiWorkbenchView';
import type { AiAddon, AiRun, AiRunOutput } from '../../types/node';

const RUNTIME = '0.27.7';
const STARTED = 1_700_000_000_000;

function makeRun(patch: Partial<AiRun> & Pick<AiRun, 'id'>): AiRun {
	return {
		startedAt: STARTED,
		status: 'done',
		mode: 'analyse',
		runtime: RUNTIME,
		inputs: [],
		summary: '',
		outputs: [],
		toolCalls: 0,
		...patch
	};
}

function makeAddon(patch: Partial<AiAddon> = {}): AiAddon {
	return { prompt: '', runs: [], promoted: {}, ...patch };
}

function output(name: string, assetId = `asset-${name}`): AiRunOutput {
	return { name, assetId, mimeType: 'image/png' };
}

describe('latestDoneRun', () => {
	it('has nothing to report on a node that has never run', () => {
		expect(latestDoneRun(makeAddon())).toBeUndefined();
	});

	it('picks the last run that finished, walking back past the ones that did not', () => {
		const ai = makeAddon({
			runs: [
				makeRun({ id: 'first' }),
				makeRun({ id: 'second' }),
				makeRun({ id: 'third', status: 'cancelled' }),
				makeRun({ id: 'fourth', status: 'error' })
			]
		});

		expect(latestDoneRun(ai)?.id).toBe('second');
	});

	it('ignores an interrupted run entirely', () => {
		const ai = makeAddon({ runs: [makeRun({ id: 'only', status: 'interrupted' })] });

		expect(latestDoneRun(ai)).toBeUndefined();
	});
});

describe('defaultRunMode', () => {
	it('offers a fresh analysis when nothing has run yet', () => {
		expect(defaultRunMode(makeAddon({ prompt: 'plot channel 2' }))).toBe('analyse');
	});

	it('offers a fresh analysis when a run finished but left no script', () => {
		const ai = makeAddon({
			prompt: 'plot channel 2',
			runs: [makeRun({ id: 'r1', prompt: 'plot channel 2' })]
		});

		expect(defaultRunMode(ai)).toBe('analyse');
	});

	it('offers a fresh analysis when only the failed runs left a script behind', () => {
		const ai = makeAddon({
			prompt: 'plot channel 2',
			script: 'print(1)',
			runs: [makeRun({ id: 'r1', status: 'error', prompt: 'plot channel 2' })]
		});

		expect(defaultRunMode(ai)).toBe('analyse');
	});

	it('offers a re-run when the prompt is exactly what produced the script', () => {
		const ai = makeAddon({
			prompt: 'plot channel 2',
			script: 'print(1)',
			runs: [makeRun({ id: 'r1', prompt: 'plot channel 2' })]
		});

		expect(defaultRunMode(ai)).toBe('rerun');
	});

	it('offers a refine once the prompt has moved on', () => {
		const ai = makeAddon({
			prompt: 'plot channel 2, log scale on y',
			script: 'print(1)',
			runs: [makeRun({ id: 'r1', prompt: 'plot channel 2' })]
		});

		expect(defaultRunMode(ai)).toBe('refine');
	});

	it('compares against the latest completed run, not the latest attempt', () => {
		const ai = makeAddon({
			prompt: 'plot channel 2',
			script: 'print(1)',
			runs: [
				makeRun({ id: 'r1', prompt: 'plot channel 2' }),
				makeRun({ id: 'r2', status: 'cancelled', prompt: 'something else entirely' })
			]
		});

		expect(defaultRunMode(ai)).toBe('rerun');
	});

	it('will not claim a run recorded without its prompt is unchanged', () => {
		const ai = makeAddon({
			prompt: 'plot channel 2',
			script: 'print(1)',
			runs: [makeRun({ id: 'r1' })]
		});

		expect(defaultRunMode(ai)).toBe('refine');
	});

	it('treats whitespace as an edit, because the request carries it verbatim', () => {
		const ai = makeAddon({
			prompt: 'plot channel 2 ',
			script: 'print(1)',
			runs: [makeRun({ id: 'r1', prompt: 'plot channel 2' })]
		});

		expect(defaultRunMode(ai)).toBe('refine');
	});
});

describe('staleOutputNames', () => {
	it('reports nothing when nothing is promoted', () => {
		const ai = makeAddon({ runs: [makeRun({ id: 'r1', outputs: [output('fig.png')] })] });

		expect(staleOutputNames(ai)).toEqual([]);
	});

	it('reports the bindings the latest completed run did not produce', () => {
		const ai = makeAddon({
			runs: [makeRun({ id: 'r1', outputs: [output('fig.png')] })],
			promoted: { 'fig.png': 'node-a', 'table.csv': 'node-b' }
		});

		expect(staleOutputNames(ai)).toEqual(['table.csv']);
	});

	it('keeps binding order, so the marks do not reshuffle between renders', () => {
		const ai = makeAddon({
			runs: [makeRun({ id: 'r1', outputs: [] })],
			promoted: { 'b.png': 'node-b', 'a.png': 'node-a' }
		});

		expect(staleOutputNames(ai)).toEqual(['b.png', 'a.png']);
	});

	it('reads the latest completed run, so a cancelled attempt stales nothing', () => {
		const ai = makeAddon({
			runs: [
				makeRun({ id: 'r1', outputs: [output('fig.png')] }),
				makeRun({ id: 'r2', status: 'cancelled', outputs: [] })
			],
			promoted: { 'fig.png': 'node-a' }
		});

		expect(staleOutputNames(ai)).toEqual([]);
	});

	it('stales every binding when history holds no completed run at all', () => {
		const ai = makeAddon({ promoted: { 'fig.png': 'node-a' } });

		expect(staleOutputNames(ai)).toEqual(['fig.png']);
	});
});

describe('runMetadataLine', () => {
	it('says what the run used, how long it took, and what it cost', () => {
		const line = runMetadataLine(
			makeRun({
				id: 'r1',
				model: 'claude-opus-5',
				finishedAt: STARTED + 48_000,
				usage: { inputTokens: 11_000, outputTokens: 1300 },
				toolCalls: 3
			})
		);

		expect(line).toBe('claude-opus-5 · 48 s · 12.3k tokens · 3 tool calls');
	});

	it('says a re-run touched no model', () => {
		const line = runMetadataLine(makeRun({ id: 'r1', mode: 'rerun', finishedAt: STARTED + 2000 }));

		expect(line).toBe('script only · 2 s');
	});

	it('counts one tool call in the singular', () => {
		const line = runMetadataLine(
			makeRun({ id: 'r1', model: 'claude-sonnet-5', finishedAt: STARTED + 9000, toolCalls: 1 })
		);

		expect(line).toBe('claude-sonnet-5 · 9 s · 1 tool call');
	});

	it('drops the tool-call segment when the script never ran', () => {
		const line = runMetadataLine(
			makeRun({ id: 'r1', model: 'claude-opus-5', finishedAt: STARTED + 4000, toolCalls: 0 })
		);

		expect(line).toBe('claude-opus-5 · 4 s');
	});

	it('spells long runs in minutes and seconds', () => {
		expect(runMetadataLine(makeRun({ id: 'r1', model: 'm', finishedAt: STARTED + 72_000 }))).toBe(
			'm · 1 m 12 s'
		);
		expect(runMetadataLine(makeRun({ id: 'r2', model: 'm', finishedAt: STARTED + 180_000 }))).toBe(
			'm · 3 m'
		);
	});

	it('reports small token counts exactly and large ones roundly', () => {
		const usageLine = (inputTokens: number, outputTokens: number): string =>
			runMetadataLine(makeRun({ id: 'r', usage: { inputTokens, outputTokens } }));

		expect(usageLine(800, 12)).toBe('812 tokens');
		expect(usageLine(12_000, 0)).toBe('12k tokens');
		expect(usageLine(1_200_000, 0)).toBe('1.2M tokens');
	});

	it('reports nothing it does not know: an interrupted run has no duration and no cost', () => {
		const line = runMetadataLine(
			makeRun({ id: 'r1', status: 'interrupted', model: 'claude-opus-5' })
		);

		expect(line).toBe('claude-opus-5');
	});

	it('drops a duration a clock adjustment made negative rather than drawing it', () => {
		const line = runMetadataLine(
			makeRun({ id: 'r1', model: 'claude-opus-5', finishedAt: STARTED - 5000 })
		);

		expect(line).toBe('claude-opus-5');
	});
});
