/**
 * What makes two graphs the same document, and what a restore does about the
 * difference.
 *
 * The whole history rests on one property of the house immutability rule: every
 * layout write ends in `mergeVisiblePositions`, which spreads the graph and
 * replaces `posByNodeId` alone. So the semantic collections come through by
 * reference, and "did this commit change the document?" is five pointer
 * comparisons rather than a fingerprint of the whole graph — which matters,
 * because the question is asked on the drag path sixty times a second.
 *
 * The invariant is implicit and load-bearing: it holds only while every layout
 * write preserves those references. `graphIdentity.spec.ts` asserts it after a
 * real `relaxAfterMutation`, and a failure there is a design change to
 * understand, not a test to update.
 *
 * One known exception, stated here so nobody rediscovers it in a panic: the
 * document-swap ingest in `Multigraph.svelte` writes
 * `{ ...incoming, posByNodeId: settledLayoutGraph.posByNodeId }` without going
 * through `mergeVisiblePositions`. It still preserves `nodes` and `edges` by
 * reference, and it runs only on a `graphGeneration` change — where the history
 * has just been cleared — so it cannot corrupt an entry.
 */

import type { MultigraphData, Point } from '../../types/multigraph';

/**
 * The O(1) reference test: true when nothing but positions can have moved.
 *
 * Over-reports change by design. A mutation that rebuilds an array to an equal
 * value fails this test and is confirmed by a fingerprint before it becomes an
 * entry — O(N), but only on real edits, never on a physics frame.
 */
export function semanticallyUnchanged(prev: MultigraphData, next: MultigraphData): boolean {
	return (
		prev.nodes === next.nodes &&
		prev.edges === next.edges &&
		prev.tagColorConfig === next.tagColorConfig &&
		prev.assets === next.assets &&
		prev.pinSequence === next.pinSequence
	);
}

/**
 * The document, without its layout: what the reference test's over-reporting is
 * confirmed against before a commit becomes an entry.
 *
 * Deliberately excludes `posByNodeId`. A mutation that rebuilds an array to an
 * equal value fails the reference test, and its commit relaxes afterwards — so
 * comparing whole graphs would call the relax a change and record an entry for
 * an edit that did nothing. O(N), but only ever on a commit that already passed
 * the O(1) gate, never on a physics frame.
 */
export function semanticFingerprint(graph: MultigraphData): string {
	return JSON.stringify({
		nodes: graph.nodes,
		edges: graph.edges,
		tagColorConfig: graph.tagColorConfig,
		assets: graph.assets,
		pinSequence: graph.pinSequence
	});
}

/**
 * Where the nodes `next` no longer has were standing.
 *
 * Only the persisted delta needs this. An in-memory entry is a snapshot and
 * carries every position as of its moment, so nothing has to be captured on the
 * side; a delta is precisely the format that leaves whole position maps out, and
 * a resurrected node still has to land somewhere.
 */
export function removedNodePositions(
	prev: MultigraphData,
	next: MultigraphData
): Record<string, Point> {
	const survivingIds = new Set(next.nodes.map((node) => node.id));
	const positions: Record<string, Point> = {};
	for (const node of prev.nodes) {
		if (survivingIds.has(node.id)) continue;
		const position = prev.posByNodeId[node.id];
		if (position !== undefined) positions[node.id] = position;
	}
	return positions;
}

/**
 * The snapshot's document, at the positions the canvas is at now.
 *
 * Restoring `posByNodeId` wholesale would drag the entire canvas back to where
 * the simulation had it several seconds ago, for an edit that touched one node.
 * So: a node in both graphs keeps the position it currently occupies, a node
 * only the snapshot has takes the one it had when the snapshot was recorded —
 * which is how an undone deletion grows back where it was rather than at the
 * origin — and a `posByNodeId` key naming a node in neither is dropped instead
 * of accumulating forever.
 *
 * Everything else comes from the snapshot by reference, spread first so an
 * optional field the snapshot never had (`assets`, `pinSequence`) stays absent
 * rather than inheriting the current graph's.
 */
export function restoreSemantics(
	current: MultigraphData,
	snapshot: MultigraphData
): MultigraphData {
	const currentNodeIds = new Set(current.nodes.map((node) => node.id));
	const posByNodeId: Record<string, Point> = {};

	for (const node of snapshot.nodes) {
		const position = currentNodeIds.has(node.id)
			? (current.posByNodeId[node.id] ?? snapshot.posByNodeId[node.id])
			: snapshot.posByNodeId[node.id];
		if (position !== undefined) posByNodeId[node.id] = position;
	}

	return { ...snapshot, posByNodeId };
}
