import type { MultigraphData } from '../../types/multigraph';
import { hopsFromPinned } from './layout';

/**
 * What a mutation did to the nodes around it: did some of them lose their last
 * route to a pinned node, and is there still one that did not?
 *
 * The question a removal has to answer twice — once for a deleted node's
 * neighbours, once for a removed edge's endpoints — and the two call sites used
 * to answer it with the same six lines each. The rule is subtle enough (a
 * *severing* removal is the only one that creates a pinless component worth
 * hinting a beacon about; removing one of two parallel edges severs nothing)
 * that it deserves one tested home rather than two copies drifting apart.
 */
interface SeveredComponent {
	/**
	 * A candidate that can still be reached from some pinned node, or null when
	 * none can. It is the node the reveal wave is played from, so that the
	 * orphaned side fades down to its beacon instead of popping.
	 */
	survivorNodeId: string | null;
	/**
	 * True only when the mutation left the candidates on both sides of the cut:
	 * one still reachable, at least one no longer. With every candidate reachable
	 * nothing was severed; with none reachable there is nowhere to play the wave
	 * from.
	 */
	severed: boolean;
}

export function severedComponentAfterMutation(
	graphAfterMutation: MultigraphData,
	candidateNodeIds: readonly string[]
): SeveredComponent {
	const hops = hopsFromPinned(graphAfterMutation);
	const survivorNodeId = candidateNodeIds.find((id) => Number.isFinite(hops[id])) ?? null;
	return {
		survivorNodeId,
		severed: survivorNodeId !== null && candidateNodeIds.some((id) => !Number.isFinite(hops[id]))
	};
}
