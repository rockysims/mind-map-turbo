import type { EdgeData } from '../../types/edge';
import type { TagPhysicsConfig } from '../../types/multigraph';
import type { NodeData } from '../../types/node';

/**
 * The range a stored per-tag factor may take. Module constants rather than
 * `APP_CONFIG` entries: the range is part of what a saved value means, so a
 * setting that moved it would silently re-interpret every saved graph.
 */
export const TAG_PHYSICS_MIN_FACTOR = 0.25;
export const TAG_PHYSICS_MAX_FACTOR = 4;

/**
 * One slider step in log2 space: `2 ** 0.05 ≈ ×1.035`, so a step near ×1 moves
 * the factor by about 0.035.
 */
const TAG_PHYSICS_SLIDER_STEP = 0.05;

/** Stored factors carry three decimals, so position 0 lands on exactly 1. */
const FACTOR_DECIMALS = 3;

/**
 * Clamps into the stored range. A non-finite factor has no direction to clamp
 * toward and comes back as it went in; callers drop it before reaching here.
 */
export function clampTagPhysicsFactor(
	factor: number,
	min = TAG_PHYSICS_MIN_FACTOR,
	max = TAG_PHYSICS_MAX_FACTOR
): number {
	return Math.min(max, Math.max(min, factor));
}

function isUsableFactor(factor: unknown): factor is number {
	return typeof factor === 'number' && Number.isFinite(factor) && factor > 0;
}

/**
 * The factor an element gets from its tags: the geometric mean of the factors
 * of the tags that have one.
 *
 * Not the product, because `0.9 × 0.8 = 0.72` falls below both inputs — two
 * "slightly shorter" tags would make an edge much shorter than either asked
 * for. The geometric mean stays between its inputs, cancels ×2 against ×0.5,
 * and equals the shared value when every tag agrees. Tags with no stored factor
 * are left out rather than counted as 1, so an incidental tag does not dilute a
 * deliberate one; with none configured the element is unchanged (1).
 */
export function elementFactor(
	tags: readonly string[],
	factors: Readonly<Record<string, number>> | undefined
): number {
	if (!factors) return 1;

	const configured: number[] = [];
	for (const tag of new Set(tags)) {
		if (!Object.prototype.hasOwnProperty.call(factors, tag)) continue;
		const factor = factors[tag];
		if (isUsableFactor(factor)) configured.push(factor);
	}

	if (configured.length === 0) return 1;
	// Exact when every tag agrees; the log round trip below can be an ulp off.
	if (configured.every((factor) => factor === configured[0])) return configured[0];

	const meanLog2 =
		configured.reduce((sum, factor) => sum + Math.log2(factor), 0) / configured.length;
	return 2 ** meanLog2;
}

function hasEntries(record: Readonly<Record<string, number>> | undefined): boolean {
	return record !== undefined && Object.keys(record).length > 0;
}

/**
 * Stamps each edge with the `gapFactor` its tags ask for. Runs on every relax
 * frame, so it hands back the very same array when there is no edge config or
 * when no edge's factor differs from 1, and never writes `gapFactor: 1`.
 */
export function withTagGapFactors(
	edges: EdgeData[],
	config: TagPhysicsConfig | undefined
): EdgeData[] {
	const edgeTags = config?.edgeTags;
	if (!edgeTags || !hasEntries(edgeTags)) return edges;

	let changed = false;
	const weighed = edges.map((edge) => {
		const gapFactor = elementFactor(edge.tags, edgeTags);
		if (gapFactor === 1) return edge;
		changed = true;
		return { ...edge, gapFactor };
	});
	return changed ? weighed : edges;
}

/**
 * Node id → the repulsion factor its tags ask for, listing only nodes whose
 * factor differs from 1. `undefined` when there is no node config at all, so
 * physics skips the lookup entirely for a graph that never used the sliders.
 */
export function repulsionFactorByNodeId(
	nodes: readonly Pick<NodeData, 'id' | 'tags'>[],
	config: TagPhysicsConfig | undefined
): Record<string, number> | undefined {
	const nodeTags = config?.nodeTags;
	if (!nodeTags || !hasEntries(nodeTags)) return undefined;

	const factors: Record<string, number> = {};
	for (const node of nodes) {
		const factor = elementFactor(node.tags, nodeTags);
		if (factor !== 1) factors[node.id] = factor;
	}
	return factors;
}

/**
 * Rounds to a fixed number of decimals by dividing an integer by a power of
 * ten, which yields the double nearest the decimal (`0.15`, not
 * `0.15000000000000002`), and folds `-0` into `0`.
 */
function roundTo(value: number, decimals: number): number {
	const scale = 10 ** decimals;
	return Math.round(value * scale) / scale + 0;
}

/**
 * Where a factor sits on the logarithmic slider: `log2(factor)`, snapped to the
 * slider step and clamped to the range's ends, so ×1 sits at the centre and
 * ×0.5 and ×2 sit equally far either side of it. A factor that is not finite
 * and positive reads as the centre — physics treats it as ×1 too.
 */
export function sliderPositionForFactor(
	factor: number,
	min = TAG_PHYSICS_MIN_FACTOR,
	max = TAG_PHYSICS_MAX_FACTOR,
	step = TAG_PHYSICS_SLIDER_STEP
): number {
	if (!isUsableFactor(factor)) return 0;

	const snapped = roundTo(Math.round(Math.log2(factor) / step) * step, 10);
	return Math.min(Math.log2(max), Math.max(Math.log2(min), snapped));
}

/**
 * The factor a slider position stores: `2 ** position`, rounded to three
 * decimals so position 0 is exactly 1 (and so removes the stored key), then
 * clamped into range. A non-finite position comes back non-finite, which the
 * mutation treats as a no-op rather than a reset.
 */
export function factorForSliderPosition(
	position: number,
	min = TAG_PHYSICS_MIN_FACTOR,
	max = TAG_PHYSICS_MAX_FACTOR
): number {
	return clampTagPhysicsFactor(roundTo(2 ** position, FACTOR_DECIMALS), min, max);
}

/** `×1.4`, `×0.71`, `×4.0`: two significant figures, whatever the magnitude. */
export function formatTagPhysicsFactor(factor: number): string {
	return `×${factor.toPrecision(2)}`;
}
