/**
 * What an `!ai` node sends: its own attachments, plus the text and attachments
 * of the neighbours that feed it.
 *
 * Inputs are collected by proximity, from authored structure only. An edge
 * pointing *at* the AI node is an input; an undirected edge is an input;
 * an edge pointing *away* is an output and is skipped, which is what stops a
 * promoted output node from feeding the node that produced it. Derived
 * dataflow edges are never consulted — only `graph.edges`.
 *
 * A neighbour carrying the `ai` add-on contributes its *latest done run's*
 * outputs as well, on exactly the same terms as its attachments — same
 * proximity rule, same label from the same edge — which is what lets one node
 * read the CSV the node before it wrote without anyone promoting it first.
 * Latest done run only: a run's outputs are that node's current answer, and
 * three generations of `drift.png` would make the filename meaningless. The
 * node's own outputs are never collected, because self is not a neighbour.
 *
 * Order is stable by construction so the workbench list does not reshuffle
 * while the user edits the map: the node's own attachments first in
 * `node.content` order, then each qualifying neighbour in `graph.nodes` order
 * (not edge order, so inserting an unrelated edge moves nothing), and within a
 * neighbour its text entry, then its attachments, then its run outputs in run
 * order. A neighbour joined by several edges appears once, with the labels of
 * those edges merged.
 *
 * ## One name, decided here
 *
 * `AiFileInput.name` is the name the file takes *inside the runtime*: the
 * executor writes it under that name, the probe reports its digest under it,
 * the request lists it as a name the script may open, and the run record keeps
 * it so the next run can say what moved. Those four have to agree, and two
 * neighbours can each produce `plot.png`, so the name cannot be decided one
 * file at a time — `disambiguateExecutorNames` decides the whole collection's
 * names at the end of `collectAiInputs`, and every consumer carries what it is
 * given rather than re-deriving it.
 */

import type { EdgeData } from '../../types/edge';
import { disambiguateExecutorNames } from '$lib/ai/inputFileName';
import type { GraphAssetMetadata, MultigraphData } from '../../types/multigraph';
import type { NodeContentBlock, NodeData } from '../../types/node';
import { latestDoneRun } from './aiNode';

interface AiTextInput {
	kind: 'text';
	nodeId: string;
	title: string;
	description: string;
	/** The role the connecting edge gives this input. Absent when it has none. */
	label?: string;
}

export interface AiFileInput {
	kind: 'file';
	nodeId: string;
	assetId: string;
	/** The name the runtime writes it under, unique across one collection. */
	name: string;
	mimeType: string;
	size: number;
	label?: string;
	/**
	 * Where this file came from: a file the reader attached to a node, or a
	 * neighbour's latest run output.
	 *
	 * Required rather than optional, and not persisted — inputs are recomputed
	 * from the graph on every collection — so it costs no migration and every
	 * construction site has to say which kind it is building. Three things read
	 * it: the workbench lists outputs in a sub-list of their own, Add, Replace
	 * and Remove are not drawn for them, and the request's digest line tells the
	 * model the file is a produced one.
	 */
	origin: 'attachment' | 'run-output';
}

/** One thing the request will carry, already resolved against `graph.assets`. */
export type AiInput = AiTextInput | AiFileInput;

/** How a neighbour is joined to the AI node, once all its edges are considered. */
interface NeighborRelation {
	/** Labels from the qualifying edges, in `graph.edges` order, deduped. */
	labels: string[];
}

/**
 * The inputs an `!ai` node at `nodeId` would send, in the order the workbench
 * lists them and the request renders them.
 *
 * An unknown `nodeId` yields no inputs. A content block whose asset metadata is
 * missing is skipped: there is no blob to send and no size to show, and every
 * write path registers the metadata with the block, so an absence is damage
 * rather than a state to render.
 */
export function collectAiInputs(graph: MultigraphData, nodeId: string): AiInput[] {
	const self = graph.nodes.find((node) => node.id === nodeId);
	if (!self) return [];

	const inputs: AiInput[] = [...fileInputsFor(graph, self)];

	const relations = neighborRelations(graph, nodeId);
	for (const node of graph.nodes) {
		const relation = relations.get(node.id);
		if (!relation) continue;

		const label = mergeLabels(relation.labels);
		inputs.push({
			kind: 'text',
			nodeId: node.id,
			title: node.title,
			description: node.description,
			...(label === undefined ? {} : { label })
		});
		for (const file of [...fileInputsFor(graph, node), ...runOutputInputsFor(graph, node)]) {
			inputs.push(label === undefined ? file : { ...file, label });
		}
	}

	return withRuntimeNames(inputs);
}

