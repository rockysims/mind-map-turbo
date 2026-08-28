/**
 * Collect every node's quantities into one graph-wide index.
 *
 * The index keeps *every* symbol it sees, including ones nobody defines. The
 * promotion rule — a symbol counts as a tracked quantity only once some node
 * defines it — is applied by callers that draw things, not here. Discarding
 * unclaimed symbols at index time would keep the canvas quiet but leave the
 * diagnostics with nothing to offer.
 */

import type { QuantitySymbol } from '../../MathText/lib/mathSymbols';
import {
	nodeQuantities,
	type NodeQuantities,
	type NodeQuantitiesOptions,
	type QuantityBearingNode
} from './nodeQuantities';

export interface IndexableNode extends QuantityBearingNode {
	id: string;
}

export interface QuantityIndexEntry {
	symbol: QuantitySymbol;
	/** Nodes defining this quantity, sorted. More than one is a conflict. */
	definerNodeIds: string[];
	/** Nodes referencing this quantity without defining it, sorted. */
	consumerNodeIds: string[];
}

export interface QuantityIndex {
	/** Every symbol seen anywhere, keyed by canonical key. */
	entries: ReadonlyMap<string, QuantityIndexEntry>;
	/** What each node defines and references. */
	byNodeId: ReadonlyMap<string, NodeQuantities>;
}

/** Injectable so callers can count how often extraction actually runs. */
export type QuantityExtractor = (node: QuantityBearingNode) => NodeQuantities;

export interface QuantityIndexerOptions extends NodeQuantitiesOptions {
	extract?: QuantityExtractor;
}

/**
 * A node's contribution changes only when its title, description, or tags
 * change, since the opt-out is a tag. Nothing else about a node can affect
 * extraction.
 *
 * The title must be in here. Omitting it produces a graph that is correct after
 * a reload and wrong until then, because a title edit would leave the cached
 * extraction in place — the hardest class of bug to notice.
 */
function signatureOf(node: IndexableNode): string {
	return `${node.title ?? ''}\u0000${node.description}\u0000${node.tags.join('\u0001')}`;
}

function entryFor(entries: Map<string, QuantityIndexEntry>, symbol: QuantitySymbol) {
	const existing = entries.get(symbol.key);
	if (existing !== undefined) {
		return existing;
	}
	const created: QuantityIndexEntry = { symbol, definerNodeIds: [], consumerNodeIds: [] };
	entries.set(symbol.key, created);
	return created;
}

/** True when some node defines this quantity, so it may be drawn. */
export function isTracked(entry: QuantityIndexEntry): boolean {
	return entry.definerNodeIds.length > 0;
}

/** Quantities the canvas may draw: edges, chips, and edge labels. */
export function trackedQuantities(index: QuantityIndex): QuantityIndexEntry[] {
	return [...index.entries.values()].filter(isTracked);
}

/**
 * Build an indexer that reuses extraction results across calls.
 *
 * Extraction renders every expression in a description, so re-running it for an
 * untouched node on each recompute is the cost that would make large graphs
 * unusable.
 */
export function createQuantityIndexer(options: QuantityIndexerOptions = {}) {
	const { extract, ...quantityOptions } = options;
	const run: QuantityExtractor = extract ?? ((node) => nodeQuantities(node, quantityOptions));
	const cache = new Map<string, { signature: string; quantities: NodeQuantities }>();

	return function buildQuantityIndex(nodes: readonly IndexableNode[]): QuantityIndex {
		const entries = new Map<string, QuantityIndexEntry>();
		const byNodeId = new Map<string, NodeQuantities>();
		const liveNodeIds = new Set<string>();

		for (const node of nodes) {
			liveNodeIds.add(node.id);
			const signature = signatureOf(node);
			const cached = cache.get(node.id);
			const quantities = cached?.signature === signature ? cached.quantities : run({ ...node });
			cache.set(node.id, { signature, quantities });
			byNodeId.set(node.id, quantities);

			for (const symbol of quantities.defines) {
				entryFor(entries, symbol).definerNodeIds.push(node.id);
			}
			for (const symbol of quantities.references) {
				entryFor(entries, symbol).consumerNodeIds.push(node.id);
			}
		}

		for (const cachedNodeId of [...cache.keys()]) {
			if (!liveNodeIds.has(cachedNodeId)) {
				cache.delete(cachedNodeId);
			}
		}

		// Sorting makes the index independent of node order, which in turn keeps
		// derived edge ordering stable across unrelated graph edits.
		for (const entry of entries.values()) {
			entry.definerNodeIds.sort();
			entry.consumerNodeIds.sort();
		}

		return { entries, byNodeId };
	};
}

/** One-shot index for callers with no recompute loop to amortize over. */
export function buildQuantityIndex(
	nodes: readonly IndexableNode[],
	options: QuantityIndexerOptions = {}
): QuantityIndex {
	return createQuantityIndexer(options)(nodes);
}
