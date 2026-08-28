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
	math: {
		renderCacheMaxEntries: 500, // rendered expressions kept before eviction
		maxSizeEm: 10, // cap on em-relative sizes so a rule cannot fill the screen
		maxSizePt: 100, // cap on absolute sizes in points
		maxExpand: 1000 // macro expansion cap that stops runaway definitions
	},
	multigraph: {
		nodeRadiusPx: NODE_RADIUS_PX, // default rendered node radius
		nodeTextFontSizePx: 38, // default title and description font size
		nodeBorderWidthPx: 8, // default node border width
		pinnedNodeBorderWidthPx: 8, // border width for pinned nodes
		minNodeHitRadiusPx: 32, // minimum tap/hit target radius
		edgeArrow: {
			lengthPx: 10, // arrowhead length along the edge
			halfHeightPx: 6, // arrowhead half-height from edge centerline
			referenceNodeScale: 0.25 // node scale where the configured arrow size applies
		},
		edgeStroke: {
			widthPx: 2, // edge line width at the reference node scale
			referenceNodeScale: 0.25 // node scale where the configured stroke width applies
		},
		zoom: {
			minScale: 0.05, // minimum stage zoom scale
			maxScale: 4 // maximum stage zoom scale
		},
		focus: {
			entryGestureIdleMs: 180, // initial quiet gap before residual zoom input becomes fresh
			entryGestureMaxMs: 420, // hard cap for swallowing residual boundary-crossing zoom input
			boundaryNearTouchMarginPx: 8, // tolerance for treating zoom subjects as inscribed
			detailsCornerRadiusPx: 18, // fully focused node corner radius
			detailsBorderWidthPx: 8, // fully focused node frame border width (matches node border)
			preInscribeZoneFraction: 0.88, // fraction of inscribe scale used for entry scrub
			subFitExitZoneFraction: 0.72, // fraction below fit scale used for exit scrub
			eligibilityCoverageRatio: 1, // focal point must be inside the projected node circle
			entryTransitionMs: 660, // focus overlay morph duration
			worldWheelSensitivity: 0.002, // wheel delta to scale factor inside focus/image worlds
			worldMaxScale: 8 // deepest free zoom inside a focused world
		},
		tagSyntax: {
			nodeTagMarker: '#', // leading marker for node tags in title/query shortcuts
			edgeTagMarker: '@' // leading marker for edge tags in title/query shortcuts
		},
		layout: {
			baseRadius: NODE_RADIUS_PX, // base radius for hop-scaled layout
			displayedLayers: 3, // hop layers visible around pinned nodes
			scaleFalloff: 0.7, // scale multiplier per hop from pinned
			minScale: 0.1, // minimum node scale in layout
			relaxIterations: 12, // physics relax iterations per layout pass
			parallelEdgeMaxOffsetRadiusFactor: 0.5, // max parallel-edge offset as fraction of smaller endpoint radius
			parallelEdgeClearancePx: 4, // extra gap between parallel edge strokes/arrowheads
			edgeGapMinRadiusFactor: 0.42, // min edge gap as fraction of node radius
			edgeGapMaxRadiusFactor: 0.84, // max edge gap as fraction of node radius
			edgeSpringStrength: 0.5, // how strongly edges pull nodes together
			hopRepulsionStrength: 0.3, // repulsion strength between distant hops
			hopRepulsionMinHops: 0, // min hop distance before repulsion applies
			hopRepulsionMaxHops: 4, // hop distance where repulsion peaks
			hopRepulsionMaxExtraGapRadiusFactor: 2, // cap on extra gap from hop repulsion
			postDragSettleEpsilonPx: 0.25, // motion threshold to end post-drag settle
			postDragSettleMaxFrames: 200, // max frames for post-drag physics settle
			postScaleChangeSettleMaxFrames: 200, // max frames to settle after scale animation
			scaleAnimationDurationMs: 800, // duration of node scale change animation
			normalizeRelaxationTranslation: true, // remove whole-graph drift during per-frame settle
			normalizeRelaxationRotation: true, // remove whole-graph spin during per-frame settle
			maxRelaxationRotationPerFrameRad: Math.PI / 4, // skip degenerate rotation fits above this
			layeredRelayoutSettleMaxFrames: 20, // max frames per layered relayout phase
			layeredRelayoutSettleMaxFramesFinal: 200, // max frames for final layered relayout settle
			layeredRelayoutSettleEpsilonPx: 0.25, // motion threshold to end layered relayout
			enterExitDurationMs: 180, // duration of add/remove enter-exit animation (0 = instant)
			revealFrontWidthHops: 2, // reveal-wave front width in hops for pin/unpin transitions
			edgeOcclusionClearancePx: 20, // extra edge fade clearance around unrelated nodes
			edgeOcclusionFadeWidthPx: 25, // width of the soft fade on each side of an occlusion
			edgeOcclusionZoomScaleExponent: 0.4, // lower values make occlusion scale more gently with zoom
			edgeOcclusionMinOpacity: 0.16 // minimum edge opacity where a node crosses over it
		},
		dataflow: {
			labelMinStageScale: 0.8, // zoom below which quantity labels stay hidden
			labelMinOnScreenLengthPx: 90, // shortest on-screen edge worth labelling
			labelMaxVisibleQuantities: 3, // quantities named before collapsing to a count
			chipMinOnScreenDiameterPx: 180, // on-screen node size below which chips are hidden
			chipMaxVisibleQuantities: 3 // quantities a compact node names before a count
		}
	}
} as const;
