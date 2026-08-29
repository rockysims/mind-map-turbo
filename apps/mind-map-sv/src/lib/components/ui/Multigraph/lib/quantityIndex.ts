/**
 * Collect every node's quantities into one graph-wide index.
 *
 * Two different things arrive here and are kept apart on purpose. Extraction
 * reads each node's math and yields *suggestions* — what the text appears to
 * define and mention. Designations are what the user confirmed, and they alone
 * decide who defines a quantity and who consumes it, which is to say they alone
 * draw edges. A node full of equations that nobody has confirmed anything on
 * contributes symbols to look at and no dataflow whatsoever.
 *
 * The index keeps *every* symbol it sees either way, including ones nobody
 * defines. The promotion rule — a symbol counts as a tracked quantity only once
 * some node defines it — is applied by callers that draw things, not here.
 * Discarding unclaimed symbols at index time would keep the canvas quiet but
 * leave the chips and the diagnostics with nothing to offer.
 *
 * The in-between state gets a name of its own: a symbol some node's *text*
 * defines while nobody has confirmed it. Those are the `text*` facets. They draw
 * nothing — no chips, no edges, no promotion — but a reader asking "what defines
 * this?" has to be told about them, because answering "nothing" invites them to
 * write a second node saying what the first one already says.
 */

import { symbolFor, type QuantitySymbol } from '../../MathText/lib/mathSymbols';
import type { QuantityDesignation } from '../../types/node';
import {
	DEFAULT_DATAFLOW_OPT_OUT_TAG,
	nodeQuantities,
	type NodeQuantities,
	type NodeQuantitiesOptions,
	type QuantityBearingNode
} from './nodeQuantities';

export interface IndexableNode extends QuantityBearingNode {
	id: string;
	/** Quantities the user confirmed this node consumes. Absent means none. */
	inputs?: readonly QuantityDesignation[];
	/** Quantities the user confirmed this node defines. Absent means none. */
	outputs?: readonly QuantityDesignation[];
}

export interface QuantityDefinitionRecord {
	nodeId: string;
	bodyKey: string;
	/** The LaTeX the author wrote, for rendering this definition where it is needed. */
	sourceTex: string;
	displayMode: boolean;
}

export interface QuantityIndexEntry {
	symbol: QuantitySymbol;
	/**
	 * Nodes whose confirmed outputs include this quantity, sorted and distinct. A
	 * node appears once however many times it states the definition, because this
	 * drives edges and labels, where a repeat would draw a duplicate.
	 */
	definerNodeIds: string[];
	/**
	 * What the definers' text says this quantity equals, sorted — one record per
	 * distinct statement. Disagreement among these is what a conflict is; use
	 * `definerNodeIds` for anything that draws. A definer whose text no longer
	 * contains the equation contributes nothing here, which is a stale designation
	 * rather than an error: the edge the user confirmed survives a reworded node.
	 */
	definitions: QuantityDefinitionRecord[];
	/**
	 * Nodes whose *text* defines this quantity without anyone having confirmed it,
	 * sorted and distinct — the mirror of `definerNodeIds` for the in-between
	 * state. A confirmed definer never appears here: once the output is confirmed
	 * the node is a definer, full stop, and listing it twice would offer the reader
	 * a confirmation they have already made.
	 *
	 * Nothing draws from this. It exists because a symbol whose only definers are
	 * unconfirmed is not "defined by nobody" — saying so leads a reader to write a
	 * second node stating what the first one already says.
	 */
	textDefinerNodeIds: string[];
	/**
	 * What those unconfirmed definers' text says this quantity equals, sorted the
	 * same way `definitions` is and carrying the same record shape, so one row
	 * renderer serves both. A text definer always has at least one record here, by
	 * construction: it is on the list precisely because its text defines the
	 * symbol.
	 */
	textDefinitions: QuantityDefinitionRecord[];
	/** Nodes whose confirmed inputs include this quantity, sorted. */
	consumerNodeIds: string[];
}

export interface QuantityIndex {
	/** Every symbol seen anywhere — extracted or designated — keyed by canonical key. */
	entries: ReadonlyMap<string, QuantityIndexEntry>;
	/**
	 * What each node's *text* defines and references. Suggestions, not dataflow:
	 * the chip UI offers these for confirmation and the diagnostics use them for
	 * context, but only designations reach `definerNodeIds`/`consumerNodeIds`.
	 */
	byNodeId: ReadonlyMap<string, NodeQuantities>;
}

