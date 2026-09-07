/**
 * What one wheel over the zoom world means when a scroller sits inside it.
 *
 * Focus mode reads by zooming: `ZoomWorld` swallows every wheel and moves the
 * world with it. That is the right default for a page of prose, and the wrong
 * one for a surface taller than the frame — the AI workbench with several input
 * files puts its Run controls below the frame, where the world's pan clamp
 * cannot reach them. So one kind of element is allowed to claim the wheel: a
 * marked (`data-zoom-scroll`) scroll container inside the world.
 *
 * ## The three answers
 *
 * A marked scroller with room left in the wheel's direction takes it, and the
 * browser scrolls natively (`scroll`). At either end of that scroller the wheel
 * comes back — and the world takes it and does nothing (`swallow`):
 *
 * - Wheel-in (`deltaY < 0`, which also scrolls *up*) exhausted at the top:
 *   magnifying a page of controls is never what that gesture meant. The one
 *   exception is a descendable image under the cursor — that is the gesture
 *   that opens a plot in the output grid into its own zoom level, so it still
 *   `zoom`s.
 * - Wheel-out (`deltaY > 0`, which also scrolls *down*) exhausted at the
 *   bottom: swallowed too. **Once the reader is inside a scrollable surface,
 *   the wheel never leaves deep zoom.** Close — the button, or Escape — is what
 *   leaves. This started as a timed pause against trackpad momentum, and a
 *   resistance factor on top of it, and both were tuning knobs on a gesture the
 *   reader did not want in the first place: a wheel at the end of a scroll is
 *   the end of a scroll, not a request to close what you are reading.
 *
 * With no marked scroller in the chain, every wheel is a `zoom`, exactly as
 * before any of this existed.
 *
 * The decision is stated over plain data so it can be specced without a DOM;
 * `nestedScrollChain` is the one-line adapter that reads that data off real
 * elements. Deltas are in pixels — the caller normalizes with
 * `wheelDeltaPixels` first — so a mouse wheel reporting lines and a trackpad
 * reporting pixels are judged on the same scale.
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
 * Who the wheel belongs to.
 *
 * - `scroll`: the browser's — return without `preventDefault`.
 * - `swallow`: the world's, and it does nothing with it — `preventDefault`, no
 *   zoom, and any in-flight exit scrub goes back to zero.
 * - `zoom`: the world's, on the usual terms.
 */
type NestedWheelDecision = 'scroll' | 'swallow' | 'zoom';

/** Everything the decision reads about one wheel. */
export interface NestedWheelInput {
	/** The wheel's target's ancestors, outward, stopping before the world. */
	chain: NestedScrollCandidate[];
	/** Pixel delta: negative zooms in and scrolls up, positive out and down. */
	deltaY: number;
	/** Whether a zoom-in here would descend into an image rather than magnify. */
	descendableImageUnderCursor: boolean;
}

export function nestedWheelDecision(input: NestedWheelInput): NestedWheelDecision {
	const { chain, deltaY, descendableImageUnderCursor } = input;
	// No direction to scroll in, so nothing to hand over; the world's zoom math
	// makes the same nothing of it.
	if (deltaY === 0) return 'zoom';
	// The nearest marked scroller that can still move wins — one at its end is
	// passed over rather than ending the walk, so a scrollable pane nested inside
	// another hands the wheel outward before it hands it to the world.
	if (chain.some((candidate) => canScrollBy(candidate, deltaY))) return 'scroll';
	if (!holdsMarkedScroller(chain)) return 'zoom';
	// Both ends of the scroll are the world's and neither moves it, bar the one
	// zoom-in that opens a plot rather than magnifying the page it sits on.
	return deltaY < 0 && descendableImageUnderCursor ? 'zoom' : 'swallow';
}

/**
 * Whether the chain holds a marked element that is really a scroll container
 * with something to scroll. A marked box whose content fits is not one: it has
 * no ends to be at, so every wheel over it is the world's, as it always was.
 */
export function holdsMarkedScroller(chain: NestedScrollCandidate[]): boolean {
	return chain.some(
		(candidate) =>
			isMarkedScroller(candidate) && candidate.scrollHeight - candidate.clientHeight > 1
	);
}

function isMarkedScroller(candidate: NestedScrollCandidate): boolean {
	return candidate.marked && (candidate.overflowY === 'auto' || candidate.overflowY === 'scroll');
}

/**
 * Whether this element can still move in the wheel's direction. The one-pixel
 * slack in the bottom test is for fractional layout heights, where
 * `scrollTop + clientHeight` lands just shy of `scrollHeight` at the very end.
 */
function canScrollBy(candidate: NestedScrollCandidate, deltaY: number): boolean {
	if (!isMarkedScroller(candidate)) return false;
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
