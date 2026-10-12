/**
 * Maps one number about a node to a border-width multiplier, on the scale its
 * source names.
 *
 * - **Linear** (node weight, edge count): the factor is `value / reference`, so
 *   twice the reference draws twice the border. These numbers sit in a narrow
 *   range where a reader compares them directly.
 * - **Logarithmic** (attachment size, description length): every doubling of
 *   the value adds `widthPerDoubling` to the factor. Bytes and characters span
 *   orders of magnitude, so a linear scale would pin almost every node to a bound.
 *
 * On both scales a node at exactly `reference` draws the configured border
 * (factor 1), a value of 0 draws the thinnest border, and the factor is clamped
 * to `[minFactor, maxFactor]`.
 */
import { APP_CONFIG } from '$lib/appConfig';
import type { NodeData } from '../../types/node';
import { nodeBorderValue, type BorderInputs } from './nodeWeight';

type Bounds = {
	/** Lower bound on the factor. */
	minFactor: number;
	/** Upper bound on the factor. */
	maxFactor: number;
};

type LogSettings = Bounds & {
	/** Factor added each time the value doubles. */
	widthPerDoubling: number;
};

/** Which scale each source that reads a number off a node is drawn on. */
const SCALE_BY_SOURCE = {
	weight: 'linear',
	degree: 'linear',
	attachmentBytes: 'log',
	descriptionLength: 'log'
} as const satisfies Record<string, 'linear' | 'log'>;

type ReferencedSource = keyof typeof SCALE_BY_SOURCE;

/** Per source, the value that draws exactly the configured border. */
type BorderReference = Readonly<Record<ReferencedSource, number>>;

/**
 * Clamps `raw` to the bounds, whichever way round they are given: crossed
 * bounds clamp to `[min, max]` of the two, so dragging the floor past the cap
 * draws a flat border rather than ignoring one of them. A factor left
 * non-finite (a `NaN` bound or `raw`, say) gives 1.
 */
function clampFactor(raw: number, { minFactor, maxFactor }: Bounds): number {
	const low = Math.min(minFactor, maxFactor);
	const high = Math.max(minFactor, maxFactor);
	const factor = Math.min(high, Math.max(low, raw));
	return Number.isFinite(factor) ? factor : 1;
}

/**
 * Whether `value` and `reference` can be drawn at all. `undefined` ("no
 * value"), negative, `NaN` and ±`Infinity` values draw the configured border,
 * and so does a `reference` ≤ 0 or non-finite: the settings panel's paired
 * numeric inputs accept out-of-range values by design, so a degenerate setting
 * must draw the default border rather than `NaN`.
 */
function isDrawable(value: number | undefined, reference: number): value is number {
	if (value === undefined || !Number.isFinite(value) || value < 0) return false;
	return Number.isFinite(reference) && reference > 0;
}

/** Missing bounds fall back to `APP_CONFIG.multigraph.borderWeight`, read at call time. */
function boundsWithDefaults(settings: Partial<Bounds>): Bounds {
	const defaults = APP_CONFIG.multigraph.borderWeight;
	return {
		minFactor: settings.minFactor ?? defaults.minFactor,
		maxFactor: settings.maxFactor ?? defaults.maxFactor
	};
}

/**
 * Linear border-width factor: `value / reference`, clamped.
 *
 * `0` is a real value and lands on the floor, `min(minFactor, maxFactor)`.
 * Values and references that cannot be drawn give 1 (see `isDrawable`), as do
 * bounds that leave the factor non-finite.
 */
export function linearBorderFactor(
	value: number | undefined,
	settings: { reference: number } & Partial<Bounds>
): number {
	if (!isDrawable(value, settings.reference)) return 1;
	return clampFactor(value / settings.reference, boundsWithDefaults(settings));
}

/**
 * Logarithmic border-width factor:
 * `1 + widthPerDoubling × log2(value / reference)`, clamped.
 *
 * - `0` is a real value: `log2(0)` is −∞, so it lands on the floor. An empty
 *   description or a node with nothing attached draws the thinnest border.
 * - Values and references that cannot be drawn give 1 (see `isDrawable`), and
 *   so does a non-finite `widthPerDoubling`. A slope of 0 gives 1 everywhere,
 *   including at 0, because `0 × −∞` is `NaN` and the clamp's guard catches it.
 *
 * Missing slope and bounds fall back to `APP_CONFIG.multigraph.borderWeight`.
 */
export function logBorderFactor(
	value: number | undefined,
	settings: { reference: number } & Partial<LogSettings>
): number {
	const widthPerDoubling =
		settings.widthPerDoubling ?? APP_CONFIG.multigraph.borderWeight.widthPerDoubling;
	if (!isDrawable(value, settings.reference)) return 1;
	if (!Number.isFinite(widthPerDoubling)) return 1;
	const raw = 1 + widthPerDoubling * Math.log2(value / settings.reference);
	return clampFactor(raw, boundsWithDefaults(settings));
}

function isReferencedSource(source: string): source is ReferencedSource {
	// Own keys only, so `'toString'` and friends are not sources.
	return Object.prototype.hasOwnProperty.call(SCALE_BY_SOURCE, source);
}

/**
 * Border-width factor for `node` under the graph's border settings.
 *
 * `borderWeight.source` picks the number (`nodeBorderValue`) and its scale,
 * and `borderReference[source]` is the value that draws the configured border.
 * `widthPerDoubling` only applies to the logarithmic sources. `'none'` and any
 * unknown source give 1. `inputs` is read only by the computed sources (see
 * `nodeBorderValue`), so a caller may pass empty ones under every other source.
 */
export function borderFactorForNode(
	node: NodeData,
	inputs: BorderInputs,
	borderWeight: { source: string } & LogSettings,
	borderReference: BorderReference
): number {
	const { source, widthPerDoubling, minFactor, maxFactor } = borderWeight;
	if (!isReferencedSource(source)) return 1;
	const value = nodeBorderValue(node, source, inputs);
	const reference = borderReference[source];
	return SCALE_BY_SOURCE[source] === 'linear'
		? linearBorderFactor(value, { reference, minFactor, maxFactor })
		: logBorderFactor(value, { reference, widthPerDoubling, minFactor, maxFactor });
}
