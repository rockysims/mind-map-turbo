/**
 * Narrow the graph-wide diagnostics down to what one node should say about
 * itself.
 *
 * Ordered so the actionable states come first: an unresolved quantity is an
 * invitation to extend the graph, an out-of-view one is only a navigation hop,
 * and a conflict is a judgement call the author has to make.
 */

import {
	referencesForNode,
	type DataflowDiagnostics,
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
	 * Nodes to reach: the definers for `out-of-view`, the *other* definers for
	 * `conflict`. Empty for `unresolved` and for `self-conflict`, where in both
	 * cases there is nowhere else to go — which is the point of each state.
	 */
	nodeIds: string[];
}

export interface NodeDiagnosticsView {
	items: QuantityDiagnosticItem[];
	/** Other nodes this one is mutually dependent with, sorted. */
	cycleNodeIds: string[];
}

const STATE_ORDER: Record<QuantityDiagnosticState, number> = {
	unresolved: 0,
	'out-of-view': 1,
	// Before a cross-node conflict: this one is repairable without leaving the
	// node, whereas reconciling with another node is a judgement about both.
	'self-conflict': 2,
	conflict: 3
};

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
			nodeIds: reference.state === 'out-of-view' ? [...reference.definerNodeIds] : []
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
