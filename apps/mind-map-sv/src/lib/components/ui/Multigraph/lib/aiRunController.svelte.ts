/**
 * The run loop: the one place that turns "the reader pressed Run" into a
 * finished record on the node.
 *
 * Everything either side of it is already pure or already an interface — the
 * request builder, the client, the executor, the graph mutations — so this file
 * is the sequencing and nothing else, and it holds exactly one piece of state:
 * what each node's run is doing *right now*, which is never persisted.
 *
 * ## The two commits
 *
 * A run commits twice, both labelled "run AI node". The first lands before the
 * first `await`: a placeholder record with `status: 'interrupted'`, no outputs
 * and no summary. It exists because in-flight state lives here and nowhere
 * else, so a tab that goes away mid-run would otherwise leave the node looking
 * as though nothing had ever happened. The schema refuses a persisted
 * `running`, and `interrupted` is precisely what an in-flight run *is* once the
 * page holding it is gone. The second commit replaces that record with the
 * terminal one (`replaceAiRun`, matched by id), so a run is never two entries.
 *
 * ## What the loop is
 *
 * `send` → if the turn stopped for `tool_use`, run the script it asked for and
 * `appendToolResult` → `send` again, until `end_turn`, a `refusal`,
 * `max_tokens`, or the configured tool-call cap. The script and outputs of the
 * *last execution that exited 0* are what the node keeps: a run whose third
 * script crashed still has the second one's figures, and that is the run the
 * reader wanted.
 *
 * ## Cancel does not dispose
 *
 * Cancel aborts the run's signal, and `PyExecutor.run` answers an abort by
 * terminating its worker and building a fresh one on the next call — seconds,
 * from the browser cache. It deliberately does *not* call `executor.dispose()`,
 * which is terminal: a disposed executor throws from every later `load`, so one
 * cancel would take the Python runtime away for the rest of the session. The
 * page owns one executor for its lifetime; only the page disposes it.
 */

import { APP_CONFIG } from '$lib/appConfig';
import type Anthropic from '@anthropic-ai/sdk';
import { AiClientError, type AiClient, type AiRequest, type AiTurn } from '$lib/ai/aiClient';
import {
	appendToolResult,
	buildAnalyseRequest,
	buildRefineRequest,
	RUN_ANALYSIS_TOOL
} from '$lib/ai/aiRequest';
import type { AiSettings } from '$lib/ai/aiSettings';
import { executorInputName } from '$lib/ai/inputFileName';
import type { DigestUnavailableReason, FileDigest } from '$lib/ai/probeScript';
import type { ExecutionOutput, ExecutorFile, PyExecutor } from '$lib/ai/pyExecutor';
import type { GraphAssetStore } from '$lib/assets/assetStore';
import { tombstoneAsset } from '$lib/assets/assetTrash';
import type { GraphAssetMetadata, MultigraphData } from '../../types/multigraph';
import type { AiRun, AiRunInput, AiRunMode, AiRunOutput, AiRunStatus } from '../../types/node';
import { collectAiInputs, type AiInput } from './aiInputs';
import { recordAiRun, refreshPromotedOutputs, replaceAiRun, setAiScript } from './aiNode';
import {
	hasInputChanges,
	inputChangesForAddon,
	IDLE_RUN_STATE,
	type AiInputChanges,
	type AiRunState,
	type AiRunStep
} from './aiWorkbenchView';

/** The undo label every commit a run makes carries. */
export const AI_RUN_COMMIT_LABEL = 'run AI node';

/** The only tool the request offers, and so the only name a `tool_use` may carry. */
const RUN_ANALYSIS_TOOL_NAME = RUN_ANALYSIS_TOOL.name;

/**
 * How a `run` ended, from the caller's point of view.
 *
 * The four run statuses, plus the two answers that are about the caller rather
 * than the run: `needs-key` says the sheet has to open before there is anything
 * to run, and `busy` says this node already has a run in flight.
 */
export type AiRunOutcome = AiRunStatus | 'needs-key' | 'busy';

