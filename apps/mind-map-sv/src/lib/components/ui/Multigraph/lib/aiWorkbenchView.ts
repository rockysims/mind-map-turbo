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
 * The mode the switch starts on.
 *
 * - **analyse** — nothing to build on: no completed run, or no stored script.
 *   A fresh analysis is also what a completed run that left no script gets,
 *   because both of the other modes need a script to work from.
 * - **refine** — the prompt has moved since the run that wrote the script, so
 *   the script needs editing to match. A run recorded before `AiRun.prompt`
 *   existed lands here too: an absent prompt cannot be claimed unchanged, and
 *   offering to edit the script is the recoverable half of that guess.
 * - **rerun** — the prompt is exactly what produced the stored script, so the
 *   only reason to run is new data, and that needs no model call at all.
 */
export function defaultRunMode(ai: AiAddon): AiRunMode {
	const latest = latestDoneRun(ai);
	if (latest === undefined || ai.script === undefined) return 'analyse';
	return latest.prompt === ai.prompt ? 'rerun' : 'refine';
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
 * calls`, and `script only · 2 s` for a re-run, which calls no model and so has
 * neither tokens nor tool calls to report.
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
