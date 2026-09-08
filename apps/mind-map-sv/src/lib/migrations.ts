import { beaconNodeIds } from './components/ui/Multigraph/lib/beacons';
import type { GraphDelta } from './graphDelta';
import type { EdgeData } from './components/ui/types/edge';
import type {
	GraphAssetMetadata,
	MultigraphData,
	Point,
	TagColorConfig
} from './components/ui/types/multigraph';
import type {
	AiAddon,
	AiRun,
	AiRunInput,
	AiRunOutput,
	NodeAddons,
	NodeContentBlock,
	NodeData,
	QuantityDesignation,
	TaskAddon
} from './components/ui/types/node';
import { isRegisteredAddon, type NodeAddonName } from './components/ui/Multigraph/lib/nodeAddons';
import { isAiRunStatus } from './components/ui/Multigraph/lib/aiNode';
import type { AiResult } from './ai/aiResults';

export const CURRENT_SCHEMA_VERSION = 8;

const EMPTY_TAG_COLOR_CONFIG: TagColorConfig = {
	nodeTags: {},
	edgeTags: {}
};

export type ViewState = {
	panX: number;
	panY: number;
	scale: number;
};

export const NEUTRAL_VIEW_STATE: ViewState = { panX: 0, panY: 0, scale: 1 };

export type PersistedGraphPayload = {
	schemaVersion: typeof CURRENT_SCHEMA_VERSION;
	data: MultigraphData;
	viewState?: ViewState;
	history?: PersistedHistoryTail;
};

/** The canvas fields one recorded state carries beside its graph. */
export type PersistedHistoryState = {
	label: string;
	primaryNodeId: string;
	severedBeaconPreference: string[];
	/** Epoch ms, so a reloaded revert offer can still say how long ago it was. */
	createdAt: number;
	/** The reader turned down the revert offer for this state. */
	offerDismissed?: boolean;
};

/**
 * The recent undo tail, as deltas chained backwards from the draft's own `data`.
 *
 * Draft-only, and deliberately so. An entry holds the content an edit removed,
 * so a tail inside an exported document would send deleted material along with
 * the document — which is why `wrapPersistedGraph` is reached only by the draft
 * writer and never by `graphFile.ts`. The consequence is stated rather than
 * hidden: undo does not survive carrying a file to another machine.
 *
 * The undo side only. The chain walks backwards from the graph the draft holds,
 * and no chain of backwards deltas can reach a state in front of it — which is
 * also what every mainstream editor does with redo across a reload.
 */
export type PersistedHistoryTail = {
	/** The state the draft's `data` is in. */
	head: PersistedHistoryState;
	/** States behind it, newest first, each with the delta from the state ahead. */
	entries: Array<PersistedHistoryState & { delta: GraphDelta }>;
};

export class PersistedGraphError extends Error {
	constructor(
		message: string,
		readonly code: 'malformed-payload' | 'unsupported-version' | 'unsupported-app-version'
	) {
		super(message);
		this.name = 'PersistedGraphError';
	}
}

export function wrapPersistedGraph(
	data: MultigraphData,
	history?: PersistedHistoryTail
): PersistedGraphPayload {
	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		data,
		...(history === undefined ? {} : { history })
	};
}

/**
 * Read a draft's undo tail back, or `null` when there is nothing usable.
 *
 * A tail from another schema version is dropped rather than migrated, exactly as
 * a snapshot from another version reads as absent: restoring a half-understood
 * graph is not worth the risk, and the graph beside it loads regardless. So does
 * a tail that is malformed — including one written by another tab against a
 * graph this draft no longer holds, which is a race the draft already has and
 * which this format cannot make better or worse.
 */
export function unwrapPersistedHistory(payload: unknown): PersistedHistoryTail | null {
	if (!isRecord(payload)) return null;
	if (payload.schemaVersion !== CURRENT_SCHEMA_VERSION) return null;
	const history = payload.history;
	if (!isRecord(history)) return null;
	const head = readHistoryState(history.head);
	if (head === null || !Array.isArray(history.entries)) return null;

	const entries: PersistedHistoryTail['entries'] = [];
	for (const candidate of history.entries) {
		const state = readHistoryState(candidate);
		if (state === null || !isRecord(candidate) || !isRecord(candidate.delta)) return null;
		entries.push({ ...state, delta: candidate.delta as unknown as GraphDelta });
	}

	return { head, entries };
}

