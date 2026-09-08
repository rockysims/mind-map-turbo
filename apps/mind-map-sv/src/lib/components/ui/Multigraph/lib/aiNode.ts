/**
 * Pure mutations for the `!ai` add-on: the prompt, the stored script, the
 * bounded run history, the promoted-output bindings, and the follow-up node a
 * reader's next question becomes.
 *
 * Everything here is a graph-in, graph-out function that returns the *same*
 * object when nothing changed, so an edit that is not an edit neither
 * re-renders the canvas nor lands in the undo list. Nothing here touches the
 * asset store: `recordAiRun` reports the asset ids that fell out of reach and
 * the caller tombstones them, exactly as `assetTrash.ts` describes.
 */

import { APP_CONFIG } from '$lib/appConfig';
import type { GraphAssetMetadata, MultigraphData, Point } from '../../types/multigraph';
import type {
	AiAddon,
	AiRun,
	AiRunOutput,
	AiRunStatus,
	NodeContentBlock,
	NodeData
} from '../../types/node';
import { feedingNodeIds } from './aiAdjacency';
import { addEdge, addNode, nextId, referencedAssetIds, setNodePinned } from './graph';
import { withNodeAddon } from './nodeAddons';

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
 * Swap one already-recorded run for its finished self, in place, and register
 * the metadata of the assets it names.
 *
 * This is the other half of the run controller's two-commit shape. A run
 * commits a placeholder record the moment it starts — `status: 'interrupted'`,
 * because the schema refuses a persisted `running` and a reload must show the
 * run that was in flight rather than nothing — and replaces it here when it
 * ends. Replacing rather than appending is the whole point: `recordAiRun`
 * appends, and appending the terminal record would leave two entries for one
 * run.
 *
 * Matching is by `run.id`, and a run id that is not in the history leaves the
 * graph untouched. That is the honest answer for the one way it happens: an
 * undo landing mid-run takes the placeholder off the node, and pushing the
 * terminal record onto a history the reader has just undone would be putting
 * back what they removed.
 *
 * The assets ride along rather than being registered by a second function
 * because they are one fact with the run: an output the record names and whose
 * metadata the graph does not carry is a broken attachment, and one commit is
 * what keeps the two from ever being apart. The summary is truncated on the way
 * in for the same reason `recordAiRun` truncates it.
 */
