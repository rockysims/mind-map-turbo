/**
 * Width fitting for display equations.
 *
 * The focus surface deliberately has no scroll container, so an equation wider
 * than its column would be lost rather than scrollable. Scaling it down keeps it
 * readable and keeps wheel input reaching the zoom world underneath.
 */

/**
 * Scale factor that fits `naturalWidth` into `availableWidth`, never enlarging.
 *
 * Returns 1 for any degenerate measurement, so an element measured before layout
 * renders at its natural size instead of collapsing to nothing.
 */
export function fitScale(availableWidth: number, naturalWidth: number): number {
	if (!Number.isFinite(availableWidth) || !Number.isFinite(naturalWidth)) {
		return 1;
	}
	if (availableWidth <= 0 || naturalWidth <= 0) {
		return 1;
	}
	return Math.min(1, availableWidth / naturalWidth);
}
