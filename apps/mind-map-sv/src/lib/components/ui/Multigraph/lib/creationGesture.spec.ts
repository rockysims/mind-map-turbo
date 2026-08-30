import { describe, expect, it } from 'vitest';

import { resolveCreationDrop, shouldShowCreationPreviewNode } from './creationGesture.js';

describe('resolveCreationDrop', () => {
	it('creates a node and edge when released on background', () => {
		expect(resolveCreationDrop('n0', null)).toEqual({ kind: 'create-node-and-edge' });
	});

	it('cancels when released back on the source node', () => {
		expect(resolveCreationDrop('n0', 'n0')).toEqual({ kind: 'cancel' });
	});

	it('connects to the target when released on another node', () => {
		expect(resolveCreationDrop('n0', 'n1')).toEqual({
			kind: 'connect-to-node',
			targetNodeId: 'n1'
		});
	});

	it('merges into the target when a merge gesture is released on another node', () => {
		expect(resolveCreationDrop('n0', 'n1', 'merge')).toEqual({
			kind: 'merge-into-node',
			targetNodeId: 'n1'
		});
	});

	it('cancels a merge released on background, where there is nothing to absorb into', () => {
		expect(resolveCreationDrop('n0', null, 'merge')).toEqual({ kind: 'cancel' });
	});

	it('cancels a merge released back on its own source node', () => {
		expect(resolveCreationDrop('n0', 'n0', 'merge')).toEqual({ kind: 'cancel' });
	});
});

describe('shouldShowCreationPreviewNode', () => {
	it('shows the preview node over background', () => {
		expect(shouldShowCreationPreviewNode(null)).toBe(true);
	});

	it('hides the preview node over the source node', () => {
		expect(shouldShowCreationPreviewNode('n0')).toBe(false);
	});

	it('hides the preview node over any other node', () => {
		expect(shouldShowCreationPreviewNode('n1')).toBe(false);
	});

	it('never shows a preview node for a merge, which creates nothing', () => {
		expect(shouldShowCreationPreviewNode(null, 'merge')).toBe(false);
		expect(shouldShowCreationPreviewNode('n1', 'merge')).toBe(false);
	});
});