/**
 * Everything the controller reaches for, as getters.
 *
 * Getters rather than values because every one of them can change under a run:
 * the key arrives mid-session, the asset store resolves after mount, and the
 * graph is replaced on every commit. `executor` and `assetStore` are nullable
 * for the same reason — `Multigraph` is mounted before either exists, and a
 * story may hand down neither.
 */
interface AiRunControllerDeps {
	client: () => AiClient | null;
	executor: () => PyExecutor | null;
	assetStore: () => GraphAssetStore | null;
	assetScope: () => string | null;
	graph: () => MultigraphData;
	commit: (next: MultigraphData, label: string) => void;
	settings: () => AiSettings;
	now?: () => number;
	randomId?: () => string;
}

export interface AiRunController {
	/** What this node's run is doing, or `IDLE_RUN_STATE` when it has none. */
	stateFor(nodeId: string): AiRunState;
	/** The digest of each of this node's file inputs, keyed by asset id. */
	digestsFor(nodeId: string): Record<string, FileDigest>;
	/**
	 * Measure this node's file inputs, loading the runtime if it is not loaded.
	 * Idempotent: a node whose inputs are already measured at the current
	 * preview depth costs nothing.
	 */
	digest(nodeId: string): Promise<void>;
	run(nodeId: string, mode: AiRunMode): Promise<AiRunOutcome>;
	/**
	 * "Fix with AI": a refine run carrying the traceback the last failed re-run
	 * printed, recorded as `mode: 'refine'` because that is what it is — an edit
	 * to the stored script, with the failure as the thing to satisfy.
	 *
	 * The traceback comes off this node's run state rather than a store of its
	 * own: the state is what put the button on screen, so the request cannot
	 * carry a different failure from the one the reader is looking at. A node
	 * with none is an ordinary refine.
	 */
	runFix(nodeId: string): Promise<AiRunOutcome>;
	/** Abort the run in flight on this node. Does nothing when there is none. */
	cancel(nodeId: string): void;
}

/** Digests for one node, remembered with the depth they were measured at. */
interface DigestCache {
	previewRows: number;
	byAssetId: Record<string, FileDigest>;
}

/** One attached file, as `collectAiInputs` resolved it against `graph.assets`. */
type AiFileInput = Extract<AiInput, { kind: 'file' }>;

/** What came back from the asset store, and what did not. */
interface ReadFilesResult {
	files: ExecutorFile[];
	/** The inputs the store could not answer for, in input order. */
	missing: AiFileInput[];
}

/** The live pieces of a run, kept locally and written into state as they move. */
interface RunProgress {
	text: string;
	thinking: string;
	steps: AiRunStep[];
}

