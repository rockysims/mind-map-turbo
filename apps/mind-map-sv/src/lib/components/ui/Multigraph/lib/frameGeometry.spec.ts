import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '$lib/appConfig';
import { NODE_BORDER_WIDTH } from '$lib/constants';
import { frameGeometry, type FrameViewState, type NodeFrameLayout } from './frameGeometry';
import { graphPointToClientPoint, type StageRect } from './stageCoordinates';
import type { Rect } from './zoomBoundary';

const stageRect: StageRect = { left: 0, top: 0, width: 1000, height: 800 };
const fillRect: Rect = { left: 0, top: 0, width: 1000, height: 800 };
const DETAILS_RADIUS = APP_CONFIG.multigraph.focus.detailsCornerRadiusPx;
const DETAILS_BORDER = APP_CONFIG.multigraph.focus.detailsBorderWidthPx;

// Independently derive the node's on-screen rect the same way the app places
// nodes, so the spec pins geometry rather than re-deriving inside the module.
function derivedSourceRect(layout: NodeFrameLayout, view: FrameViewState): Rect {
	const center = graphPointToClientPoint(layout.center, view.stageRect, view.pan, view.scale);
	const screenRadius = layout.radius * view.scale;
	return {
		left: center.x - screenRadius,
		top: center.y - screenRadius,
		width: screenRadius * 2,
		height: screenRadius * 2
	};
}

describe('frameGeometry', () => {
	describe('progress 0 equals the derived on-screen rect', () => {
		const cases: Array<{ name: string; layout: NodeFrameLayout; view: FrameViewState }> = [
			{
				name: 'identity view, centered node',
				layout: { center: { x: 0, y: 0 }, radius: 100, nodeScale: 0.5 },
				view: { pan: { x: 0, y: 0 }, scale: 1, stageRect }
			},
			{
				name: 'panned and zoomed view',
				layout: { center: { x: 50, y: -20 }, radius: 100, nodeScale: 0.5 },
				view: { pan: { x: 100, y: -50 }, scale: 2, stageRect }
			},
			{
				name: 'small node scale, fractional stage scale',
				layout: { center: { x: -120, y: 40 }, radius: 40, nodeScale: 0.2 },
				view: { pan: { x: -30, y: 15 }, scale: 0.75, stageRect }
			}
		];

		for (const { name, layout, view } of cases) {
			it(name, () => {
				const rect = derivedSourceRect(layout, view);
				const geometry = frameGeometry(layout, view, fillRect, 0);
				expect(geometry.x).toBeCloseTo(rect.left);
				expect(geometry.y).toBeCloseTo(rect.top);
				expect(geometry.width).toBeCloseTo(rect.width);
				expect(geometry.height).toBeCloseTo(rect.height);
				// Source corner radius is the node circle radius (half its diameter).
				expect(geometry.borderRadiusPx).toBeCloseTo(rect.width / 2);
				// Source border width = node border × on-screen visual scale.
				expect(geometry.borderWidthPx).toBeCloseTo(
					NODE_BORDER_WIDTH * view.scale * layout.nodeScale
				);
			});
		}
	});

	it('tracks a changing view state between calls', () => {
		const layout: NodeFrameLayout = { center: { x: 0, y: 0 }, radius: 100, nodeScale: 0.5 };
		const first = frameGeometry(layout, { pan: { x: 0, y: 0 }, scale: 1, stageRect }, fillRect, 0);
		const second = frameGeometry(
			layout,
			{ pan: { x: 100, y: -50 }, scale: 2, stageRect },
			fillRect,
			0
		);

		// scale 1 → node radius 100 on screen, centered at (500, 400).
		expect(first).toMatchObject({ x: 400, y: 300, width: 200, height: 200 });
		// scale 2 + pan (100, -50) → node radius 200 on screen, centered at (600, 350).
		expect(second).toMatchObject({ x: 400, y: 150, width: 400, height: 400 });
		expect(second.borderWidthPx).toBeCloseTo(NODE_BORDER_WIDTH * 2 * 0.5);
	});

	it('progress 1 equals the fill rect plus details radius and border width', () => {
		const layout: NodeFrameLayout = { center: { x: 0, y: 0 }, radius: 100, nodeScale: 0.5 };
		const geometry = frameGeometry(
			layout,
			{ pan: { x: 0, y: 0 }, scale: 1, stageRect },
			fillRect,
			1
		);
		expect(geometry).toEqual({
			x: fillRect.left,
			y: fillRect.top,
			width: fillRect.width,
			height: fillRect.height,
			borderRadiusPx: DETAILS_RADIUS,
			borderWidthPx: DETAILS_BORDER
		});
	});

	it('interpolates every channel at a mid progress', () => {
		const layout: NodeFrameLayout = { center: { x: 0, y: 0 }, radius: 100, nodeScale: 0.5 };
		const view: FrameViewState = { pan: { x: 0, y: 0 }, scale: 1, stageRect };
		const geometry = frameGeometry(layout, view, fillRect, 0.5);
		// source rect {400,300,200,200,r100,bw4} → fill {0,0,1000,800,r18,bw8}.
		expect(geometry.x).toBeCloseTo(200);
		expect(geometry.y).toBeCloseTo(150);
		expect(geometry.width).toBeCloseTo(600);
		expect(geometry.height).toBeCloseTo(500);
		expect(geometry.borderRadiusPx).toBeCloseTo((100 + DETAILS_RADIUS) / 2);
		expect(geometry.borderWidthPx).toBeCloseTo((NODE_BORDER_WIDTH * 0.5 + DETAILS_BORDER) / 2);
	});

	it('scales the passed node border width for the source end', () => {
		const view: FrameViewState = { pan: { x: 0, y: 0 }, scale: 1, stageRect };
		const layout: NodeFrameLayout = { center: { x: 0, y: 0 }, radius: 100, nodeScale: 0.5 };
		// Pinned and unpinned nodes share one width, so the passed width is the
		// only border input; pin it away from the default to prove it is read.
		const geometry = frameGeometry(layout, view, fillRect, 0, { nodeBorderWidthPx: 12 });

		expect(geometry.borderWidthPx).toBeCloseTo(12 * 0.5);
	});
});
