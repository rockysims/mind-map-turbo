import { describe, expect, it } from 'vitest';
import { DEFAULT_GRAPH_ID, graphHref, graphSearch, resolveGraphHref } from './graphRoute';

describe('graph route helpers', () => {
	it('uses the root route for the default graph', () => {
		expect(graphSearch(DEFAULT_GRAPH_ID)).toBe('');
		expect(graphHref(DEFAULT_GRAPH_ID)).toBe('/');
		expect(resolveGraphHref((path) => `/base${path}`, DEFAULT_GRAPH_ID)).toBe('/base/');
	});

	it('adds graph search params for custom graph ids', () => {
		expect(graphSearch('graph-1')).toBe('?graph=graph-1');
		expect(graphHref('graph-1')).toBe('/?graph=graph-1');
		expect(resolveGraphHref((path) => `/base${path}`, 'graph-1')).toBe('/base/?graph=graph-1');
	});

	it('encodes reserved URL characters in graph ids', () => {
		const search = graphSearch('team graph/a+b&c');
		const params = new URLSearchParams(search.slice(1));

		expect(params.get('graph')).toBe('team graph/a+b&c');
		expect(search).toBe('?graph=team+graph%2Fa%2Bb%26c');
	});
});
