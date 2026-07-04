import type { MultigraphData } from '$lib/components/ui/types/multigraph';
import { DEFAULT_GRAPH_ID } from '$lib/graphRoute';

export function createDefaultGraph(): MultigraphData {
	return {
		nodes: [
			{
				id: 'n0',
				title: 'Root',
				description: 'Description for root node',
				tags: [],
				pinned: true
			}
		],
		edges: [],
		posByNodeId: { n0: { x: 0, y: 0 } },
		tagColorConfig: {
			nodeTags: {},
			edgeTags: {}
		}
	};
}

export function shouldEditInitialRootTitle({
	graphId,
	requestedByUrl,
	createdDefaultGraph
}: {
	graphId: string;
	requestedByUrl: boolean;
	createdDefaultGraph: boolean;
}): boolean {
	return requestedByUrl || (graphId === DEFAULT_GRAPH_ID && createdDefaultGraph);
}