function readHistoryState(value: unknown): PersistedHistoryState | null {
	if (!isRecord(value)) return null;
	if (typeof value.label !== 'string') return null;
	if (typeof value.primaryNodeId !== 'string') return null;
	if (!Array.isArray(value.severedBeaconPreference)) return null;
	if (value.severedBeaconPreference.some((id) => typeof id !== 'string')) return null;
	if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)) return null;
	return {
		label: value.label,
		primaryNodeId: value.primaryNodeId,
		severedBeaconPreference: [...(value.severedBeaconPreference as string[])],
		createdAt: value.createdAt,
		...(value.offerDismissed === true ? { offerDismissed: true } : {})
	};
}

export function unwrapPersistedGraph(payload: unknown): MultigraphData {
	return withSeededComponentPins(unwrapPersistedGraphData(payload));
}

function unwrapPersistedGraphData(payload: unknown): MultigraphData {
	if (!isRecord(payload)) {
		throw new PersistedGraphError(
			'Persisted graph payload must be an object.',
			'malformed-payload'
		);
	}

	if (payload.schemaVersion === 1) {
		if (
			!isMultigraphData(payload.data, {
				allowLegacyTags: true,
				allowLegacyEdgeColor: true,
				allowMissingTagColorConfig: true,
				allowMissingContent: true,
				allowMissingAssets: true
			})
		) {
			throw new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload');
		}
		return migrateLegacyGraphData(payload.data, { allowMissingTags: true });
	}

	if (payload.schemaVersion === 2) {
		if (
			!isMultigraphData(payload.data, {
				allowLegacyEdgeColor: true,
				allowMissingTagColorConfig: true,
				allowMissingContent: true,
				allowMissingAssets: true
			})
		) {
			throw new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload');
		}
		return migrateLegacyGraphData(payload.data);
	}

	if (payload.schemaVersion === 3) {
		if (
			!isMultigraphData(payload.data, {
				allowMissingContent: true,
				allowMissingAssets: true
			})
		) {
			throw new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload');
		}
		return migrateGraphDataToV8(
			migrateGraphDataToV7(
				migrateGraphDataToV6(migrateGraphDataToV5(migrateGraphDataToV4(payload.data)))
			)
		);
	}

	if (payload.schemaVersion === 4) {
		if (
			!isMultigraphData(payload.data, {
				allowMissingContent: true,
				allowMissingAssets: true
			})
		) {
			throw new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload');
		}
		return migrateGraphDataToV8(
			migrateGraphDataToV7(migrateGraphDataToV6(migrateGraphDataToV5(payload.data)))
		);
	}

	if (payload.schemaVersion === 5) {
		if (
			!isMultigraphData(payload.data, {
				allowMissingContent: true,
				allowMissingAssets: true
			})
		) {
			throw new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload');
		}
		return migrateGraphDataToV8(migrateGraphDataToV7(migrateGraphDataToV6(payload.data)));
	}

	if (payload.schemaVersion === 6) {
		if (
			!isMultigraphData(payload.data, {
				allowMissingContent: true,
				allowMissingAssets: true
			})
		) {
			throw new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload');
		}
		return migrateGraphDataToV8(migrateGraphDataToV7(payload.data));
	}

	if (payload.schemaVersion === 7) {
		if (
			!isMultigraphData(payload.data, {
				allowMissingContent: true,
				allowMissingAssets: true
			})
		) {
			throw new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload');
		}
		return migrateGraphDataToV8(payload.data);
	}

	if (payload.schemaVersion !== CURRENT_SCHEMA_VERSION) {
		throw new PersistedGraphError(
			`Unsupported graph schema version: ${String(payload.schemaVersion)}`,
			'unsupported-version'
		);
	}

	if (
		!isMultigraphData(payload.data, {
			allowMissingContent: true,
			allowMissingAssets: true
		})
	) {
		throw new PersistedGraphError('Persisted graph data is malformed.', 'malformed-payload');
	}

	return payload.data;
}

export function parsePersistedGraph(json: string): MultigraphData {
	try {
		return unwrapPersistedGraph(JSON.parse(json));
	} catch (error) {
		if (error instanceof PersistedGraphError) throw error;
		throw new PersistedGraphError('Persisted graph JSON is malformed.', 'malformed-payload');
	}
}

