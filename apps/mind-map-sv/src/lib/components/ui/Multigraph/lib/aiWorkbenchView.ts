/**
 * What the workbench shows about an `!ai` node, decided without a component.
 *
 * Three questions the surface cannot answer by looking at one field: which run
 * mode to offer by default, which promoted outputs the latest run stopped
 * producing, and how to say in one line what a run cost. All three read the
 * add-on and nothing else, so a story can pin them and the component can stay
 * markup.
 */

import { latestDoneRun } from './aiNode';
import type { AiInput } from './aiInputs';
import type { AiAddon, AiRun, AiRunMode } from '../../types/node';

/**
 * How far along the run in front of the reader is. Never persisted: a reload
 * turns an in-flight run into an `interrupted` record, so this lives in the
 * controller (T08) for exactly as long as the run does.
 *
 * `loading-runtime` is its own phase rather than a flag on `running` because it
 * is the one wait the reader has to be told about — tens of megabytes of Python
 * from a CDN, once per browser.
 */
export type AiRunPhase = 'idle' | 'loading-runtime' | 'running' | 'done' | 'error';

/** One execution of the script inside a run, as the live section draws it. */
export interface AiRunStep {
	/** The tail of what the script printed — `APP_CONFIG.ai.stdoutTailChars` of it. */
	stdoutTail: string;
	/** `null` while the step is still running; `0` for a script that succeeded. */
	exitCode: number | null;
}

/**
 * Everything the workbench draws about the run in flight, assembled by the run
 * controller and handed down whole.
 *
 * `text` and `thinking` accumulate as the stream arrives, so the reader sees
 * the first token rather than the last. `error` carries the sentence shown
 * where the summary would be; `refusal` says that sentence is Claude declining
 * rather than something breaking, which is a different thing to tell a reader
 * even though both arrive on the same phase.
 */
export interface AiRunState {
	phase: AiRunPhase;
	/** Claude's reply as it streams. */
	text: string;
	/** The thinking summary as it streams, behind a disclosure. */
	thinking: string;
	steps: AiRunStep[];
	/** Bytes of the Python runtime fetched so far, while `loading-runtime`. */
	runtimeProgress?: { loadedBytes: number; totalBytes?: number };
	error?: string;
	/** `true` when `error` is Claude refusing the request rather than a failure. */
	refusal?: boolean;
	/**
	 * What the stored script printed to stderr when a re-run of it failed.
	 *
	 * Set on that path alone, because it is the one failure nobody has explained
	 * to the reader: no model was in the loop, so the traceback is the whole of
	 * what is known. Its presence is what puts "Fix with AI" on the error block,
	 * and its text is what that refine run carries — one value, so what is on
	 * screen and what goes in the request cannot disagree.
	 */
	traceback?: string;
}

/** The state a workbench with nothing in flight is handed. */
export { latestDoneRun };

export const IDLE_RUN_STATE: AiRunState = { phase: 'idle', text: '', thinking: '', steps: [] };

/**
 * What has happened to the files since a run, by filename.
 *
 * Three lists rather than a flag, because the sentence the workbench writes
 * names them — "added a.csv, replaced b.csv" — and because they mean different
 * things to a script: an added file it will not open, a replaced one it will
 * open and find different, a removed one it will fail on.
 */
export interface AiInputChanges {
	added: string[];
	removed: string[];
	replaced: string[];
}

/** Nothing has changed: the answer every caller with no run to compare gets. */
const NO_INPUT_CHANGES: AiInputChanges = { added: [], removed: [], replaced: [] };

export function hasInputChanges(changes: AiInputChanges): boolean {
	return changes.added.length + changes.removed.length + changes.replaced.length > 0;
}

/**
 * Which files have come, gone or been swapped since `run` was recorded.
 *
 * This exists because re-run is not as free as it looks. The controller does
 * gather the current files on every run, but the *stored script* opens the
 * names it was written for — so a file added since then is written into the
 * sandbox and never read, and a renamed one is written under a name no line of
 * the script mentions. Nothing fails; the answer is just quietly about the old
 * data, which is the worst way for this to go wrong.
 *
 * Matched by asset id first: the same id under a new name is not a new file,
 * and the same name over a new id is `replaced`, which is the case a reader has
 * to be told about because the script will happily read the new bytes and say
 * nothing. Only file inputs count — a neighbour's title and description are
 * sent in the request, not written to disk, so a script cannot be out of date
 * with respect to one.
 *
 * A run recorded before filenames were kept (`AiRunInput.name`) can still be
 * matched by id, so files that survived are recognised; what it cannot do is
 * name a file that has gone, and that one is left out rather than guessed at.
 */
