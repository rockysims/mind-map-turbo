/**
 * Report what is wrong, or merely hidden, in a graph's dataflow.
 *
 * A "reference" here is a quantity the user confirmed as one of a node's inputs,
 * never a symbol that merely appears in its text. That is the whole point of
 * asking for confirmation: an unresolved reference is now a claim the author made
 * — "this node needs a value for `g`" — and reporting one is an invitation to
 * supply it, rather than a complaint about a letter in an equation.
 *
 * The reference states are deliberately distinct, because each one names a
 * different repair. A quantity whose definer is simply scrolled out of the
 * visible neighborhood is not a mistake; one that someone has written down but
 * nobody confirmed needs a tap, not a new node; only a symbol nothing anywhere
 * states is an invitation to extend the graph. Showing them the same way would
 * train people to ignore all of them.
 */

import type { QuantitySymbol } from '../../MathText/lib/mathSymbols';
import type { DerivedEdge } from './derivedEdges';
import type { QuantityDefinitionRecord, QuantityIndex } from './quantityIndex';

export type ReferenceState =
	/** Defined by a node that is currently on screen. */
	| 'resolved'
	/** Defined somewhere, but every definer is outside the visible neighborhood. */
	| 'out-of-view'
	/**
	 * Written down, but no node confirmed it as an output. Not a missing
	 * definition — a missing confirmation, and the repair is one tap on the node
	 * that already says it rather than a new node saying it again.
	 */
	| 'unconfirmed'
	/** Defined by no node anywhere. An invitation to extend the graph. */
	| 'unresolved';

/** One node's confirmed input, and how well the graph answers it. */
export interface ReferenceDiagnostic {
	nodeId: string;
	symbol: QuantitySymbol;
	state: ReferenceState;
	/** Nodes defining this quantity. Empty exactly when unresolved or unconfirmed. */
	definerNodeIds: string[];
	/**
	 * Nodes whose text defines this quantity without having confirmed it. Non-empty
	 * exactly when the state is `unconfirmed`; they are who the repair points at.
	 */
	textDefinerNodeIds: string[];
}

export interface ConflictDiagnostic {
	symbol: QuantitySymbol;
	/**
	 * The nodes whose disagreement this is, sorted. Usually two or more, but
	 * exactly one when a single node defines it two different ways — it
	 * contradicts itself, with no second node involved.
	 *
	 * Read off the definitions rather than off the entry's confirmed definers:
	 * a definer whose text no longer states the equation is a stale designation,
	 * not a party to the disagreement, and naming it would send the reader to a
	 * node with nothing to reconcile. Callers that want everyone claiming the
	 * output — the edges, the peek card's rows — read the index directly.
	 */
	definerNodeIds: string[];
	/**
	 * Nodes that alone define this quantity more than one way, sorted. Separated
	 * out because it is a different repair: there is no other node to reconcile
	 * with and nowhere to navigate to, so the panel has to say something else.
	 */
	selfContradictingNodeIds: string[];
}

export interface CycleDiagnostic {
	/** Mutually dependent nodes, sorted. */
	nodeIds: string[];
}

export interface DataflowDiagnostics {
	references: ReferenceDiagnostic[];
	conflicts: ConflictDiagnostic[];
	cycles: CycleDiagnostic[];
}

export interface DataflowDiagnosticsOptions {
	/**
	 * Nodes currently on screen. Omit to treat every node as visible, which is
	 * what keeps this module pure and independent of bounded visibility.
	 */
	visibleNodeIds?: ReadonlySet<string>;
}

function referenceState(
	definerNodeIds: readonly string[],
	textDefinerNodeIds: readonly string[],
	visibleNodeIds: ReadonlySet<string> | undefined
): ReferenceState {
	if (definerNodeIds.length === 0) {
		// Someone wrote the equation and nobody confirmed it. Reporting that as
		// "not defined anywhere" is false, and the offer it used to carry — define
		// it — would produce a second node saying what the first one already says.
		//
		// Visibility deliberately does not split this state the way it splits
		// `resolved`: the repair is a confirmation, which the reader makes from
		// where they are, so whether the writer is on screen changes nothing about
		// what to do next.
		return textDefinerNodeIds.length > 0 ? 'unconfirmed' : 'unresolved';
	}
	if (visibleNodeIds === undefined) {
		return 'resolved';
	}
	// One reachable definer is enough; a competing definer being off screen does
	// not make the reference any harder to follow.
	return definerNodeIds.some((nodeId) => visibleNodeIds.has(nodeId)) ? 'resolved' : 'out-of-view';
}

/**
 * Groups of mutually dependent nodes, via Tarjan's strongly connected
 * components.
 *
 * Enumerating every simple cycle is exponential, and the useful answer is not a
 * list of loops but the set of nodes that cannot be ordered. Strongly connected
 * components give exactly that, in linear time, and naturally exclude a diamond
 * where two independent paths merge.
 *
 * Written iteratively so a deep dependency chain cannot overflow the stack.
 */
