/**
 * When a wheel over the zoom world belongs to a scroller inside it instead.
 *
 * Focus mode reads by zooming: `ZoomWorld` swallows every wheel and moves the
 * world with it. That is the right default for a page of prose, and the wrong
 * one for a surface taller than the frame — the AI workbench with several input
 * files puts its Run controls below the frame, where the world's pan clamp
 * cannot reach them. So one kind of element is allowed to claim the wheel: a
 * marked (`data-zoom-scroll`) scroll container that still has somewhere to go in
 * the wheel's direction.
 *
 * The "still has somewhere to go" half is what keeps the world's gestures: a
 * scroller already at its top hands a wheel-out back, which is exactly the
 * gesture that exits focus, and one already at its bottom hands a wheel-in back
 * to the zoom. So the reader never hits a dead zone in either direction — the
 * boundary of the scroller is the boundary of the world's input.
 *
 * The decision is stated over plain data so it can be specced without a DOM;
 * `nestedScrollChain` is the one-line adapter that reads that data off real
 * elements.
 */

/** One ancestor of the wheel's target, as the decision needs to see it. */
export interface NestedScrollCandidate {
	/** The element's computed `overflow-y`. */
	overflowY: string;
	scrollTop: number;
	clientHeight: number;
	scrollHeight: number;
	/** Whether the element carries `data-zoom-scroll`. */
	marked: boolean;
}

/**
 * Whether the wheel should be left to the browser rather than zoomed.
 *
 * `chain` runs from the wheel's target outward, stopping before the world
 * element itself; `deltaY` is the wheel's vertical delta, of which only the
 * sign is read. The nearest marked scroller that can still move in that
 * direction wins — a marked scroller at its end is passed over rather than
 * ending the walk, so a scrollable pane nested inside another one hands the
 * wheel outward before it hands it to the zoom.
 *
 * It declines to yield when: the delta is zero (nothing to scroll); no ancestor
 * is marked; a marked ancestor is not actually a scroll container
 * (`overflow-y` is anything but `auto` or `scroll`); or every marked scroller is
 * already at the end the wheel points at. The one-pixel slack in the bottom test
 * is for fractional layout heights, where `scrollTop + clientHeight` lands just
 * shy of `scrollHeight` at the very bottom.
 */
export function yieldsToNestedScroll(chain: NestedScrollCandidate[], deltaY: number): boolean {
	if (deltaY === 0) return false;
	return chain.some((candidate) => canScrollBy(candidate, deltaY));
}

function canScrollBy(candidate: NestedScrollCandidate, deltaY: number): boolean {
	if (!candidate.marked) return false;
	if (candidate.overflowY !== 'auto' && candidate.overflowY !== 'scroll') return false;
	return deltaY < 0
		? candidate.scrollTop > 0
		: candidate.scrollTop + candidate.clientHeight < candidate.scrollHeight - 1;
}

/**
 * Read the chain off the DOM: every element from `target` up to but not
 * including `root`. An empty chain — `target` outside `root`, or not an element
 * at all — is the honest answer that there is no nested scroller in play.
 */
export function nestedScrollChain(
	target: EventTarget | null,
	root: Element | null
): NestedScrollCandidate[] {
	if (!(target instanceof Element) || root === null || !root.contains(target)) return [];
	const chain: NestedScrollCandidate[] = [];
	for (
		let node: Element | null = target;
		node !== null && node !== root;
		node = node.parentElement
	) {
		chain.push({
			overflowY: getComputedStyle(node).overflowY,
			scrollTop: node.scrollTop,
			clientHeight: node.clientHeight,
			scrollHeight: node.scrollHeight,
			marked: node.hasAttribute('data-zoom-scroll')
		});
	}
	return chain;
}
