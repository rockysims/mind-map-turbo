export const DEFAULT_GRAPH_ID = 'default';

type ResolvePath = (path: '/') => string;

export type GraphRouteMode = 'query' | 'hash';

export function graphRouteModeForProtocol(protocol: string): GraphRouteMode {
	return protocol === 'file:' ? 'hash' : 'query';
}

export function graphSearch(graphId: string): string {
	if (graphId === DEFAULT_GRAPH_ID) return '';
	return `?${new URLSearchParams({ graph: graphId }).toString()}`;
}

export function graphHash(graphId: string): string {
	if (graphId === DEFAULT_GRAPH_ID) return '';
	return `#${new URLSearchParams({ graph: graphId }).toString()}`;
}

export function graphHref(graphId: string): string {
	return `/${graphSearch(graphId)}`;
}

export function resolveGraphHref(
	resolvePath: ResolvePath,
	graphId: string,
	mode: GraphRouteMode = 'query'
): string {
	if (mode === 'hash') return `${resolvePath('/')}${graphHash(graphId)}`;
	return `${resolvePath('/')}${graphSearch(graphId)}`;
}

export function graphIdFromUrl(url: URL, mode: GraphRouteMode = 'query'): string {
	if (mode === 'query' && url.searchParams.has('graph')) {
		return url.searchParams.get('graph') ?? DEFAULT_GRAPH_ID;
	}
	if (mode === 'query' && url.hash.startsWith('#/')) {
		const hashRoute = new URL(url.hash.slice(1), url.origin);
		return graphIdFromUrl(hashRoute);
	}
	const params = mode === 'hash' ? new URLSearchParams(url.hash.slice(1)) : url.searchParams;
	return params.get('graph') ?? DEFAULT_GRAPH_ID;
}
