import type { ConfigPath } from './configPaths';

/** Which section of the settings panel a field belongs to. */
export type Tier = 'basic' | 'advanced';

/**
 * What the user can expect to see when the field changes.
 *
 * - `instant` — redraws while dragging.
 * - `resize-only` — nodes resize in place; positions need the settle kick.
 * - `physics` — invisible at rest; visible while the relax loop runs.
 * - `gesture` — correct immediately, but only observable during a transition.
 * - `none` — live-applied with no visual feedback at all.
 */
export type Preview = 'instant' | 'resize-only' | 'physics' | 'gesture' | 'none';

export type FieldSpec =
	| { control: 'hidden'; reason: string }
	| {
			control: 'toggle';
			label: string;
			help?: string;
			tier: Tier;
			preview: Preview;
	  }
	| {
			control: 'range';
			label: string;
			help?: string;
			tier: Tier;
			preview: Preview;
			min: number;
			max: number;
			step: number;
			unit?: string;
	  }
	| {
			control: 'number';
			label: string;
			help?: string;
			tier: Tier;
			preview: Preview;
			min?: number;
			max?: number;
			step?: number;
			integer?: boolean;
			unit?: string;
	  };

const PERSISTENCE_REASON =
	'Persistence is built once in onMount; under per-graph scope the storage namespace is circular.';

const TAG_SYNTAX_REASON =
	'Tag markers retroactively reinterpret every stored node title — a data migration, not a setting.';

const ADDON_SYNTAX_REASON =
	'The add-on marker retroactively reinterprets every stored node title — a data migration, not a setting.';

const AI_REASON =
	'AI preferences belong to the browser, not the graph: one key and one set of run limits serve every `!ai` node in every graph, and the AI settings sheet owns the ones a reader may change.';

const HISTORY_REASON =
	'Undo history belongs to the draft, not the graph: the persistence controller reads these outside any graph’s resolved config.';

const ATTACHMENTS_REASON =
	'Read by the uploader and the export-size notice outside the canvas’s resolved config, so a per-graph value would not reach them.';

/**
 * Every leaf of `APP_CONFIG`, classified. The mapped type is the point: adding a
 * key to `APP_CONFIG` is a compile error until it is described here.
 *
 * Ranges are chosen for usability, not legality — the `number` control is the
 * out-of-range escape hatch.
 */
