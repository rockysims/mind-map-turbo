const NODE_RADIUS_PX = 200; // default node radius in layout and rendering

export const APP_CONFIG = {
	interaction: {
		doubleClickMs: 250, // max gap between clicks to count as double-click
		dragThresholdPx: 5, // min pointer movement before a drag starts
		longPressMs: 1000, // hold duration before long-press triggers
		longPressDistancePx: 8 // max movement allowed during long-press
	},
	persistence: {
		storageNamespace: 'mind-map', // localStorage key prefix for saved graphs
		saveDebounceMs: 500, // delay before persisting graph changes
		quotaBudgetBytes: 5 * 1024 * 1024, // localStorage budget before quota warnings
		quotaWarningRatio: 0.8 // usage ratio that triggers a quota warning
	},
	multigraph: {
		nodeRadiusPx: NODE_RADIUS_PX, // default rendered node radius
		minNodeHitRadiusPx: 32, // minimum tap/hit target radius
		edgeArrow: {
			lengthPx: 10, // arrowhead length along the edge
			halfHeightPx: 6 // arrowhead half-height from edge centerline
		},
		zoom: {
			minScale: 0.05, // minimum stage zoom scale
			maxScale: 4 // maximum stage zoom scale
		},
		layout: {
			baseRadius: NODE_RADIUS_PX, // base radius for hop-scaled layout
			displayedLayers: 3, // hop layers visible around pinned nodes
			scaleFalloff: 0.7, // scale multiplier per hop from pinned
			minScale: 0.1, // minimum node scale in layout
			relaxIterations: 12, // physics relax iterations per layout pass
			edgeGapMinRadiusFactor: 0.2, // min edge gap as fraction of node radius
			edgeGapMaxRadiusFactor: 0.4, // max edge gap as fraction of node radius
			edgeSpringStrength: 0.5, // how strongly edges pull nodes together
			hopRepulsionStrength: 0.3, // repulsion strength between distant hops
			hopRepulsionMinHops: 0, // min hop distance before repulsion applies
			hopRepulsionMaxHops: 8, // hop distance where repulsion peaks
			hopRepulsionMaxExtraGapRadiusFactor: 8, // cap on extra gap from hop repulsion
			postDragSettleEpsilonPx: 0.25, // motion threshold to end post-drag settle
			postDragSettleMaxFrames: 200, // max frames for post-drag physics settle
			postScaleChangeSettleMaxFrames: 200, // max frames to settle after scale animation
			scaleAnimationDurationMs: 500, // duration of node scale change animation
			layeredRelayoutSettleMaxFrames: 20, // max frames per layered relayout phase
			layeredRelayoutSettleMaxFramesFinal: 200, // max frames for final layered relayout settle
			layeredRelayoutSettleEpsilonPx: 0.25, // motion threshold to end layered relayout
			layeredRelayoutMobilityStep: 0.2, // per-phase mobility reduction during relayout
			layeredRelayoutMobilityFloor: 0.05 // minimum node mobility during relayout
		}
	}
} as const;