export function createAiRunController(deps: AiRunControllerDeps): AiRunController {
	const now = deps.now ?? (() => Date.now());
	const randomId = deps.randomId ?? defaultRandomId;

	let states = $state<Record<string, AiRunState>>({});
	let digestCache = $state<Record<string, DigestCache>>({});
	/**
	 * One entry per run in flight, which is also what makes a node busy. A plain
	 * record rather than a `Map` because nothing renders from it — it is the
	 * controller's own bookkeeping, and a reactive collection here would be
	 * inviting a component to read it.
	 */
	const inFlight: Record<string, AbortController> = {};

	/**
	 * States are replaced whole rather than patched in place: the optional
	 * fields (`error`, `refusal`, `runtimeProgress`) have to be able to *go*
	 * when a phase changes, and a patch can only add.
	 */
	function putState(nodeId: string, next: AiRunState): void {
		states = { ...states, [nodeId]: next };
	}

	function stateFor(nodeId: string): AiRunState {
		return states[nodeId] ?? IDLE_RUN_STATE;
	}

	function digestsFor(nodeId: string): Record<string, FileDigest> {
		return digestCache[nodeId]?.byAssetId ?? EMPTY_DIGESTS;
	}

	/**
	 * The blobs behind this node's file inputs, deduplicated by asset — and the
	 * inputs the store could not answer for.
	 *
	 * A missing blob is one input short, not a failed read: the script opens what
	 * is there. But it is not nothing either, and reporting it is what lets the
	 * caller record a digest-shaped "there is nothing to measure" for that file
	 * instead of leaving its row measuring for ever.
	 *
	 * With no store at all nothing is claimed missing: the page mounts before the
	 * store resolves, and a file whose bytes have not been *asked for* yet is not
	 * a file whose bytes are gone.
	 */
	async function readFiles(inputs: AiInput[]): Promise<ReadFilesResult> {
		const store = deps.assetStore();
		const scope = deps.assetScope();
		const wanted = dedupedFileInputs(inputs);
		if (store === null || scope === null || scope === '') return { files: [], missing: [] };

		const files: ExecutorFile[] = [];
		const missing: AiFileInput[] = [];
		for (const input of wanted) {
			const stored = await store.get(scope, input.assetId);
			if (!stored.ok) {
				missing.push(input);
				continue;
			}
			files.push({
				name: input.name,
				bytes: new Uint8Array(await stored.value.blob.arrayBuffer())
			});
		}
		return { files, missing };
	}

	function putDigests(
		nodeId: string,
		previewRows: number,
		byAssetId: Record<string, FileDigest>
	): void {
		digestCache = { ...digestCache, [nodeId]: { previewRows, byAssetId } };
	}

	/**
	 * Measure `files` and remember the answers against the assets they came from.
	 *
	 * The probe reports each digest under the name the executor wrote the file
	 * as, which is how it is matched back to an asset id; `executorInputName` is
	 * that rule, and the request builder applies the same one, so what the
	 * workbench shows and what the request carries are the same rendering of the
	 * same measurement.
	 *
	 * `missing` is remembered alongside the measurements, as an "unavailable"
	 * digest apiece: the cache is what the workbench draws every file row from,
	 * so a file that could not be read has to have an entry there saying so, or
	 * its row waits on a measurement that is never coming. Only what the probe
	 * actually measured is returned, because that is what a request may carry.
	 */
	async function measure(
		nodeId: string,
		executor: PyExecutor,
		inputs: AiInput[],
		files: ExecutorFile[],
		previewRows: number,
		missing: AiFileInput[]
	): Promise<FileDigest[]> {
		const digests = await executor.digest(files, previewRows);

		const assetIdByName: Record<string, string> = {};
		for (const input of inputs) {
			if (input.kind !== 'file') continue;
			const key = executorInputName(input.name);
			if (assetIdByName[key] === undefined) assetIdByName[key] = input.assetId;
		}

		const byAssetId: Record<string, FileDigest> = unavailableDigests(missing, 'blob');
		for (const digest of digests) {
			const assetId = assetIdByName[executorInputName(digest.name)];
			if (assetId !== undefined) byAssetId[assetId] = digest;
		}
		putDigests(nodeId, previewRows, byAssetId);
		return digests;
	}

	/**
	 * Whether every file input already has an answer at this depth.
	 *
	 * An "unavailable" counts: it is an answer, and the thing it answers about
	 * cannot change while the graph does not. A *run* asks for more than this —
	 * see `runModelLoop`, which re-measures rather than build a request around a
	 * gap that may have closed.
	 */
	function digestsAreFresh(nodeId: string, inputs: AiInput[], previewRows: number): boolean {
		const cached = digestCache[nodeId];
		if (cached === undefined || cached.previewRows !== previewRows) return false;
		return inputs.every(
			(input) => input.kind !== 'file' || cached.byAssetId[input.assetId] !== undefined
		);
	}

	async function digest(nodeId: string): Promise<void> {
		// A run does its own measuring, and a digest that reset the phase under it
		// would take the runtime line off the screen mid-download.
		if (inFlight[nodeId] !== undefined) return;

		const inputs = collectAiInputs(deps.graph(), nodeId);
		const previewRows = deps.settings().previewRows;
		if (digestsAreFresh(nodeId, inputs, previewRows)) return;

		const read = fileInputCount(inputs) === 0 ? NOTHING_READ : await readFiles(inputs);
		if (read.files.length === 0) {
			// Nothing for the probe to look at — either there are no files, or not
			// one of them could be read. Both are final answers, and the second one
			// has something to say about each file it covers.
			putDigests(nodeId, previewRows, unavailableDigests(read.missing, 'blob'));
			return;
		}

		const executor = deps.executor();
		if (executor === null) return;

		// The phase is only borrowed when nothing else is using it, so a digest
		// triggered by an edit does not wipe the last run's error off the surface.
		const owned = stateFor(nodeId).phase === 'idle';
		try {
			if (owned) {
				putState(nodeId, { ...IDLE_RUN_STATE, phase: 'loading-runtime' });
				await executor.load((progress) => {
					if (progress.loadedBytes === undefined) return;
					putState(nodeId, {
						...IDLE_RUN_STATE,
						phase: 'loading-runtime',
						runtimeProgress: { loadedBytes: progress.loadedBytes }
					});
				});
			} else {
				await executor.load();
			}
			await measure(nodeId, executor, inputs, read.files, previewRows, read.missing);
			if (owned) putState(nodeId, IDLE_RUN_STATE);
		} catch (error) {
			// The runtime is what failed, so every file is unmeasured for the same
			// reason and every row says that reason once — the alternative is a list
			// of files that all claim to be measuring, with nothing measuring them.
			// The ones whose bytes were already out of reach keep their own reason.
			putDigests(nodeId, previewRows, {
				...unavailableDigests(dedupedFileInputs(inputs), 'runtime'),
				...unavailableDigests(read.missing, 'blob')
			});
			if (owned) {
				putState(nodeId, { ...IDLE_RUN_STATE, phase: 'error', error: messageOf(error) });
			}
		}
	}

	/** Commit the placeholder, and tombstone whatever its arrival evicted. */
	function commitPlaceholder(nodeId: string, run: AiRun): void {
		const { graph, evictedAssetIds } = recordAiRun(deps.graph(), nodeId, run);
		deps.commit(graph, AI_RUN_COMMIT_LABEL);
		void tombstoneAll(evictedAssetIds);
	}

	async function tombstoneAll(assetIds: string[]): Promise<void> {
		const store = deps.assetStore();
		const scope = deps.assetScope();
		if (store === null || scope === null || scope === '' || assetIds.length === 0) return;
		for (const assetId of assetIds) await tombstoneAsset(store, scope, assetId);
	}

	/**
	 * Store one execution's outputs as assets and describe them for the record.
	 *
	 * The same split every other attachment gets — images as `kind: 'image'`,
	 * everything else as `kind: 'file'` — which is why a promoted output needs no
	 * rendering of its own. No content block is added to the AI node: the run
	 * record is what names these, and the workbench draws them from it.
	 */
	async function storeOutputs(
		outputs: ExecutionOutput[]
	): Promise<{ runOutputs: AiRunOutput[]; assets: GraphAssetMetadata[] }> {
		const store = deps.assetStore();
		const scope = deps.assetScope();
		if (store === null || scope === null || scope === '') return { runOutputs: [], assets: [] };

		const runOutputs: AiRunOutput[] = [];
		const assets: GraphAssetMetadata[] = [];
		for (const output of outputs) {
			const assetId = randomId();
			const stamp = now();
			// `new Uint8Array(...)` copies: the same bytes may still be referenced by
			// the tool result the loop sent, and a Blob must not alias them.
			const blob = new Blob([new Uint8Array(output.bytes)], { type: output.mimeType });
			const stored = await store.put({
				scope,
				assetId,
				blob,
				mimeType: output.mimeType,
				name: output.name,
				size: output.bytes.length,
				updatedAt: stamp
			});
			if (!stored.ok) continue;
			runOutputs.push({ name: output.name, assetId, mimeType: output.mimeType });
			assets.push({
				id: assetId,
				kind: output.mimeType.startsWith('image/') ? 'image' : 'file',
				mimeType: output.mimeType,
				name: output.name,
				size: output.bytes.length,
				createdAt: stamp
			});
		}
		return { runOutputs, assets };
	}

	/**
	 * The terminal commit: the finished record in the placeholder's place, the
	 * script it produced, the promoted nodes pointed at the new figures — one
	 * commit, so one undo puts the node back the way it was.
	 */
	function commitTerminal(
		nodeId: string,
		run: AiRun,
		assets: GraphAssetMetadata[],
		script: string | undefined
	): void {
		let next = replaceAiRun(deps.graph(), nodeId, run, assets);
		if (script !== undefined) next = setAiScript(next, nodeId, script);
		next = refreshPromotedOutputs(next, nodeId).graph;
		deps.commit(next, AI_RUN_COMMIT_LABEL);
	}

	function run(nodeId: string, mode: AiRunMode): Promise<AiRunOutcome> {
		return runWith(nodeId, mode);
	}

	function runFix(nodeId: string): Promise<AiRunOutcome> {
		// Read before the run starts: the first `putState` a run makes clears the
		// state the traceback is on.
		return runWith(nodeId, 'refine', stateFor(nodeId).traceback);
	}

	async function runWith(
		nodeId: string,
		mode: AiRunMode,
		traceback?: string
	): Promise<AiRunOutcome> {
		if (inFlight[nodeId] !== undefined) return 'busy';

		const startGraph = deps.graph();
		const ai = startGraph.nodes.find((node) => node.id === nodeId)?.addons?.ai;
		if (ai === undefined) return 'error';

		const client = deps.client();
		// Before anything is committed: a run that cannot start must leave no
		// trace, so the caller can open the sheet and try the same run again.
		if (mode !== 'rerun' && client === null) return 'needs-key';

		const executor = deps.executor();
		if (executor === null) {
			putState(nodeId, {
				...IDLE_RUN_STATE,
				phase: 'error',
				error: 'The Python runtime is not available in this page.'
			});
			return 'error';
		}

		const storedScript = ai.script ?? '';
		if (mode !== 'analyse' && storedScript === '') {
			putState(nodeId, {
				...IDLE_RUN_STATE,
				phase: 'error',
				error: 'This node has no stored script to run yet. Write one first.'
			});
			return 'error';
		}

		const settings = deps.settings();
		const inputs = collectAiInputs(startGraph, nodeId);
		const runId = randomId();
		const startedAt = now();
		const placeholder: AiRun = {
			id: runId,
			startedAt,
			status: 'interrupted',
			mode,
			prompt: ai.prompt,
			runtime: APP_CONFIG.ai.runtime.version,
			inputs: inputs.map(toRunInput),
			summary: '',
			outputs: [],
			toolCalls: 0
		};
		// Synchronous, and before the first `await`: the whole point of the
		// placeholder is that no window exists in which the run is invisible.
		commitPlaceholder(nodeId, placeholder);

		const abort = new AbortController();
		inFlight[nodeId] = abort;
		const progress: RunProgress = { text: '', thinking: '', steps: [] };

		try {
			putState(nodeId, { phase: 'loading-runtime', text: '', thinking: '', steps: [] });
			await withAbort(
				abort.signal,
				executor.load((loading) => {
					if (loading.loadedBytes === undefined) return;
					putState(nodeId, {
						phase: 'loading-runtime',
						text: '',
						thinking: '',
						steps: [],
						runtimeProgress: { loadedBytes: loading.loadedBytes }
					});
				})
			);
			const read = await withAbort(abort.signal, readFiles(inputs));

			putState(nodeId, { phase: 'running', ...progress });

			const finished =
				mode === 'rerun'
					? await runStoredScript(
							nodeId,
							executor,
							storedScript,
							read.files,
							abort.signal,
							progress
						)
					: await runModelLoop({
							nodeId,
							// `client` is null only when `mode !== 'rerun'` returned above.
							client: nonNull(client),
							executor,
							files: read.files,
							missing: read.missing,
							inputs,
							mode,
							settings,
							prompt: ai.prompt,
							previousScript: storedScript,
							// Against the run whose script is stored, and computed here rather
							// than at the press: the graph can move between the two.
							inputChanges: inputChangesForAddon(ai, inputs),
							signal: abort.signal,
							progress,
							...(traceback === undefined ? {} : { traceback })
						});

			const { runOutputs, assets } = await storeOutputs(finished.outputs);
			const terminal: AiRun = {
				...placeholder,
				status: finished.error === undefined ? 'done' : 'error',
				finishedAt: now(),
				summary: finished.summary,
				outputs: runOutputs,
				toolCalls: finished.toolCalls,
				...(finished.model === undefined ? {} : { model: finished.model }),
				...(finished.usage === undefined ? {} : { usage: finished.usage }),
				...(finished.error === undefined ? {} : { error: finished.error })
			};
			commitTerminal(nodeId, terminal, assets, finished.script);

			putState(nodeId, {
				phase: finished.error === undefined ? 'done' : 'error',
				text: progress.text,
				thinking: progress.thinking,
				steps: progress.steps,
				...(finished.error === undefined ? {} : { error: finished.error }),
				...(finished.refusal === true ? { refusal: true } : {}),
				...(finished.traceback === undefined ? {} : { traceback: finished.traceback })
			});
			return terminal.status;
		} catch (error) {
			const cancelled = abort.signal.aborted;
			const message = cancelled ? 'The run was cancelled.' : messageOf(error);
			commitTerminal(
				nodeId,
				{
					...placeholder,
					status: cancelled ? 'cancelled' : 'error',
					finishedAt: now(),
					...(cancelled ? {} : { error: message })
				},
				[],
				undefined
			);
			putState(nodeId, {
				phase: cancelled ? 'idle' : 'error',
				text: progress.text,
				thinking: progress.thinking,
				steps: progress.steps,
				...(cancelled ? {} : { error: message })
			});
			return cancelled ? 'cancelled' : 'error';
		} finally {
			delete inFlight[nodeId];
		}
	}

	/** Re-run mode: the stored script, no request, no model, no usage. */
	async function runStoredScript(
		nodeId: string,
		executor: PyExecutor,
		script: string,
		files: ExecutorFile[],
		signal: AbortSignal,
		progress: RunProgress
	): Promise<FinishedRun> {
		progress.steps = [{ stdoutTail: '', exitCode: null }];
		putState(nodeId, { phase: 'running', ...progress });

		const result = await executor.run(script, files, {
			timeoutMs: APP_CONFIG.ai.scriptTimeoutMs,
			signal
		});
		// stderr when the script printed nothing, because a failed script's output
		// *is* its traceback and an empty step would say nothing at all.
		progress.steps = [
			{ stdoutTail: tail(result.stdout || result.stderr), exitCode: result.exitCode }
		];
		putState(nodeId, { phase: 'running', ...progress });

		if (result.exitCode !== 0) {
			// The traceback rides back whole rather than tailed: the workbench shows
			// it and the fix run sends it, and a cut-off traceback is a cut-off
			// diagnosis. The tailed copy in the step above is the glance; this is the
			// evidence.
			const traceback = result.stderr.replace(/\n+$/, '');
			return {
				summary: '',
				outputs: [],
				toolCalls: 0,
				error: `The stored script failed with exit code ${result.exitCode}.`,
				...(traceback === '' ? {} : { traceback })
			};
		}
		return { summary: '', outputs: result.outputs, toolCalls: 0, script };
	}

	interface ModelLoopInput {
		nodeId: string;
		client: AiClient;
		executor: PyExecutor;
		files: ExecutorFile[];
		/** File inputs whose bytes the store could not hand over for this run. */
		missing: AiFileInput[];
		inputs: AiInput[];
		mode: AiRunMode;
		settings: AiSettings;
		prompt: string;
		previousScript: string;
		/** What has changed about the files since the stored script was written. */
		inputChanges: AiInputChanges;
		signal: AbortSignal;
		progress: RunProgress;
		/** The failure a "Fix with AI" refine is answering. Absent for every other run. */
		traceback?: string;
	}

	async function runModelLoop(input: ModelLoopInput): Promise<FinishedRun> {
		const { nodeId, client, executor, files, inputs, settings, signal, progress } = input;

		const previewRows = settings.previewRows;
		const cached = Object.values(digestsFor(nodeId));
		// An "unavailable" in the cache is a file nothing measured, and a run is
		// exactly when that may have changed — the blob may have arrived, and the
		// runtime just loaded. So it re-measures rather than send a request built
		// around the gap. What a request carries is measurements only; the request
		// builder already says name and size for a file that has no digest.
		const digests =
			digestsAreFresh(nodeId, inputs, previewRows) && cached.every(isMeasured)
				? cached
				: await measure(nodeId, executor, inputs, files, previewRows, input.missing);

		const build = { prompt: input.prompt, inputs, digests, settings, previewRows };
		let request: AiRequest =
			input.mode === 'refine'
				? buildRefineRequest({
						...build,
						previousScript: input.previousScript,
						// Only when something actually moved: an empty list would be a
						// sentence about nothing, in a prefix that is cached across the loop.
						...(hasInputChanges(input.inputChanges) ? { inputChanges: input.inputChanges } : {}),
						...(input.traceback === undefined ? {} : { traceback: input.traceback })
					})
				: buildAnalyseRequest(build);

		let toolCalls = 0;
		let inputTokens = 0;
		let outputTokens = 0;
		let model: string | undefined;
		let script: string | undefined;
		let outputs: ExecutionOutput[] = [];

		for (;;) {
			const turn = await client.send(request, {
				signal,
				onEvent: (event) => {
					if (event.type === 'text') progress.text += event.text;
					else if (event.type === 'thinking') progress.thinking += event.text;
					else return;
					putState(nodeId, { phase: 'running', ...progress });
				}
			});
			model = turn.model;
			inputTokens += turn.usage.inputTokens;
			outputTokens += turn.usage.outputTokens;

			const usage = { inputTokens, outputTokens };
			const settled = (rest: Partial<FinishedRun>): FinishedRun => ({
				summary: turnText(turn),
				outputs,
				toolCalls,
				model,
				usage,
				...(script === undefined ? {} : { script }),
				...rest
			});

			if (turn.stopReason !== 'tool_use') {
				if (turn.stopReason === 'refusal') {
					return settled({ error: refusalMessage(turn), refusal: true });
				}
				if (turn.stopReason === 'max_tokens') {
					return settled({
						error: 'The reply ran past the output-token limit before it finished.'
					});
				}
				return settled({});
			}

			const call = turn.content.find(isRunAnalysisCall);
			const requested = call === undefined ? undefined : scriptArgument(call.input);
			if (call === undefined || requested === undefined) {
				return settled({ error: 'Claude asked for a tool this node does not offer.' });
			}

			if (toolCalls >= APP_CONFIG.ai.maxToolCalls) {
				return settled({
					error: `The run stopped at its limit of ${APP_CONFIG.ai.maxToolCalls} script runs. What ran is below.`
				});
			}
			toolCalls += 1;

			progress.steps = [...progress.steps, { stdoutTail: '', exitCode: null }];
			putState(nodeId, { phase: 'running', ...progress });

			const result = await executor.run(requested, files, {
				timeoutMs: APP_CONFIG.ai.scriptTimeoutMs,
				signal
			});
			progress.steps = [
				...progress.steps.slice(0, -1),
				{ stdoutTail: tail(result.stdout || result.stderr), exitCode: result.exitCode }
			];
			putState(nodeId, { phase: 'running', ...progress });

			// The last execution that *worked* is what the node keeps, so a run
			// whose final script crashed still shows the figures it drew before.
			if (result.exitCode === 0) {
				script = requested;
				outputs = result.outputs;
			}

			request = appendToolResult(
				request,
				turn,
				{
					toolUseId: call.id,
					exitCode: result.exitCode,
					stdout: result.stdout,
					stderr: result.stderr,
					outputs: result.outputs
				},
				{ sendPlots: settings.sendPlots }
			);
		}
	}

	function cancel(nodeId: string): void {
		// Aborting is the whole of it: `PyExecutor.run` answers an abort by
		// terminating its worker and rebuilding on the next call. Disposing here
		// would end the executor for the session — see the note at the top.
		inFlight[nodeId]?.abort();
	}

	return { stateFor, digestsFor, digest, run, runFix, cancel };
}

