import { describe, expect, it } from 'vitest';
import type { Point } from '../../types/multigraph';
import { normalizeRigidMotion } from './rigidMotion';

const TOLERANCE = 1e-9;

function expectPointCloseTo(actual: Point, expected: Point): void {
	expect(actual.x).toBeCloseTo(expected.x, 9);
	expect(actual.y).toBeCloseTo(expected.y, 9);
}

function rotateAround(point: Point, reference: Point, angleRad: number): Point {
	const dx = point.x - reference.x;
	const dy = point.y - reference.y;
	const cos = Math.cos(angleRad);
	const sin = Math.sin(angleRad);

	return {
		x: reference.x + dx * cos - dy * sin,
		y: reference.y + dx * sin + dy * cos
	};
}

function translate(point: Point, dx: number, dy: number): Point {
	return {
		x: point.x + dx,
		y: point.y + dy
	};
}

function centroid(positions: Record<string, Point>, nodeIds: readonly string[]): Point {
	return nodeIds.reduce(
		(sum, nodeId, _index, ids) => ({
			x: sum.x + positions[nodeId].x / ids.length,
			y: sum.y + positions[nodeId].y / ids.length
		}),
		{ x: 0, y: 0 }
	);
}

describe('normalizeRigidMotion', () => {
	it('removes net translation and rotation for unanchored participating nodes', () => {
		const before = {
			a: { x: -10, y: -10 },
			b: { x: 20, y: 0 },
			c: { x: -10, y: 10 }
		};
		const beforeCentroid = centroid(before, ['a', 'b', 'c']);
		const after = Object.fromEntries(
			Object.entries(before).map(([nodeId, point]) => [
				nodeId,
				translate(rotateAround(point, beforeCentroid, Math.PI / 12), 100, -30)
			])
		);

		const normalized = normalizeRigidMotion(before, after, Object.keys(before), new Set(), {
			maxRelaxationRotationPerFrameRad: Math.PI / 4
		});

		for (const [nodeId, point] of Object.entries(before)) {
			expectPointCloseTo(normalized[nodeId], point);
		}
		expectPointCloseTo(centroid(normalized, ['a', 'b', 'c']), beforeCentroid);
	});

	it('removes rotation about one anchor while keeping the anchor fixed', () => {
		const before = {
			anchor: { x: 5, y: 5 },
			a: { x: 15, y: 5 },
			b: { x: 5, y: 20 }
		};
		const after = {
			anchor: { x: 5, y: 5 },
			a: rotateAround(before.a, before.anchor, Math.PI / 18),
			b: rotateAround(before.b, before.anchor, Math.PI / 18)
		};

		const normalized = normalizeRigidMotion(
			before,
			after,
			Object.keys(before),
			new Set(['anchor']),
			{
				maxRelaxationRotationPerFrameRad: Math.PI / 4
			}
		);

		expectPointCloseTo(normalized.anchor, before.anchor);
		expectPointCloseTo(normalized.a, before.a);
		expectPointCloseTo(normalized.b, before.b);
	});

	it('leaves positions unchanged when two or more anchors participate', () => {
		const before = {
			anchorA: { x: 0, y: 0 },
			anchorB: { x: 20, y: 0 },
			movable: { x: 10, y: 10 }
		};
		const after = {
			anchorA: { x: 0, y: 0 },
			anchorB: { x: 20, y: 0 },
			movable: { x: 11, y: 12 }
		};

		const normalized = normalizeRigidMotion(
			before,
			after,
			Object.keys(before),
			new Set(['anchorA', 'anchorB'])
		);

		expect(normalized).toEqual(after);
		expect(normalized).not.toBe(after);
	});

	it('preserves the centroid without applying rotation for fewer than two movable nodes', () => {
		const before = {
			a: { x: 10, y: 20 }
		};
		const after = {
			a: { x: 100, y: -30 }
		};

		const normalized = normalizeRigidMotion(before, after, ['a'], new Set());

		expectPointCloseTo(normalized.a, before.a);
		expectPointCloseTo(centroid(normalized, ['a']), centroid(before, ['a']));
	});

	it('skips rotation beyond the cap while still removing unanchored translation', () => {
		const before = {
			a: { x: -10, y: 0 },
			b: { x: 10, y: 0 }
		};
		const beforeCentroid = centroid(before, ['a', 'b']);
		const after = Object.fromEntries(
			Object.entries(before).map(([nodeId, point]) => [
				nodeId,
				translate(rotateAround(point, beforeCentroid, Math.PI / 2), 50, 30)
			])
		);

		const normalized = normalizeRigidMotion(before, after, Object.keys(before), new Set(), {
			maxRelaxationRotationPerFrameRad: Math.PI / 4
		});

		expectPointCloseTo(centroid(normalized, ['a', 'b']), beforeCentroid);
		expect(Math.hypot(normalized.a.x - before.a.x, normalized.a.y - before.a.y)).toBeGreaterThan(
			TOLERANCE
		);
	});

	it('can remove only rotation while keeping unanchored translation', () => {
		const before = {
			a: { x: -10, y: -10 },
			b: { x: 20, y: 0 },
			c: { x: -10, y: 10 }
		};
		const beforeCentroid = centroid(before, ['a', 'b', 'c']);
		const dx = 100;
		const dy = -30;
		const after = Object.fromEntries(
			Object.entries(before).map(([nodeId, point]) => [
				nodeId,
				translate(rotateAround(point, beforeCentroid, Math.PI / 12), dx, dy)
			])
		);

		const normalized = normalizeRigidMotion(before, after, Object.keys(before), new Set(), {
			normalizeRelaxationTranslation: false,
			normalizeRelaxationRotation: true
		});

		for (const [nodeId, point] of Object.entries(before)) {
			expectPointCloseTo(normalized[nodeId], translate(point, dx, dy));
		}
	});

	it('can remove only translation while keeping unanchored rotation', () => {
		const before = {
			a: { x: -10, y: 0 },
			b: { x: 10, y: 0 }
		};
		const beforeCentroid = centroid(before, ['a', 'b']);
		const after = Object.fromEntries(
			Object.entries(before).map(([nodeId, point]) => [
				nodeId,
				translate(rotateAround(point, beforeCentroid, Math.PI / 12), 50, 30)
			])
		);

		const normalized = normalizeRigidMotion(before, after, Object.keys(before), new Set(), {
			normalizeRelaxationTranslation: true,
			normalizeRelaxationRotation: false
		});

		expectPointCloseTo(centroid(normalized, ['a', 'b']), beforeCentroid);
		expectPointCloseTo(normalized.a, rotateAround(before.a, beforeCentroid, Math.PI / 12));
		expectPointCloseTo(normalized.b, rotateAround(before.b, beforeCentroid, Math.PI / 12));
	});

	it('does not move anchored nodes or mutate input positions', () => {
		const before = {
			anchor: { x: 0, y: 0 },
			a: { x: 20, y: 0 },
			b: { x: 0, y: 20 }
		};
		const after = {
			anchor: { x: 0, y: 0 },
			a: rotateAround(before.a, before.anchor, Math.PI / 18),
			b: rotateAround(before.b, before.anchor, Math.PI / 18),
			other: { x: 100, y: 100 }
		};
		const afterSnapshot = structuredClone(after);

		const normalized = normalizeRigidMotion(
			before,
			after,
			['anchor', 'a', 'b'],
			new Set(['anchor'])
		);

		expectPointCloseTo(normalized.anchor, after.anchor);
		expect(normalized.other).toEqual(after.other);
		expect(normalized).not.toBe(after);
		expect(normalized.a).not.toBe(after.a);
		expect(after).toEqual(afterSnapshot);
	});
});