/**
 * The same inputs with `name` replaced by the name the runtime will use.
 *
 * Names are assigned per *asset*, not per row: the same asset can reach a node
 * twice — attached to one neighbour and promoted onto another — and the
 * executor writes it once, so both rows have to say the one name it was
 * written under. Everything else keeps its position, because the order is what
 * makes the naming reproducible.
 */
function withRuntimeNames(inputs: AiInput[]): AiInput[] {
	const assetIds: string[] = [];
	const rawNames: string[] = [];
	for (const input of inputs) {
		if (input.kind !== 'file' || assetIds.includes(input.assetId)) continue;
		assetIds.push(input.assetId);
		rawNames.push(input.name);
	}
	if (assetIds.length === 0) return inputs;

	const runtimeNames = disambiguateExecutorNames(rawNames);
	const byAssetId = new Map(assetIds.map((assetId, index) => [assetId, runtimeNames[index]]));
	return inputs.map((input) =>
		input.kind === 'file' ? { ...input, name: byAssetId.get(input.assetId) ?? input.name } : input
	);
}

/**
 * One node's contribution to a run, as the workbench lists it: the node itself,
 * then the files attached to it.
 *
 * The flat list `collectAiInputs` returns is the order a request renders in,
 * and it reads as one long list of things with no way to tell whose file is
 * whose. Grouped, a file is visibly *under* the node it hangs off — which is
 * also the node an Add, a Replace or a Remove acts on, so the group header is
 * where those actions belong.
 *
 * The AI node's own group leads and is always present, even with nothing
 * attached: it is where Add file lives, and a node with no files is exactly the
 * node that needs it. Its `title` is empty because the surface names it "This
 * node" — the reader is looking at it.
 */
export interface AiInputGroup {
	nodeId: string;
	/** `true` for the AI node's own group; every other group is a neighbour. */
	self: boolean;
	/** The neighbour's title. Empty for the self group, which the surface names. */
	title: string;
	/** The neighbour's description — text the request carries. Empty for self. */
	description: string;
	/** The role the connecting edge gives this neighbour, if it has one. */
	label?: string;
	/** The files attached to this node, which Add, Replace and Remove act on. */
	files: AiFileInput[];
	/**
	 * The files this node's latest done run produced, which nothing acts on.
	 *
	 * A list of their own rather than a flag on each row, so the surface can
	 * draw them as a sub-list under the node and simply not draw the three file
	 * actions there — there is no action behind them to explain, and a disabled
	 * control that can never be enabled is a worse answer than no control.
	 * Always the self group's empty list: a node never reads its own outputs.
	 */
	outputs: AiFileInput[];
}

/**
 * The collected inputs, grouped by the node each one hangs off.
 *
 * Order is `collectAiInputs`'s order, which is why nothing here sorts: the self
 * group first, then each neighbour in the order its text input appeared. A file
 * for a node with no text input of its own joins the self group when it is the
 * AI node's, and otherwise opens a group named by its node id — collected
 * inputs never do that, but this takes a list rather than a graph and cannot
 * drop a file it was handed.
 */
export function groupAiInputs(inputs: AiInput[], selfNodeId: string): AiInputGroup[] {
	const selfGroup: AiInputGroup = {
		nodeId: selfNodeId,
		self: true,
		title: '',
		description: '',
		files: [],
		outputs: []
	};
	const groups: AiInputGroup[] = [selfGroup];
	const byNodeId = new Map<string, AiInputGroup>([[selfNodeId, selfGroup]]);

	for (const input of inputs) {
		if (input.kind === 'text') {
			// A text input for a node that already has a group describes that group
			// rather than opening a second one — the self node above all, whose group
			// exists before any input is read.
			const described = byNodeId.get(input.nodeId);
			if (described !== undefined) {
				described.title = input.title;
				described.description = input.description;
				if (input.label !== undefined) described.label = input.label;
				continue;
			}
			const group: AiInputGroup = {
				nodeId: input.nodeId,
				self: false,
				title: input.title,
				description: input.description,
				...(input.label === undefined ? {} : { label: input.label }),
				files: [],
				outputs: []
			};
			byNodeId.set(input.nodeId, group);
			groups.push(group);
			continue;
		}

		// Routed by origin alone, so the surface never has to work out which list
		// a row belongs in from anything else about it.
		const existing = byNodeId.get(input.nodeId);
		if (existing !== undefined) {
			listFor(existing, input).push(input);
			continue;
		}
		const group: AiInputGroup = {
			nodeId: input.nodeId,
			self: false,
			title: input.nodeId,
			description: '',
			...(input.label === undefined ? {} : { label: input.label }),
			files: [],
			outputs: []
		};
		listFor(group, input).push(input);
		byNodeId.set(input.nodeId, group);
		groups.push(group);
	}

	return groups;
}