/** What the loop hands back, whichever way it ended. */
interface FinishedRun {
	summary: string;
	outputs: ExecutionOutput[];
	toolCalls: number;
	model?: string;
	usage?: { inputTokens: number; outputTokens: number };
	/** The last script that exited 0. Absent when none did. */
	script?: string;
	/** Set when the run ended on something the reader has to be told about. */
	error?: string;
	/** `true` when `error` is Claude declining rather than something breaking. */
	refusal?: boolean;
	/** A failed re-run's stderr, which is what "Fix with AI" sends. */
	traceback?: string;
}

const EMPTY_DIGESTS: Record<string, FileDigest> = {};

/** What `readFiles` answers for a node with no files to read. */
const NOTHING_READ: ReadFilesResult = { files: [], missing: [] };

function fileInputCount(inputs: AiInput[]): number {
	return inputs.filter((input) => input.kind === 'file').length;
}

/** This node's file inputs, one per asset, in the order the workbench lists them. */
function dedupedFileInputs(inputs: AiInput[]): AiFileInput[] {
	const wanted: AiFileInput[] = [];
	for (const input of inputs) {
		if (input.kind !== 'file') continue;
		if (wanted.some((seen) => seen.assetId === input.assetId)) continue;
		wanted.push(input);
	}
	return wanted;
}