/** Injectable so callers can count how often extraction actually runs. */
export type QuantityExtractor = (node: QuantityBearingNode) => NodeQuantities;

export interface QuantityIndexerOptions extends NodeQuantitiesOptions {
	extract?: QuantityExtractor;
}

/**
 * A node's *extraction* changes only when its title, description, or tags change,
 * since the opt-out is a tag. Designations are deliberately absent: they do not
 * affect what the math says, and folding them in here would re-render every
 * equation in a node on each chip tap.
 *
 * The title must be in here. Omitting it produces a graph that is correct after
 * a reload and wrong until then, because a title edit would leave the cached
 * extraction in place — the hardest class of bug to notice.
 */
function signatureOf(node: IndexableNode): string {
	return `${node.title ?? ''}\u0000${node.description}\u0000${node.tags.join('\u0001')}`;
}

/**
 * A node's *designations*, which decide its edges but never its extraction.
 *
 * Symbol keys embed a NUL of their own, so the separators here start above it;
 * inputs and outputs are joined by a distinct one so that moving a designation
 * from one column to the other changes the signature rather than cancelling out.
 */
function designationListKey(designations: readonly QuantityDesignation[] | undefined): string {
	return (designations ?? [])
		.map((designation) => symbolFor(designation.base, designation.subscript).key)
		.join('\u0001');
}

function ioSignatureOf(node: IndexableNode): string {
	return `${designationListKey(node.inputs)}\u0002${designationListKey(node.outputs)}`;
}

function entryFor(entries: Map<string, QuantityIndexEntry>, symbol: QuantitySymbol) {
	const existing = entries.get(symbol.key);
	if (existing !== undefined) {
		return existing;
	}
	const created: QuantityIndexEntry = {
		symbol,
		definerNodeIds: [],
		definitions: [],
		textDefinerNodeIds: [],
		textDefinitions: [],
		consumerNodeIds: []
	};
	entries.set(symbol.key, created);
	return created;
}

/**
 * One order for both record lists, so a confirmed row and an unconfirmed one
 * sort the same way and a confirmation does not reshuffle the card it lands in.
 */
