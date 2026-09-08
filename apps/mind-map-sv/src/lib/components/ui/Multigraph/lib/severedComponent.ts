import type { MultigraphData } from '../../types/multigraph';
import { hopsFromPinned } from './layout';

/**
 * What a mutation did to the nodes around it: did some of them lose their last
 * route to a pinned node, and is there still one that did not?
 *
 * The question a removal has to answer twice — once for a deleted node's
 * neighbours, once for a removed edge's endpoints — and the two call sites used
 * to answer it with the same six lines each. The rule is subtle enough
 * (removing one of two parallel edges severs nothing; deleting the last pinned
 * node orphans everything at once) that it deserves one tested home rather than
 * two copies drifting apart.
 */
interface SeveredComponent {
	/**
	 * A candidate that can still be reached from some pinned node, or null when
	 * none can. It is the node the reveal wave is played from, so that the
	 * orphaned side fades down to its beacon instead of popping.
	 */
	survivorNodeId: string | null;
	/**
	 * True when the mutation left at least one candidate with no route to any
	 * pinned node: the case that creates a pinless component, and so the case
	 * worth hinting a beacon about.
	 *
	 * Deliberately not conditioned on a survivor. Deleting the only pinned node
	 * orphans every candidate at once — there is nobody left to play a reveal
	 * wave from, but the beacon election still has to be told where the reader
	 * was looking, or the component elects an anchor somewhere off screen and the
	 * canvas reads as empty.
	 */
	severed: boolean;
}

export function severedComponentAfterMutation(
	graphAfterMutation: MultigraphData,
	candidateNodeIds: readonly string[]
): SeveredComponent {
	const hops = hopsFromPinned(graphAfterMutation);
	return {
		survivorNodeId: candidateNodeIds.find((id) => Number.isFinite(hops[id])) ?? null,
		severed: candidateNodeIds.some((id) => !Number.isFinite(hops[id]))
	};
}
