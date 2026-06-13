import { describe, expect, it } from 'vitest';
import type { EdgeVisibility } from './boundedVisibility';
import type { GraphLayout } from './graphLayout';
import { edgeArrowScale, edgeRenderPoints, edgeStrokeScale, edgeStyle } from './edgeStyle';

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