function migrateLegacyGraphData(
	data: MultigraphData,
	options: { allowMissingTags?: boolean } = {}
): MultigraphData {
	return migrateGraphDataToV8(
		migrateGraphDataToV7(
			migrateGraphDataToV6(
				migrateGraphDataToV5(
					migrateGraphDataToV4({
						...data,
						nodes: data.nodes.map((node) => ({
							...node,
							tags: options.allowMissingTags ? (node.tags ?? []) : node.tags
						})),
						edges: data.edges.map(migrateLegacyEdge),
						tagColorConfig: { ...EMPTY_TAG_COLOR_CONFIG }
					})
				)
			)
		)
	);
}

function migrateGraphDataToV4(data: MultigraphData): MultigraphData {
	return {
		...data,
		nodes: data.nodes.map((node) => ({
			...node,
			content: node.content ?? []
		})),
		tagColorConfig: data.tagColorConfig ?? { ...EMPTY_TAG_COLOR_CONFIG },
		assets: data.assets ?? {}
	};
}

function migrateGraphDataToV5(data: MultigraphData): MultigraphData {
	// Seed pin history for already-pinned nodes so beacon selection has recency
	// to work with (array order stands in for actual pin order).
	let pinSequence = data.pinSequence ?? 0;
	const nodes = data.nodes.map((node) => {
		if (!node.pinned || node.lastPinnedSeq !== undefined) return node;
		pinSequence += 1;
		return { ...node, lastPinnedSeq: pinSequence };
	});

	return { ...data, nodes, pinSequence };
}

/**
 * v6 adds optional `inputs`/`outputs` designations to nodes; absent means none,
 * so older data needs no rewriting. Named anyway so the branch chain reads like
 * the others and v7 has a place to hang.
 */
function migrateGraphDataToV6(data: MultigraphData): MultigraphData {
	return data;
}

/**
 * v7 widens `GraphAssetMetadata.kind` to `'image' | 'file'` and adds the
 * `file` content block. Both are additive — a v6 graph carries only image
 * assets and image blocks, which stay exactly what they were — so there is
 * nothing to rewrite. Named like its neighbours so the branch chain reads the
 * same and v8 has a place to hang.
 */
function migrateGraphDataToV7(data: MultigraphData): MultigraphData {
	return data;
}

/**
 * v8 adds the `ai` add-on. Additive again — a v7 graph carries no `ai` key and
 * a node without one is unchanged — so there is nothing to rewrite, and the
 * version exists for the *other* direction: `isNodeAddons` refuses an add-on
 * name it does not know, so a v7 app meeting an `!ai` node would call the file
 * malformed. Stamping 8 (and reader version 4 in `graphFile.ts`) sends it down
 * the "written by a newer app" route instead, which opens the document in its
 * own embedded shell.
 */
function migrateGraphDataToV8(data: MultigraphData): MultigraphData {
	return data;
}

/**
 * Load/import-time seeding for graphs with no pinned node at all (pre-v5 files
 * predate pinning, and hand-written JSON often omits it). Without a pin every
 * component collapses to its single beacon node, so the file would open as a
 * scattering of lone nodes. Pinning the node each component's beacon election
 * would pick — its hub — opens that hub's neighborhood instead.
 *
 * Only runs here, on data entering the app: a user who deliberately unpins
 * their last pin during a session keeps the beacon view they asked for.
 */
function withSeededComponentPins(data: MultigraphData): MultigraphData {
	if (data.nodes.some((node) => node.pinned)) return data;

	const seedNodeIds = beaconNodeIds(data);
	if (seedNodeIds.size === 0) return data;

	let pinSequence = data.pinSequence ?? 0;
	const nodes = data.nodes.map((node) => {
		if (!seedNodeIds.has(node.id)) return node;
		pinSequence += 1;
		return { ...node, pinned: true, lastPinnedSeq: pinSequence };
	});

	return { ...data, nodes, pinSequence };
}

function isMultigraphData(
	value: unknown,
	options: {
		allowLegacyTags?: boolean;
		allowLegacyEdgeColor?: boolean;
		allowMissingTagColorConfig?: boolean;
		allowMissingContent?: boolean;
		allowMissingAssets?: boolean;
	} = {}
): value is MultigraphData {
	if (!isRecord(value)) return false;
	if (!Array.isArray(value.nodes) || !Array.isArray(value.edges) || !isRecord(value.posByNodeId)) {
		return false;
	}

	return (
		value.nodes.every((node) => isNodeData(node, options)) &&
		value.edges.every((edge) => isEdgeData(edge, options)) &&
		Object.values(value.posByNodeId).every(isPoint) &&
		(options.allowMissingTagColorConfig
			? value.tagColorConfig === undefined || isTagColorConfig(value.tagColorConfig)
			: isTagColorConfig(value.tagColorConfig)) &&
		(options.allowMissingAssets
			? value.assets === undefined || isAssetMetadataRecord(value.assets)
			: isAssetMetadataRecord(value.assets)) &&
		(value.pinSequence === undefined ||
			(typeof value.pinSequence === 'number' && Number.isFinite(value.pinSequence)))
	);
}

