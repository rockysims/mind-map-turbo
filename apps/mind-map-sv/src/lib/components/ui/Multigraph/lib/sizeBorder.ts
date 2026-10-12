/**
 * Maps a node's `sizeBytes` to a border-width multiplier.
 *
 * Sizes scraped from the web span six orders of magnitude, so the mapping is
 * logarithmic and bounded: every doubling of the size adds `widthPerDoubling`
 * to the factor, a node of exactly `referenceBytes` draws the configured border
 * (factor 1), and the result is clamped to `[minFactor, maxFactor]`.
 */
import { APP_CONFIG } from '$lib/appConfig';

type SizeBorderSettings = {
	/** Size that draws exactly the configured border (factor 1). */
	referenceBytes: number;
	/** Factor added each time the size doubles. */
	widthPerDoubling: number;
	/** Lower bound on the factor. */
	minFactor: number;
	/** Upper bound on the factor. */
	maxFactor: number;
};

/**
 * Border-width factor for a node of `sizeBytes`.
 *
 * Returns 1 — the configured border, unchanged — whenever there is no usable
 * size or no usable setting:
 *
 * - `sizeBytes` `undefined`, `0`, negative, `NaN` or ±`Infinity`. Zero is what a
 *   scraper writes when it could not measure, so it reads as "unknown", not
 *   "tiny".
 * - `referenceBytes` ≤ 0 or non-finite, or a non-finite `widthPerDoubling`. The
 *   settings panel's paired numeric inputs accept out-of-range values by design,
 *   so a degenerate setting must draw the default border rather than `NaN`.
 * - Bounds that leave the factor non-finite (a `NaN` bound, say).
 *
 * The clamp is order-insensitive: crossed bounds clamp to
 * `[min(minFactor, maxFactor), max(minFactor, maxFactor)]`, so dragging the
 * floor past the cap draws a flat border rather than ignoring one of them.
 *
 * Missing settings fall back to `APP_CONFIG.multigraph.sizeBorder`, read at call
 * time.
 */
export function borderWidthFactorForSize(
	sizeBytes: number | undefined,
	settings: Partial<SizeBorderSettings> = {}
): number {
	const defaults = APP_CONFIG.multigraph.sizeBorder;
	const {
		referenceBytes = defaults.referenceBytes,
		widthPerDoubling = defaults.widthPerDoubling,
		minFactor = defaults.minFactor,
		maxFactor = defaults.maxFactor
	} = settings;

	if (sizeBytes === undefined || !Number.isFinite(sizeBytes) || sizeBytes <= 0) return 1;
	if (!Number.isFinite(referenceBytes) || referenceBytes <= 0) return 1;
	if (!Number.isFinite(widthPerDoubling)) return 1;

	const raw = 1 + widthPerDoubling * Math.log2(sizeBytes / referenceBytes);
	const low = Math.min(minFactor, maxFactor);
	const high = Math.max(minFactor, maxFactor);
	const factor = Math.min(high, Math.max(low, raw));
	return Number.isFinite(factor) ? factor : 1;
}
