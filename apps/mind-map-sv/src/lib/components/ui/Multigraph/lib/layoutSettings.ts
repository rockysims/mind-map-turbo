import { APP_CONFIG } from '../../../../appConfig';

export interface LayoutSettings {
	baseRadius: number;
	displayedLayers: number;
	scaleFalloff: number;
	minScale: number;
	relaxIterations: number;
	parallelEdgeMaxOffsetRadiusFactor: number;
	parallelEdgeClearancePx: number;
	edgeGapMinRadiusFactor: number;
	edgeGapMaxRadiusFactor: number;
	edgeSpringStrength: number;
	/**
	 * Derived dataflow edges pull this much relative to an authored edge. At 1 a
	 * dataflow relationship shapes the graph exactly as a drawn one does; lower
	 * values let it inform the layout without overruling what the author drew.
	 */
	derivedEdgeSpringFactor: number;
	hopRepulsionStrength: number;
	hopRepulsionMinHops: number;
	hopRepulsionMaxHops: number;
	hopRepulsionMaxExtraGapRadiusFactor: number;
	postDragSettleEpsilonPx: number;
	postDragSettleMaxFrames: number;
	postScaleChangeSettleMaxFrames: number;
	scaleAnimationDurationMs: number;
	normalizeRelaxationTranslation: boolean;
	normalizeRelaxationRotation: boolean;
	maxRelaxationRotationPerFrameRad: number;
	layeredRelayoutSettleMaxFrames: number;
	layeredRelayoutSettleMaxFramesFinal: number;
	layeredRelayoutSettleEpsilonPx: number;
	enterExitDurationMs: number;
	revealFrontWidthHops: number;
	edgeOcclusionClearancePx: number;
	edgeOcclusionFadeWidthPx: number;
	edgeOcclusionZoomScaleExponent: number;
	edgeOcclusionMinOpacity: number;
}

export const DEFAULT_LAYOUT_SETTINGS: LayoutSettings = {
	...APP_CONFIG.multigraph.layout
};

export function withDefaultLayoutSettings(settings: Partial<LayoutSettings> = {}): LayoutSettings {
	return {
		...DEFAULT_LAYOUT_SETTINGS,
		...settings
	};
}
