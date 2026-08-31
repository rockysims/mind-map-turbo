import { describe, expect, it } from 'vitest';

import {
	CREATION_PREVIEW_TARGET_SCALE,
	beginCreationPreview,
	creationPreviewScaleAt,
	endCreationPreview,
	isCreationPreviewSettled,
	updateCreationPreview
} from './creationPreview.js';

const DURATION = 180;

describe('beginCreationPreview', () => {
	it('starts hidden over the source node', () => {
		const state = beginCreationPreview('n0', { x: 10, y: 20 }, 1000);
		expect(state.hoverNodeId).toBe('n0');
		expect(creationPreviewScaleAt(state, 1000)).toBe(0);
		expect(isCreationPreviewSettled(state, 1000)).toBe(true);
		expect(state.ending).toBe(false);
	});

	it('defaults to the create mode', () => {
		expect(beginCreationPreview('n0', { x: 0, y: 0 }, 1000).mode).toBe('create');
	});
});

describe('updateCreationPreview', () => {
	it('scales in when the cursor leaves the source node onto background', () => {
		let state = beginCreationPreview('n0', { x: 0, y: 0 }, 1000);
		state = updateCreationPreview(
			state,
			{ point: { x: 50, y: 0 }, hoverNodeId: null },
			1000,
			DURATION
		);
		expect(state.point).toEqual({ x: 50, y: 0 });
		expect(creationPreviewScaleAt(state, 1000)).toBe(0);
		expect(creationPreviewScaleAt(state, 1000 + DURATION)).toBe(CREATION_PREVIEW_TARGET_SCALE);
		expect(creationPreviewScaleAt(state, 1000 + DURATION / 2)).toBeCloseTo(0.5);
	});

	it('keeps the running animation when visibility does not flip', () => {
		let state = beginCreationPreview('n0', { x: 0, y: 0 }, 1000);
		state = updateCreationPreview(
			state,
			{ point: { x: 50, y: 0 }, hoverNodeId: null },
			1000,
			DURATION
		);
		const anim = state.anim;
		state = updateCreationPreview(
			state,
			{ point: { x: 60, y: 5 }, hoverNodeId: null },
			1050,
			DURATION
		);
		expect(state.anim).toBe(anim);
		expect(state.point).toEqual({ x: 60, y: 5 });
	});

	it('retargets from the current mid-animation scale without snapping', () => {
		let state = beginCreationPreview('n0', { x: 0, y: 0 }, 1000);
		state = updateCreationPreview(
			state,
			{ point: { x: 50, y: 0 }, hoverNodeId: null },
			1000,
			DURATION
		);
		const midScale = creationPreviewScaleAt(state, 1000 + DURATION / 2);
		state = updateCreationPreview(
			state,
			{ point: { x: 80, y: 0 }, hoverNodeId: 'n1' },
			1000 + DURATION / 2,
			DURATION
		);
		expect(creationPreviewScaleAt(state, 1000 + DURATION / 2)).toBeCloseTo(midScale);
		expect(creationPreviewScaleAt(state, 1000 + DURATION / 2 + DURATION)).toBe(0);
	});

	it('hides over the source node after re-entering it', () => {
		let state = beginCreationPreview('n0', { x: 0, y: 0 }, 1000);
		state = updateCreationPreview(
			state,
			{ point: { x: 50, y: 0 }, hoverNodeId: null },
			1000,
			DURATION
		);
		state = updateCreationPreview(
			state,
			{ point: { x: 2, y: 0 }, hoverNodeId: 'n0' },
			1000 + DURATION,
			DURATION
		);
		expect(creationPreviewScaleAt(state, 1000 + 2 * DURATION)).toBe(0);
	});

	it('does not resurrect an ending preview', () => {
		let state = beginCreationPreview('n0', { x: 0, y: 0 }, 1000);
		state = updateCreationPreview(state, { point: { x: 50, y: 0 }, hoverNodeId: null }, 1000, 0);
		const ended = endCreationPreview(state, 2000, DURATION)!;
		const updated = updateCreationPreview(
			ended,
			{ point: { x: 60, y: 0 }, hoverNodeId: null },
			2000,
			DURATION
		);
		expect(updated.ending).toBe(true);
	});

	it('keeps a merge preview node hidden over background, where a create one would grow', () => {
		let state = beginCreationPreview('n0', { x: 0, y: 0 }, 1000, 'merge');
		state = updateCreationPreview(
			state,
			{ point: { x: 50, y: 0 }, hoverNodeId: null },
			1000,
			DURATION
		);
		expect(state.point).toEqual({ x: 50, y: 0 });
		expect(creationPreviewScaleAt(state, 1000 + DURATION)).toBe(0);
	});

	it('carries the mode through an update, so the preview never changes its aim', () => {
		let state = beginCreationPreview('n0', { x: 0, y: 0 }, 1000, 'merge');
		state = updateCreationPreview(state, { point: { x: 9, y: 0 }, hoverNodeId: 'n1' }, 1000, 0);
		expect(state.mode).toBe('merge');
		expect(state.hoverNodeId).toBe('n1');
	});

	it('settles immediately when duration is 0', () => {
		let state = beginCreationPreview('n0', { x: 0, y: 0 }, 1000);
		state = updateCreationPreview(state, { point: { x: 50, y: 0 }, hoverNodeId: null }, 1000, 0);
		expect(creationPreviewScaleAt(state, 1000)).toBe(CREATION_PREVIEW_TARGET_SCALE);
		expect(isCreationPreviewSettled(state, 1000)).toBe(true);
	});
});

describe('endCreationPreview', () => {
	it('scales out from the current scale and marks the preview as ending', () => {
		let state = beginCreationPreview('n0', { x: 0, y: 0 }, 1000);
		state = updateCreationPreview(state, { point: { x: 50, y: 0 }, hoverNodeId: null }, 1000, 0);
		const ended = endCreationPreview(state, 2000, DURATION);
		expect(ended).not.toBeNull();
		expect(ended!.ending).toBe(true);
		expect(creationPreviewScaleAt(ended!, 2000)).toBe(CREATION_PREVIEW_TARGET_SCALE);
		expect(creationPreviewScaleAt(ended!, 2000 + DURATION)).toBe(0);
	});

	it('returns null when the preview is already hidden', () => {
		const state = beginCreationPreview('n0', { x: 0, y: 0 }, 1000);
		expect(endCreationPreview(state, 1000, DURATION)).toBeNull();
	});
});