export function inputsChangedSince(run: AiRun, inputs: AiInput[]): AiInputChanges {
	const current = fileInputs(inputs);
	const previous = run.inputs.filter((input) => input.assetId !== undefined);

	const currentIds = new Set(current.map((input) => input.assetId));
	const previousIds = new Set(previous.map((input) => input.assetId));
	// Only the names that have *gone* can stand in for a replacement: a name that
	// is still attached under its old id has not been replaced by anything.
	const goneNames = new Set(
		previous
			.filter((input) => input.assetId !== undefined && !currentIds.has(input.assetId))
			.map((input) => input.name)
			.filter((name): name is string => name !== undefined)
	);

	const added: string[] = [];
	const replaced: string[] = [];
	for (const input of current) {
		if (previousIds.has(input.assetId)) continue;
		const list = goneNames.has(input.name) ? replaced : added;
		if (!list.includes(input.name)) list.push(input.name);
	}

	const currentNames = new Set(current.map((input) => input.name));
	const removed: string[] = [];
	for (const input of previous) {
		if (input.assetId !== undefined && currentIds.has(input.assetId)) continue;
		// A gone id whose name is attached again is the replacement above, not a
		// removal; a gone id with no name recorded cannot be named at all.
		if (input.name === undefined || currentNames.has(input.name)) continue;
		if (!removed.includes(input.name)) removed.push(input.name);
	}

	return { added, removed, replaced };
}

function fileInputs(inputs: AiInput[]): Extract<AiInput, { kind: 'file' }>[] {
	return inputs.filter((input) => input.kind === 'file');
}

/**
 * The mode the switch starts on.
 *
 * - **analyse** — nothing to build on: no completed run, or no stored script.
 *   A fresh analysis is also what a completed run that left no script gets,
 *   because both of the other modes need a script to work from.
 * - **refine** — the prompt has moved since the run that wrote the script, so
 *   the script needs editing to match. A run recorded before `AiRun.prompt`
 *   existed lands here too: an absent prompt cannot be claimed unchanged, and
 *   offering to edit the script is the recoverable half of that guess. Changed
 *   *files* land here as well, and for the same reason: the stored script names
 *   the files it was written for, so new data can need a new script even when
 *   the question has not moved an inch.
 * - **rerun** — the prompt and the files are both exactly what produced the
 *   stored script, so the only reason to run is that the bytes behind an
 *   attachment moved — and that needs no model call at all.
 *
 * `inputs` is optional because a caller that has not collected them cannot be
 * asked to invent them; without it the file question is simply not asked, which
 * is the answer this had before it could be.
 */
export function defaultRunMode(ai: AiAddon, inputs?: AiInput[]): AiRunMode {
	const latest = latestDoneRun(ai);
	if (latest === undefined || ai.script === undefined) return 'analyse';
	if (latest.prompt !== ai.prompt) return 'refine';
	if (inputs !== undefined && hasInputChanges(inputsChangedSince(latest, inputs))) return 'refine';
	return 'rerun';
}

/**
 * What changed since the run whose script is stored, or nothing at all when
 * there is no such run. The workbench's one call: it draws the note and reads
 * the default mode off the same answer.
 */
export function inputChangesForAddon(ai: AiAddon, inputs: AiInput[]): AiInputChanges {
	const latest = latestDoneRun(ai);
	if (latest === undefined || ai.script === undefined) return NO_INPUT_CHANGES;
	return inputsChangedSince(latest, inputs);
}

/**
 * The note above the mode switch, or `''` when there is nothing to say.
 *
 * It names the files and then names the choice, because the reader's next act
 * is picking a mode: Run is not wrong, it is just literal, and Change is how the
 * script catches up. Only the non-empty parts are listed — "removed: none" is
 * noise about a thing that did not happen.
 */
