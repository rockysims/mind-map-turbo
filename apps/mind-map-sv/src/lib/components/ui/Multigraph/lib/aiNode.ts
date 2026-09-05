/**
 * Pure mutations for the `!ai` add-on: the prompt, the stored script, the
 * bounded run history, and the promoted-output bindings.
 *
 * Everything here is a graph-in, graph-out function that returns the *same*
 * object when nothing changed, so an edit that is not an edit neither
 * re-renders the canvas nor lands in the undo list. Nothing here touches the
 * asset store: `recordAiRun` reports the asset ids that fell out of reach and
 * the caller tombstones them, exactly as `assetTrash.ts` describes.
 */

import { APP_CONFIG } from '$lib/appConfig';
import type { MultigraphData } from '../../types/multigraph';
import type {
	AiAddon,
	AiRun,
	AiRunOutput,
	AiRunStatus,
	NodeContentBlock,
	NodeData
} from '../../types/node';
import { referencedAssetIds } from './graph';

/**
 * The statuses a stored run may carry. All four are terminal: a run in flight
 * is UI state and is never written to the graph, so anything else on a run
 * record is a run whose tab went away mid-flight.
 */
export const AI_RUN_STATUSES: readonly AiRunStatus[] = [
	'done',
	'error',
	'cancelled',
	'interrupted'
];

/**
 * Takes `unknown` rather than `AiRunStatus` on purpose: its two callers are the
 * persisted-graph validator, which has parsed JSON in hand, and
 * `markInterruptedRuns`, whose whole job is the value the type says cannot be
 * there.
 */
export function isAiRunStatus(value: unknown): value is AiRunStatus {
	return AI_RUN_STATUSES.some((status) => status === value);
}

/** What `recordAiRun` hands back: the new graph, and what the caller must tombstone. */
interface RecordAiRunResult {
	graph: MultigraphData;
	/**
	 * Output assets of evicted runs that nothing in the resulting graph can
	 * reach any more, in the order the evicted runs produced them.
	 */
	evictedAssetIds: string[];
}

/** What `refreshPromotedOutputs` hands back beside the new graph. */
interface RefreshPromotedOutputsResult {
	graph: MultigraphData;
	/**
	 * Bound output names the latest run did not produce. Their promoted nodes
	 * keep the image they have; the workbench marks them stale.
	 */
	staleOutputNames: string[];
}

/** Replace the node's saved prompt. Same graph object when the text is unchanged. */
export function setAiPrompt(data: MultigraphData, nodeId: string, prompt: string): MultigraphData {
	const ai = aiAddonOf(data, nodeId);
	if (ai === undefined || ai.prompt === prompt) return data;
	return withAiAddon(data, nodeId, { ...ai, prompt });
}

/**
 * Replace the node's stored `analysis.py`. Same graph object when the text is
 * unchanged — a refine run that hands back a byte-identical script is not an
 * edit.
 */
export function setAiScript(data: MultigraphData, nodeId: string, script: string): MultigraphData {
	const ai = aiAddonOf(data, nodeId);
	if (ai === undefined || ai.script === script) return data;
	return withAiAddon(data, nodeId, { ...ai, script });
}

/**
 * Append a finished run, evict the oldest beyond `historyLength`, and say which
 * output assets that put out of reach.
 *
 * The summary is truncated on the way in rather than at the call site: run
 * records ride in the autosaved JSON under the localStorage budget, and the
 * length that budget can afford is a config value, not a property of whatever
 * the model happened to write. The cut is a plain slice — no ellipsis — so the
 * stored string is exactly as long as configured.
 *
 * Eviction asks the *resulting* graph what it still references, so an evicted
 * run's output survives when a promoted node's content block points at it, or
 * when any other node's block does, or when a surviving run produced the same
 * asset. Only what nothing can reach comes back for tombstoning. Metadata in
 * `data.assets` for those ids is dropped with them, the way
 * `removeNodeContentBlock` drops it, so the draft does not accumulate entries
 * for blobs that are on their way to the trash.
 *
 * A node without the add-on is left alone and evicts nothing.
 */
