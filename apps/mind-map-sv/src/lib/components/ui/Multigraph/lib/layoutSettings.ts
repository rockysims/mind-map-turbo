import { APP_CONFIG } from '../../../../appConfig';

export interface LayoutSettings {
	baseRadius: number;
	displayedLayers: number;
	scaleFalloff: number;
	minScale: number;
	relaxIterations: number;
	edgeGapMinRadiusFactor: number;
	edgeGapMaxRadiusFactor: number;
	edgeSpringStrength: number;
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
