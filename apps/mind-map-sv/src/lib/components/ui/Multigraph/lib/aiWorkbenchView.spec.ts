import { describe, expect, it } from 'vitest';
import {
	defaultRunMode,
	inputChangesNote,
	inputsChangedSince,
	latestDoneRun,
	runMetadataLine,
	staleOutputNames
} from './aiWorkbenchView';
import type { AiInput } from './aiInputs';
import type { AiAddon, AiRun, AiRunInput, AiRunOutput } from '../../types/node';

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

/** One attached file, as the workbench collects it. */
function file(name: string, assetId = `asset-${name}`): AiInput {
	return { kind: 'file', nodeId: 'bench', assetId, name, mimeType: 'text/csv', size: 2048 };
}

/** The same file, as a finished run recorded it. */
function sent(name: string, assetId = `asset-${name}`): AiRunInput {
	return { nodeId: 'bench', assetId, name };
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

describe('inputsChangedSince', () => {
	const run = makeRun({ id: 'r1', inputs: [sent('a.csv'), sent('b.csv')] });

	it('says nothing changed when the same files are still attached', () => {
		expect(inputsChangedSince(run, [file('a.csv'), file('b.csv')])).toEqual({
			added: [],
			removed: [],
			replaced: []
		});
	});

	it('names a file attached since the run', () => {
		expect(inputsChangedSince(run, [file('a.csv'), file('b.csv'), file('c.csv')])).toEqual({
			added: ['c.csv'],
			removed: [],
			replaced: []
		});
	});

	it('names a file detached since the run', () => {
		expect(inputsChangedSince(run, [file('a.csv')])).toEqual({
			added: [],
			removed: ['b.csv'],
			replaced: []
		});
	});

	it('calls the same name over a new asset a replacement, not an add and a remove', () => {
		// A re-export of the same measurement. The script opens it happily and says
		// nothing, which is exactly why the reader has to be told.
		expect(inputsChangedSince(run, [file('a.csv'), file('b.csv', 'asset-b-v2')])).toEqual({
			added: [],
			removed: [],
			replaced: ['b.csv']
		});
	});

	it('reports all three at once, each in the order it is attached', () => {
		expect(
			inputsChangedSince(run, [file('b.csv', 'asset-b-v2'), file('c.csv'), file('d.csv')])
		).toEqual({ added: ['c.csv', 'd.csv'], removed: ['a.csv'], replaced: ['b.csv'] });
	});

	it('ignores a text input, which is sent rather than written to disk', () => {
		const text: AiInput = { kind: 'text', nodeId: 'notes', title: 'Bench', description: 'Warm.' };
		const withText = makeRun({ id: 'r2', inputs: [sent('a.csv'), { nodeId: 'notes' }] });

		expect(inputsChangedSince(withText, [file('a.csv'), text])).toEqual({
			added: [],
			removed: [],
			replaced: []
		});
		// And a note that has come or gone is not a change to the files either.
		expect(inputsChangedSince(withText, [file('a.csv')])).toEqual({
			added: [],
			removed: [],
			replaced: []
		});
	});

	it('treats a renamed asset as one file, not as an add and a remove', () => {
		// Same id, new name: the bytes the script reads have not moved, and the
		// executor writes whatever name the graph now holds.
		expect(inputsChangedSince(run, [file('a.csv'), file('b-final.csv', 'asset-b.csv')])).toEqual({
			added: [],
			removed: [],
			replaced: []
		});
	});

	it('matches what it can of a run recorded before filenames were kept', () => {
		// The id still says which files survived; a file that has gone cannot be
		// named, so it is left out rather than guessed at.
		const legacy = makeRun({ id: 'r3', inputs: [{ nodeId: 'bench', assetId: 'asset-a.csv' }] });

		expect(inputsChangedSince(legacy, [file('a.csv')])).toEqual({
			added: [],
			removed: [],
			replaced: []
		});
		expect(inputsChangedSince(legacy, [file('c.csv')])).toEqual({
			added: ['c.csv'],
			removed: [],
			replaced: []
		});
	});

	it('counts a file attached twice once, since the sandbox holds one copy', () => {
		expect(
			inputsChangedSince(run, [file('a.csv'), file('b.csv'), file('c.csv'), file('c.csv')])
		).toEqual({ added: ['c.csv'], removed: [], replaced: [] });
	});
});

describe('inputChangesNote', () => {
	it('names what moved and then names the choice', () => {
		expect(inputChangesNote({ added: ['a.csv'], removed: [], replaced: ['b.csv'] })).toBe(
			'Files changed since the script was written: added a.csv, replaced b.csv. ' +
				'Run uses the stored script as it is; choose Change so Claude updates it.'
		);
	});

	it('lists only the parts that happened', () => {
		expect(inputChangesNote({ added: [], removed: ['gone.csv'], replaced: [] })).toContain(
			'written: removed gone.csv.'
		);
	});

	it('is empty when nothing changed, so the workbench has nothing to draw', () => {
		expect(inputChangesNote({ added: [], removed: [], replaced: [] })).toBe('');
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

	it('offers a refine when the files have moved, however unchanged the prompt', () => {
		// The script names the files it was written for, so new data can need a new
		// script even when the question has not changed at all.
		const ai = makeAddon({
			prompt: 'plot channel 2',
			script: 'print(1)',
			runs: [makeRun({ id: 'r1', prompt: 'plot channel 2', inputs: [sent('a.csv')] })]
		});

		expect(defaultRunMode(ai, [file('a.csv'), file('b.csv')])).toBe('refine');
		expect(defaultRunMode(ai, [file('a.csv')])).toBe('rerun');
	});

	it('does not ask the file question when the caller has no inputs to give', () => {
		// A caller that has not collected the inputs cannot be asked to invent
		// them, and an empty list would read as "every file was removed".
		const ai = makeAddon({
			prompt: 'plot channel 2',
			script: 'print(1)',
			runs: [makeRun({ id: 'r1', prompt: 'plot channel 2', inputs: [sent('a.csv')] })]
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
