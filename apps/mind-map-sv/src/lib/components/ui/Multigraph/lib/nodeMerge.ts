/**
 * Fold one node into another, by hand.
 *
 * `planNodeMerge` is a dry run and the commit in one call: the caller shows the
 * reported conflicts in a dialog and, on confirm, commits the very `next` that
 * was described. There is no second pass that could disagree with the first.
 *
 * Merging is the only mutation here that can silently discard an authored fact
 * (an edge's direction), so that one case is reported rather than performed
 * quietly. Everything else the merge does is recoverable in the edit sheet.
 */

import type { EdgeData } from '../../types/edge';
import type { MultigraphData } from '../../types/multigraph';
import type { NodeContentBlock, NodeData, QuantityDesignation } from '../../types/node';
import { isDerivedEdgeId } from './derivedEdges';
import { designationKey, findExistingEdge } from './graph';

/**
 * One absorbed edge whose direction assertion the merged graph will not carry.
 *
 * Deliberately minimal: the dialog needs a count, and enough to name the edges
 * later if the copy ever grows past a count. Both ids are resolvable against
 * the *input* graph (`survivingEdgeId` also exists in `next`, carrying the
 * unioned tags; `absorbedEdgeId` does not).
 */
export interface EdgeConflict {
	/** Id of the edge incident to the absorbed node, whose direction is discarded. */
	absorbedEdgeId: string;
	/** Id of the survivor-side edge it collapsed into, whose direction wins. */
	survivingEdgeId: string;
}

export interface NodeMergePlan {
	/** The merged graph. Referentially identical to `data` when the merge is a no-op. */
	next: MultigraphData;
	/** Absorbed edges whose direction the result discards. Empty means nothing lossy happened. */
	directionConflicts: EdgeConflict[];
	/** The absorbed--survivor edge that would have become a self-loop, if there was one. */
	droppedSelfEdgeId: string | null;
}

/**
 * Merge `absorbedId` into `survivorId`. The survivor keeps its id, title and
 * position; the absorbed node disappears and its content is folded in.
 *
 * A no-op (returning `data` itself) when either id is unknown or the two are the
 * same node, so a mis-aimed gesture can never damage the graph.
 */
export function planNodeMerge(
	data: MultigraphData,
	absorbedId: string,
	survivorId: string
): NodeMergePlan {
	const absorbed = data.nodes.find((node) => node.id === absorbedId);
	const survivor = data.nodes.find((node) => node.id === survivorId);
	if (!absorbed || !survivor || absorbedId === survivorId) {
		return { next: data, directionConflicts: [], droppedSelfEdgeId: null };
	}

	const merged = mergeNodeFields(survivor, absorbed);
	const edgePlan = mergeEdges(data, absorbedId, survivorId);

	const posByNodeId = { ...data.posByNodeId };
	delete posByNodeId[absorbedId];

	return {
		next: {
			...data,
			nodes: data.nodes
				.filter((node) => node.id !== absorbedId)
				.map((node) => (node.id === survivorId ? merged : node)),
			edges: edgePlan.edges,
			posByNodeId
		},
		directionConflicts: edgePlan.directionConflicts,
		droppedSelfEdgeId: edgePlan.droppedSelfEdgeId
	};
}

function mergeNodeFields(survivor: NodeData, absorbed: NodeData): NodeData {
	return {
		...survivor,
		description: mergeDescriptions(survivor.description, absorbed.description),
		tags: unionTags(survivor.tags, absorbed.tags),
		pinned: mergePinned(survivor.pinned, absorbed.pinned),
		lastPinnedSeq: maxDefined(survivor.lastPinnedSeq, absorbed.lastPinnedSeq),
		content: concatContent(survivor.content, absorbed.content),
		inputs: unionDesignations(survivor.inputs, absorbed.inputs),
		outputs: unionDesignations(survivor.outputs, absorbed.outputs),
		// The survivor's size wins; the absorbed one only fills a gap. A merge
		// unites duplicates, and summing two scrapes of the same file would
		// double it.
		sizeBytes: survivor.sizeBytes ?? absorbed.sizeBytes,
		// Same rule for weight, and a survivor's 0 is a real weight that wins.
		weight: survivor.weight ?? absorbed.weight
	};
}

/**
 * Both descriptions survive, separated by a blank line. Ugly beats deleting
 * prose the reader wrote: a merge is deliberate, so they are already right
 * there in the edit sheet if they want to tidy it.
 *
 * A whitespace-only description counts as empty, so merging into a blank node
 * does not leave a stray blank line at the top.
 */
function mergeDescriptions(survivorText: string, absorbedText: string): string {
	const parts = [survivorText, absorbedText].filter((part) => part.trim() !== '');
	return parts.join('\n\n');
}

/** Union preserving the survivor's order, then the absorbed node's new tags. */
function unionTags(survivorTags: readonly string[], absorbedTags: readonly string[]): string[] {
	const seen = new Set(survivorTags);
	return [...survivorTags, ...absorbedTags.filter((tag) => !seen.has(tag))];
}