export function recordAiRun(
	data: MultigraphData,
	nodeId: string,
	run: AiRun,
	historyLength: number = APP_CONFIG.ai.historyLength,
	summaryMaxChars: number = APP_CONFIG.ai.summaryMaxChars
): RecordAiRunResult {
	const ai = aiAddonOf(data, nodeId);
	if (ai === undefined) return { graph: data, evictedAssetIds: [] };

	const stored: AiRun = { ...run, summary: run.summary.slice(0, Math.max(0, summaryMaxChars)) };
	const all = [...ai.runs, stored];
	const keep = Math.max(0, Math.min(all.length, Math.trunc(historyLength)));
	const runs = all.slice(all.length - keep);
	const evicted = all.slice(0, all.length - keep);

	const graph = withAiAddon(data, nodeId, { ...ai, runs });

	const candidates = new Set<string>();
	for (const evictedRun of evicted) {
		for (const output of evictedRun.outputs) candidates.add(output.assetId);
	}
	if (candidates.size === 0) return { graph, evictedAssetIds: [] };

	const stillReferenced = referencedAssetIds(graph);
	const evictedAssetIds = [...candidates].filter((assetId) => !stillReferenced.has(assetId));

	return { graph: withoutAssetMetadata(graph, evictedAssetIds), evictedAssetIds };
}

/**
 * Turn any run whose status is not one of the four terminal values into
 * `interrupted`.
 *
 * The persisted-graph validator refuses such a record outright, so this can
 * never fire on a graph that came off disk — the two guard different doors.
 * This one guards the in-memory graph the run controller assembles: it holds
 * in-flight runs as UI state, and anything that hands one of those to the graph
 * (a crash-recovery path, a future controller that checkpoints) gets it
 * normalised here rather than writing a state the schema does not allow.
 */
export function markInterruptedRuns(data: MultigraphData): MultigraphData {
	let changed = false;

	const nodes = data.nodes.map((node) => {
		const ai = node.addons?.ai;
		if (ai === undefined) return node;

		let nodeChanged = false;
		const runs = ai.runs.map((run): AiRun => {
			if (isAiRunStatus(run.status)) return run;
			nodeChanged = true;
			return { ...run, status: 'interrupted' };
		});
		if (!nodeChanged) return node;

		changed = true;
		return { ...node, addons: { ...node.addons, ai: { ...ai, runs } } };
	});

	return changed ? { ...data, nodes } : data;
}

/**
 * Point every promoted node at what the latest run produced for it.
 *
 * A binding is `outputName → nodeId`. Three things can be true of one:
 *
 * - the promoted node is gone (the user deleted it), and the binding goes with
 *   it — nothing to refresh and nothing to be stale about;
 * - the latest run produced that name, and the promoted node's content block
 *   for the *previous* asset of that name is swapped for the new one, keeping
 *   any caption the user wrote. A block already holding the new asset is left
 *   alone, so calling this twice changes nothing the second time; a promoted
 *   node the user emptied is left alone too, rather than having a block pushed
 *   back onto it;
 * - the latest run did not produce that name, and the name comes back in
 *   `staleOutputNames` with the promoted node untouched — the milestone's rule
 *   that a figure the run stopped drawing stays on screen, marked stale.
 *
 * The asset a swap displaces is not reported for tombstoning: it still belongs
 * to the run that produced it, and it is that run falling out of history
 * (`recordAiRun`) that decides whether it can be collected.
 */
