import { describe, expect, it } from 'vitest';
import {
	DEFAULT_GRAPH_ID,
	graphHash,
	graphHref,
	graphIdFromUrl,
	graphRouteModeForProtocol,
	graphSearch,
	resolveGraphHref
} from './graphRoute';

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

	it('adds graph hash params for file-safe routing', () => {
		expect(graphHash(DEFAULT_GRAPH_ID)).toBe('');
		expect(graphHash('graph-1')).toBe('#graph=graph-1');
		expect(resolveGraphHref((path) => `/base${path}`, 'graph-1', 'hash')).toBe(
			'/base/#graph=graph-1'
		);
	});

	it('uses hash routing for file URLs', () => {
		expect(graphRouteModeForProtocol('file:')).toBe('hash');
		expect(graphRouteModeForProtocol('http:')).toBe('query');
		expect(graphRouteModeForProtocol('https:')).toBe('query');
	});

	it('encodes reserved URL characters in graph ids', () => {
		const search = graphSearch('team graph/a+b&c');
		const params = new URLSearchParams(search.slice(1));

		expect(params.get('graph')).toBe('team graph/a+b&c');
		expect(search).toBe('?graph=team+graph%2Fa%2Bb%26c');
	});

	it('reads graph ids from query or hash routes', () => {
		expect(graphIdFromUrl(new URL('https://example.test/?graph=query'))).toBe('query');
		expect(graphIdFromUrl(new URL('https://example.test/#/?graph=hash-router'))).toBe(
			'hash-router'
		);
		expect(graphIdFromUrl(new URL('file:///tmp/mind-map.html#graph=hash'), 'hash')).toBe('hash');
		expect(graphIdFromUrl(new URL('file:///tmp/mind-map.html'), 'hash')).toBe(DEFAULT_GRAPH_ID);
	});
});