function stronglyConnectedComponents(
	nodeIds: readonly string[],
	adjacency: ReadonlyMap<string, string[]>
): string[][] {
	const indexByNode = new Map<string, number>();
	const lowLinkByNode = new Map<string, number>();
	const onStack = new Set<string>();
	const pending: string[] = [];
	const components: string[][] = [];
	let nextIndex = 0;

	for (const root of nodeIds) {
		if (indexByNode.has(root)) {
			continue;
		}

		const frames: { nodeId: string; childIndex: number }[] = [{ nodeId: root, childIndex: 0 }];

		while (frames.length > 0) {
			const frame = frames[frames.length - 1];
			const { nodeId } = frame;

			if (frame.childIndex === 0) {
				indexByNode.set(nodeId, nextIndex);
				lowLinkByNode.set(nodeId, nextIndex);
				nextIndex += 1;
				pending.push(nodeId);
				onStack.add(nodeId);
			}

			const neighbors = adjacency.get(nodeId) ?? [];
			if (frame.childIndex < neighbors.length) {
				const neighbor = neighbors[frame.childIndex];
				frame.childIndex += 1;
				if (!indexByNode.has(neighbor)) {
					frames.push({ nodeId: neighbor, childIndex: 0 });
				} else if (onStack.has(neighbor)) {
					lowLinkByNode.set(
						nodeId,
						Math.min(lowLinkByNode.get(nodeId)!, indexByNode.get(neighbor)!)
					);
				}
				continue;
			}

			frames.pop();
			const parent = frames[frames.length - 1];
			if (parent !== undefined) {
				lowLinkByNode.set(
					parent.nodeId,
					Math.min(lowLinkByNode.get(parent.nodeId)!, lowLinkByNode.get(nodeId)!)
				);
			}

			if (lowLinkByNode.get(nodeId) === indexByNode.get(nodeId)) {
				const component: string[] = [];
				for (;;) {
					const popped = pending.pop()!;
					onStack.delete(popped);
					component.push(popped);
					if (popped === nodeId) {
						break;
					}
				}
				components.push(component);
			}
		}
	}

	return components;
}

function cyclesFrom(edges: readonly DerivedEdge[]): CycleDiagnostic[] {
	const adjacency = new Map<string, string[]>();
	const nodeIds = new Set<string>();

	for (const edge of edges) {
		nodeIds.add(edge.sourceNodeId);
		nodeIds.add(edge.targetNodeId);
		const neighbors = adjacency.get(edge.sourceNodeId);
		if (neighbors === undefined) {
			adjacency.set(edge.sourceNodeId, [edge.targetNodeId]);
		} else {
			neighbors.push(edge.targetNodeId);
		}
	}

	// Sorting the roots keeps component discovery order independent of edge order.
	const ordered = [...nodeIds].sort();

	return stronglyConnectedComponents(ordered, adjacency)
		.filter((component) => component.length > 1)
		.map((component) => ({ nodeIds: [...component].sort() }))
		.sort((left, right) => left.nodeIds[0].localeCompare(right.nodeIds[0]));
}

/**
 * The nodes a conflict is actually between: those whose text states one of the
 * competing definitions. Distinct and sorted, so a node that says the same thing
 * twice is named once and the order depends on nothing but the content.
 */
function conflictingNodeIdsOf(definitions: readonly QuantityDefinitionRecord[]): string[] {
	return [...new Set(definitions.map((definition) => definition.nodeId))].sort();
}

function selfContradictingNodeIdsOf(definitions: readonly QuantityDefinitionRecord[]): string[] {
	const bodiesByNodeId = new Map<string, Set<string>>();
	for (const definition of definitions) {
		const bodies = bodiesByNodeId.get(definition.nodeId);
		if (bodies === undefined) {
			bodiesByNodeId.set(definition.nodeId, new Set([definition.bodyKey]));
		} else {
			bodies.add(definition.bodyKey);
		}
	}

	return [...bodiesByNodeId]
		.filter(([, bodies]) => bodies.size > 1)
		.map(([nodeId]) => nodeId)
		.sort();
}

export function computeDataflowDiagnostics(
	index: QuantityIndex,
	edges: readonly DerivedEdge[],
	options: DataflowDiagnosticsOptions = {}
): DataflowDiagnostics {
	// Read off the index's consumers rather than each node's extracted symbols:
	// consumers are the confirmed inputs, which is what a reference means here.
	const references: ReferenceDiagnostic[] = [];

	for (const entry of index.entries.values()) {
		for (const nodeId of entry.consumerNodeIds) {
			references.push({
				nodeId,
				symbol: entry.symbol,
				state: referenceState(
					entry.definerNodeIds,
					entry.textDefinerNodeIds,
					options.visibleNodeIds
				),
				definerNodeIds: [...entry.definerNodeIds],
				textDefinerNodeIds: [...entry.textDefinerNodeIds]
			});
		}
	}

	// Entry order follows whichever node was read first, so sort into an order
	// that depends on nothing but the content.
	references.sort(
		(left, right) =>
			left.nodeId.localeCompare(right.nodeId) || left.symbol.key.localeCompare(right.symbol.key)
	);

	// Only confirmed outputs are compared, since only they put a definition in the
	// index: an equation nobody claimed is a draft, and two drafts disagreeing is
	// not yet a problem with the graph.
	//
	// A conflict is disagreement, not duplication. Two nodes that both state
	// `x = 1` are saying one thing in two places, which is how a graph gets
	// written; warning about it would fire on ordinary authoring and teach people
	// to ignore the warning. Two nodes — or one node twice — that say `x = 1` and
	// `x = 2` have stated something the graph cannot satisfy.
	const conflicts: ConflictDiagnostic[] = [...index.entries.values()]
		.filter((entry) => new Set(entry.definitions.map((each) => each.bodyKey)).size > 1)
		.map((entry) => ({
			symbol: entry.symbol,
			definerNodeIds: conflictingNodeIdsOf(entry.definitions),
			selfContradictingNodeIds: selfContradictingNodeIdsOf(entry.definitions)
		}))
		.sort((left, right) => left.symbol.key.localeCompare(right.symbol.key));

	return { references, conflicts, cycles: cyclesFrom(edges) };
}

/** The reference diagnostics belonging to one node, for rendering in place. */
export function referencesForNode(
	diagnostics: DataflowDiagnostics,
	nodeId: string
): ReferenceDiagnostic[] {
	return diagnostics.references.filter((reference) => reference.nodeId === nodeId);
}