function byNodeThenBody(left: QuantityDefinitionRecord, right: QuantityDefinitionRecord): number {
	return left.nodeId.localeCompare(right.nodeId) || left.bodyKey.localeCompare(right.bodyKey);
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
 *
 * The indexer also returns the *previous index object* whenever nothing
 * content-relevant changed. Callers derive the index from the whole graph, whose
 * identity churns on every animation frame of a drag or a settle because
 * positions moved; without an identity return, each of those frames would build
 * a fresh-but-identical index and invalidate every piece of derived state hanging
 * off it — edges, chips, labels, diagnostics — sixty times a second for reasons
 * that have nothing to do with the math.
 *
 * The two signatures serve the two halves of that: extraction is reused whenever
 * the *text* is unchanged, while the identity return additionally requires the
 * designations to be unchanged, since those are what the edges are made of.
 */
export function createQuantityIndexer(options: QuantityIndexerOptions = {}) {
	const { extract, ...quantityOptions } = options;
	const optOutTag = quantityOptions.optOutTag ?? DEFAULT_DATAFLOW_OPT_OUT_TAG;
	const run: QuantityExtractor = extract ?? ((node) => nodeQuantities(node, quantityOptions));
	const cache = new Map<
		string,
		{ signature: string; ioSignature: string; quantities: NodeQuantities }
	>();
	let previous: QuantityIndex | undefined;

	return function buildQuantityIndex(nodes: readonly IndexableNode[]): QuantityIndex {
		const signatures = nodes.map((node) => signatureOf(node));
		const ioSignatures = nodes.map((node) => ioSignatureOf(node));
		const liveNodeIds = new Set<string>();
		let everyNodeMatchedItsMemo = true;

		for (let position = 0; position < nodes.length; position += 1) {
			liveNodeIds.add(nodes[position].id);
			const cached = cache.get(nodes[position].id);
			if (
				cached?.signature !== signatures[position] ||
				cached.ioSignature !== ioSignatures[position]
			) {
				everyNodeMatchedItsMemo = false;
			}
		}

		// The index is a pure function of every node's (id, title, description,
		// tags, inputs, outputs). Every node matching both memos means nothing
		// relevant changed; the cache holding exactly as many nodes as are live
		// means none came or went, since dead ids are evicted below and a new id
		// could not have matched a memo.
		if (previous !== undefined && everyNodeMatchedItsMemo && cache.size === liveNodeIds.size) {
			return previous;
		}

		const entries = new Map<string, QuantityIndexEntry>();
		const byNodeId = new Map<string, NodeQuantities>();

		// Extraction first, for every node, so that a symbol appearing in anyone's
		// text is represented by the parsed symbol object rather than one rebuilt
		// from a designation. The two compare equal, but only the parsed one was
		// read off the author's math.
		for (let position = 0; position < nodes.length; position += 1) {
			const node = nodes[position];
			const signature = signatures[position];
			const cached = cache.get(node.id);
			let quantities: NodeQuantities;
			if (cached !== undefined && cached.signature === signature) {
				quantities = cached.quantities;
			} else {
				quantities = run({ ...node });
			}
			cache.set(node.id, { signature, ioSignature: ioSignatures[position], quantities });
			byNodeId.set(node.id, quantities);

			// Every extracted symbol earns an entry and nothing more that draws. This is
			// the pool the chips are offered from and what the diagnostics reason about;
			// the edges come from the designation pass below.
			//
			// A parsed definition also records itself as a *text* definer, which is the
			// answer to "who writes this down?" for a symbol nobody has confirmed. The
			// confirmed ones are subtracted back out once this pass knows them, below.
			const optedOut = node.tags.includes(optOutTag);
			for (const definition of quantities.defines) {
				const entry = entryFor(entries, definition.symbol);
				// Belt and braces: extraction already yields nothing for an opted-out
				// node, and one tag has to mean one thing whichever side reads it.
				if (optedOut) {
					continue;
				}
				entry.textDefinitions.push({
					nodeId: node.id,
					bodyKey: definition.bodyKey,
					sourceTex: definition.sourceTex,
					displayMode: definition.displayMode
				});
			}
			for (const symbol of quantities.references) {
				entryFor(entries, symbol);
			}
		}

		for (const node of nodes) {
			// One tag, one meaning: an opted-out node contributes no dataflow, so its
			// designations are suppressed exactly as its math already was.
			if (node.tags.includes(optOutTag)) {
				continue;
			}

			const quantities = byNodeId.get(node.id) ?? { defines: [], references: [] };

			const seenOutputs = new Set<string>();
			for (const designation of node.outputs ?? []) {
				const symbol = symbolFor(designation.base, designation.subscript);
				if (seenOutputs.has(symbol.key)) {
					continue;
				}
				seenOutputs.add(symbol.key);

				const entry = entryFor(entries, symbol);
				entry.definerNodeIds.push(node.id);
				// A confirmed output whose equation is not (or no longer) in the text is
				// still a definer; it just has no body to show.
				for (const definition of quantities.defines) {
					if (definition.symbol.key !== symbol.key) {
						continue;
					}
					entry.definitions.push({
						nodeId: node.id,
						bodyKey: definition.bodyKey,
						sourceTex: definition.sourceTex,
						displayMode: definition.displayMode
					});
				}
			}

			// A node that designates one quantity as both input and output keeps both
			// roles: it said so, and silently dropping one would lose an edge the user
			// asked for. The definer/consumer cross-product skips self-pairs anyway.
			const seenInputs = new Set<string>();
			for (const designation of node.inputs ?? []) {
				const symbol = symbolFor(designation.base, designation.subscript);
				if (seenInputs.has(symbol.key)) {
					continue;
				}
				seenInputs.add(symbol.key);
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
			entry.definitions.sort(byNodeThenBody);

			// Confirmed wins: a node that both writes the equation and has the output
			// confirmed is a definer, and appearing on both lists would show the reader
			// one node twice and offer to confirm what is already confirmed.
			const confirmed = new Set(entry.definerNodeIds);
			entry.textDefinitions = entry.textDefinitions
				.filter((record) => !confirmed.has(record.nodeId))
				.sort(byNodeThenBody);
			// Distinct: a node stating the same quantity twice is one answer to "who
			// writes this down?", however many equations it took.
			entry.textDefinerNodeIds = [
				...new Set(entry.textDefinitions.map((record) => record.nodeId))
			].sort();
		}

		previous = { entries, byNodeId };
		return previous;
	};
}

/** One-shot index for callers with no recompute loop to amortize over. */
export function buildQuantityIndex(
	nodes: readonly IndexableNode[],
	options: QuantityIndexerOptions = {}
): QuantityIndex {
	return createQuantityIndexer(options)(nodes);
}