/**
 * A digest-shaped "there is nothing to measure, and here is why", per asset.
 *
 * Name and size come from the graph's asset metadata, which is everything that
 * is known about a file nobody could open.
 */
function unavailableDigests(
	inputs: AiFileInput[],
	reason: DigestUnavailableReason
): Record<string, FileDigest> {
	const byAssetId: Record<string, FileDigest> = {};
	for (const input of inputs) {
		byAssetId[input.assetId] = {
			name: input.name,
			size: input.size,
			kind: 'unavailable',
			reason
		};
	}
	return byAssetId;
}

function isMeasured(digest: FileDigest): boolean {
	return digest.kind !== 'unavailable';
}

function toRunInput(input: AiInput): AiRunInput {
	return {
		nodeId: input.nodeId,
		// The name as well as the id: what the next run compares against is the
		// filename the script was written to open.
		...(input.kind === 'file' ? { assetId: input.assetId, name: input.name } : {}),
		...(input.label === undefined ? {} : { label: input.label })
	};
}

function tail(text: string, limit: number = APP_CONFIG.ai.stdoutTailChars): string {
	const body = text.replace(/\n+$/, '');
	return body.length <= limit ? body : body.slice(-limit);
}

function turnText(turn: AiTurn): string {
	return turn.content
		.filter((block) => block.type === 'text')
		.map((block) => block.text)
		.join('\n')
		.trim();
}

