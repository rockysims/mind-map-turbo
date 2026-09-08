import { describe, expect, it } from 'vitest';
import {
	ancestorContextPreview,
	availableRunModes,
	defaultRunMode,
	digestDisclosureLabel,
	followUpDisabledReason,
	followUpSubmitDisabledReason,
	inputChangesNote,
	modeNoticeLine,
	prosePreviewLine,
	resultRows,
	stepStatusText,
	stepsPreviewLine,
	inputsChangedSince,
	latestDoneRun,
	runMetadataLine,
	staleOutputNames,
	IDLE_RUN_STATE,
	type AiRunState,
	type RunModeAvailability,
	type RunModeOptions
} from './aiWorkbenchView';
import { APP_CONFIG } from '$lib/appConfig';
import type { AiAncestor } from './aiAncestry';
import type { AiInput } from './aiInputs';
import type { FileDigest } from '$lib/ai/probeScript';
import type { AiAddon, AiRun, AiRunInput, AiRunMode, AiRunOutput } from '../../types/node';

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
	return {
		kind: 'file',
		nodeId: 'bench',
		assetId,
		name,
		mimeType: 'text/csv',
		size: 2048,
		origin: 'attachment'
	};
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
	// Same names, new bytes — which is what the workbench's own Replace does. The
	// stored script opens exactly those names, so a Run is the point here rather
	// than the trap, and the note must not push at a model call nobody needs.
	it('tells a replacement it can just be run', () => {
		expect(inputChangesNote({ added: [], removed: [], replaced: ['measurements.csv'] })).toBe(
			'measurements.csv was replaced since the last run. ' +
				'Run re-runs the script on the new data; Change lets Claude adjust it.'
		);
	});

	it('agrees with itself about several replacements', () => {
		expect(inputChangesNote({ added: [], removed: [], replaced: ['a.csv', 'b.csv'] })).toBe(
			'a.csv, b.csv were replaced since the last run. ' +
				'Run re-runs the script on the new data; Change lets Claude adjust it.'
		);
	});

	// A file the script names nowhere is the failure that does not look like one,
	// so this half keeps the sentence that names the choice.
	it('names what moved and then names the choice when something came or went', () => {
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

describe('digestDisclosureLabel', () => {
	const table = (rows?: number): FileDigest => ({
		name: 'measurements.csv',
		size: 2048,
		kind: 'table',
		columns: ['time'],
		...(rows === undefined ? {} : { rows })
	});

	it('names the preview depth for a file with more rows than that', () => {
		expect(digestDisclosureLabel(5, table(10_000))).toBe('What Claude will see (5 rows)');
	});

	// The setting is a ceiling, not a promise about this file: claiming five rows
	// of a two-row file was the complaint that started this.
	it('says how many the file actually has when it fits inside the preview', () => {
		expect(digestDisclosureLabel(5, table(2))).toBe('What Claude will see (all 2 rows)');
		expect(digestDisclosureLabel(5, table(1))).toBe('What Claude will see (all 1 row)');
		expect(digestDisclosureLabel(5, table(5))).toBe('What Claude will see (all 5 rows)');
	});

	it('keeps schema-only at a depth of zero, whatever the file holds', () => {
		expect(digestDisclosureLabel(0, table(2))).toBe('What Claude will see (schema only)');
		expect(digestDisclosureLabel(-3, table(10_000))).toBe('What Claude will see (schema only)');
	});

	it('falls back to the depth when the probe counted no rows', () => {
		expect(digestDisclosureLabel(1, table(undefined))).toBe('What Claude will see (1 row)');
		expect(digestDisclosureLabel(5, { name: 'notes.txt', size: 12, kind: 'other' })).toBe(
			'What Claude will see (5 rows)'
		);
	});
});

describe('prosePreviewLine', () => {
	const state = (patch: Partial<AiRunState> = {}): AiRunState => ({
		...IDLE_RUN_STATE,
		...patch
	});

	// The ticker half: a run in flight is a wait the reader is watching, so the
	// line is the newest thing Claude has finished saying rather than the oldest.
	it('tracks the latest sentence while a run is in flight', () => {
		expect(
			prosePreviewLine(
				state({ phase: 'running', text: 'Reading both files. Then plotting them.' }),
				''
			)
		).toBe('Then plotting them.');
	});

	it('moves as the stream arrives, one finished sentence at a time', () => {
		const at = (text: string): string => prosePreviewLine(state({ phase: 'running', text }), '');

		// Nothing has ended yet, so the fragment is what there is — the line moves
		// from the first token rather than waiting for a full stop.
		expect(at('Reading both')).toBe('Reading both');
		expect(at('Reading both files.')).toBe('Reading both files.');
		// Mid-sentence the line holds the last finished one rather than redrawing
		// on every token; it moves again when that sentence ends.
		expect(at('Reading both files. Then plott')).toBe('Reading both files.');
		expect(at('Reading both files. Then plotting them.')).toBe('Then plotting them.');
	});

	it('treats the end of a paragraph as the end of a sentence', () => {
		expect(
			prosePreviewLine(state({ phase: 'running', text: 'Reading both files\nNow plotting' }), '')
		).toBe('Reading both files');
	});

	it('tracks the stream while the runtime is still loading, too', () => {
		// `loading-runtime` is in flight as much as `running` is, and a model that
		// spoke before the runtime arrived has said the newest thing there is.
		expect(
			prosePreviewLine(
				state({ phase: 'loading-runtime', text: 'Reading both files. Then plotting them.' }),
				''
			)
		).toBe('Then plotting them.');
	});

	it('cuts a long latest sentence to one line', () => {
		const long = `Done. ${'word '.repeat(60)}stop.`;
		const preview = prosePreviewLine(state({ phase: 'running', text: long }), '');

		expect(preview.length).toBeLessThanOrEqual(121);
		expect(preview.endsWith('…')).toBe(true);
		expect(preview.startsWith('word')).toBe(true);
	});

	// The summary half: the run is over, there is nothing left to track, and the
	// first sentence is the answer often enough to save the click.
	it('shows the first sentence of the reply once the run has finished', () => {
		expect(
			prosePreviewLine(
				state({ phase: 'done', text: 'Reading both files. Then plotting them.' }),
				''
			)
		).toBe('Reading both files.');
	});

	it('falls back to the stored summary once nothing is running', () => {
		expect(prosePreviewLine(IDLE_RUN_STATE, 'Both files plotted on shared axes.')).toBe(
			'Both files plotted on shared axes.'
		);
	});

	// The line has to fit on one row of a summary, and a paragraph with no full
	// stop in it is still a paragraph.
	it('cuts a long first sentence rather than wrapping the summary', () => {
		const long = `${'word '.repeat(60)}stop.`;
		const preview = prosePreviewLine(state({ phase: 'done', text: long }), '');

		expect(preview.length).toBeLessThanOrEqual(121);
		expect(preview.endsWith('…')).toBe(true);
	});

	it('says what is happening while a run has not said anything yet', () => {
		expect(prosePreviewLine(state({ phase: 'loading-runtime' }), '')).toBe(
			'Loading the Python runtime…'
		);
		expect(prosePreviewLine(state({ phase: 'running' }), '')).toBe('Running…');
		expect(
			prosePreviewLine(state({ phase: 'running', steps: [{ stdoutTail: '', exitCode: null }] }), '')
		).toBe('Running analysis.py');
	});

	it('has nothing to preview on a node that has never run', () => {
		expect(prosePreviewLine(IDLE_RUN_STATE, '')).toBe('Nothing yet');
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

	/*
	 * The whole file table, because the difference between the three columns is
	 * the only thing that decides which button the reader lands on — and getting
	 * a replacement wrong is what started this: the reader swapped one export for
	 * another, the stored script opened exactly the same names, and the surface
	 * defaulted them to a model call that could only rewrite the script it had.
	 */
	describe('with a stored script and an unmoved prompt, by what the files did', () => {
		const run = makeRun({
			id: 'r1',
			prompt: 'plot channel 2',
			inputs: [sent('a.csv'), sent('b.csv')]
		});
		const ai = makeAddon({ prompt: 'plot channel 2', script: 'print(1)', runs: [run] });

		/** The same names over new bytes, which is what the workbench's Replace does. */
		const replacedA = file('a.csv', 'asset-a-v2');
		const replacedB = file('b.csv', 'asset-b-v2');

		it('nothing moved → rerun', () => {
			expect(defaultRunMode(ai, [file('a.csv'), file('b.csv')])).toBe('rerun');
		});

		it('replaced only → rerun, one file or several', () => {
			expect(defaultRunMode(ai, [replacedA, file('b.csv')])).toBe('rerun');
			expect(defaultRunMode(ai, [replacedA, replacedB])).toBe('rerun');
		});

		it('added → refine', () => {
			expect(defaultRunMode(ai, [file('a.csv'), file('b.csv'), file('c.csv')])).toBe('refine');
		});

		it('removed → refine', () => {
			expect(defaultRunMode(ai, [file('a.csv')])).toBe('refine');
		});

		it('added and removed → refine', () => {
			expect(defaultRunMode(ai, [file('a.csv'), file('c.csv')])).toBe('refine');
		});

		// A replacement alongside something that came or went is not the cheap
		// case: the script still has a name it never mentions, or one that is gone.
		it('replaced with an add → refine', () => {
			expect(defaultRunMode(ai, [replacedA, file('b.csv'), file('c.csv')])).toBe('refine');
		});

		it('replaced with a removal → refine', () => {
			expect(defaultRunMode(ai, [replacedA])).toBe('refine');
		});

		it('replaced with both → refine', () => {
			expect(defaultRunMode(ai, [replacedA, file('c.csv')])).toBe('refine');
		});

		// The note and the default read the same answer, so they cannot disagree
		// about what the reader should press.
		it('agrees with the note it is drawn beside', () => {
			const changes = inputsChangedSince(run, [replacedA, file('b.csv')]);

			expect(changes).toEqual({ added: [], removed: [], replaced: ['a.csv'] });
			expect(inputChangesNote(changes)).toContain('Run re-runs the script on the new data');
		});
	});

	it('still offers a refine for a replacement once the prompt has moved too', () => {
		// The prompt wins as it always has: a changed question needs a changed
		// script, whatever the files did.
		const ai = makeAddon({
			prompt: 'plot channel 2, log scale on y',
			script: 'print(1)',
			runs: [makeRun({ id: 'r1', prompt: 'plot channel 2', inputs: [sent('a.csv')] })]
		});

		expect(defaultRunMode(ai, [file('a.csv', 'asset-a-v2')])).toBe('refine');
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

/*
 * The four states a node can be in once a follow-up can inherit a script, in
 * one table, because the default and the availability have to agree: a mode the
 * switch starts on and then refuses to offer is the one combination that cannot
 * be right.
 */
describe('the mode rules across the four script states', () => {
	const INHERITED = { inheritedScript: 'print(2)' };

	/** A follow-up before its first run: a prompt and nothing else. */
	const fresh = makeAddon({ prompt: 'now fit a line' });
	/** A node that has run and kept the script that run wrote. */
	const ranAndStored = makeAddon({
		prompt: 'plot channel 2',
		script: 'print(1)',
		runs: [makeRun({ id: 'r1', prompt: 'plot channel 2' })]
	});

	/** The modes the switch may offer, in the order it draws them. */
	function offered(ai: AiAddon, options?: RunModeOptions): AiRunMode[] {
		return availableRunModes(ai, options)
			.filter((entry) => entry.available)
			.map((entry) => entry.mode);
	}

	/** One mode's entry — every mode has one, available or not, and this says so. */
	function entryFor(ai: AiAddon, mode: AiRunMode, options?: RunModeOptions): RunModeAvailability {
		const entry = availableRunModes(ai, options).find((candidate) => candidate.mode === mode);
		if (entry === undefined) throw new Error(`expected the switch to list ${mode}`);
		return entry;
	}

	function reasonFor(ai: AiAddon, mode: AiRunMode, options?: RunModeOptions): string | undefined {
		return entryFor(ai, mode, options).reason;
	}

	it('no run and nothing to inherit: writes, and offers Write alone', () => {
		expect(defaultRunMode(fresh)).toBe('analyse');
		expect(offered(fresh)).toEqual(['analyse']);
	});

	it('an inherited script only: changes it, and offers Write and Change but not Run', () => {
		expect(defaultRunMode(fresh, undefined, INHERITED)).toBe('refine');
		expect(offered(fresh, INHERITED)).toEqual(['analyse', 'refine']);
	});

	it('a script of its own: keeps the rules it had, and offers all three', () => {
		expect(defaultRunMode(ranAndStored)).toBe('rerun');
		expect(offered(ranAndStored)).toEqual(['analyse', 'refine', 'rerun']);
	});

	it('both scripts: its own decides, and all three stay on offer', () => {
		expect(defaultRunMode(ranAndStored, undefined, INHERITED)).toBe('rerun');
		expect(offered(ranAndStored, INHERITED)).toEqual(['analyse', 'refine', 'rerun']);
	});

	it('lists every mode, available or not, in the order the switch draws them', () => {
		expect(availableRunModes(fresh).map((entry) => entry.mode)).toEqual([
			'analyse',
			'refine',
			'rerun'
		]);
	});

	it('says Change needs a script when there is none to reach', () => {
		expect(reasonFor(fresh, 'refine')).toBe('No stored script yet — write one first.');
	});

	it('says Run needs a script when there is none to reach', () => {
		expect(reasonFor(fresh, 'rerun')).toBe('No stored script yet — write one first.');
	});

	it('tells a node with only an inherited script that Run needs one of its own', () => {
		// A different sentence from the one above on purpose: telling a reader
		// there is no script, on a node whose parent's script they can see, is a
		// lie about the state they are looking at.
		expect(reasonFor(fresh, 'rerun', INHERITED)).toBe(
			"No stored script on this node yet — Change adapts the parent's and stores it here."
		);
	});

	it('gives an available mode no reason to show', () => {
		expect(reasonFor(fresh, 'analyse')).toBeUndefined();
		expect(reasonFor(ranAndStored, 'rerun')).toBeUndefined();
	});

	it('leaves a node that has a script but no completed run on Write, inherited or not', () => {
		// The existing rule, pinned against the new option: an inherited script
		// only speaks for a node that has none of its own.
		const scriptWithoutRun = makeAddon({ prompt: 'plot channel 2', script: 'print(1)' });

		expect(defaultRunMode(scriptWithoutRun)).toBe('analyse');
		expect(defaultRunMode(scriptWithoutRun, undefined, INHERITED)).toBe('analyse');
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

	/*
	 * A binding to a node the reader deleted is not stale — it is not a binding.
	 * Marking it stale would put a name on screen with a jump to nothing behind
	 * it, which is the bug this predicate exists to close.
	 */
	it('ignores bindings whose node is gone', () => {
		const ai = makeAddon({
			runs: [makeRun({ id: 'r1', outputs: [] })],
			promoted: { 'gone.png': 'deleted-node', 'kept.png': 'live-node' }
		});

		expect(staleOutputNames(ai, (nodeId) => nodeId === 'live-node')).toEqual(['kept.png']);
	});

	it('treats every binding as live for a caller with no graph to ask', () => {
		const ai = makeAddon({
			runs: [makeRun({ id: 'r1', outputs: [] })],
			promoted: { 'gone.png': 'deleted-node' }
		});

		expect(staleOutputNames(ai)).toEqual(['gone.png']);
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

describe('stepsPreviewLine', () => {
	it('names the latest execution, how it ended, and the last line it printed', () => {
		expect(
			stepsPreviewLine([
				{ stdoutTail: 'Reading data\nWrote channel2.png\n', exitCode: 0 },
				{ stdoutTail: "Traceback (most recent call last):\n  ...\nKeyError: 'ch2'\n", exitCode: 1 }
			])
		).toBe("Execution 2 failed, exit 1 — KeyError: 'ch2'");
	});

	it('says a step is running and follows what it prints', () => {
		expect(stepsPreviewLine([{ stdoutTail: 'Loading both files\n', exitCode: null }])).toBe(
			'Execution 1 running — Loading both files'
		);
	});

	it('drops the dash when the step printed nothing', () => {
		expect(stepsPreviewLine([{ stdoutTail: '  \n\n', exitCode: 0 }])).toBe('Execution 1 finished');
		expect(stepsPreviewLine([])).toBe('Nothing yet');
	});

	it('cuts a long printed line to the summary width', () => {
		const line = stepsPreviewLine([{ stdoutTail: 'x'.repeat(200), exitCode: 0 }], 40);
		expect(line).toHaveLength(40 + 1);
		expect(line.endsWith('…')).toBe(true);
	});

	it('words an exit the same way on the row and in the closed line', () => {
		expect(stepStatusText(null)).toBe('running');
		expect(stepStatusText(0)).toBe('finished');
		expect(stepStatusText(2)).toBe('failed, exit 2');
	});
});

describe('the notice line under the mode switch', () => {
	it('says nothing when every mode is available', () => {
		expect(modeNoticeLine(availableRunModes(makeAddon({ script: 'print(1)' })))).toBe('');
	});

	it('says the shared reason once when two modes are out for the same reason', () => {
		expect(modeNoticeLine(availableRunModes(makeAddon()))).toBe(
			'No stored script yet — write one first.'
		);
	});

	it('carries the reason a follow-up gets, which is about this node and not the map', () => {
		expect(modeNoticeLine(availableRunModes(makeAddon(), { inheritedScript: 'print(2)' }))).toBe(
			"No stored script on this node yet — Change adapts the parent's and stores it here."
		);
	});
});

describe('the results a run reported, as rows', () => {
	const measured = makeRun({
		id: 'r1',
		results: [
			{ symbol: 'R_{th}', value: '12.3', unit: 'K/W' },
			{ symbol: '\\tau', value: '0.8' }
		]
	});

	it('renders each result through the renderer the extractor also reads', () => {
		expect(resultRows(makeAddon({ runs: [measured] }))).toEqual([
			{ symbol: 'R_{th}', tex: 'R_{th} = 12.3\\ \\text{K/W}' },
			{ symbol: '\\tau', tex: '\\tau = 0.8' }
		]);
	});

	it('has nothing to show for a node that has never run, or ran and measured nothing', () => {
		expect(resultRows(makeAddon())).toEqual([]);
		expect(resultRows(makeAddon({ runs: [makeRun({ id: 'r1' })] }))).toEqual([]);
	});

	it('keeps the last completed run when a later attempt failed', () => {
		// A re-run that timed out measured nothing; letting it blank the section
		// would take the answer off the screen for a reason that is not about it.
		const failed = makeRun({ id: 'r2', status: 'error' });
		expect(resultRows(makeAddon({ runs: [measured, failed] }))).toHaveLength(2);
	});
});

describe('the ancestor context preview', () => {
	function ancestor(patch: Partial<AiAncestor> = {}): AiAncestor {
		return {
			nodeId: 'parent',
			hops: 1,
			title: 'Sweep A cleanup',
			prompt: 'drop the first 200 samples',
			summary: 'Wrote clean.csv.',
			...patch
		};
	}

	const withScript = ancestor({ script: 'print("clean")' });

	it('has nothing to preview without ancestors', () => {
		expect(ancestorContextPreview([], 'refine')).toEqual({ text: '', steps: 0, label: '' });
	});

	it('leaves the script out in Change, because the request carries it separately', () => {
		const preview = ancestorContextPreview([withScript], 'refine');
		expect(preview.text).toContain('Asked: drop the first 200 samples');
		expect(preview.text).not.toContain('Its analysis.py:');
	});

	it('carries the script in Write, which has no other place to put it', () => {
		const preview = ancestorContextPreview([withScript], 'analyse');
		expect(preview.text).toContain('Its analysis.py:');
		expect(preview.text).toContain('print("clean")');
	});

	it('previews nothing for a Run, which calls no model and sends no prose', () => {
		expect(ancestorContextPreview([withScript], 'rerun').text).toBe('');
	});

	it('names the steps and the characters that are actually in the section', () => {
		const one = ancestorContextPreview([ancestor()], 'refine');
		expect(one.steps).toBe(1);
		expect(one.label).toBe(`What Claude will see (1 step, ${one.text.length} characters)`);

		const two = ancestorContextPreview(
			[ancestor(), ancestor({ nodeId: 'grandparent', hops: 2, title: 'Raw import' })],
			'refine'
		);
		expect(two.steps).toBe(2);
		expect(two.label).toContain('(2 steps,');
	});

	it('counts what survived the cap rather than what was handed in', () => {
		// The number on the closed line is a claim about what leaves the machine,
		// so a step the renderer dropped must not be counted as sent. Wide rather
		// than deep, because the hop cap is three and the character cap is what
		// this is about: a dozen parents each reporting a page.
		const many = Array.from({ length: 12 }, (unused, index) =>
			ancestor({ nodeId: `p${index}`, summary: 'x'.repeat(2000) })
		);
		const preview = ancestorContextPreview(many, 'refine');
		expect(preview.text.length).toBeLessThanOrEqual(APP_CONFIG.ai.ancestorContext.maxChars);
		expect(preview.steps).toBeLessThan(12);
		expect(preview.steps).toBeGreaterThan(0);
		expect(preview.label).toContain(`${preview.steps} steps`);
		expect(preview.text).toContain('earlier steps omitted.');
	});
});

describe('why the follow-up controls are out of reach', () => {
	it('waits for an answer to follow up on', () => {
		expect(followUpDisabledReason(makeAddon())).toBe(
			'Nothing to follow up on yet — run this node first.'
		);
		expect(
			followUpDisabledReason(makeAddon({ runs: [makeRun({ id: 'r1', status: 'error' })] }))
		).toBe('Nothing to follow up on yet — run this node first.');
	});

	it('says nothing once the node has a completed run', () => {
		expect(followUpDisabledReason(makeAddon({ runs: [makeRun({ id: 'r1' })] }))).toBeUndefined();
	});

	it('refuses an empty draft on the same terms the mutation refuses it', () => {
		expect(followUpSubmitDisabledReason('')).toBe('Nothing to ask yet — type the follow-up first.');
		expect(followUpSubmitDisabledReason('  \n\t ')).toBe(
			'Nothing to ask yet — type the follow-up first.'
		);
		expect(followUpSubmitDisabledReason('now fit a line')).toBeUndefined();
	});
});