export const CONFIG_SCHEMA: { [K in ConfigPath]: FieldSpec } = {
	'ai.defaultModel': { control: 'hidden', reason: AI_REASON },
	'ai.models': { control: 'hidden', reason: AI_REASON },
	'ai.previewRows': { control: 'hidden', reason: AI_REASON },
	'ai.previewRowChoices': { control: 'hidden', reason: AI_REASON },
	'ai.sendPlots': { control: 'hidden', reason: AI_REASON },
	'ai.rememberKey': { control: 'hidden', reason: AI_REASON },
	'ai.historyLength': { control: 'hidden', reason: AI_REASON },
	'ai.effort.analyse': { control: 'hidden', reason: AI_REASON },
	'ai.effort.refine': { control: 'hidden', reason: AI_REASON },
	'ai.maxToolCalls': { control: 'hidden', reason: AI_REASON },
	'ai.scriptTimeoutMs': { control: 'hidden', reason: AI_REASON },
	'ai.stdoutTailChars': { control: 'hidden', reason: AI_REASON },
	'ai.maxImagesPerResult': { control: 'hidden', reason: AI_REASON },
	'ai.maxImageBytes': { control: 'hidden', reason: AI_REASON },
	'ai.summaryMaxChars': { control: 'hidden', reason: AI_REASON },
	'ai.maxTokens': { control: 'hidden', reason: AI_REASON },
	'ai.maxResultsPerRun': { control: 'hidden', reason: AI_REASON },
	'ai.resultUnitMaxChars': { control: 'hidden', reason: AI_REASON },
	'ai.ancestorContext.maxHops': { control: 'hidden', reason: AI_REASON },
	'ai.ancestorContext.maxChars': { control: 'hidden', reason: AI_REASON },
	'ai.ancestorContext.ancestorSummaryMaxChars': { control: 'hidden', reason: AI_REASON },
	'ai.runtime.version': { control: 'hidden', reason: AI_REASON },
	'ai.runtime.indexUrl': { control: 'hidden', reason: AI_REASON },
	'ai.runtime.packages': { control: 'hidden', reason: AI_REASON },

	'interaction.doubleClickMs': {
		control: 'range',
		label: 'Double-click gap',
		help: 'Longest pause between two clicks that still counts as a double-click.',
		tier: 'advanced',
		preview: 'none',
		min: 100,
		max: 600,
		step: 10,
		unit: 'ms'
	},
	'interaction.dragThresholdPx': {
		control: 'range',
		label: 'Drag threshold',
		tier: 'advanced',
		preview: 'none',
		min: 0,
		max: 40,
		step: 1,
		unit: 'px'
	},
	'interaction.longPressMs': {
		control: 'range',
		label: 'Long-press duration',
		tier: 'advanced',
		preview: 'none',
		min: 200,
		max: 3000,
		step: 50,
		unit: 'ms'
	},
	'interaction.longPressDistancePx': {
		control: 'range',
		label: 'Long-press slop',
		help: 'How far the pointer may move before a long press is abandoned.',
		tier: 'advanced',
		preview: 'none',
		min: 0,
		max: 40,
		step: 1,
		unit: 'px'
	},

	'persistence.storageNamespace': { control: 'hidden', reason: PERSISTENCE_REASON },
	'persistence.saveDebounceMs': { control: 'hidden', reason: PERSISTENCE_REASON },
	'persistence.quotaBudgetBytes': { control: 'hidden', reason: PERSISTENCE_REASON },
	'persistence.quotaWarningRatio': { control: 'hidden', reason: PERSISTENCE_REASON },

	'history.retainedPointerCeiling': { control: 'hidden', reason: HISTORY_REASON },
	'history.persistedEntryCount': { control: 'hidden', reason: HISTORY_REASON },
	'history.persistedBudgetBytes': { control: 'hidden', reason: HISTORY_REASON },

	'math.renderCacheMaxEntries': {
		control: 'number',
		label: 'Math render cache size',
		help: 'Rendered expressions kept before eviction.',
		tier: 'advanced',
		preview: 'none',
		min: 0,
		step: 50,
		integer: true
	},
	'math.maxSizeEm': {
		control: 'range',
		label: 'Max relative math size',
		help: 'Caps em-relative sizes so one rule cannot fill the screen.',
		tier: 'advanced',
		preview: 'none',
		min: 1,
		max: 40,
		step: 1,
		unit: 'em'
	},
	'math.maxSizePt': {
		control: 'range',
		label: 'Max absolute math size',
		tier: 'advanced',
		preview: 'none',
		min: 10,
		max: 400,
		step: 10,
		unit: 'pt'
	},
	'math.maxExpand': {
		control: 'number',
		label: 'Macro expansion cap',
		help: 'Stops runaway macro definitions.',
		tier: 'advanced',
		preview: 'none',
		min: 1,
		step: 100,
		integer: true
	},

	'multigraph.nodeRadiusPx': {
		control: 'hidden',
		reason:
			'Follows layout base radius; two independent radii would let node chrome and layout disagree.'
	},
	'multigraph.nodeTextFontSizePx': {
		control: 'range',
		label: 'Node text size',
		tier: 'basic',
		preview: 'instant',
		min: 8,
		max: 120,
		step: 1,
		unit: 'px'
	},
	'multigraph.nodeBorderWidthPx': {
		control: 'range',
		label: 'Node border width',
		tier: 'basic',
		preview: 'instant',
		min: 0,
		max: 40,
		step: 1,
		unit: 'px'
	},
	'multigraph.pinnedNodeBorderWidthPx': {
		control: 'range',
		label: 'Pinned node border width',
		tier: 'advanced',
		preview: 'instant',
		min: 0,
		max: 40,
		step: 1,
		unit: 'px'
	},
	'multigraph.minNodeHitRadiusPx': {
		control: 'range',
		label: 'Minimum tap target',
		help: 'Floor on a node hit area, however small the node is drawn.',
		tier: 'advanced',
		preview: 'instant',
		min: 0,
		max: 120,
		step: 4,
		unit: 'px'
	},

	'multigraph.sizeBorder.referenceBytes': {
		control: 'number',
		label: 'Reference size',
		help: 'A node of this many bytes draws the normal border.',
		tier: 'basic',
		preview: 'instant',
		min: 1,
		step: 1024,
		integer: true,
		unit: 'B'
	},
	'multigraph.sizeBorder.widthPerDoubling': {
		control: 'range',
		label: 'Width per doubling',
		help: 'How much thicker the border gets each time the size doubles.',
		tier: 'basic',
		preview: 'instant',
		min: 0,
		max: 0.5,
		step: 0.01
	},
	'multigraph.sizeBorder.minFactor': {
		control: 'range',
		label: 'Thinnest border',
		help: 'The border of the smallest nodes, as a multiple of the normal border.',
		tier: 'basic',
		preview: 'instant',
		min: 0.1,
		max: 1,
		step: 0.05,
		unit: '×'
	},
	'multigraph.sizeBorder.maxFactor': {
		control: 'range',
		label: 'Thickest border',
		help: 'The border of the largest nodes, as a multiple of the normal border.',
		tier: 'basic',
		preview: 'instant',
		min: 1,
		max: 4,
		step: 0.1,
		unit: '×'
	},

	'multigraph.edgeArrow.lengthPx': {
		control: 'range',
		label: 'Arrowhead length',
		tier: 'basic',
		preview: 'instant',
		min: 0,
		max: 60,
		step: 1,
		unit: 'px'
	},
	'multigraph.edgeArrow.halfHeightPx': {
		control: 'range',
		label: 'Arrowhead half-height',
		tier: 'advanced',
		preview: 'instant',
		min: 0,
		max: 40,
		step: 1,
		unit: 'px'
	},
	'multigraph.edgeArrow.referenceNodeScale': {
		control: 'range',
		label: 'Arrow reference scale',
		help: 'Node scale at which the configured arrow size applies.',
		tier: 'advanced',
		preview: 'instant',
		min: 0.05,
		max: 1,
		step: 0.05
	},

	'multigraph.edgeStroke.widthPx': {
		control: 'range',
		label: 'Edge width',
		tier: 'basic',
		preview: 'instant',
		min: 0,
		max: 20,
		step: 0.5,
		unit: 'px'
	},
	'multigraph.edgeStroke.referenceNodeScale': {
		control: 'range',
		label: 'Edge reference scale',
		help: 'Node scale at which the configured stroke width applies.',
		tier: 'advanced',
		preview: 'instant',
		min: 0.05,
		max: 1,
		step: 0.05
	},

	'multigraph.zoom.minScale': {
		control: 'range',
		label: 'Minimum zoom',
		tier: 'basic',
		preview: 'gesture',
		min: 0.01,
		max: 1,
		step: 0.01
	},
	'multigraph.zoom.maxScale': {
		control: 'range',
		label: 'Maximum zoom',
		tier: 'basic',
		preview: 'gesture',
		min: 1,
		max: 20,
		step: 0.5
	},

	'multigraph.focus.entryGestureIdleMs': {
		control: 'range',
		label: 'Focus entry idle gap',
		help: 'Quiet gap before residual zoom input counts as a fresh gesture.',
		tier: 'advanced',
		preview: 'gesture',
		min: 0,
		max: 1000,
		step: 10,
		unit: 'ms'
	},
	'multigraph.focus.entryGestureMaxMs': {
		control: 'range',
		label: 'Focus entry gesture cap',
		tier: 'advanced',
		preview: 'gesture',
		min: 0,
		max: 2000,
		step: 20,
		unit: 'ms'
	},
	'multigraph.focus.boundaryNearTouchMarginPx': {
		control: 'range',
		label: 'Focus boundary margin',
		help: 'Tolerance for treating a zoom subject as inscribed.',
		tier: 'advanced',
		preview: 'gesture',
		min: 0,
		max: 40,
		step: 1,
		unit: 'px'
	},
	'multigraph.focus.detailsCornerRadiusPx': {
		control: 'range',
		label: 'Focused node corner radius',
		tier: 'advanced',
		preview: 'instant',
		min: 0,
		max: 80,
		step: 1,
		unit: 'px'
	},
	'multigraph.focus.detailsBorderWidthPx': {
		control: 'range',
		label: 'Focused node border width',
		tier: 'advanced',
		preview: 'instant',
		min: 0,
		max: 40,
		step: 1,
		unit: 'px'
	},
	'multigraph.focus.preInscribeZoneFraction': {
		control: 'range',
		label: 'Focus entry zone',
		help: 'Fraction of the inscribe scale used for the entry scrub.',
		tier: 'advanced',
		preview: 'gesture',
		min: 0,
		max: 1,
		step: 0.01
	},
	'multigraph.focus.subFitExitZoneFraction': {
		control: 'range',
		label: 'Focus exit zone',
		help: 'Fraction below the fit scale used for the exit scrub.',
		tier: 'advanced',
		preview: 'gesture',
		min: 0,
		max: 1,
		step: 0.01
	},
	'multigraph.focus.eligibilityCoverageRatio': {
		control: 'range',
		label: 'Focus eligibility coverage',
		help: 'How far inside the projected node circle the focal point must sit.',
		tier: 'advanced',
		preview: 'gesture',
		min: 0,
		max: 2,
		step: 0.05
	},
	'multigraph.focus.entryTransitionMs': {
		control: 'range',
		label: 'Focus transition duration',
		tier: 'advanced',
		preview: 'gesture',
		min: 0,
		max: 2000,
		step: 20,
		unit: 'ms'
	},
	'multigraph.focus.worldWheelSensitivity': {
		control: 'range',
		label: 'Focused world wheel sensitivity',
		tier: 'advanced',
		preview: 'gesture',
		min: 0.0005,
		max: 0.01,
		step: 0.0005
	},
	'multigraph.focus.worldMaxScale': {
		control: 'range',
		label: 'Focused world max zoom',
		tier: 'advanced',
		preview: 'gesture',
		min: 1,
		max: 32,
		step: 1
	},

	'multigraph.tagSyntax.nodeTagMarker': { control: 'hidden', reason: TAG_SYNTAX_REASON },
	'multigraph.tagSyntax.edgeTagMarker': { control: 'hidden', reason: TAG_SYNTAX_REASON },
	'multigraph.tagSyntax.addonMarker': { control: 'hidden', reason: ADDON_SYNTAX_REASON },

	'multigraph.attachments.warnBytesPerFile': { control: 'hidden', reason: ATTACHMENTS_REASON },
	'multigraph.attachments.warnTotalBytes': { control: 'hidden', reason: ATTACHMENTS_REASON },

	'multigraph.layout.baseRadius': {
		control: 'range',
		label: 'Node radius',
		help: 'Base radius before hop scaling. Node chrome follows this too.',
		tier: 'basic',
		preview: 'resize-only',
		min: 50,
		max: 600,
		step: 10,
		unit: 'px'
	},
	'multigraph.layout.displayedLayers': {
		control: 'range',
		label: 'Displayed hop layers',
		tier: 'basic',
		preview: 'resize-only',
		min: 1,
		max: 8,
		step: 1
	},
	'multigraph.layout.dataflowDisplayedLayers': {
		control: 'range',
		label: 'Dataflow hop layers',
		help: 'Extra hop layers a derived dataflow edge may reveal.',
		tier: 'basic',
		preview: 'resize-only',
		min: 0,
		max: 8,
		step: 1
	},
	'multigraph.layout.scaleFalloff': {
		control: 'range',
		label: 'Scale falloff per hop',
		tier: 'basic',
		preview: 'resize-only',
		min: 0,
		max: 1,
		step: 0.05
	},
	'multigraph.layout.minScale': {
		control: 'range',
		label: 'Minimum node scale',
		tier: 'basic',
		preview: 'resize-only',
		min: 0.01,
		max: 1,
		step: 0.01
	},
	'multigraph.layout.relaxIterations': {
		control: 'number',
		label: 'Relax iterations',
		help: 'Physics iterations per layout pass.',
		tier: 'advanced',
		preview: 'physics',
		min: 0,
		step: 1,
		integer: true
	},
	'multigraph.layout.parallelEdgeMaxOffsetRadiusFactor': {
		control: 'range',
		label: 'Parallel edge offset',
		help: 'Largest offset as a fraction of the smaller endpoint radius.',
		tier: 'advanced',
		preview: 'instant',
		min: 0,
		max: 1,
		step: 0.05
	},
	'multigraph.layout.parallelEdgeClearancePx': {
		control: 'range',
		label: 'Parallel edge clearance',
		tier: 'advanced',
		preview: 'instant',
		min: 0,
		max: 40,
		step: 1,
		unit: 'px'
	},
	'multigraph.layout.edgeGapMinRadiusFactor': {
		control: 'range',
		label: 'Minimum edge gap',
		help: "As a fraction of the two nodes' combined radius.",
		tier: 'advanced',
		preview: 'physics',
		min: 0,
		max: 1,
		step: 0.01
	},
	'multigraph.layout.edgeGapMaxRadiusFactor': {
		control: 'range',
		label: 'Maximum edge gap',
		help: "As a fraction of the two nodes' combined radius.",
		tier: 'advanced',
		preview: 'physics',
		min: 0,
		max: 2,
		step: 0.01
	},
	'multigraph.layout.edgeSpringStrength': {
		control: 'range',
		label: 'Edge spring strength',
		tier: 'basic',
		preview: 'physics',
		min: 0,
		// Physics clamps the strength to [0, 1] (`relaxEdgeDistancesStep`), so a
		// slider past 1 would move the thumb and change nothing.
		max: 1,
		step: 0.05
	},
	'multigraph.layout.derivedEdgeSpringFactor': {
		control: 'range',
		label: 'Derived edge spring factor',
		help: 'How hard derived dataflow edges pull, relative to authored ones.',
		tier: 'advanced',
		preview: 'physics',
		min: 0,
		max: 2,
		step: 0.05
	},
	'multigraph.layout.hopRepulsionStrength': {
		control: 'range',
		label: 'Hop repulsion strength',
		tier: 'basic',
		preview: 'physics',
		min: 0,
		// Physics clamps the strength to [0, 1] (`relaxHopRepulsionStep`), so a
		// slider past 1 would move the thumb and change nothing.
		max: 1,
		step: 0.05
	},
	'multigraph.layout.hopRepulsionMinHops': {
		control: 'range',
		label: 'Repulsion start hop',
		tier: 'advanced',
		preview: 'physics',
		min: 0,
		max: 8,
		step: 1
	},
	'multigraph.layout.hopRepulsionMaxHops': {
		control: 'range',
		label: 'Repulsion peak hop',
		tier: 'advanced',
		preview: 'physics',
		min: 0,
		max: 12,
		step: 1
	},
	'multigraph.layout.hopRepulsionMaxExtraGapRadiusFactor': {
		control: 'range',
		label: 'Repulsion extra gap cap',
		tier: 'advanced',
		preview: 'physics',
		min: 0,
		max: 8,
		step: 0.1
	},
	'multigraph.layout.postDragSettleEpsilonPx': {
		control: 'range',
		label: 'Post-drag settle threshold',
		help: 'Motion below this ends the settle.',
		tier: 'advanced',
		preview: 'gesture',
		min: 0.01,
		max: 5,
		step: 0.01,
		unit: 'px'
	},
	'multigraph.layout.postDragSettleMaxFrames': {
		control: 'number',
		label: 'Post-drag settle frames',
		tier: 'advanced',
		preview: 'gesture',
		min: 0,
		step: 10,
		integer: true
	},
	'multigraph.layout.postScaleChangeSettleMaxFrames': {
		control: 'number',
		label: 'Post-scale settle frames',
		tier: 'advanced',
		preview: 'gesture',
		min: 0,
		step: 10,
		integer: true
	},
	'multigraph.layout.scaleAnimationDurationMs': {
		control: 'range',
		label: 'Scale animation duration',
		tier: 'basic',
		preview: 'gesture',
		min: 0,
		max: 2000,
		step: 20,
		unit: 'ms'
	},
	'multigraph.layout.normalizeRelaxationTranslation': {
		control: 'toggle',
		label: 'Remove layout drift',
		help: 'Cancels whole-graph translation during the per-frame settle.',
		tier: 'advanced',
		preview: 'physics'
	},
	'multigraph.layout.normalizeRelaxationRotation': {
		control: 'toggle',
		label: 'Remove layout spin',
		help: 'Cancels whole-graph rotation during the per-frame settle.',
		tier: 'advanced',
		preview: 'physics'
	},
	'multigraph.layout.maxRelaxationRotationPerFrameRad': {
		control: 'number',
		label: 'Max rotation per frame',
		help: 'Rotation fits larger than this are treated as degenerate and skipped.',
		tier: 'advanced',
		preview: 'physics',
		min: 0,
		max: Math.PI,
		step: 0.01,
		unit: 'rad'
	},
	'multigraph.layout.layeredRelayoutSettleMaxFrames': {
		control: 'number',
		label: 'Layered relayout frames',
		tier: 'advanced',
		preview: 'gesture',
		min: 0,
		step: 5,
		integer: true
	},
	'multigraph.layout.layeredRelayoutSettleMaxFramesFinal': {
		control: 'number',
		label: 'Final relayout frames',
		tier: 'advanced',
		preview: 'gesture',
		min: 0,
		step: 10,
		integer: true
	},
	'multigraph.layout.layeredRelayoutSettleEpsilonPx': {
		control: 'range',
		label: 'Layered relayout threshold',
		tier: 'advanced',
		preview: 'gesture',
		min: 0.01,
		max: 5,
		step: 0.01,
		unit: 'px'
	},
	'multigraph.layout.enterExitDurationMs': {
		control: 'range',
		label: 'Enter and exit animation',
		help: 'Zero is instant.',
		tier: 'basic',
		preview: 'gesture',
		min: 0,
		max: 2000,
		step: 20,
		unit: 'ms'
	},
	'multigraph.layout.revealFrontWidthHops': {
		control: 'range',
		label: 'Reveal wave width',
		tier: 'advanced',
		preview: 'gesture',
		min: 0,
		max: 8,
		step: 1
	},
	'multigraph.layout.edgeOcclusionClearancePx': {
		control: 'range',
		label: 'Edge occlusion clearance',
		tier: 'advanced',
		preview: 'instant',
		min: 0,
		max: 100,
		step: 1,
		unit: 'px'
	},
	'multigraph.layout.edgeOcclusionFadeWidthPx': {
		control: 'range',
		label: 'Edge occlusion fade width',
		tier: 'advanced',
		preview: 'instant',
		min: 0,
		max: 100,
		step: 1,
		unit: 'px'
	},
	'multigraph.layout.edgeOcclusionZoomScaleExponent': {
		control: 'range',
		label: 'Edge occlusion zoom exponent',
		help: 'Lower values make occlusion scale more gently with zoom.',
		tier: 'advanced',
		preview: 'instant',
		min: 0,
		max: 2,
		step: 0.05
	},
	'multigraph.layout.edgeOcclusionMinOpacity': {
		control: 'range',
		label: 'Edge occlusion minimum opacity',
		tier: 'advanced',
		preview: 'instant',
		min: 0,
		max: 1,
		step: 0.01
	},

	'multigraph.dataflow.labelMinStageScale': {
		control: 'range',
		label: 'Quantity label zoom threshold',
		help: 'Zoom below which edge quantity labels stay hidden.',
		tier: 'advanced',
		preview: 'instant',
		min: 0,
		max: 4,
		step: 0.05
	},
	'multigraph.dataflow.labelMinOnScreenLengthPx': {
		control: 'range',
		label: 'Shortest labelled edge',
		tier: 'advanced',
		preview: 'instant',
		min: 0,
		max: 400,
		step: 10,
		unit: 'px'
	},
	'multigraph.dataflow.labelMaxVisibleQuantities': {
		control: 'range',
		label: 'Quantities named on an edge',
		help: 'Beyond this the label collapses to a count.',
		tier: 'advanced',
		preview: 'instant',
		min: 0,
		max: 10,
		step: 1
	},
	'multigraph.dataflow.chipMinOnScreenDiameterPx': {
		control: 'range',
		label: 'Chip visibility node size',
		help: 'On-screen node size below which chips are hidden.',
		tier: 'advanced',
		preview: 'instant',
		min: 0,
		max: 600,
		step: 10,
		unit: 'px'
	},
	'multigraph.dataflow.chipMaxVisibleQuantities': {
		control: 'range',
		label: 'Quantities named on a node',
		help: 'Beyond this the node collapses them to a count.',
		tier: 'advanced',
		preview: 'instant',
		min: 0,
		max: 10,
		step: 1
	},
	'multigraph.dataflow.chipPeekLongPressMs': {
		control: 'range',
		label: 'Chip peek hold',
		tier: 'advanced',
		preview: 'none',
		min: 100,
		max: 2000,
		step: 50,
		unit: 'ms'
	},
	'multigraph.dataflow.chipInsertLongPressMs': {
		control: 'range',
		label: 'Chip insert hold',
		tier: 'advanced',
		preview: 'none',
		min: 100,
		max: 2000,
		step: 50,
		unit: 'ms'
	}
};
