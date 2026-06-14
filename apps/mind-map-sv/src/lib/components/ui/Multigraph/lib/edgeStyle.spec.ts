import { describe, expect, it } from 'vitest';
import type { EdgeVisibility } from './boundedVisibility';
import type { GraphLayout } from './graphLayout';
import {
	edgeArrowScale,
	edgeBackground,
	edgeRenderPoints,
	edgeStrokeScale,
	edgeStyle
} from './edgeStyle';

const directedEdge = {
	id: 'edge-1',
	sourceNodeId: 'source',
	targetNodeId: 'target',
	tags: [],
	directed: true
};

const undirectedEdge = {
	id: 'edge-2',
	sourceNodeId: 'source',
	targetNodeId: 'target',
	tags: []
};

describe('edgeStyle', () => {
	it('formats CSS positioning and rotation for a known segment', () => {
		expect(edgeStyle({ x: 10, y: 20 }, { x: 110, y: 20 })).toBe(
			'left: calc(50% + 10px); top: calc(50% + 20px); width: 100px; transform: translateY(-50%) rotate(0rad);'
		);
	});
});

describe('edgeRenderPoints', () => {
	const layout = {
		posByNodeId: {
			source: { x: 0, y: 0 },
			target: { x: 100, y: 0 }
		},
		radiusByNodeId: {
			source: 10,
			target: 20
		}
	} satisfies Pick<GraphLayout, 'posByNodeId' | 'radiusByNodeId'>;

	it('trims a fully visible edge to the node borders', () => {
		const visibility = {
			kind: 'visible',
			edge: undirectedEdge
		} satisfies EdgeVisibility;

		expect(edgeRenderPoints(visibility, layout, {})).toEqual({
			source: { x: 14, y: 0 },
			target: { x: 76, y: 0 }
		});
	});

	it('renders a boundary edge from the visible node toward the hidden node fade point', () => {
		const visibility = {
			kind: 'boundary',
			edge: undirectedEdge,
			visibleNodeId: 'source',
			hiddenNodeId: 'hidden',
			visibleEndpoint: 'source',
			hiddenEndpoint: 'target',
			fadeRatio: 0.25
		} satisfies EdgeVisibility;

		expect(edgeRenderPoints(visibility, layout, { hidden: { x: 100, y: 200 } })).toEqual({
			source: { x: 0, y: 0 },
			target: { x: 25, y: 50 }
		});
	});
});

