/**
 * Whether a compact node has room to name the quantities it defines.
 *
 * The canvas has no level-of-detail mechanism, so this is the first one. It has
 * to exist because the same node spans roughly 7px to 550px on screen depending
 * on how far it sits from a pinned node and how far the user has zoomed, and
 * chips are unreadable across most of that range.
 */

export interface QuantityChipVisibilityOptions {
	/** On-screen node diameter below which chips are hidden, in CSS pixels. */
	minOnScreenDiameterPx?: number;
	/** Chips named before the rest collapse into a count. */
	maxVisible?: number;
}

/**
 * Gated on the node's effective on-screen size rather than on zoom alone,
 * because a distant node stays small however far the user zooms in.
 */
export function shouldShowQuantityChips(
	nodeDiameterPx: number,
	nodeScale: number,
	stageScale: number,
	options: QuantityChipVisibilityOptions = {}
): boolean {
	const { minOnScreenDiameterPx = 180 } = options;
	const onScreenDiameter = nodeDiameterPx * nodeScale * stageScale;

	// A pre-layout frame can report zero or NaN for scale; showing chips then
	// would flash them at the wrong size before the first real measurement.
	if (!Number.isFinite(onScreenDiameter)) {
		return false;
	}
	return onScreenDiameter >= minOnScreenDiameterPx;
}

export interface QuantityChips {
	labels: string[];
	/** Quantities not named, or zero when they all fit. */
	overflowCount: number;
}

/** Name the first few quantities and count the rest, so a prolific node stays legible. */
export function quantityChips(
	labels: readonly string[],
	options: QuantityChipVisibilityOptions = {}
): QuantityChips {
	const { maxVisible = 3 } = options;
	if (maxVisible < 1) {
		return { labels: [], overflowCount: labels.length };
	}
	return {
		labels: labels.slice(0, maxVisible),
		overflowCount: Math.max(0, labels.length - maxVisible)
	};
}
