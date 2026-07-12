import { describe, expect, it } from 'vitest';
import {
	boundaryProgressDelta,
	boundaryReleaseDelta,
	entrySteeringProgress,
	projectedCandidateRect,
	solveFocusEntryBoundary,
	type FocusEntryBoundaryCandidate
} from './focusEntryBoundary';

const viewport = { width: 320, height: 240 };
const centeredCandidate: FocusEntryBoundaryCandidate = {
	nodeId: 'n0',
	position: { x: 0, y: 0 },
	radius: 40
};

describe('focus entry boundary solver', () => {
	it('zooms freely until the candidate reaches an edge', () => {
		const step = solveFocusEntryBoundary({
			currentView: { panX: 0, panY: 0, scale: 1 },
			requestedScale: 2,
			focalPoint: { x: 160, y: 120 },
			viewport,
			candidate: centeredCandidate
		});

		expect(step.phase).toBe('free');
		expect(step.view.scale).toBe(2);
		expect(step.progressDelta).toBe(0);
	});

	it('holds a one-sided edge contact while gradually recentering the other axis', () => {
		const offCenterCandidate: FocusEntryBoundaryCandidate = {
			nodeId: 'n0',
			position: { x: 90, y: 5 },
			radius: 40
		};
		const firstStep = solveFocusEntryBoundary({
			currentView: { panX: 0, panY: 0, scale: 1 },
			requestedScale: 1.6,
			focalPoint: { x: 160, y: 120 },
			viewport,
			candidate: offCenterCandidate
		});

		expect(firstStep.phase).toBe('steering');
		expect(firstStep.projectedRect.left + firstStep.projectedRect.width).toBeCloseTo(
			viewport.width
		);
		expect(firstStep.projectedRect.top + firstStep.projectedRect.height / 2).toBeGreaterThan(
			viewport.height / 2
		);
		expect(firstStep.steeringState).toEqual({
			nodeId: 'n0',
			axis: 'horizontal',
			startScale: 1.6
		});
		expect(firstStep.progressDelta).toBe(0);

		const secondStep = solveFocusEntryBoundary({
			currentView: firstStep.view,
			requestedScale: 2.3,
			focalPoint: { x: 160, y: 120 },
			viewport,
			candidate: offCenterCandidate,
			steeringState: firstStep.steeringState
		});
		const firstCenterY = firstStep.projectedRect.top + firstStep.projectedRect.height / 2;
		const secondCenterY = secondStep.projectedRect.top + secondStep.projectedRect.height / 2;

		expect(secondStep.phase).toBe('steering');
		expect(secondStep.projectedRect.left + secondStep.projectedRect.width).toBeCloseTo(
			viewport.width
		);
		expect(secondCenterY).toBeLessThan(firstCenterY);
		expect(secondCenterY).toBeGreaterThan(viewport.height / 2);
	});

	it('finishes one-sided steering centered at inscription', () => {
		const offCenterCandidate: FocusEntryBoundaryCandidate = {
			nodeId: 'n0',
			position: { x: 90, y: 5 },
			radius: 40
		};
		const step = solveFocusEntryBoundary({
			currentView: { panX: 0, panY: 0, scale: 2.3 },
			requestedScale: 3,
			focalPoint: { x: 160, y: 120 },
			viewport,
			candidate: offCenterCandidate,
			steeringState: { nodeId: 'n0', axis: 'horizontal', startScale: 1.6 }
		});

		expect(step.phase).toBe('boundary');
		expect(step.projectedRect.top + step.projectedRect.height / 2).toBeCloseTo(viewport.height / 2);
		expect(step.steeringState).toBeNull();
	});

	it('locks the rendered scale at inscription before accumulating boundary progress', () => {
		const step = solveFocusEntryBoundary({
			currentView: { panX: 0, panY: 0, scale: 2.8 },
			requestedScale: 3.3,
			focalPoint: { x: 160, y: 120 },
			viewport,
			candidate: centeredCandidate,
			zoneFraction: 0.25
		});
		const rect = projectedCandidateRect(centeredCandidate, step.view, viewport);

		expect(step.phase).toBe('boundary');
		expect(step.boundaryScale).toBe(3);
		expect(step.view.scale).toBe(3);
		expect(rect.top).toBeCloseTo(0);
		expect(rect.top + rect.height).toBeCloseTo(viewport.height);
		expect(step.progressDelta).toBeCloseTo(0.4);
	});

	it('shrinks an already oversized current view back to the inscription scale', () => {
		const step = solveFocusEntryBoundary({
			currentView: { panX: 0, panY: 0, scale: 4 },
			requestedScale: 4.4,
			focalPoint: { x: 160, y: 120 },
			viewport,
			candidate: centeredCandidate,
			zoneFraction: 0.25
		});

		expect(step.phase).toBe('boundary');
		expect(step.boundaryScale).toBe(3);
		expect(step.view.scale).toBe(3);
		expect(step.projectedRect.height).toBeCloseTo(viewport.height);
		expect(step.progressDelta).toBe(1);
	});

	it('does not produce boundary progress when zoom reverses below inscription', () => {
		expect(boundaryProgressDelta(2.9, 3, 0.25)).toBe(0);
		expect(boundaryReleaseDelta(2.625, 3, 0.25)).toBeCloseTo(0.5);
	});

	it('allows a large single wheel step to commit from the boundary', () => {
		expect(boundaryProgressDelta(3.75, 3, 0.25)).toBe(1);
	});

	it('maps steering scale progress from first contact to inscription', () => {
		expect(entrySteeringProgress(1.6, 1.6, 3)).toBe(0);
		expect(entrySteeringProgress(2.3, 1.6, 3)).toBeCloseTo(0.5);
		expect(entrySteeringProgress(3, 1.6, 3)).toBe(1);
	});
});
