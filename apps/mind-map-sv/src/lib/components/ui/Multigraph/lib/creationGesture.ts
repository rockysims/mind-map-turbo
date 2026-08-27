/**
 * Pure decision logic for the node/edge creation gesture (double-click-drag or
 * menu-armed hover). Shared by Stage's release handling for both entry paths.
 */

export type CreationDropAction =
	| { kind: 'create-node-and-edge' }
	| { kind: 'connect-to-node'; targetNodeId: string }
	| { kind: 'cancel' };

/** Resolve what releasing the creation gesture does, given the drop hit-test result. */
export function resolveCreationDrop(
	sourceNodeId: string,
	dropTargetNodeId: string | null
): CreationDropAction {
	if (dropTargetNodeId === null) return { kind: 'create-node-and-edge' };
	if (dropTargetNodeId === sourceNodeId) return { kind: 'cancel' };
	return { kind: 'connect-to-node', targetNodeId: dropTargetNodeId };
}

/** Preview node is shown only while the cursor is over background (no node hovered). */
export function shouldShowCreationPreviewNode(hoverNodeId: string | null): boolean {
	return hoverNodeId === null;
}
