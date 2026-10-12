/**
 * Shipped defaults, frozen at import.
 *
 * These are the fallback a caller gets when it passes nothing — story fixtures,
 * specs, and harnesses. They are deliberately NOT the path a rendering component
 * takes to a tunable: a component reads its config per render (see `cfg` in
 * `Multigraph.svelte`) and hands the value down as a parameter or prop, so a
 * config that changes at runtime reaches the pixels. Adding a read of one of
 * these inside a component re-freezes that value.
 */
import { APP_CONFIG } from './appConfig';

export const DBL_CLICK_MS = APP_CONFIG.interaction.doubleClickMs;
export const DRAG_THRESHOLD = APP_CONFIG.interaction.dragThresholdPx;
export const LONG_PRESS_MS = APP_CONFIG.interaction.longPressMs;
export const LONG_PRESS_DIST = APP_CONFIG.interaction.longPressDistancePx;
export const MIN_NODE_HIT_RADIUS = APP_CONFIG.multigraph.minNodeHitRadiusPx;
export const NODE_RADIUS = APP_CONFIG.multigraph.nodeRadiusPx;
export const NODE_TEXT_FONT_SIZE = APP_CONFIG.multigraph.nodeTextFontSizePx;
export const NODE_BORDER_WIDTH = APP_CONFIG.multigraph.nodeBorderWidthPx;
export const EDGE_ARROW_HALF_HEIGHT = APP_CONFIG.multigraph.edgeArrow.halfHeightPx;
export const EDGE_ARROW_REFERENCE_NODE_SCALE = APP_CONFIG.multigraph.edgeArrow.referenceNodeScale;
export const EDGE_STROKE_REFERENCE_NODE_SCALE = APP_CONFIG.multigraph.edgeStroke.referenceNodeScale;
