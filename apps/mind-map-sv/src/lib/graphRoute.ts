export const DEFAULT_GRAPH_ID = 'default';

type ResolvePath = (path: '/') => string;

type GraphRouteMode = 'query' | 'hash';

export function graphRouteModeForProtocol(protocol: string): GraphRouteMode {
	return protocol === 'file:' || protocol === 'blob:' ? 'hash' : 'query';
}

type GraphRouteOptions = {
	editRoot?: boolean;
};

export function graphSearch(graphId: string, options: GraphRouteOptions = {}): string {
	const params = graphRouteParams(graphId, options);
	if (params.size === 0) return '';
	return `?${params.toString()}`;
}

export function graphHash(graphId: string, options: GraphRouteOptions = {}): string {
	const params = graphRouteParams(graphId, options);
	if (params.size === 0) return '';
	return `#/?${params.toString()}`;
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
	if (mode === 'hash') {
		const hash = url.hash.slice(1);
		if (hash.startsWith('/')) {
			return graphIdFromUrl(new URL(hash, 'https://hash-route.local'));
		}
		const params = new URLSearchParams(hash.startsWith('?') ? hash.slice(1) : hash);
		return params.get('graph') ?? DEFAULT_GRAPH_ID;
	}
	const params = url.searchParams;
	return params.get('graph') ?? DEFAULT_GRAPH_ID;
}

/**
 * An href with its hash route stripped — everything before the `#`.
 *
 * Named rather than open-coded because `+page.svelte` was doing
 * `href.split('#')[0]` in six places and `.split('?')[0]` after it in three of
 * them, which is two different questions ("drop the hash route" and "drop every
 * route") that looked identical at a glance.
 */
export function urlWithoutHash(href: string): string {
	return href.split('#')[0];
}

/**
 * The bare app URL: no hash route and no query route, whichever mode this
 * document is being served under. What you want when you are about to append a
 * fresh route of your own, or hand someone the app itself.
 */
export function appUrlWithoutGraphRoute(href: string): string {
	return urlWithoutHash(href).split('?')[0];
}

function graphRouteParams(graphId: string, options: GraphRouteOptions): URLSearchParams {
	const params = new URLSearchParams();
	if (graphId !== DEFAULT_GRAPH_ID) params.set('graph', graphId);
	if (options.editRoot === true) params.set('editRoot', '1');
	return params;
}
