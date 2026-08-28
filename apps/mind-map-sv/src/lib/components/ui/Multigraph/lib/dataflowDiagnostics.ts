/**
 * Report what is wrong, or merely hidden, in a graph's dataflow.
 *
 * The three reference states are deliberately distinct. A quantity whose definer
 * is simply scrolled out of the visible neighborhood is not a mistake, and
 * showing it the same way as a genuinely undefined symbol would train people to
 * ignore both.
 */

import type { QuantitySymbol } from '../../MathText/lib/mathSymbols';
import type { DerivedEdge } from './derivedEdges';
import type { QuantityIndex } from './quantityIndex';

export type ReferenceState =
	/** Defined by a node that is currently on screen. */
	| 'resolved'
	/** Defined somewhere, but every definer is outside the visible neighborhood. */
	| 'out-of-view'
	/** Defined by no node anywhere. An invitation to extend the graph. */
	| 'unresolved';

export interface ReferenceDiagnostic {
	nodeId: string;
	symbol: QuantitySymbol;
	state: ReferenceState;
	/** Nodes defining this quantity. Empty exactly when unresolved. */
	definerNodeIds: string[];
}

export interface ConflictDiagnostic {
	symbol: QuantitySymbol;
	/** The competing definers, always two or more. */
	definerNodeIds: string[];
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
	visibleNodeIds: ReadonlySet<string> | undefined
): ReferenceState {
	if (definerNodeIds.length === 0) {
		return 'unresolved';
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

export function computeDataflowDiagnostics(
	index: QuantityIndex,
	edges: readonly DerivedEdge[],
	options: DataflowDiagnosticsOptions = {}
): DataflowDiagnostics {
	const references: ReferenceDiagnostic[] = [];

	for (const [nodeId, quantities] of index.byNodeId) {
		for (const symbol of quantities.references) {
			const definerNodeIds = index.entries.get(symbol.key)?.definerNodeIds ?? [];
			references.push({
				nodeId,
				symbol,
				state: referenceState(definerNodeIds, options.visibleNodeIds),
				definerNodeIds: [...definerNodeIds]
			});
		}
	}

	const conflicts: ConflictDiagnostic[] = [...index.entries.values()]
		.filter((entry) => entry.definerNodeIds.length > 1)
		.map((entry) => ({ symbol: entry.symbol, definerNodeIds: [...entry.definerNodeIds] }))
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