describe('edgeBackground', () => {
	it('keeps visible edges without occlusion windows on the current solid color string', () => {
		const visibility = {
			kind: 'visible',
			edge: undirectedEdge
		} satisfies EdgeVisibility;

		expect(edgeBackground(visibility, '#888888')).toBe('#888888');
		expect(edgeBackground(visibility, '#112233', { occlusionWindows: [] })).toBe('#112233');
	});

	it('composes one soft full-to-min-to-full occlusion gradient for visible edges', () => {
		const visibility = {
			kind: 'visible',
			edge: undirectedEdge
		} satisfies EdgeVisibility;

		expect(
			edgeBackground(visibility, '#888888', {
				edgeOcclusionMinOpacity: 0.2,
				occlusionWindows: [
					{
						fadeStart: 0.26,
						coreStart: 0.36,
						coreEnd: 0.64,
						fadeEnd: 0.74,
						occludingNodeIds: ['centered']
					}
				]
			})
		).toBe(
			'linear-gradient(to right, #888888 0%, #888888 26%, color-mix(in srgb, #888888 20%, transparent) 36%, color-mix(in srgb, #888888 20%, transparent) 64%, #888888 74%, #888888 100%)'
		);
	});

	it('maps directed edge stops against the rendered before width', () => {
		const visibility = {
			kind: 'visible',
			edge: directedEdge
		} satisfies EdgeVisibility;

		expect(
			edgeBackground(visibility, '#123456', {
				edgeLengthPx: 100,
				edgeArrowLengthPx: 20,
				edgeOcclusionMinOpacity: 0.25,
				occlusionWindows: [
					{
						fadeStart: 0.45,
						coreStart: 0.5,
						coreEnd: 0.55,
						fadeEnd: 0.6,
						occludingNodeIds: ['centered']
					}
				]
			})
		).toBe(
			'linear-gradient(to right, #123456 0%, #123456 50%, color-mix(in srgb, #123456 25%, transparent) 55.5556%, color-mix(in srgb, #123456 25%, transparent) 61.1111%, #123456 66.6667%, #123456 100%)'
		);
	});

	it('sorts multiple windows into valid increasing gradient stops', () => {
		const visibility = {
			kind: 'visible',
			edge: undirectedEdge
		} satisfies EdgeVisibility;

		expect(
			edgeBackground(visibility, '#abcdef', {
				edgeOcclusionMinOpacity: 0.16,
				occlusionWindows: [
					{
						fadeStart: 0.7,
						coreStart: 0.72,
						coreEnd: 0.78,
						fadeEnd: 0.8,
						occludingNodeIds: ['later']
					},
					{
						fadeStart: 0.2,
						coreStart: 0.25,
						coreEnd: 0.35,
						fadeEnd: 0.4,
						occludingNodeIds: ['earlier']
					}
				]
			})
		).toBe(
			'linear-gradient(to right, #abcdef 0%, #abcdef 20%, color-mix(in srgb, #abcdef 16%, transparent) 25%, color-mix(in srgb, #abcdef 16%, transparent) 35%, #abcdef 40%, #abcdef 70%, color-mix(in srgb, #abcdef 16%, transparent) 72%, color-mix(in srgb, #abcdef 16%, transparent) 78%, #abcdef 80%, #abcdef 100%)'
		);
	});

	it('keeps boundary edge backgrounds on the existing far-end fade gradient', () => {
		const visibility = {
			kind: 'boundary',
			edge: directedEdge,
			visibleNodeId: 'source',
			hiddenNodeId: 'target',
			visibleEndpoint: 'source',
			hiddenEndpoint: 'target',
			fadeRatio: 0.5
		} satisfies EdgeVisibility;

		expect(
			edgeBackground(visibility, '#888888', {
				occlusionWindows: [
					{
						fadeStart: 0.25,
						coreStart: 0.3,
						coreEnd: 0.7,
						fadeEnd: 0.75,
						occludingNodeIds: ['ignored']
					}
				]
			})
		).toBe('linear-gradient(to right, #888888, transparent)');
	});
});

describe('edge scales', () => {
	const scaleByNodeId = {
		source: 0.5,
		target: 0.75,
		visible: 0.25
	};

	it('scales visible directed edge arrows from the target node scale', () => {
		const visibility = {
			kind: 'visible',
			edge: directedEdge
		} satisfies EdgeVisibility;

		expect(edgeArrowScale(visibility, scaleByNodeId)).toBe(3);
	});

	it('leaves undirected and boundary edge arrows at the base scale', () => {
		const undirectedVisibility = {
			kind: 'visible',
			edge: undirectedEdge
		} satisfies EdgeVisibility;
		const boundaryVisibility = {
			kind: 'boundary',
			edge: directedEdge,
			visibleNodeId: 'visible',
			hiddenNodeId: 'target',
			visibleEndpoint: 'source',
			hiddenEndpoint: 'target',
			fadeRatio: 0.5
		} satisfies EdgeVisibility;

		expect(edgeArrowScale(undirectedVisibility, scaleByNodeId)).toBe(1);
		expect(edgeArrowScale(boundaryVisibility, scaleByNodeId)).toBe(1);
	});

	it('scales visible directed strokes from the target node scale', () => {
		const visibility = {
			kind: 'visible',
			edge: directedEdge
		} satisfies EdgeVisibility;

		expect(edgeStrokeScale(visibility, scaleByNodeId)).toBe(3);
	});

	it('scales visible undirected strokes from the endpoint average scale', () => {
		const visibility = {
			kind: 'visible',
			edge: undirectedEdge
		} satisfies EdgeVisibility;

		expect(edgeStrokeScale(visibility, scaleByNodeId)).toBe(2.5);
	});

	it('scales boundary strokes from the visible node scale', () => {
		const visibility = {
			kind: 'boundary',
			edge: directedEdge,
			visibleNodeId: 'visible',
			hiddenNodeId: 'target',
			visibleEndpoint: 'source',
			hiddenEndpoint: 'target',
			fadeRatio: 0.5
		} satisfies EdgeVisibility;

		expect(edgeStrokeScale(visibility, scaleByNodeId)).toBe(1);
	});
});
