const NODE_RADIUS_PX = 200;

export const APP_CONFIG = {
	interaction: {
		doubleClickMs: 250,
		dragThresholdPx: 5,
		longPressMs: 1000,
		longPressDistancePx: 8
	},
	persistence: {
		storageNamespace: 'mind-map',
		saveDebounceMs: 500,
		quotaBudgetBytes: 5 * 1024 * 1024,
		quotaWarningRatio: 0.8
	},
	multigraph: {
		nodeRadiusPx: NODE_RADIUS_PX,
		minNodeHitRadiusPx: 32,
		zoom: {
			minScale: 0.05,
			maxScale: 4
		},
		layout: {
			baseRadius: NODE_RADIUS_PX,
			scaleFalloff: 0.7,
			minScale: 0.1,
			relaxIterations: 2,
			edgeGapMinRadiusFactor: 0.2,
			edgeGapMaxRadiusFactor: 0.4,
			edgeSpringStrength: 0.5,
			hopRepulsionStrength: 0.3,
			hopRepulsionMinHops: 2,
			hopRepulsionMaxHops: 8,
			hopRepulsionMaxExtraGapRadiusFactor: 8,
			postDragSettleEpsilonPx: 0.25,
			postDragSettleMaxFrames: 90,
			postScaleChangeSettleMaxFrames: 24,
			scaleAnimationDurationMs: 500
		}
	}
} as const;
