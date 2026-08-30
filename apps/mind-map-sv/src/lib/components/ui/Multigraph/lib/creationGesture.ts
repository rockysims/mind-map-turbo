/**
 * Pure decision logic for the drag-from-node gesture (double-click-drag or
 * menu-armed hover). Shared by Stage's release handling for both entry paths.
 *
 * One skeleton, two aims: `create` grows the graph (a new node, or an edge to
 * the node dropped on), `merge` folds the dragged node into the node dropped on.
 * The mode is the only thing that differs — arming, tracking and hit testing are
 * the same gesture — so it travels as a flag rather than as a second machine.
 */

/** Which mutation a drag-from-node gesture is aimed at. */
export type NodeGestureMode = 'create' | 'merge';

export type CreationDropAction =
	| { kind: 'create-node-and-edge' }
	| { kind: 'connect-to-node'; targetNodeId: string }
	| { kind: 'merge-into-node'; targetNodeId: string }
	| { kind: 'cancel' };

/**
 * Resolve what releasing the gesture does, given the drop hit-test result.
 *
 * A merge has nothing to say about empty canvas — there is no node there to
 * absorb into — so background releases cancel instead of creating anything.
 */
export function resolveCreationDrop(
	sourceNodeId: string,
	dropTargetNodeId: string | null,
	mode: NodeGestureMode = 'create'
): CreationDropAction {
	if (dropTargetNodeId === null) {
		return mode === 'merge' ? { kind: 'cancel' } : { kind: 'create-node-and-edge' };
	}
	if (dropTargetNodeId === sourceNodeId) return { kind: 'cancel' };
	return mode === 'merge'
		? { kind: 'merge-into-node', targetNodeId: dropTargetNodeId }
		: { kind: 'connect-to-node', targetNodeId: dropTargetNodeId };
}

/**
 * Preview node is shown only while a creation gesture is over background (no
 * node hovered). A merge never creates a node, so it never previews one.
 */
export function shouldShowCreationPreviewNode(
	hoverNodeId: string | null,
	mode: NodeGestureMode = 'create'
): boolean {
	return mode === 'create' && hoverNodeId === null;
}
