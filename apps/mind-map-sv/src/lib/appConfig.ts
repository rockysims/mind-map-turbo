const NODE_RADIUS_PX = 200; // default node radius in layout and rendering

export const APP_CONFIG = {
	ai: {
		defaultModel: 'claude-opus-5', // model an unconfigured browser runs AI nodes on
		models: ['claude-opus-5', 'claude-sonnet-5'], // models offered in the settings sheet
		previewRows: 5, // rows of each input file a request may carry by default
		previewRowChoices: [0, 5, 20], // preview-row depths the settings sheet offers
		sendPlots: true, // send rendered plots back so Claude can check its own figure
		rememberKey: true, // keep the API key in this browser between sessions
		historyLength: 3, // runs kept on a node before the oldest is evicted
		effort: { analyse: 'high', refine: 'medium' }, // thinking effort per run mode
		maxToolCalls: 12, // script executions one run may ask for before the loop ends
		scriptTimeoutMs: 300000, // wall clock a single script execution may take
		stdoutTailChars: 8000, // trailing stdout/stderr characters a tool result carries
		maxImagesPerResult: 4, // rendered plots sent back per script execution
		maxImageBytes: 1_000_000, // largest rendered plot sent back, per image
		summaryMaxChars: 4000, // summary length a run record stores, truncated on the way in
		// What a follow-up's request carries about the steps before it. Named in
		// full rather than `summaryMaxChars`, which is taken above by the cap a run
		// record's own summary is stored under: two knobs sharing one name is a
		// question every reader of this file would have to answer twice.
		ancestorContext: {
			maxHops: 3, // ai steps back the walk reaches before it stops
			maxChars: 12000, // characters the rendered context section may take
			ancestorSummaryMaxChars: 1200 // each summary's cap once the section is over budget
		},
		maxResultsPerRun: 20, // distinct RESULT symbols one run may record
		resultUnitMaxChars: 32, // characters a RESULT line's unit is truncated to
		maxTokens: 32000, // output-token ceiling per Messages call
		runtime: {
			version: '0.27.7', // Pyodide version pinned so a run is reproducible
			indexUrl: 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/', // CDN the runtime loads from
			// The preload set only. scipy's wheel is 13 MB of the 33 MB the four
			// together cost and most scripts never touch it, so the executor calls
			// `loadPackagesFromImports` before every run and fetches whatever else a
			// script imports on demand (T01 spike decision).
			packages: ['pandas', 'numpy', 'matplotlib']
		}
	},
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
	history: {
		// Σ (nodes.length + edges.length) over undo entries before the oldest are
		// evicted. A ceiling rather than a depth cap: entries are structurally
		// shared, so what a session actually retains is pointers, and two sessions
		// at the same depth over graphs of different sizes are nothing alike. At
		// ~8 bytes a pointer this is ~16 MB in the worst case — 10,000 edits on a
		// 200-node graph, 2,000 on a 1,000-node one, both past any real session.
		retainedPointerCeiling: 2_000_000,
		// Undo entries serialized into the localStorage draft. On phones, where the
		// OS evicts background tabs freely, this tail *is* the effective history
		// depth — so it is the first number to revisit once a real session says
		// what an entry weighs.
		persistedEntryCount: 10,
		// Pre-flight ceiling on the tail's own serialized size (UTF-16 code units).
		// Over it, the oldest entries are dropped and the write still succeeds:
		// losing history is a smaller harm than losing the draft.
		persistedBudgetBytes: 256 * 1024
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
		minNodeHitRadiusPx: 32, // minimum tap/hit target radius
		// Border width can show one number per node on a bounded log scale:
		// `clamp(1 + widthPerDoubling * log2(value / reference), minFactor, maxFactor)`
		// multiplies the border width above. `source` picks the number; a node with
		// no value for it draws the widths as-is.
		borderWeight: {
			source: 'size', // none | size | weight | degree | attachments | descriptionLength
			widthPerDoubling: 0.15, // factor added each time the value doubles
			minFactor: 0.5, // thinnest border, as a multiple of the configured width
			maxFactor: 3 // thickest border, as a multiple of the configured width
		},
		// The value that draws exactly the configured border, per source.
		borderReference: {
			size: 1048576, // bytes (1 MiB)
			weight: 1,
			degree: 3, // edges
			attachments: 1,
			descriptionLength: 200 // characters
		},
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
		attachments: {
			warnBytesPerFile: 5 * 1024 * 1024, // per-file size the uploader asks about before adding
			warnTotalBytes: 25 * 1024 * 1024 // total attachment size above which the export size is reported
		},
		tagSyntax: {
			nodeTagMarker: '#', // leading marker for node tags in title/query shortcuts
			edgeTagMarker: '@', // leading marker for edge tags in title/query shortcuts
			addonMarker: '!' // leading marker for node add-ons from the closed registry
		},
		layout: {
			baseRadius: NODE_RADIUS_PX, // base radius for hop-scaled layout
			displayedLayers: 3, // hop layers visible around pinned nodes
			dataflowDisplayedLayers: 1, // hop layers a derived dataflow edge may reveal past those
			scaleFalloff: 0.7, // scale multiplier per hop from pinned
			minScale: 0.1, // minimum node scale in layout
			relaxIterations: 12, // physics relax iterations per layout pass
			parallelEdgeMaxOffsetRadiusFactor: 0.5, // max parallel-edge offset as fraction of smaller endpoint radius
			parallelEdgeClearancePx: 4, // extra gap between parallel edge strokes/arrowheads
			edgeGapMinRadiusFactor: 0.42, // min edge gap as fraction of the two nodes' combined radius
			edgeGapMaxRadiusFactor: 0.84, // max edge gap as fraction of the two nodes' combined radius
			edgeSpringStrength: 0.5, // how strongly edges pull nodes together
			derivedEdgeSpringFactor: 1, // derived dataflow edges pull this much relative to authored ones
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
			chipMaxVisibleQuantities: 3, // quantities a compact node names before a count
			chipPeekLongPressMs: 500, // hold on a details chip before its definition peek opens
			chipInsertLongPressMs: 500 // hold on an edit chip before its symbol is written into the text
		}
	}
} as const;
