/**
 * Maps one number about a node to a border-width multiplier.
 *
 * The numbers a border can show (bytes, counts, lengths, an importer's weight)
 * span orders of magnitude, so the mapping is logarithmic and bounded: every
 * doubling of the value adds `widthPerDoubling` to the factor, a node at exactly
 * `reference` draws the configured border (factor 1), and the result is clamped
 * to `[minFactor, maxFactor]`.
 */
import { APP_CONFIG } from '$lib/appConfig';
import type { NodeData } from '../../types/node';
import { nodeBorderValue } from './nodeWeight';

type CurveSettings = {
	/** Factor added each time the value doubles. */
	widthPerDoubling: number;
	/** Lower bound on the factor. */
	minFactor: number;
	/** Upper bound on the factor. */
	maxFactor: number;
};

/** The sources that read a number off a node, each with its own reference. */
type ReferencedSource = 'size' | 'weight' | 'degree' | 'attachments' | 'descriptionLength';

/** Per source, the value that draws exactly the configured border. */
type BorderReference = Readonly<Record<ReferencedSource, number>>;

/**
 * Border-width factor for a node whose chosen source reads `value`.
 *
 * - `0` is a real value: `log2(0)` is −∞, so it lands on the floor,
 *   `min(minFactor, maxFactor)`. Under a count source an isolated node must not
 *   draw a thicker border than a leaf with one edge.
 * - `undefined` ("no value"), negative, `NaN` and ±`Infinity` return 1 — the
 *   configured border, unchanged.
 * - A degenerate setting returns 1: `reference` ≤ 0 or non-finite, or a
 *   non-finite `widthPerDoubling`. The settings panel's paired numeric inputs
 *   accept out-of-range values by design, so a degenerate setting must draw the
 *   default border rather than `NaN`. A slope of 0 also gives 1 everywhere,
 *   including at 0, because `0 × −∞` is `NaN` and the non-finite guard catches it.
 * - Bounds that leave the factor non-finite (a `NaN` bound, say) return 1.
 *
 * The clamp is order-insensitive: crossed bounds clamp to
 * `[min(minFactor, maxFactor), max(minFactor, maxFactor)]`, so dragging the
 * floor past the cap draws a flat border rather than ignoring one of them.
 *
 * `reference` is required because it depends on the source. Missing slope and
 * bounds fall back to `APP_CONFIG.multigraph.borderWeight`, read at call time.
 */
export function borderWidthFactorForValue(
	value: number | undefined,
	settings: { reference: number } & Partial<CurveSettings>
): number {
	const defaults = APP_CONFIG.multigraph.borderWeight;
	const {
		reference,
		widthPerDoubling = defaults.widthPerDoubling,
		minFactor = defaults.minFactor,
		maxFactor = defaults.maxFactor
	} = settings;

	if (value === undefined || !Number.isFinite(value) || value < 0) return 1;
	if (!Number.isFinite(reference) || reference <= 0) return 1;
	if (!Number.isFinite(widthPerDoubling)) return 1;

	const raw = 1 + widthPerDoubling * Math.log2(value / reference);
	const low = Math.min(minFactor, maxFactor);
	const high = Math.max(minFactor, maxFactor);
	const factor = Math.min(high, Math.max(low, raw));
	return Number.isFinite(factor) ? factor : 1;
}

function isReferencedSource(
	source: string,
	reference: BorderReference
): source is ReferencedSource {
	// Own keys only, so `'toString'` and friends are not sources.
	return Object.prototype.hasOwnProperty.call(reference, source);
}

/**
 * Border-width factor for `node` under the graph's border settings.
 *
 * `borderWeight.source` picks the number (`nodeBorderValue`), and
 * `borderReference[source]` is the value that draws the configured border.
 * `'none'` and any unknown source give 1. `degrees` comes from
 * `authoredDegrees` and is only read under `'degree'`, so a caller may pass an
 * empty map under every other source.
 */
export function borderFactorForNode(
	node: NodeData,
	degrees: ReadonlyMap<string, number>,
	borderWeight: { source: string } & CurveSettings,
	borderReference: BorderReference
): number {
	const { source, widthPerDoubling, minFactor, maxFactor } = borderWeight;
	if (!isReferencedSource(source, borderReference)) return 1;
	return borderWidthFactorForValue(nodeBorderValue(node, source, degrees), {
		reference: borderReference[source],
		widthPerDoubling,
		minFactor,
		maxFactor
	});
}
