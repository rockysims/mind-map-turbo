export const DEFAULT_GRAPH_ID = 'default';

type ResolvePath = (path: '/') => string;

export function graphSearch(graphId: string): string {
	if (graphId === DEFAULT_GRAPH_ID) return '';
	return `?${new URLSearchParams({ graph: graphId }).toString()}`;
}

export function graphHref(graphId: string): string {
	return `/${graphSearch(graphId)}`;
}

export function resolveGraphHref(resolvePath: ResolvePath, graphId: string): string {
	return `${resolvePath('/')}${graphSearch(graphId)}`;
}
