import { describe, expect, it } from 'vitest';
import type { NodeData } from '../../types/node';
import {
	EMPTY_OVERSHOOT_STATE,
	decayOvershoot,
	focalNodeForPoint,
	focusOverzoomMaxScaleForNode,
	focusOverzoomScale,
	nodeScreenCircle,
	overshootInput,
	persistedScaleForFocusOverzoom
} from './nodeFocus';

const node = (id: string): NodeData => ({ id, title: id, description: '', tags: [], content: [] });
const rect = { left: 10, top: 20, width: 300, height: 200 };

describe('node focus geometry', () => {
	it('projects graph circles into client coordinates with pan and scale', () => {
		const circle = nodeScreenCircle('n0', { x: 20, y: -10 }, 40, rect, {
			panX: 5,
			panY: -15,
			scale: 2
		});

		expect(circle.center.x).toBe(10 + 150 + 5 + 40);
		expect(circle.center.y).toBe(20 + 100 - 15 - 20);
		expect(circle.radius).toBe(80);
	});

	it('selects the topmost overlapping eligible node', () => {
		const selected = focalNodeForPoint(
			[
				{ node: node('back'), position: { x: 0, y: 0 }, radius: 30, zIndex: 1 },
				{ node: node('front'), position: { x: 0, y: 0 }, radius: 30, zIndex: 2 }
			],
			{ x: 160, y: 120 },
			rect,
			{ panX: 0, panY: 0, scale: 1 }
		);

		expect(selected?.node.id).toBe('front');
	});

	it('rejects focal points outside the projected circle', () => {
		const selected = focalNodeForPoint(
			[{ node: node('n0'), position: { x: 0, y: 0 }, radius: 20 }],
			{ x: 260, y: 120 },
			rect,
			{ panX: 0, panY: 0, scale: 1 }
		);

		expect(selected).toBeNull();
	});
});

describe('focus overzoom scale', () => {
	it('allows visual scale past max up to the dynamic cap for eligible focus input', () => {
		expect(focusOverzoomScale(5, { maxScale: 4, dynamicMaxScale: 6 }, true)).toBe(5);
		expect(focusOverzoomScale(5, { maxScale: 4 }, false)).toBe(4);
	});

	it('caps visual overzoom at the geometric inscribed scale', () => {
		expect(focusOverzoomScale(12, { maxScale: 4, dynamicMaxScale: 6 }, true)).toBe(6);
	});

	it('keeps persisted scale clamped while visual scale overzooms', () => {
		expect(persistedScaleForFocusOverzoom(5.5, 4)).toBe(4);
		expect(persistedScaleForFocusOverzoom(3.5, 4)).toBe(3.5);
	});

	it('derives a dynamic cap from node radius and viewport size', () => {
		expect(focusOverzoomMaxScaleForNode(20, { width: 300, height: 200 }, 4)).toBe(5);
		expect(focusOverzoomMaxScaleForNode(80, { width: 300, height: 200 }, 4)).toBe(4);
	});
});

describe('overshoot accumulator', () => {
	const options = { commitThreshold: 1, decayHalfLifeMs: 100, hysteresisMs: 300 };

	it('decays brief bumps without committing', () => {
		const bumped = overshootInput(EMPTY_OVERSHOOT_STATE, 0.4, 0, options);
		const decayed = decayOvershoot(bumped, 200, options);

		expect(bumped.committed).toBe(false);
		expect(decayed.progress).toBeCloseTo(0.1);
	});

	it('commits sustained blocked zoom input', () => {
		const first = overshootInput(EMPTY_OVERSHOOT_STATE, 0.7, 0, options);
		const second = overshootInput(first, 0.7, 50, options);

		expect(second.committed).toBe(true);
		expect(second.progress).toBe(1);
	});

	it('uses hysteresis to prevent immediate retriggering', () => {
		const committed = overshootInput(EMPTY_OVERSHOOT_STATE, 1.2, 0, options);
		const retrigger = overshootInput(committed, 1.2, 100, options);

		expect(committed.committed).toBe(true);
		expect(retrigger.committed).toBe(false);
	});
});
