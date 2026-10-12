/**
 * The number about a node that its border width can show, per source, and how
 * a node's generic weight reads in its details.
 *
 * Pure: the canvas picks the source from settings and feeds the value through
 * the bounded log curve. A source returns `undefined` for "no value", which
 * draws the configured border as-is; a returned `0` is a real value and lands
 * on the curve's floor.
 */

import type { EdgeData } from '../../types/edge';
import type { WeightConfig } from '../../types/multigraph';
import type { NodeData } from '../../types/node';
import { isDerivedEdgeId } from './derivedEdges';

/**
 * What border width can show. Settings hand the source over as a plain
 * `string` (config leaves widen their literals), so the public functions take
 * `string` and anything outside this union means "no value".
 */
type BorderSource = 'none' | 'size' | 'weight' | 'degree' | 'attachments' | 'descriptionLength';

type ValuedSource = Exclude<BorderSource, 'none'>;

const VALUE_BY_SOURCE: Readonly<
	Record<ValuedSource, (node: NodeData, degrees: ReadonlyMap<string, number>) => number | undefined>
> = {
	// A stored 0 is what a scraper writes when it could not measure, so it reads
	// as unknown rather than as the thinnest border.
	size: (node) => (node.sizeBytes === 0 ? undefined : node.sizeBytes),
	// Unlike size, a weight of 0 is real: the node weighs nothing.
	weight: (node) => node.weight,
	// 0 is a real count for the three computed sources, never "unknown".
	degree: (node, degrees) => degrees.get(node.id) ?? 0,
	// Every content block is an image or a file, so every block is an attachment.
	attachments: (node) => node.content?.length ?? 0,
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
 * `degrees` comes from `authoredDegrees` and is only read under `'degree'`.
 * `'none'` and any unknown source give `undefined`.
 */
export function nodeBorderValue(
	node: NodeData,
	source: string,
	degrees: ReadonlyMap<string, number>
): number | undefined {
	if (!isValuedSource(source)) return undefined;
	return VALUE_BY_SOURCE[source](node, degrees);
}

/** Fixed locale: the UI is English, and stories need a deterministic "4,200". */
const WEIGHT_NUMBER_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/**
 * A node's weight as its details view reads it: "Word count 4,200",
 * "Mass 12.5 kg", or "Weight 7" when the graph names nothing.
 */
export function formatNodeWeight(
	weight: number,
	config: WeightConfig | undefined
): { label: string; text: string } {
	const value = WEIGHT_NUMBER_FORMAT.format(weight);
	return {
		label: config?.label ?? 'Weight',
		text: config?.unit === undefined ? value : `${value} ${config.unit}`
	};
}
