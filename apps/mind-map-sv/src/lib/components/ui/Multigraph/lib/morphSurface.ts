/**
 * Pure math for the morph surface's two content layers.
 *
 * Each content layer is laid out ONCE at a fixed logical base size and then
 * `transform: scale()`-ed (top-left origin) to the current frame size. Only
 * the scale factor and the crossfade opacity change while the frame morphs —
 * the base layout never re-flows. These helpers own that arithmetic so the
 * component stays a thin wiring layer.
 */

/**
 * Scale factor that maps a content layer laid out at `baseSizePx` onto the
 * current `frameSizePx`. Returns 0 for a non-positive base so a mis-configured
 * layer collapses instead of dividing by zero / producing NaN.
 */
export function contentLayerScale(frameSizePx: number, baseSizePx: number): number {
	if (!(baseSizePx > 0)) return 0;
	return frameSizePx / baseSizePx;
}

export interface CrossfadeOpacity {
	compact: number;
	details: number;
}

/**
 * Crossfade the compact layer out (1 → 0) and the details layer in (0 → 1) as
 * progress advances. Progress is clamped so callers can pass raw scrub values.
 */
export function crossfadeOpacity(progress: number): CrossfadeOpacity {
	const p = clamp01(progress);
	return { compact: 1 - p, details: p };
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}
