import { describe, expect, it } from 'vitest';
import { computeEdgeOcclusionWindows, edgeOcclusionFadeWidthForZoom } from './edgeOcclusion';
import type { EdgeOcclusionNode, EdgeOcclusionSegment } from './edgeOcclusion';

const horizontalSegment = {
	sourceNodeId: 'source',
	targetNodeId: 'target',
	source: { x: 0, y: 0 },
	target: { x: 100, y: 0 }
} satisfies EdgeOcclusionSegment;

const baseOptions = {
	edgeOcclusionClearancePx: 4,
	edgeOcclusionFadeWidthPx: 10,
	edgeOcclusionMinOpacity: 0.2
};

describe('computeEdgeOcclusionWindows', () => {
	it('uses the circle chord for core half-length at a known perpendicular distance', () => {
		const [window] = computeEdgeOcclusionWindows(
			horizontalSegment,
			[node('crossing', { x: 50, y: 6 }, 10)],
			baseOptions
		);

		const expectedHalfLength = Math.sqrt(10 * 10 - 6 * 6) + baseOptions.edgeOcclusionClearancePx;
		expect((window.coreEnd - window.coreStart) * 100).toBeCloseTo(expectedHalfLength * 2);
	});

	it('gates on the node radius, not the clearance-expanded fade area', () => {
		const touchingBorder = computeEdgeOcclusionWindows(
			horizontalSegment,
			[node('touching-border', { x: 50, y: 10 }, 10)],
			baseOptions
		);
		const insideClearanceButNotTouching = computeEdgeOcclusionWindows(
			horizontalSegment,
			[node('near-miss', { x: 50, y: 10.01 }, 10)],
			baseOptions
		);

		expect(touchingBorder).toHaveLength(1);
		expect(insideClearanceButNotTouching).toEqual([]);
	});

	it('clamps projection windows to the segment ends without occluding a node beyond reach', () => {
		const nearStart = computeEdgeOcclusionWindows(
			horizontalSegment,
			[node('near-start', { x: -2, y: 0 }, 10)],
			baseOptions
		);
		const beyondTarget = computeEdgeOcclusionWindows(
			horizontalSegment,
			[node('beyond-target', { x: 120, y: 0 }, 10)],
			baseOptions
		);

		expect(nearStart).toHaveLength(1);
		expect(nearStart[0].fadeStart).toBe(0);
		expect(nearStart[0].coreStart).toBe(0);
		expect(nearStart[0].coreEnd).toBeCloseTo((Math.sqrt(10 * 10 - 2 * 2) + 4) / 100);
		expect(nearStart[0].fadeEnd).toBeCloseTo((Math.sqrt(10 * 10 - 2 * 2) + 14) / 100);
		expect(nearStart[0].occludingNodeIds).toEqual(['near-start']);
		expect(beyondTarget).toEqual([]);
	});

	it('creates a soft fade window for a centered unrelated node', () => {
		expect(
			computeEdgeOcclusionWindows(
				horizontalSegment,
				[node('centered', { x: 50, y: 0 }, 10)],
				baseOptions
			)
		).toEqual([
			{
				fadeStart: 0.26,
				coreStart: 0.36,
				coreEnd: 0.64,
				fadeEnd: 0.74,
				occludingNodeIds: ['centered']
			}
		]);
	});

	it('keeps near-but-outside-clearance and far nodes from creating windows', () => {
		const windows = computeEdgeOcclusionWindows(
			horizontalSegment,
			[node('near-outside', { x: 50, y: 14 }, 10), node('far', { x: 50, y: 60 }, 10)],
			baseOptions
		);

		expect(windows).toEqual([]);
	});

	it('excludes source and target nodes for their own edge', () => {
		const windows = computeEdgeOcclusionWindows(
			horizontalSegment,
			[node('source', { x: 0, y: 0 }, 10), node('target', { x: 100, y: 0 }, 10)],
			baseOptions
		);

		expect(windows).toEqual([]);
	});

	it('merges overlapping windows deterministically', () => {
		const windows = computeEdgeOcclusionWindows(
			horizontalSegment,
			[node('b', { x: 55, y: 0 }, 10), node('a', { x: 45, y: 0 }, 10)],
			baseOptions
		);

		expect(windows).toEqual([
			{
				fadeStart: 0.21,
				coreStart: 0.31,
				coreEnd: 0.69,
				fadeEnd: 0.79,
				occludingNodeIds: ['a', 'b']
			}
		]);
	});

	it('preserves separate cores when only their fade ramps overlap', () => {
		const windows = computeEdgeOcclusionWindows(
			horizontalSegment,
			[node('b', { x: 35, y: 0 }, 5), node('c', { x: 65, y: 0 }, 5)],
			{
				...baseOptions,
				edgeOcclusionClearancePx: 0,
				edgeOcclusionFadeWidthPx: 15
			}
		);

		expect(windows).toEqual([
			{
				fadeStart: 0.15,
				coreStart: 0.3,
				coreEnd: 0.4,
				fadeEnd: 0.55,
				occludingNodeIds: ['b']
			},
			{
				fadeStart: 0.45,
				coreStart: 0.6,
				coreEnd: 0.7,
				fadeEnd: 0.85,
				occludingNodeIds: ['c']
			}
		]);
	});

	it('merges touching cores deterministically', () => {
		const windows = computeEdgeOcclusionWindows(
			horizontalSegment,
			[node('b', { x: 55, y: 0 }, 5), node('a', { x: 45, y: 0 }, 5)],
			{
				...baseOptions,
				edgeOcclusionClearancePx: 0,
				edgeOcclusionFadeWidthPx: 10
			}
		);

		expect(windows).toEqual([
			{
				fadeStart: 0.3,
				coreStart: 0.4,
				coreEnd: 0.6,
				fadeEnd: 0.7,
				occludingNodeIds: ['a', 'b']
			}
		]);
	});

	it('returns no windows for zero-length, very short, invalid radius, or disabled opacity inputs', () => {
		expect(
			computeEdgeOcclusionWindows(
				{ ...horizontalSegment, target: { x: 0, y: 0 } },
				[node('centered', { x: 0, y: 0 }, 10)],
				baseOptions
			)
		).toEqual([]);
		expect(
			computeEdgeOcclusionWindows(
				{ ...horizontalSegment, target: { x: 0.5, y: 0 } },
				[node('centered', { x: 0.25, y: 0 }, 10)],
				baseOptions
			)
		).toEqual([]);
		expect(
			computeEdgeOcclusionWindows(
				horizontalSegment,
				[node('invalid', { x: 50, y: 0 }, 0)],
				baseOptions
			)
		).toEqual([]);
		expect(
			computeEdgeOcclusionWindows(horizontalSegment, [node('disabled', { x: 50, y: 0 }, 10)], {
				...baseOptions,
				edgeOcclusionMinOpacity: 1
			})
		).toEqual([]);
	});

	it('scales smaller-radius nodes to proportionally smaller windows without extra suppression', () => {
		const [small] = computeEdgeOcclusionWindows(
			horizontalSegment,
			[node('small', { x: 50, y: 0 }, 5)],
			baseOptions
		);
		const [large] = computeEdgeOcclusionWindows(
			horizontalSegment,
			[node('large', { x: 50, y: 0 }, 10)],
			baseOptions
		);

		expect(small.coreEnd - small.coreStart).toBeCloseTo(0.18);
		expect(large.coreEnd - large.coreStart).toBeCloseTo(0.28);
		expect(small.fadeEnd - small.fadeStart).toBeLessThan(large.fadeEnd - large.fadeStart);
	});

	it('uses the same geometry for directed and undirected edges', () => {
		const nodes = [node('centered', { x: 50, y: 0 }, 10)];
		const undirected = computeEdgeOcclusionWindows(horizontalSegment, nodes, baseOptions);
		const directed = computeEdgeOcclusionWindows(
			{
				...horizontalSegment,
				directed: true
			},
			nodes,
			baseOptions
		);

		expect(directed).toEqual(undirected);
	});

	it('does not mutate input objects', () => {
		const segment = { ...horizontalSegment };
		const nodes = [node('centered', { x: 50, y: 0 }, 10)];
		const originalSegment = structuredClone(segment);
		const originalNodes = structuredClone(nodes);

		computeEdgeOcclusionWindows(segment, nodes, baseOptions);

		expect(segment).toEqual(originalSegment);
		expect(nodes).toEqual(originalNodes);
	});
});

describe('edgeOcclusionFadeWidthForZoom', () => {
	it('keeps the base fade width at scale 1', () => {
		expect(edgeOcclusionFadeWidthForZoom(30, 1)).toBe(30);
	});

	it('widens fades in graph space when zoomed out', () => {
		expect(edgeOcclusionFadeWidthForZoom(30, 0.5)).toBe(60);
	});

	it('narrows fades in graph space when zoomed in', () => {
		expect(edgeOcclusionFadeWidthForZoom(30, 2)).toBe(15);
	});

	it('clamps extreme zoom multipliers', () => {
		expect(edgeOcclusionFadeWidthForZoom(30, 0.05)).toBe(120);
		expect(edgeOcclusionFadeWidthForZoom(30, 10)).toBe(15);
	});

	it('leaves invalid inputs unchanged', () => {
		expect(edgeOcclusionFadeWidthForZoom(30, 0)).toBe(30);
		expect(edgeOcclusionFadeWidthForZoom(-1, 0.5)).toBe(-1);
	});
});

function node(
	nodeId: string,
	position: EdgeOcclusionNode['position'],
	radius: number
): EdgeOcclusionNode {
	return { nodeId, position, radius };
}