function refusalMessage(turn: AiTurn): string {
	const explanation = turn.stopDetails?.explanation;
	if (typeof explanation === 'string' && explanation !== '') return explanation;
	const text = turnText(turn);
	return text === '' ? 'Claude declined to answer this request.' : text;
}

function isRunAnalysisCall(block: Anthropic.ContentBlock): block is Anthropic.ToolUseBlock {
	return block.type === 'tool_use' && block.name === RUN_ANALYSIS_TOOL_NAME;
}

/**
 * The script out of a tool call's input.
 *
 * `ToolUseBlock.input` is `unknown` by design — the SDK cannot know a tool's
 * schema — so this is the one place that checks the shape the tool definition
 * asked for, rather than asserting it.
 */
function scriptArgument(input: unknown): string | undefined {
	if (typeof input !== 'object' || input === null) return undefined;
	const script = Object.getOwnPropertyDescriptor(input, 'script')?.value;
	return typeof script === 'string' && script !== '' ? script : undefined;
}

/**
 * Race `work` against the signal, so a Cancel during the runtime download ends
 * the run now rather than in nine seconds. The download itself carries on into
 * the browser cache, which is where the next run wants it anyway.
 */
function withAbort<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
	if (signal.aborted) return Promise.reject(cancelledError());
	return Promise.race([
		work,
		new Promise<never>((_, reject) => {
			signal.addEventListener('abort', () => reject(cancelledError()), { once: true });
		})
	]);
}

function cancelledError(): AiClientError {
	return new AiClientError('aborted', 'The run was cancelled.');
}

/**
 * Narrow a value the caller has already established is not null. Used once, at
 * the only place where the check and the use are separated by a branch TS
 * cannot follow (`mode !== 'rerun'` implies a client).
 */
function nonNull<T>(value: T | null): T {
	if (value === null) throw new Error('expected a value');
	return value;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function defaultRandomId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
