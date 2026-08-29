/**
 * Narrow the graph-wide diagnostics down to what one node should say about
 * itself.
 *
 * Every item here traces back to something the author confirmed — an input this
 * node needs or an output it claims — so each one is worth interrupting them
 * about. Symbols the parser merely noticed belong to the chips, not here.
 *
 * Ordered so the actionable states come first: an unconfirmed quantity is one
 * tap from resolved, an unresolved one is an invitation to extend the graph, an
 * out-of-view one is only a navigation hop, and a conflict is a judgement call
 * the author has to make.
 */

import {
	referencesForNode,
	type DataflowDiagnostics,
	type ReferenceDiagnostic,
	type ReferenceState
} from './dataflowDiagnostics';

export type QuantityDiagnosticState =
	| Exclude<ReferenceState, 'resolved'>
	| 'conflict'
	| 'self-conflict';

export interface QuantityDiagnosticItem {
	key: string;
	label: string;
	state: QuantityDiagnosticState;
	/**
	 * Nodes to act on: the definers for `out-of-view`, the *other* definers for
	 * `conflict`, and for `unconfirmed` the nodes whose text already states this
	 * quantity — the ones a confirmation would point at. Empty for `unresolved`
	 * and for `self-conflict`, where in both cases there is nowhere else to go,
	 * which is the point of each state.
	 */
	nodeIds: string[];
}

export interface NodeDiagnosticsView {
	items: QuantityDiagnosticItem[];
	/** Other nodes this one is mutually dependent with, sorted. */
	cycleNodeIds: string[];
}

const STATE_ORDER: Record<QuantityDiagnosticState, number> = {
	// First: the graph already contains the answer and is one tap from saying so,
	// which is the cheapest repair anything here can offer.
	unconfirmed: 0,
	unresolved: 1,
	'out-of-view': 2,
	// Before a cross-node conflict: this one is repairable without leaving the
	// node, whereas reconciling with another node is a judgement about both.
	'self-conflict': 3,
	conflict: 4
};

/** Which nodes this reference's repair points at, if any. */
function nodeIdsFor(reference: ReferenceDiagnostic): string[] {
	if (reference.state === 'out-of-view') {
		return [...reference.definerNodeIds];
	}
	// The nodes that already state this quantity: naming them is what turns
	// "nothing defines it" into "confirm the one that does".
	if (reference.state === 'unconfirmed') {
		return [...reference.textDefinerNodeIds];
	}
	return [];
}

export function nodeDiagnosticsView(
	diagnostics: DataflowDiagnostics,
	nodeId: string
): NodeDiagnosticsView {
	const references = referencesForNode(diagnostics, nodeId);
	const conflictedKeys = new Set(diagnostics.conflicts.map((conflict) => conflict.symbol.key));
	const items = new Map<string, QuantityDiagnosticItem>();

	for (const reference of references) {
		// A conflict outranks out-of-view: which definer applies is the open
		// question, and answering it makes the navigation question moot.
		if (conflictedKeys.has(reference.symbol.key)) {
			continue;
		}
		if (reference.state === 'resolved') {
			continue;
		}
		items.set(reference.symbol.key, {
			key: reference.symbol.key,
			label: reference.symbol.label,
			state: reference.state,
			nodeIds: nodeIdsFor(reference)
		});
	}

	const referencedKeys = new Set(references.map((reference) => reference.symbol.key));
	for (const conflict of diagnostics.conflicts) {
		const involved =
			conflict.definerNodeIds.includes(nodeId) || referencedKeys.has(conflict.symbol.key);
		if (!involved) {
			continue;
		}
		// When this node contradicts itself, that is the report — even if another
		// node also disagrees. Reconciling with anyone else is meaningless until
		// the node states one thing, and it is the half the reader can fix here.
		const contradictsItself = conflict.selfContradictingNodeIds.includes(nodeId);

		items.set(conflict.symbol.key, {
			key: conflict.symbol.key,
			label: conflict.symbol.label,
			state: contradictsItself ? 'self-conflict' : 'conflict',
			// Never offer to navigate to the node already being read.
			nodeIds: contradictsItself
				? []
				: conflict.definerNodeIds.filter((definerId) => definerId !== nodeId)
		});
	}

	const cycle = diagnostics.cycles.find((candidate) => candidate.nodeIds.includes(nodeId));

	return {
		items: [...items.values()].sort(
			(left, right) =>
				STATE_ORDER[left.state] - STATE_ORDER[right.state] || left.label.localeCompare(right.label)
		),
		cycleNodeIds: cycle ? cycle.nodeIds.filter((candidate) => candidate !== nodeId) : []
	};
}