function isNodeData(
	value: unknown,
	options: { allowLegacyTags?: boolean; allowMissingContent?: boolean } = {}
): value is NodeData {
	return (
		isRecord(value) &&
		typeof value.id === 'string' &&
		typeof value.title === 'string' &&
		typeof value.description === 'string' &&
		(options.allowLegacyTags
			? value.tags === undefined || isStringArray(value.tags)
			: isStringArray(value.tags)) &&
		(value.pinned === undefined || typeof value.pinned === 'boolean') &&
		(value.lastPinnedSeq === undefined ||
			(typeof value.lastPinnedSeq === 'number' && Number.isFinite(value.lastPinnedSeq))) &&
		(options.allowMissingContent
			? value.content === undefined || isNodeContent(value.content)
			: isNodeContent(value.content)) &&
		(value.inputs === undefined || isDesignationArray(value.inputs)) &&
		(value.outputs === undefined || isDesignationArray(value.outputs)) &&
		(value.addons === undefined || isNodeAddons(value.addons))
	);
}

/**
 * The registry is closed, so an unknown key or a badly shaped payload makes the
 * node malformed rather than being dropped: a file written by a newer app that
 * knows `!ai` is not a file this one can load and re-save without losing it.
 */
function isNodeAddons(value: unknown): value is NodeAddons {
	return (
		isRecord(value) &&
		Object.entries(value).every(
			([name, addon]) => isRegisteredAddon(name) && isAddonData(name, addon)
		)
	);
}

function isAddonData(name: NodeAddonName, value: unknown): boolean {
	switch (name) {
		case 'task':
			return isTaskAddon(value);
		case 'ai':
			return isAiAddon(value);
	}
}

function isTaskAddon(value: unknown): value is TaskAddon {
	return (
		isRecord(value) &&
		typeof value.done === 'boolean' &&
		(value.doneAt === undefined ||
			(typeof value.doneAt === 'number' && Number.isFinite(value.doneAt)))
	);
}

/**
 * Every field of the `ai` add-on is checked, including inside each run.
 *
 * Strict on purpose, and strictest about `status`: a run is never *persisted*
 * as running, so a record saying it is describes a state this app has no way to
 * resume and no way to draw. Refusing the document is the honest answer —
 * loading it and quietly rewriting the status would re-save a file whose
 * history no longer matches what happened.
 */
function isAiAddon(value: unknown): value is AiAddon {
	return (
		isRecord(value) &&
		typeof value.prompt === 'string' &&
		(value.model === undefined || typeof value.model === 'string') &&
		(value.script === undefined || typeof value.script === 'string') &&
		Array.isArray(value.runs) &&
		value.runs.every(isAiRun) &&
		isStringRecord(value.promoted)
	);
}

function isAiRun(value: unknown): value is AiRun {
	return (
		isRecord(value) &&
		typeof value.id === 'string' &&
		isFiniteNumber(value.startedAt) &&
		(value.finishedAt === undefined || isFiniteNumber(value.finishedAt)) &&
		isAiRunStatus(value.status) &&
		(value.mode === 'analyse' || value.mode === 'refine' || value.mode === 'rerun') &&
		// Optional rather than required: every run recorded before the field
		// existed is still a valid run, and a missing prompt only costs the
		// workbench its "unchanged" answer (it offers `refine` instead of `rerun`).
		(value.prompt === undefined || typeof value.prompt === 'string') &&
		(value.model === undefined || typeof value.model === 'string') &&
		typeof value.runtime === 'string' &&
		Array.isArray(value.inputs) &&
		value.inputs.every(isAiRunInput) &&
		typeof value.summary === 'string' &&
		Array.isArray(value.outputs) &&
		value.outputs.every(isAiRunOutput) &&
		(value.usage === undefined || isAiRunUsage(value.usage)) &&
		isFiniteNumber(value.toolCalls) &&
		(value.error === undefined || typeof value.error === 'string') &&
		// Optional, and the reason neither version number moves for it: a run
		// recorded before results existed is still a valid run, and `isAiRun`
		// ignores keys it does not know — so a milestone 14 build loads a document
		// carrying this field rather than calling it malformed.
		(value.results === undefined ||
			(Array.isArray(value.results) && value.results.every(isAiResult)))
	);
}