export function refreshPromotedOutputs(
	data: MultigraphData,
	nodeId: string
): RefreshPromotedOutputsResult {
	const ai = aiAddonOf(data, nodeId);
	if (ai === undefined) return { graph: data, staleOutputNames: [] };

	const nodeIds = new Set(data.nodes.map((node) => node.id));
	const latest = ai.runs.at(-1);

	const promoted: Record<string, string> = {};
	const staleOutputNames: string[] = [];
	/** Promoted node id → the output its block should end up holding. */
	const swaps = new Map<string, AiRunOutput>();
	let bindingsChanged = false;

	for (const [outputName, promotedNodeId] of Object.entries(ai.promoted)) {
		if (!nodeIds.has(promotedNodeId)) {
			bindingsChanged = true;
			continue;
		}
		promoted[outputName] = promotedNodeId;

		const output = latest?.outputs.find((candidate) => candidate.name === outputName);
		if (output === undefined) {
			staleOutputNames.push(outputName);
			continue;
		}
		swaps.set(promotedNodeId, output);
	}

	let nodesChanged = false;
	const nodes = data.nodes.map((node) => {
		const output = swaps.get(node.id);
		const refreshed = output === undefined ? node : withRefreshedBlock(node, output, ai);
		if (refreshed !== node) nodesChanged = true;

		if (node.id !== nodeId || !bindingsChanged) return refreshed;
		return { ...refreshed, addons: { ...refreshed.addons, ai: { ...ai, promoted } } };
	});

	if (!nodesChanged && !bindingsChanged) return { graph: data, staleOutputNames };
	return { graph: { ...data, nodes }, staleOutputNames };
}

/**
 * The promoted node with its block for `output.name` pointing at the new asset.
 *
 * "Its block" is the first one holding an asset any run of this node produced
 * under that name — the binding is by name, so which run's asset is on the node
 * is not something the caller has to have tracked.
 */
function withRefreshedBlock(node: NodeData, output: AiRunOutput, ai: AiAddon): NodeData {
	const blocks = node.content ?? [];
	const previous = assetIdsForOutputName(ai, output.name);
	const index = blocks.findIndex((block) => previous.has(block.assetId));
	if (index === -1) return node;

	const existing = blocks[index];
	if (existing.assetId === output.assetId) return node;

	const content = [...blocks];
	content[index] = contentBlockForOutput(output, existing.caption);
	return { ...node, content };
}

/** Every asset this node's runs ever wrote under `name`. */
function assetIdsForOutputName(ai: AiAddon, name: string): Set<string> {
	const ids = new Set<string>();
	for (const run of ai.runs) {
		for (const output of run.outputs) {
			if (output.name === name) ids.add(output.assetId);
		}
	}
	return ids;
}

/**
 * An image block for anything the browser renders as one, a file block
 * otherwise — the same split the rest of the app already draws, which is why a
 * promoted output needs no new rendering. The output's name stands in for the
 * alt text: it is what the prompt asked to be drawn.
 */
function contentBlockForOutput(output: AiRunOutput, caption: string | undefined): NodeContentBlock {
	const captionPart = caption === undefined ? {} : { caption };
	return output.mimeType.startsWith('image/')
		? { type: 'image', assetId: output.assetId, alt: output.name, ...captionPart }
		: { type: 'file', assetId: output.assetId, name: output.name, ...captionPart };
}

function aiAddonOf(data: MultigraphData, nodeId: string): AiAddon | undefined {
	return data.nodes.find((node) => node.id === nodeId)?.addons?.ai;
}

function withAiAddon(data: MultigraphData, nodeId: string, ai: AiAddon): MultigraphData {
	return {
		...data,
		nodes: data.nodes.map((node) =>
			node.id === nodeId ? { ...node, addons: { ...node.addons, ai } } : node
		)
	};
}

function withoutAssetMetadata(data: MultigraphData, assetIds: string[]): MultigraphData {
	const assets = data.assets;
	if (assets === undefined) return data;
	const doomed = assetIds.filter((assetId) => assetId in assets);
	if (doomed.length === 0) return data;

	const nextAssets = { ...assets };
	for (const assetId of doomed) delete nextAssets[assetId];
	return { ...data, assets: nextAssets };
}
