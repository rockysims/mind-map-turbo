import { describe, expect, it } from 'vitest';
import { hopsFromPinned } from './layout';
import {
	inRangeEndpointNodeId,
	revealWaveEdgeOpacity,
	revealWaveNodeOpacities,
	revealWaveProgressFromFocalAnimation,
	revealWaveProgressFromScaleAnimation
} from './revealWave';
import { makeGraph } from './testFixtures';

describe('revealWave', () => {
	it('reveals nearer hops first and opacities rise as progress increases', () => {
		const hopsByNodeId = { n0: 0, n1: 1, n2: 2, n3: 3 };
		const early = revealWaveNodeOpacities(hopsByNodeId, 3, 0.25);
		const later = revealWaveNodeOpacities(hopsByNodeId, 3, 0.75);

		expect(early.n0).toBeGreaterThan(early.n1);
		expect(early.n1).toBeGreaterThan(early.n2);
		expect(early.n2).toBeGreaterThanOrEqual(early.n3);
		expect(later.n1).toBeGreaterThan(early.n1);
		expect(later.n2).toBeGreaterThan(early.n2);
	});

	it('uses front width as a smooth band rather than a hard step', () => {
		const opacities = revealWaveNodeOpacities({ n0: 0, n1: 1, n2: 2, n3: 3 }, 3, 0.5, {
			frontWidthHops: 2
		});

		expect(opacities.n1).toBeGreaterThan(0);
		expect(opacities.n1).toBeLessThan(1);
		expect(opacities.n2).toBeGreaterThan(0);
		expect(opacities.n2).toBeLessThan(1);
	});

	it('resolves p=1 to full opacity for every in-range hop', () => {
		const opacities = revealWaveNodeOpacities(
			{ n0: 0, n1: 1, n2: 2, n3: 3, n4: 4, nX: Infinity },
			3,
			1
		);

		expect(opacities).toEqual({
			n0: 1,
			n1: 1,
			n2: 1,
			n3: 1,
			n4: 0,
			nX: 0
		});
	});

	it('treats hide as the time-reverse of reveal', () => {
		const hopsByNodeId = { n0: 0, n1: 1, n2: 2, n3: 3 };
		const samples = [0, 0.2, 0.5, 0.8, 1];

		for (const p of samples) {
			const reveal = revealWaveNodeOpacities(hopsByNodeId, 3, p, { frontWidthHops: 1.5 });
			const hide = revealWaveNodeOpacities(hopsByNodeId, 3, 1 - p, {
				frontWidthHops: 1.5,
				direction: 'hide'
			});

			for (const nodeId of Object.keys(hopsByNodeId)) {
				expect(hide[nodeId]).toBeCloseTo(reveal[nodeId], 10);
			}
		}
	});

	it('naturally supports multiple pins via min-hop inputs', () => {
		const graph = makeGraph({
			nodeCount: 6,
			pinned: [0, 5],
			edges: [
				[0, 1],
				[1, 2],
				[2, 3],
				[3, 4],
				[4, 5]
			]
		});
		const hopsByNodeId = hopsFromPinned(graph);
		const opacities = revealWaveNodeOpacities(hopsByNodeId, 2, 0.6);

		expect(hopsByNodeId).toEqual({
			n0: 0,
			n1: 1,
			n2: 2,
			n3: 2,
			n4: 1,
			n5: 0
		});
		expect(opacities.n1).toBeGreaterThan(opacities.n2);
		expect(opacities.n4).toBeGreaterThan(opacities.n3);
	});

	it('maps edge opacity from the in-range endpoint so boundary edges finish at 1', () => {
		const hopsByNodeId = { n0: 0, n1: 1, n2: 2, n3: 3 };
		const nodeOpacities = revealWaveNodeOpacities(hopsByNodeId, 2, 1);
		const boundaryEdge = {
			id: 'e1',
			sourceNodeId: 'n2',
			targetNodeId: 'n3',
			tags: []
		};

		expect(inRangeEndpointNodeId(boundaryEdge, hopsByNodeId, 2)).toBe('n2');
		expect(revealWaveEdgeOpacity(boundaryEdge, hopsByNodeId, nodeOpacities, 2)).toBe(1);
	});

	it('chooses the nearer in-range endpoint for edges with both endpoints visible', () => {
		const hopsByNodeId = { n1: 1, n2: 2 };
		const nodeOpacities = revealWaveNodeOpacities(hopsByNodeId, 3, 0.5, {
			frontWidthHops: 2
		});
		const edge = {
			id: 'e2',
			sourceNodeId: 'n1',
			targetNodeId: 'n2',
			tags: []
		};

		expect(inRangeEndpointNodeId(edge, hopsByNodeId, 3)).toBe('n1');
		expect(revealWaveEdgeOpacity(edge, hopsByNodeId, nodeOpacities, 3)).toBeCloseTo(
			nodeOpacities.n1
		);
	});

	it('reads reveal progress from the existing scale animation clock', () => {
		expect(
			revealWaveProgressFromScaleAnimation(
				{ fromScale: 0.2, toScale: 1, startedAtMs: 100, durationMs: 200 },
				50
			)
		).toBe(0);
		expect(
			revealWaveProgressFromScaleAnimation(
				{ fromScale: 0.2, toScale: 1, startedAtMs: 100, durationMs: 200 },
				200
			)
		).toBe(0.5);
		expect(
			revealWaveProgressFromScaleAnimation(
				{ fromScale: 0.2, toScale: 1, startedAtMs: 100, durationMs: 200 },
				500
			)
		).toBe(1);
		expect(
			revealWaveProgressFromScaleAnimation(
				{ fromScale: 0.2, toScale: 1, startedAtMs: 100, durationMs: 0 },
				100
			)
		).toBe(1);
	});

	it('reads progress from focal-node animation records', () => {
		const animations = {
			n0: { fromScale: 0.2, toScale: 1, startedAtMs: 10, durationMs: 100 },
			n1: { fromScale: 1, toScale: 0.5, startedAtMs: 10, durationMs: 200 }
		};

		expect(revealWaveProgressFromFocalAnimation(animations, 'n0', 60)).toBe(0.5);
		expect(revealWaveProgressFromFocalAnimation(animations, null, 60)).toBe(1);
		expect(revealWaveProgressFromFocalAnimation(animations, 'missing', 60)).toBe(1);
	});
});
