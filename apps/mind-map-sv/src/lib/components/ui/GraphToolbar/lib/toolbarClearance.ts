/**
 * The CSS custom property the toolbar publishes on `<html>`: how far from the
 * viewport's top a bottom sheet or dialog must stop so the toolbar never covers
 * it. Set from the toolbar row's measured box, so it follows the row as it wraps
 * to two or three lines on a phone, rather than from a guessed height.
 */
export const TOOLBAR_CLEARANCE_PROPERTY = '--graph-toolbar-clearance';

/**
 * The clearance for a toolbar row whose viewport box is `box`: its bottom edge
 * plus the same gap it keeps above itself, so a capped panel sits as far below
 * the toolbar as the toolbar sits below the screen's edge. Rounded up to a whole
 * pixel, so a fractional box never leaves a hairline of overlap.
 */
export function toolbarClearancePx(box: { top: number; bottom: number }): number {
	return Math.ceil(box.bottom + Math.max(0, box.top));
}