function isAiResult(value: unknown): value is AiResult {
	return (
		isRecord(value) &&
		typeof value.symbol === 'string' &&
		typeof value.value === 'string' &&
		(value.unit === undefined || typeof value.unit === 'string')
	);
}

function isAiRunInput(value: unknown): value is AiRunInput {
	return (
		isRecord(value) &&
		typeof value.nodeId === 'string' &&
		(value.assetId === undefined || typeof value.assetId === 'string') &&
		// Optional for the same reason `prompt` is: a run recorded before the
		// filename was kept is still a valid run, and all it costs is the
		// workbench's ability to name what changed since it.
		(value.name === undefined || typeof value.name === 'string') &&
		(value.label === undefined || typeof value.label === 'string')
	);
}

function isAiRunOutput(value: unknown): value is AiRunOutput {
	return (
		isRecord(value) &&
		typeof value.name === 'string' &&
		typeof value.assetId === 'string' &&
		typeof value.mimeType === 'string'
	);
}

function isAiRunUsage(value: unknown): value is NonNullable<AiRun['usage']> {
	return isRecord(value) && isFiniteNumber(value.inputTokens) && isFiniteNumber(value.outputTokens);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isDesignationArray(value: unknown): value is QuantityDesignation[] {
	return Array.isArray(value) && value.every(isDesignation);
}

function isDesignation(value: unknown): value is QuantityDesignation {
	return (
		isRecord(value) &&
		typeof value.base === 'string' &&
		(value.subscript === null || typeof value.subscript === 'string')
	);
}

function isEdgeData(
	value: unknown,
	options: { allowLegacyTags?: boolean; allowLegacyEdgeColor?: boolean } = {}
): value is EdgeData {
	return (
		isRecord(value) &&
		typeof value.id === 'string' &&
		typeof value.sourceNodeId === 'string' &&
		typeof value.targetNodeId === 'string' &&
		(options.allowLegacyEdgeColor
			? value.color === undefined || typeof value.color === 'string'
			: true) &&
		(options.allowLegacyTags
			? value.tags === undefined || isStringArray(value.tags)
			: isStringArray(value.tags)) &&
		(value.directed === undefined || typeof value.directed === 'boolean')
	);
}

function migrateLegacyEdge(edge: EdgeData): EdgeData {
	return {
		id: edge.id,
		sourceNodeId: edge.sourceNodeId,
		targetNodeId: edge.targetNodeId,
		tags: edge.tags ?? [],
		directed: edge.directed ?? false
	};
}

function isPoint(value: unknown): value is Point {
	return isRecord(value) && typeof value.x === 'number' && typeof value.y === 'number';
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isTagColorConfig(value: unknown): value is TagColorConfig {
	return isRecord(value) && isStringRecord(value.nodeTags) && isStringRecord(value.edgeTags);
}

function isNodeContent(value: unknown): value is NodeContentBlock[] {
	return Array.isArray(value) && value.every(isNodeContentBlock);
}

function isNodeContentBlock(value: unknown): value is NodeContentBlock {
	if (!isRecord(value)) return false;
	if (typeof value.assetId !== 'string') return false;
	if (value.caption !== undefined && typeof value.caption !== 'string') return false;
	if (value.type === 'image') return typeof value.alt === 'string';
	if (value.type === 'file') return typeof value.name === 'string';
	return false;
}

function isAssetMetadataRecord(value: unknown): value is Record<string, GraphAssetMetadata> {
	return isRecord(value) && Object.values(value).every(isAssetMetadata);
}

/**
 * The `image/` MIME check belongs to the kind, not to the asset: an image block
 * renders its blob in an `<img>`, so a non-image MIME type there is a broken
 * document. A `file` asset is only ever handed to the browser, so any type is
 * legal — including `image/png`, which is what a PNG attached through Add file
 * is.
 */
function isAssetMetadata(value: unknown): value is GraphAssetMetadata {
	return (
		isRecord(value) &&
		typeof value.id === 'string' &&
		(value.kind === 'image' || value.kind === 'file') &&
		typeof value.mimeType === 'string' &&
		(value.kind === 'file' || value.mimeType.startsWith('image/')) &&
		(value.name === undefined || typeof value.name === 'string') &&
		typeof value.size === 'number' &&
		Number.isFinite(value.size) &&
		value.size >= 0 &&
		typeof value.createdAt === 'number' &&
		Number.isFinite(value.createdAt)
	);
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
