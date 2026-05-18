const NODE_RADIUS_PX = 200;

export const APP_CONFIG = {
	interaction: {
		doubleClickMs: 250,
		dragThresholdPx: 5,
		longPressMs: 500,
		longPressDistancePx: 8
	},
	multigraph: {
		nodeRadiusPx: NODE_RADIUS_PX,
		minNodeHitRadiusPx: 32,
		layout: {
			baseRadius: NODE_RADIUS_PX,
			scaleFalloff: 0.7,
			minScale: 0.1,
			relaxIterations: 2,
			edgeGapMinRadiusFactor: 0.2,
			edgeGapMaxRadiusFactor: 0.6,
			edgeSpringStrength: 0.25,
			hopRepulsionStrength: 0.3,
			hopRepulsionMinHops: 2,
			hopRepulsionMaxHops: 8,
			hopRepulsionMaxExtraGapRadiusFactor: 2,
			postDragSettleEpsilonPx: 0.25,
			postDragSettleMaxFrames: 90,
			scaleAnimationDurationMs: 500
		}
	}
} as const;