export function replaceAiRun(
	data: MultigraphData,
	nodeId: string,
	run: AiRun,
	assets: GraphAssetMetadata[] = [],
	summaryMaxChars: number = APP_CONFIG.ai.summaryMaxChars
): MultigraphData {
	const ai = aiAddonOf(data, nodeId);
	if (ai === undefined) return data;
	const index = ai.runs.findIndex((candidate) => candidate.id === run.id);
	if (index === -1) return data;

	const runs = [...ai.runs];
	runs[index] = { ...run, summary: run.summary.slice(0, Math.max(0, summaryMaxChars)) };

	const withRun = withAiAddon(data, nodeId, { ...ai, runs });
	if (assets.length === 0) return withRun;

	return {
		...withRun,
		assets: {
			...(withRun.assets ?? {}),
			...Object.fromEntries(assets.map((asset) => [asset.id, asset]))
		}
	};
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
/**
 * The most recent run that finished with something to show. Runs are stored
 * oldest first, so this walks backwards. `done` alone: a cancelled, errored or
 * interrupted run produced nothing the node stands behind.
 */
export function latestDoneRun(ai: AiAddon): AiRun | undefined {
	for (let index = ai.runs.length - 1; index >= 0; index -= 1) {
		const run = ai.runs[index];
		if (run.status === 'done') return run;
	}
	return undefined;
}

export function refreshPromotedOutputs(
	data: MultigraphData,
	nodeId: string
): RefreshPromotedOutputsResult {
	const ai = aiAddonOf(data, nodeId);
	if (ai === undefined) return { graph: data, staleOutputNames: [] };

	const nodeIds = new Set(data.nodes.map((node) => node.id));
	// The latest *done* run, not the latest run: a cancelled or errored attempt
	// after a good one produced nothing, and must not mark every binding stale.
	const latest = latestDoneRun(ai);

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

/** Where the promoted node lands, and — for a caller that needs to name it — its id. */
interface PromoteAiOutputOptions {
	/** The canvas position for the new node, chosen by the caller that has a layout. */
	position: Point;
	/**
	 * The id the new node takes, for a caller that wants to name it. Ignored when
	 * the graph already holds that id, because two nodes with one id is a worse
	 * outcome than a generated name.
	 */
	nodeId?: string;
}

/**
 * Give one of the latest run's outputs a node of its own.
 *
 * The new node is titled by the output's filename, carries that output's asset
 * as its only content block, and hangs off a directed edge *from* the AI node:
 * the direction says which way the data went, and it is also what keeps the
 * promoted node out of `collectAiInputs` — an outgoing neighbour is skipped, so
 * a run never feeds itself its own figures.
 *
 * Idempotent per output name. A second press on a name already bound to a node
 * that still exists returns the same graph object, which is what stops a
 * double-tap from making two nodes and what keeps the press out of the undo
 * list. A binding whose node the reader deleted is *not* one of those cases: the
 * name is promoted again into a new node, because a binding pointing at nothing
 * is exactly the state a re-promote is meant to repair. (`refreshPromotedOutputs`
 * drops such a binding on the next run; this repairs it now.)
 *
 * The graph comes back untouched when the name is not among the latest done
 * run's outputs — a stale binding's name, or a name from a run that has since
 * been evicted. There is no asset to hang on a node for those, and promoting the
 * *previous* run's figure under a name the latest run stopped producing would
 * quietly disagree with the workbench, which already marks it stale.
 *
 * No asset metadata is registered here: the run record that names the output is
 * committed with it (`replaceAiRun`), so `data.assets` already carries it, and
 * inventing an entry from what an `AiRunOutput` happens to hold would mean
 * guessing at a size and a creation time.
 */
export function promoteAiOutput(
	data: MultigraphData,
	aiNodeId: string,
	outputName: string,
	options: PromoteAiOutputOptions
): MultigraphData {
	const ai = aiAddonOf(data, aiNodeId);
	if (ai === undefined) return data;

	const output = latestDoneRun(ai)?.outputs.find((candidate) => candidate.name === outputName);
	if (output === undefined) return data;

	const nodeIds = data.nodes.map((node) => node.id);
	const bound = ai.promoted[outputName];
	if (bound !== undefined && nodeIds.includes(bound)) return data;

	const requested = options.nodeId;
	const newNodeId =
		requested !== undefined && !nodeIds.includes(requested) ? requested : nextId('n', nodeIds);

	const withNode = addNode(data, {
		id: newNodeId,
		title: outputName,
		description: '',
		position: options.position
	});
	// The block is written here rather than through `addNodeContentBlock`, which
	// registers asset metadata this graph already carries (see above).
	const withBlock: MultigraphData = {
		...withNode,
		nodes: withNode.nodes.map((node) =>
			node.id === newNodeId
				? { ...node, content: [contentBlockForOutput(output, undefined)] }
				: node
		)
	};
	const withEdge = addEdge(withBlock, aiNodeId, newNodeId, { directed: true, tags: [] });

	return withAiAddon(withEdge, aiNodeId, {
		...ai,
		promoted: { ...ai.promoted, [outputName]: newNodeId }
	});
}

/**
 * The title a follow-up node is created with.
 *
 * The `!ai` marker is part of the title rather than implied by the add-on,
 * because the marker is what a later title edit has to keep for the node to go
 * on being a workbench — a node whose capability is invisible in its own title
 * loses it the first time someone renames it. The word beside the marker is for
 * the canvas, which draws titles and would otherwise draw a node with nothing
 * on it.
 */
const FOLLOW_UP_NODE_TITLE = '!ai Follow-up';

/**
 * Whether a composed follow-up prompt is one that can be submitted at all.
 *
 * Exported because the composer's submit button asks the same question, and a
 * second `trim()` written at the button is a rule that can drift from the rule
 * that actually decides: this one is the guard `createFollowUpNode` runs, so a
 * button that agrees with it can never offer a press that does nothing.
 */
export function isSubmittableFollowUpPrompt(prompt: string): boolean {
	return prompt.trim() !== '';
}

/** What the follow-up carries, and where the caller wants it drawn. */
interface CreateFollowUpOptions {
	/** The prompt the reader composed. Stored trimmed; empty is refused. */
	prompt: string;
	/** The canvas position for the child, chosen by the caller that has a layout. */
	position: Point;
	/**
	 * The id the child takes, for a caller that wants to name it. Ignored when
	 * the graph already holds that id, for the reason `promoteAiOutput` gives.
	 */
	nodeId?: string;
}

/** What `createFollowUpNode` hands back. */
interface CreateFollowUpResult {
	graph: MultigraphData;
	/**
	 * The child's id, or `undefined` when nothing was created — which is the
	 * same case as `graph` coming back as the object that went in.
	 */
	nodeId: string | undefined;
}

/**
 * Ask the next question as a node of its own.
 *
 * One call produces the whole of what "ask a follow-up" means to the graph: a
 * second `!ai` node carrying the composed prompt, a directed edge from the node
 * that spawned it, and the parent's pin moved onto it. One graph out means one
 * undo entry, which is the point — the reader who takes back a follow-up gets
 * their pin back in the same press.
 *
 * The edge is **directed, parent → child, and untagged**. Directed because the
 * direction is what makes the parent an input of the child and keeps the child
 * out of the parent's own run (`collectAiInputs` skips an outgoing neighbour).
 * Untagged because an edge tag *is* the input's label in the request, and a
 * `@follow-up` on every one of these edges would put a meaningless role on every
 * input a child collects and colour the edge by it.
 *
 * The pin transfer, and why the order of the two calls is the whole subtlety:
 * both `setNodePinned` and `addNode`'s `pinned` stamp `lastPinnedSeq` from the
 * same counter, and the beacon rule reads the highest stamp. Unpinning the
 * parent *first* leaves the child holding it; doing it the other way round
 * would leave the node that is no longer pinned as the most recently touched.
 * An unpinned parent makes neither call, so `pinSequence` is untouched and a map
 * with no pins in it does not acquire a counter by being asked a question.
 *
 * The same graph object comes back — and no id with it — for an unknown node, a
 * node without the add-on, and a prompt that is empty or only whitespace, so
 * "cannot submit an empty prompt" holds at the mutation and not only at the
 * button.
 *
 * A follow-up is deliberately **not** idempotent: two questions are two nodes,
 * unlike `promoteAiOutput`, where a second press names a figure that is already
 * on the canvas.
 */
export function createFollowUpNode(
	data: MultigraphData,
	aiNodeId: string,
	options: CreateFollowUpOptions
): CreateFollowUpResult {
	const parent = data.nodes.find((node) => node.id === aiNodeId);
	if (parent?.addons?.ai === undefined) return { graph: data, nodeId: undefined };
	if (!isSubmittableFollowUpPrompt(options.prompt)) return { graph: data, nodeId: undefined };

	const nodeIds = data.nodes.map((node) => node.id);
	const requested = options.nodeId;
	const newNodeId =
		requested !== undefined && !nodeIds.includes(requested) ? requested : nextId('n', nodeIds);

	const pinned = parent.pinned === true;
	const unpinned = pinned ? setNodePinned(data, aiNodeId, false) : data;

	const withNode = addNode(unpinned, {
		id: newNodeId,
		title: FOLLOW_UP_NODE_TITLE,
		description: '',
		position: options.position,
		...(pinned ? { pinned: true } : {})
	});

	// `AddNodeInput` carries no add-ons and does not gain any for this: the node
	// is added first and given the capability second, the way `promoteAiOutput`
	// works with what `addNode` handed it. The add-on itself comes from the
	// registry default rather than a literal, so a registry change cannot drift
	// from what a follow-up is created with.
	const withAddon: MultigraphData = {
		...withNode,
		nodes: withNode.nodes.map((node) =>
			node.id === newNodeId ? { ...node, addons: withNodeAddon(node.addons, 'ai') } : node
		)
	};
	const withPrompt = setAiPrompt(withAddon, newNodeId, options.prompt.trim());

	return {
		graph: addEdge(withPrompt, aiNodeId, newNodeId, { directed: true, tags: [] }),
		nodeId: newNodeId
	};
}

/**
 * The `analysis.py` a node can start from without having written one: its direct
 * AI parent's.
 *
 * This is what makes a fresh follow-up's default mode Change rather than Write —
 * a follow-up is an edit to what was just done, and the script that did it is
 * one hop away. Direct parents only: a grandparent's script is not what this
 * node is about, and the ancestor context (T04) is where the earlier steps get
 * their say.
 *
 * Among several parents it is the first, in `graph.nodes` order, that has a
 * script — stable regardless of the order the edges were drawn in, and a parent
 * with none does not veto a sibling that has one.
 */
export function inheritedScript(data: MultigraphData, nodeId: string): string | undefined {
	for (const parentId of feedingNodeIds(data, nodeId)) {
		const script = aiAddonOf(data, parentId)?.script;
		if (script !== undefined) return script;
	}
	return undefined;
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
