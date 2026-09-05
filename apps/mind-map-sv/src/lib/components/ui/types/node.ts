export interface NodeImageContent {
	type: 'image';
	assetId: string;
	alt: string;
	caption?: string;
}

/**
 * A file of any type attached to a node. `name` is the filename the upload came
 * with, kept on the block rather than read back off the asset so a details row
 * can be drawn without touching IndexedDB. There is no `alt`: a file is not
 * rendered, it is opened, so the name is what stands in for it.
 */
export interface NodeFileContent {
	type: 'file';
	assetId: string;
	name: string;
	caption?: string;
}

export type NodeContentBlock = NodeImageContent | NodeFileContent;

/**
 * Data the `!task` add-on carries. `doneAt` is an epoch-ms stamp of the moment
 * the task was marked done; it is absent while the task is not done.
 */
export interface TaskAddon {
	done: boolean;
	doneAt?: number;
}

/**
 * How a run ended. Every value here is terminal: a run is never *persisted* as
 * running, because in-flight state belongs to the UI and no reload can resume
 * it. `interrupted` is what an in-flight run becomes.
 */
export type AiRunStatus = 'done' | 'error' | 'cancelled' | 'interrupted';

/**
 * What the run asked for. `analyse` writes a fresh script, `refine` edits the
 * stored one, and `rerun` executes the stored script with no model call at all
 * — which is why a `rerun` record carries no `model` and no `usage`.
 */
export type AiRunMode = 'analyse' | 'refine' | 'rerun';

/**
 * One thing the run sent. `assetId` is absent for a neighbour's title and
 * description, which are text rather than a file; `label` is the role the
 * connecting edge's tag gave it.
 */
export interface AiRunInput {
	nodeId: string;
	assetId?: string;
	label?: string;
}

/**
 * One file the script wrote. `name` is the filename inside `outputs/`, and it
 * is also the key a promoted node is bound by — which is why the system prompt
 * asks for stable names across runs.
 */
export interface AiRunOutput {
	name: string;
	assetId: string;
	mimeType: string;
}

/**
 * One finished run, kept so the node can say what was done to the data.
 *
 * `runtime` records the Python runtime version the script ran under, so a later
 * runtime that draws differently is a visible difference rather than a silent
 * one. `summary` is capped on the way in (`APP_CONFIG.ai.summaryMaxChars`): run
 * records ride in the autosaved JSON under the localStorage budget, so an
 * unbounded model reply would be a storage leak.
 */
export interface AiRun {
	id: string;
	/** Epoch ms. */
	startedAt: number;
	/** Epoch ms. Absent on a run interrupted before it could finish. */
	finishedAt?: number;
	status: AiRunStatus;
	mode: AiRunMode;
	/** Absent on a `rerun`, which makes no model call. */
	model?: string;
	runtime: string;
	inputs: AiRunInput[];
	summary: string;
	outputs: AiRunOutput[];
	/** Absent on a `rerun`, and on a run that failed before the first response. */
	usage?: { inputTokens: number; outputTokens: number };
	toolCalls: number;
	/** What went wrong, shown where the summary would be, when `status` is `error`. */
	error?: string;
}

/**
 * Data the `!ai` add-on carries: one editable prompt, the script the last run
 * produced, a bounded run history, and which node each output was promoted to.
 *
 * `promoted` is keyed by output *name* rather than by asset id, so a later run
 * writing the same filename refreshes the promoted node in place.
 */
export interface AiAddon {
	prompt: string;
	/** The model this node is pinned to. Absent means the configured default. */
	model?: string;
	/** `analysis.py` as the last completed run left it. Absent before the first. */
	script?: string;
	/** Oldest first, capped at `APP_CONFIG.ai.historyLength`. */
	runs: AiRun[];
	/** Output name → the id of the node it was promoted to. */
	promoted: Record<string, string>;
}

/**
 * The add-ons a node carries, one optional field per entry in the closed
 * registry in `Multigraph/lib/nodeAddons.ts`. Add-ons are capabilities, not
 * labels: each is typed on its own rather than living as a string in `tags`.
 */
export interface NodeAddons {
	task?: TaskAddon;
	ai?: AiAddon;
}

/**
 * A quantity the user confirmed as this node's input or output, stored as the
 * structural identity (base + subscript) rather than the canonical symbol key —
 * the key embeds a NUL separator that has no business in a save file.
 */
export interface QuantityDesignation {
	base: string;
	subscript: string | null;
}

export interface NodeData {
	id: string;
	title: string;
	description: string;
	tags: string[];
	pinned?: boolean;
	/** Pin-recency stamp from the graph-level pinSequence counter; higher = more recent. */
	lastPinnedSeq?: number;
	content?: NodeContentBlock[];
	/** Registered add-ons this node carries. Absent means none. */
	addons?: NodeAddons;
	/** Quantities the user confirmed this node consumes. Absent means none. */
	inputs?: QuantityDesignation[];
	/** Quantities the user confirmed this node defines. Absent means none. */
	outputs?: QuantityDesignation[];
}