function listFor(group: AiInputGroup, input: AiFileInput): AiFileInput[] {
	return input.origin === 'run-output' ? group.outputs : group.files;
}

/**
 * The neighbours that feed `nodeId`, keyed by id, with the labels of the edges
 * that qualified them.
 *
 * A self-loop is not a neighbour: a node cannot be its own input, and its
 * attachments are already collected as the node's own.
 */
function neighborRelations(graph: MultigraphData, nodeId: string): Map<string, NeighborRelation> {
	const relations = new Map<string, NeighborRelation>();

	for (const edge of graph.edges) {
		const neighborId = feedingNeighborId(edge, nodeId);
		if (neighborId === undefined) continue;

		const existing = relations.get(neighborId) ?? { labels: [] };
		const label = edgeLabel(edge);
		if (label !== undefined && !existing.labels.includes(label)) existing.labels.push(label);
		relations.set(neighborId, existing);
	}

	return relations;
}

/**
 * The other end of `edge` when it feeds `nodeId`, or `undefined` when it does
 * not: a directed edge leaving the node is an output, and an edge that never
 * touches it is nothing to do with it.
 */
function feedingNeighborId(edge: EdgeData, nodeId: string): string | undefined {
	if (edge.directed === true) {
		if (edge.targetNodeId !== nodeId) return undefined;
		return edge.sourceNodeId === nodeId ? undefined : edge.sourceNodeId;
	}

	if (edge.sourceNodeId === nodeId) {
		return edge.targetNodeId === nodeId ? undefined : edge.targetNodeId;
	}
	if (edge.targetNodeId === nodeId) return edge.sourceNodeId;
	return undefined;
}

/**
 * An edge's contribution to the label: its **first** tag.
 *
 * One tag, not all of them, because the label names a role — `@baseline` — and
 * a run of every tag an edge happens to carry reads as noise in the prompt. An
 * edge with no tags contributes nothing.
 */
function edgeLabel(edge: EdgeData): string | undefined {
	return edge.tags.length > 0 ? edge.tags[0] : undefined;
}

/**
 * The label for a neighbour joined by several edges: their first tags, in edge
 * order, comma-joined. No tagged edge at all means no label.
 */
function mergeLabels(labels: string[]): string | undefined {
	return labels.length > 0 ? labels.join(', ') : undefined;
}

function fileInputsFor(graph: MultigraphData, node: NodeData): AiFileInput[] {
	const inputs: AiFileInput[] = [];
	for (const block of node.content ?? []) {
		const asset = graph.assets?.[block.assetId];
		if (!asset) continue;
		inputs.push({
			kind: 'file',
			nodeId: node.id,
			assetId: block.assetId,
			name: fileNameFor(block, asset),
			mimeType: asset.mimeType,
			size: asset.size,
			origin: 'attachment'
		});
	}
	return inputs;
}

/**
 * The files `node`'s latest done run wrote, as inputs.
 *
 * A node with no `ai` add-on, or with no done run, contributes nothing — and so
 * does a run whose output asset is no longer in the graph. An evicted output is
 * a file that is not there any more, which is the same thing as an attachment
 * the reader removed, and offering the script a name with no bytes behind it
 * would be a failure the run only discovers when it opens the file. The
 * parent's *latest* run is never the one eviction takes, so this is the rare
 * case rather than the ordinary one.
 */
function runOutputInputsFor(graph: MultigraphData, node: NodeData): AiFileInput[] {
	const ai = node.addons?.ai;
	if (ai === undefined) return [];
	const latest = latestDoneRun(ai);
	if (latest === undefined) return [];

	const inputs: AiFileInput[] = [];
	for (const output of latest.outputs) {
		const asset = graph.assets?.[output.assetId];
		if (!asset) continue;
		inputs.push({
			kind: 'file',
			nodeId: node.id,
			assetId: output.assetId,
			name: output.name,
			// The run record says what it wrote; the asset is consulted for the size
			// and for the fact that the bytes are still reachable at all.
			mimeType: output.mimeType,
			size: asset.size,
			origin: 'run-output'
		});
	}
	return inputs;
}

/**
 * The name the script will see this attachment under.
 *
 * A file block already carries the filename it was uploaded with, so that wins.
 * An image block does not — it carries `alt`, which is prose about the picture
 * — so the asset's recorded `name` is preferred for images and `alt` is only
 * the fallback when the store never recorded one. The asset id is the last
 * resort, because a script needs *some* name and an empty one is worse than an
 * opaque one.
 */
function fileNameFor(block: NodeContentBlock, asset: GraphAssetMetadata): string {
	if (block.type === 'file') return block.name || asset.name || block.assetId;
	return asset.name || block.alt || block.assetId;
}
