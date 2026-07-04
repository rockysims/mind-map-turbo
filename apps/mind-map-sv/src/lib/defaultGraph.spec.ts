import { describe, expect, it } from 'vitest';
import { DEFAULT_GRAPH_ID } from './graphRoute';
import { createDefaultGraph, shouldEditInitialRootTitle } from './defaultGraph';

describe('createDefaultGraph', () => {
	it('creates a pinned root node at the origin', () => {
		expect(createDefaultGraph()).toMatchObject({
			nodes: [{ id: 'n0', title: 'Root', pinned: true }],
			edges: [],
			posByNodeId: { n0: { x: 0, y: 0 } }
		});
	});
});

describe('shouldEditInitialRootTitle', () => {
	it('edits the root for a newly created default graph', () => {
		expect(
			shouldEditInitialRootTitle({
				graphId: DEFAULT_GRAPH_ID,
				requestedByUrl: false,
				createdDefaultGraph: true
			})
		).toBe(true);
	});

	it('does not edit the root for an existing default graph', () => {
		expect(
			shouldEditInitialRootTitle({
				graphId: DEFAULT_GRAPH_ID,
				requestedByUrl: false,
				createdDefaultGraph: false
			})
		).toBe(false);
	});

	it('honors explicit route requests for non-default graphs', () => {
		expect(
			shouldEditInitialRootTitle({
				graphId: 'graph-new',
				requestedByUrl: true,
				createdDefaultGraph: false
			})
		).toBe(true);
	});
});
