export interface EdgeData {
	id: string;
	sourceNodeId: string;
	targetNodeId: string;
	tags: string[];
	directed?: boolean;
	/**
	 * How hard this edge pulls in the layout, relative to an ordinary edge.
	 * Absent on everything an author draws — it is set by whoever composes a
	 * derived edge into the layout graph, because it is a tuning choice about
	 * layout rather than a fact about the edge. Persistence drops it.
	 */
	springFactor?: number;
	/**
	 * How far apart this edge's endpoints rest in the layout, relative to an
	 * ordinary edge: it scales the whole rest-gap band. Absent on everything an
	 * author draws — it is set by whoever composes the layout graph, from the
	 * graph's per-tag physics config, because it is a tuning choice about layout
	 * rather than a fact about the edge. Persistence never sees it.
	 */
	gapFactor?: number;
}
