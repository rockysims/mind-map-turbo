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
 * Order is stable by construction so the workbench list does not reshuffle
 * while the user edits the map: the node's own attachments first in
 * `node.content` order, then each qualifying neighbour in `graph.nodes` order
 * (not edge order, so inserting an unrelated edge moves nothing), and within a
 * neighbour its text entry before its attachments. A neighbour joined by
 * several edges appears once, with the labels of those edges merged.
 */

import type { EdgeData } from '../../types/edge';
import type { GraphAssetMetadata, MultigraphData } from '../../types/multigraph';
import type { NodeContentBlock, NodeData } from '../../types/node';

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
	name: string;
	mimeType: string;
	size: number;
	label?: string;
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
		for (const file of fileInputsFor(graph, node)) {
			inputs.push(label === undefined ? file : { ...file, label });
		}
	}

	return inputs;
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
	files: AiFileInput[];
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
		files: []
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
				files: []
			};
			byNodeId.set(input.nodeId, group);
			groups.push(group);
			continue;
		}

		const existing = byNodeId.get(input.nodeId);
		if (existing !== undefined) {
			existing.files.push(input);
			continue;
		}
		const group: AiInputGroup = {
			nodeId: input.nodeId,
			self: false,
			title: input.nodeId,
			description: '',
			...(input.label === undefined ? {} : { label: input.label }),
			files: [input]
		};
		byNodeId.set(input.nodeId, group);
		groups.push(group);
	}

	return groups;
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
			size: asset.size
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
