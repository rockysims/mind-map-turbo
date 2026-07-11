import { describe, expect, it } from 'vitest';
import type { NodeData } from '../../types/node';
import { focalNodeForPoint, nodeScreenCircle, persistedScaleForFocusOverzoom } from './nodeFocus';
import { solveFocusEntryBoundary } from './focusEntryBoundary';

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
	it('keeps persisted scale clamped while visual scale overzooms', () => {
		expect(persistedScaleForFocusOverzoom(5.5, 4)).toBe(4);
		expect(persistedScaleForFocusOverzoom(3.5, 4)).toBe(3.5);
	});
});

describe('single boundary path parity', () => {
	it('focal point over a node resolves a candidate and commits focus via solveFocusEntryBoundary', () => {
		// The fallback used to catch nodes via getNodeAt when focalNodeForPoint returned null.
		// This spec proves the boundary resolver alone handles the canonical "zoom over a node" case.
		const candidate = focalNodeForPoint(
			[{ node: node('n0'), position: { x: 0, y: 0 }, radius: 40 }],
			{ x: 160, y: 120 }, // client-space center of node (rect center = 10+150, 20+100)
			rect,
			{ panX: 0, panY: 0, scale: 1 }
		);

		expect(candidate).not.toBeNull();
		expect(candidate!.node.id).toBe('n0');

		// A large single wheel step while at inscription scale commits the boundary (progress = 1).
		const step = solveFocusEntryBoundary({
			currentView: { panX: 0, panY: 0, scale: 4 },
			requestedScale: 4.75,
			focalPoint: { x: 150, y: 100 }, // viewport-relative (= client − rect.left/top)
			viewport: { width: rect.width, height: rect.height },
			candidate: {
				nodeId: candidate!.node.id,
				position: candidate!.position,
				radius: candidate!.radius
			},
			zoneFraction: 0.25
		});

		expect(step.phase).toBe('boundary');
		expect(step.progressDelta).toBe(1);
	});
});