function mergePinned(survivorPinned?: boolean, absorbedPinned?: boolean): boolean | undefined {
	if (survivorPinned === undefined && absorbedPinned === undefined) return undefined;
	return (survivorPinned ?? false) || (absorbedPinned ?? false);
}

/**
 * The more recent stamp wins, so a merge never makes a pinned survivor look
 * older than it is — beacon election reads this.
 */
function maxDefined(survivorSeq?: number, absorbedSeq?: number): number | undefined {
	if (survivorSeq === undefined) return absorbedSeq;
	if (absorbedSeq === undefined) return survivorSeq;
	return Math.max(survivorSeq, absorbedSeq);
}

function concatContent(
	survivorContent?: NodeContentBlock[],
	absorbedContent?: NodeContentBlock[]
): NodeContentBlock[] | undefined {
	if (survivorContent === undefined && absorbedContent === undefined) return undefined;
	return [...(survivorContent ?? []), ...(absorbedContent ?? [])];
}

/** Union deduped by symbol key, so `v_0` declared on both sides lands once. */
function unionDesignations(
	survivorDesignations?: QuantityDesignation[],
	absorbedDesignations?: QuantityDesignation[]
): QuantityDesignation[] | undefined {
	if (survivorDesignations === undefined && absorbedDesignations === undefined) return undefined;

	const seen = new Set<string>();
	const result: QuantityDesignation[] = [];
	for (const designation of [...(survivorDesignations ?? []), ...(absorbedDesignations ?? [])]) {
		const key = designationKey(designation);
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(designation);
	}
	return result;
}

interface EdgeMergeResult {
	edges: EdgeData[];
	directionConflicts: EdgeConflict[];
	droppedSelfEdgeId: string | null;
}

/**
 * Rewrite every edge incident to the absorbed node onto the survivor.
 *
 * Two passes: every untouched edge is seated first, then the incident ones are
 * rewritten. Counterpart lookup runs against the result, so it sees the
 * survivor's own edges wherever they sat in the input order, and two parallel
 * absorbed edges to the same neighbour collapse together rather than
 * reappearing as a fresh parallel pair the reader never drew.
 */
function mergeEdges(data: MultigraphData, absorbedId: string, survivorId: string): EdgeMergeResult {
	const edges: EdgeData[] = [];
	const incidentEdges: EdgeData[] = [];
	const directionConflicts: EdgeConflict[] = [];
	let droppedSelfEdgeId: string | null = null;

	for (const edge of data.edges) {
		const incident = edge.sourceNodeId === absorbedId || edge.targetNodeId === absorbedId;
		if (!incident) {
			edges.push(edge);
			continue;
		}

		// Derived edges are recomputed from the quantity index on every render, so
		// there is nothing here to preserve — and rewriting one would mint a
		// `dataflow:` id that does not match its own endpoints.
		if (isDerivedEdgeId(edge.id)) continue;

		incidentEdges.push(edge);
	}

	for (const edge of incidentEdges) {
		const rewritten: EdgeData = {
			...edge,
			sourceNodeId: edge.sourceNodeId === absorbedId ? survivorId : edge.sourceNodeId,
			targetNodeId: edge.targetNodeId === absorbedId ? survivorId : edge.targetNodeId
		};

		// The absorbed--survivor edge (and any absorbed self-loop) would become a
		// loop on the survivor. Dropping it loses nothing: it asserted a relation
		// between two things that are now one thing.
		if (rewritten.sourceNodeId === rewritten.targetNodeId) {
			droppedSelfEdgeId ??= edge.id;
			continue;
		}

		const counterpart = findExistingEdge(
			{ ...data, edges },
			rewritten.sourceNodeId,
			rewritten.targetNodeId
		);
		if (!counterpart) {
			edges.push(rewritten);
			continue;
		}

		const counterpartIndex = edges.indexOf(counterpart);
		if (discardsDirection(rewritten, counterpart)) {
			directionConflicts.push({ absorbedEdgeId: edge.id, survivingEdgeId: counterpart.id });
		}
		edges[counterpartIndex] = {
			...counterpart,
			tags: unionTags(counterpart.tags, edge.tags)
		};
	}

	return { edges, directionConflicts, droppedSelfEdgeId };
}

/**
 * True when `absorbedEdge` asserted a direction the collapsed result will not
 * carry — the two point opposite ways, or the absorbed edge was directed and
 * the survivor's counterpart is not.
 *
 * An undirected absorbed edge folding into a directed one asserts nothing that
 * gets lost, so it is not a conflict.
 *
 * Both edges are known to join the same unordered pair, so a differing source
 * is exactly "points the other way".
 */
function discardsDirection(absorbedEdge: EdgeData, survivingEdge: EdgeData): boolean {
	if (!absorbedEdge.directed) return false;
	if (!survivingEdge.directed) return true;
	return absorbedEdge.sourceNodeId !== survivingEdge.sourceNodeId;
}
