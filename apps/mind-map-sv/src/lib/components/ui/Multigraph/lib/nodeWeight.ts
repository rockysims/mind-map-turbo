/**
 * The number about a node that its border width can show, per source, and how
 * a node's generic weight reads in its details.
 *
 * Pure: the canvas picks the source from settings and `borderWeight.ts` maps
 * the value onto that source's scale. A source returns `undefined` for "no
 * value", which draws the configured border as-is; a returned `0` is a real
 * value and draws the thinnest border.
 */

import type { EdgeData } from '../../types/edge';
import type { GraphAssetMetadata, WeightConfig } from '../../types/multigraph';
import type { NodeData } from '../../types/node';
import { isDerivedEdgeId } from './derivedEdges';

/**
 * What border width can show. Settings hand the source over as a plain
 * `string` (config leaves widen their literals), so the public functions take
 * `string` and anything outside this union means "no value".
 *
 * `NodeData.sizeBytes` is deliberately not a source: it stays as data with its
 * details line, but the border no longer draws it (owner ruling, 2026-10-12).
 */
type BorderSource = 'none' | 'weight' | 'degree' | 'attachmentBytes' | 'descriptionLength';

type ValuedSource = Exclude<BorderSource, 'none'>;

/**
 * What the computed sources read besides the node itself. Both are built once
 * per graph change, never per node or per frame: `degrees` from
 * `authoredDegrees`, and `assets` is the graph's own asset map carried by
 * reference.
 */
export type BorderInputs = {
	readonly degrees: ReadonlyMap<string, number>;
	readonly assets: Readonly<Record<string, GraphAssetMetadata>>;
};

/** Byte size an asset adds to its node's total; missing or bad metadata adds nothing. */
function assetBytes(assets: BorderInputs['assets'], assetId: string): number {
	// Own keys only, so an asset id of `'toString'` reads nothing.
	if (!Object.prototype.hasOwnProperty.call(assets, assetId)) return 0;
	const size = assets[assetId]?.size;
	return typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : 0;
}

const VALUE_BY_SOURCE: Readonly<
	Record<ValuedSource, (node: NodeData, inputs: BorderInputs) => number | undefined>
> = {
	// A weight of 0 is real: the node weighs nothing. No weight is "unknown".
	weight: (node) => node.weight,
	// 0 is a real value for the three computed sources, never "unknown".
	degree: (node, { degrees }) => degrees.get(node.id) ?? 0,
	// Every content block is an image or a file, and each names one asset; the
	// total is what the reader would download to see the node in full.
	attachmentBytes: (node, { assets }) =>
		(node.content ?? []).reduce((total, block) => total + assetBytes(assets, block.assetId), 0),
	// Raw stored text in UTF-16 code units: on a log scale, code points or
	// trimming would not make a visible difference.
	descriptionLength: (node) => node.description.length
};

function isValuedSource(source: string): source is ValuedSource {
	// Own keys only, so `'toString'` and friends are not sources.
	return Object.prototype.hasOwnProperty.call(VALUE_BY_SOURCE, source);
}

/**
 * Authored edges touching each node, in both directions. O(E), so the canvas
 * can rebuild it on a relax frame instead of scanning every edge per node.
 *
 * An edge counts once for each endpoint, directed or not, and parallel edges
 * each count (this is a multigraph). A self-loop counts once. A node with no
 * edges is simply absent; `nodeBorderValue` reads that as 0.
 *
 * Derived dataflow edges are skipped even when a caller passes a render graph.
 * They are a view of the quantity index, recomputed every render, not relations
 * the reader drew: counting them would change a node's border when someone
 * types a symbol in another node, and a quantity that is both a dataflow edge
 * and a drawn edge would count twice.
 */
export function authoredDegrees(edges: readonly EdgeData[]): ReadonlyMap<string, number> {
	const degrees = new Map<string, number>();
	const bump = (nodeId: string) => degrees.set(nodeId, (degrees.get(nodeId) ?? 0) + 1);

	for (const edge of edges) {
		if (isDerivedEdgeId(edge.id)) continue;
		bump(edge.sourceNodeId);
		if (edge.targetNodeId !== edge.sourceNodeId) bump(edge.targetNodeId);
	}
	return degrees;
}

/**
 * The value `source` reads off `node`, or `undefined` when the node has none.
 *
 * `inputs.degrees` is only read under `'degree'` and `inputs.assets` only under
 * `'attachmentBytes'`, so a caller may pass empty ones under every other
 * source. `'none'` and any unknown source give `undefined`.
 */
export function nodeBorderValue(
	node: NodeData,
	source: string,
	inputs: BorderInputs
): number | undefined {
	if (!isValuedSource(source)) return undefined;
	return VALUE_BY_SOURCE[source](node, inputs);
}

/** Fixed locale: the UI is English, and stories need a deterministic "4,200". */
const WEIGHT_NUMBER_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/**
 * What the graph calls its nodes' weight, and the unit it is counted in: the
 * one rule both the details line and the edit sheet's field label follow.
 * "Weight" with no unit when the graph names nothing.
 */
export function weightName(config: WeightConfig | undefined): {
	label: string;
	unit: string | undefined;
} {
	return { label: config?.label ?? 'Weight', unit: config?.unit };
}

/**
 * A node's weight as its details view reads it: "Word count 4,200",
 * "Mass 12.5 kg", or "Weight 7" when the graph names nothing.
 */
export function formatNodeWeight(
	weight: number,
	config: WeightConfig | undefined
): { label: string; text: string } {
	const value = WEIGHT_NUMBER_FORMAT.format(weight);
	const { label, unit } = weightName(config);
	return { label, text: unit === undefined ? value : `${value} ${unit}` };
}

/**
 * What the edit sheet's weight field asks the save to do, in the shape
 * `updateNodeContent` takes: a number sets the weight, `null` removes the key,
 * and `undefined` leaves the stored weight alone.
 *
 * Blank means "no weight", so clearing the field is how a weight comes off. A
 * negative number is clamped to 0 (the floor load cleaning enforces, and a real
 * value) rather than refused. Anything that is not a finite number is ignored
 * rather than turned into a guess. `badInput` is the browser's own flag for
 * text a number field could not read: such a field reports its value as `''`,
 * which would otherwise read as a deliberate clear.
 */
export function weightFromDraft(text: string, badInput = false): number | null | undefined {
	if (badInput) return undefined;
	const trimmed = text.trim();
	if (trimmed === '') return null;
	const value = Number(trimmed);
	if (!Number.isFinite(value)) return undefined;
	return Math.max(0, value);
}