export function inputChangesNote(changes: AiInputChanges): string {
	const parts = [
		listPart('added', changes.added),
		listPart('replaced', changes.replaced),
		listPart('removed', changes.removed)
	].filter((part) => part !== '');
	if (parts.length === 0) return '';
	return (
		`Files changed since the script was written: ${parts.join(', ')}. ` +
		'Run uses the stored script as it is; choose Change so Claude updates it.'
	);
}

function listPart(verb: string, names: string[]): string {
	return names.length === 0 ? '' : `${verb} ${names.join(', ')}`;
}

/**
 * Bound output names the latest completed run did not produce, in binding
 * order.
 *
 * Their promoted nodes keep the figure they have — the milestone's rule that a
 * plot the prompt stopped asking for stays on screen — and the workbench marks
 * them, because a stale image that says nothing is worse than no image.
 *
 * Read against the latest *done* run rather than the latest run of any status:
 * a cancelled run after a good one produced nothing at all, and calling every
 * binding stale on that basis would be a lie about the data on screen. With no
 * completed run in history every binding is stale, which is the honest answer
 * for a node whose history was evicted out from under its promoted nodes.
 */
export function staleOutputNames(ai: AiAddon): string[] {
	const produced = new Set((latestDoneRun(ai)?.outputs ?? []).map((output) => output.name));
	return Object.keys(ai.promoted).filter((name) => !produced.has(name));
}

/**
 * One line of what a run cost: `claude-opus-5 · 48 s · 12.3k tokens · 3 tool
 * calls`, and `script only · 2 s` for a Run of the stored script, which calls no
 * model and so has neither tokens nor tool calls to report.
 *
 * Every segment is dropped when the run has nothing to put in it, so an
 * interrupted run reads as its model alone rather than as `0 s` and `0 tokens`
 * — numbers that would describe a run that did nothing, which is not what
 * happened.
 */
export function runMetadataLine(run: AiRun): string {
	const parts: string[] = [];

	if (run.mode === 'rerun') parts.push('script only');
	else if (run.model !== undefined) parts.push(run.model);

	const duration = durationLabel(run);
	if (duration !== undefined) parts.push(duration);

	if (run.usage !== undefined) {
		parts.push(`${formatTokenCount(run.usage.inputTokens + run.usage.outputTokens)} tokens`);
	}

	if (run.toolCalls > 0) {
		parts.push(`${run.toolCalls} ${run.toolCalls === 1 ? 'tool call' : 'tool calls'}`);
	}

	return parts.join(' · ');
}

/**
 * Wall clock, to the second: `2 s`, `48 s`, `1 m 12 s`, `3 m`. A run is a thing
 * the reader waited through, so seconds is the resolution they experienced it
 * at, and a sub-second run still reads as `0 s` rather than vanishing.
 *
 * Absent when the run never finished, or when the clock ran backwards — a
 * system clock adjustment mid-run is the one way that happens, and a negative
 * duration is not worth rendering.
 */
function durationLabel(run: AiRun): string | undefined {
	if (run.finishedAt === undefined) return undefined;
	const elapsedMs = run.finishedAt - run.startedAt;
	if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return undefined;

	const seconds = Math.round(elapsedMs / 1000);
	if (seconds < 60) return `${seconds} s`;

	const minutes = Math.floor(seconds / 60);
	const remainder = seconds % 60;
	return remainder === 0 ? `${minutes} m` : `${minutes} m ${remainder} s`;
}

/**
 * `812`, `12.3k`, `12k`, `1.2M`. Token counts are read to judge cost, and no
 * such judgement turns on the last three digits — but under a thousand the
 * exact number is as short as any rounding of it, so it stays exact.
 */
function formatTokenCount(total: number): string {
	if (!Number.isFinite(total) || total < 0) return '0';
	if (total < 1000) return `${Math.round(total)}`;
	if (total < 1_000_000) return `${trimTrailingZero(total / 1000)}k`;
	return `${trimTrailingZero(total / 1_000_000)}M`;
}

function trimTrailingZero(value: number): string {
	const rounded = Math.round(value * 10) / 10;
	return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}
