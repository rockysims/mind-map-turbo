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

export type QuantityDiagnosticState = Exclude<ReferenceState, 'resolved'> | 'conflict';

export interface QuantityDiagnosticItem {
	key: string;
	label: string;
	state: QuantityDiagnosticState;
	/**
	 * Nodes to reach for `out-of-view`, or the competing definers for `conflict`.
	 * Empty for `unresolved`, which is the state's defining property.
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
	conflict: 2
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
		items.set(conflict.symbol.key, {
			key: conflict.symbol.key,
			label: conflict.symbol.label,
			state: 'conflict',
			nodeIds: [...conflict.definerNodeIds]
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
