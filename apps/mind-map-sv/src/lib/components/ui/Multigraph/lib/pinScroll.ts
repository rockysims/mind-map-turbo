/**
 * Keeping a clipping box at its origin.
 *
 * The deep-zoom frame clips: `.deep-zoom-default-frame`, `NodeChrome`'s
 * `.circle` when it is the frame, the image frame beside it, and the frozen
 * level under the active one are all `overflow: hidden` boxes whose content
 * layers are absolutely positioned inside them and scaled by a transform. None
 * of them is a scroller, and none of them has a scrollbar — but
 * `overflow: hidden` is only "no scrollbar and no user scrolling", not "not
 * scrollable". A script, or the browser itself, can still move the box.
 *
 * The browser does exactly that. Focus a control anywhere inside the frame and
 * every scrollable ancestor is scrolled to bring it into view; inside a layer
 * that is laid out at one size and drawn at another the arithmetic lands far
 * off, and nothing scrolls the box back afterwards. A reader pressed Replace on
 * a file row — a `<label>` over a 1×1 px file input, which took focus — and the
 * frame scrolled 1863 px: the content layer left through the top of the frame
 * and everything inside deep zoom went blank, with no error to say so. It
 * depended on the window's size, which is why it only ever happened to one
 * person.
 *
 * The picker no longer moves focus (see `AiNodeContent`), so the known trigger
 * is gone. This is the guard that does not depend on knowing the trigger: an
 * `overflow: hidden` box fires `scroll` when something scrolls it, and the one
 * thing these boxes have to say about being scrolled is "no".
 */

/** The pair of numbers a scroll position is, on anything that holds one. */
type ScrollPosition = { scrollTop: number; scrollLeft: number };

/**
 * Put a clipping box back at its origin.
 *
 * Each axis is written only when it is off origin: a `scroll` handler that
 * assigns unconditionally is a handler that can re-enter itself, and the frames
 * this runs on are scrolled by accident or not at all.
 *
 * A missing box is not an error — the caller is an event handler, and its
 * target is whatever the DOM handed it.
 */
export function pinScrollToOrigin(box: ScrollPosition | null | undefined): void {
	if (!box) return;
	if (box.scrollTop !== 0) box.scrollTop = 0;
	if (box.scrollLeft !== 0) box.scrollLeft = 0;
}
