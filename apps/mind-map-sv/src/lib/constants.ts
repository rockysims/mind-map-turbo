import { APP_CONFIG } from './appConfig';

export const DBL_CLICK_MS = APP_CONFIG.interaction.doubleClickMs;
export const DRAG_THRESHOLD = APP_CONFIG.interaction.dragThresholdPx;
export const LONG_PRESS_MS = APP_CONFIG.interaction.longPressMs;
export const LONG_PRESS_DIST = APP_CONFIG.interaction.longPressDistancePx;
export const MIN_NODE_HIT_RADIUS = APP_CONFIG.multigraph.minNodeHitRadiusPx;
export const NODE_RADIUS = APP_CONFIG.multigraph.nodeRadiusPx;
export const EDGE_ARROW_LENGTH = APP_CONFIG.multigraph.edgeArrow.lengthPx;
export const EDGE_ARROW_HALF_HEIGHT = APP_CONFIG.multigraph.edgeArrow.halfHeightPx;
export const EDGE_ARROW_REFERENCE_NODE_SCALE = APP_CONFIG.multigraph.edgeArrow.referenceNodeScale;
export const EDGE_STROKE_WIDTH = APP_CONFIG.multigraph.edgeStroke.widthPx;
export const EDGE_STROKE_REFERENCE_NODE_SCALE = APP_CONFIG.multigraph.edgeStroke.referenceNodeScale;
export const MIN_ZOOM_SCALE = APP_CONFIG.multigraph.zoom.minScale;
export const MAX_ZOOM_SCALE = APP_CONFIG.multigraph.zoom.maxScale;
