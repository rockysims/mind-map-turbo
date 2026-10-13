import { APP_CONFIG } from '$lib/appConfig';
import { NODE_BORDER_WIDTH } from '$lib/constants';
import type { Point } from '../../types/multigraph';
import { interpolateMorph } from './morphGeometry';
import { graphPointToClientPoint, type StageRect } from './stageCoordinates';
import type { Rect } from './zoomBoundary';

/**
 * The node's placement in graph space plus the on-screen scale of its content.
 * `radius` and `center` mirror what `nodeScreenCircle` consumes; `nodeScale`
 * is the node's logical-to-content scale (`radius / baseRadius`) used to size
 * the border, matching how the in-stage node renders its chrome. Pinned and
 * unpinned nodes draw the same border width, so pinning is not an input here.
 */
export interface NodeFrameLayout {
	center: Point;
	radius: number;
	nodeScale: number;
}

/**
 * Live view state needed to project the node onto the screen. `stageRect` is
 * the stage element's on-screen rect (its origin and size), the same rect the
 * app feeds `graphPointToClientPoint` / `nodeScreenCircle`.
 */
export interface FrameViewState {
	pan: Point;
	scale: number;
	stageRect: StageRect;
}

export interface FrameGeometry {
	x: number;
	y: number;
	width: number;
	height: number;
	borderRadiusPx: number;
	borderWidthPx: number;
	/**
	 * How far the frame insets its content from the outer edge, when that is not
	 * `borderWidthPx`. A node's content keeps the interior at the graph's base
	 * border width while a weighted ring grows inward under it, so the two differ
	 * until they meet at the details border. Absent means "the border width",
	 * which is what a frame with no weighted ring (an image) does.
	 */
	contentInsetPx?: number;
}

interface FrameGeometryOptions {
	ease?: (progress: number) => number;
	targetRadiusPx?: number;
	targetBorderWidthPx?: number;
	/** The node's ring as drawn: the base width times its border-weight factor. */
	nodeBorderWidthPx?: number;
	/** The unweighted node border width the content is inset by; defaults to the ring. */
	nodeBaseBorderWidthPx?: number;
}

/**
 * Compose the node's live on-screen rect (derived from layout + view state,
 * never measured) through `interpolateMorph` toward `fillRect`.
 *
 * At progress 0 the result equals the node's derived on-screen rect, its
 * source circle radius, its on-screen border width and its on-screen content
 * inset. At progress 1 it equals `fillRect` with the details corner radius,
 * and both the border and the content inset at the details border width.
 */
export function frameGeometry(
	nodeLayout: NodeFrameLayout,
	viewState: FrameViewState,
	fillRect: Rect,
	progress: number,
	options: FrameGeometryOptions = {}
): FrameGeometry {
	// Mirror nodeScreenCircle: project the center via the shared coordinate
	// math and scale the radius by the stage scale. Do not measure the DOM.
	const center = graphPointToClientPoint(
		nodeLayout.center,
		viewState.stageRect,
		viewState.pan,
		viewState.scale
	);
	const screenRadius = nodeLayout.radius * viewState.scale;
	const sourceRect: Rect = {
		left: center.x - screenRadius,
		top: center.y - screenRadius,
		width: screenRadius * 2,
		height: screenRadius * 2
	};

	const baseBorderWidthPx = options.nodeBorderWidthPx ?? NODE_BORDER_WIDTH;
	// Source visual scale: how logical CSS pixels map to screen pixels for this
	// node (stage scale × the node's content scale). Border width scales by it.
	const sourceVisualScale = viewState.scale * nodeLayout.nodeScale;
	const sourceBorderWidthPx = baseBorderWidthPx * sourceVisualScale;
	const targetBorderWidthPx =
		options.targetBorderWidthPx ?? APP_CONFIG.multigraph.focus.detailsBorderWidthPx;

	const morph = interpolateMorph(sourceRect, fillRect, progress, {
		ease: options.ease,
		targetRadiusPx: options.targetRadiusPx,
		sourceBorderWidthPx,
		targetBorderWidthPx
	});
	// The content inset rides the same curve from the node's base width to the
	// same details border, so it meets the ring exactly where the ring stops
	// being weighted.
	const sourceContentInsetPx =
		(options.nodeBaseBorderWidthPx ?? baseBorderWidthPx) * sourceVisualScale;
	const insetMorph = interpolateMorph(sourceRect, fillRect, progress, {
		ease: options.ease,
		targetRadiusPx: options.targetRadiusPx,
		sourceBorderWidthPx: sourceContentInsetPx,
		targetBorderWidthPx
	});

	return {
		x: morph.x,
		y: morph.y,
		width: morph.width,
		height: morph.height,
		borderRadiusPx: morph.borderRadiusPx,
		// interpolateMorph always returns borderWidthPx here since both ends are
		// supplied; the fallback only satisfies the optional type.
		borderWidthPx: morph.borderWidthPx ?? sourceBorderWidthPx,
		contentInsetPx: insetMorph.borderWidthPx ?? sourceContentInsetPx
	};
}
