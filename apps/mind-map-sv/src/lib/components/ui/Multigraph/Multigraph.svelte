<script module lang="ts">
	import type { QuantityDesignation } from '../types/node';
	import type { ConfigOverrides, ResolvedConfig } from '$lib/config/configOverrides';
	import type { ConfigPath, ConfigValue } from '$lib/config/configPaths';
	import { CONFIG_SCHEMA } from '$lib/config/configSchema';

	/**
	 * Shared so a node with no confirmed inputs allocates nothing. The peek
	 * cascade asks for a definer's inputs on every render of every card, and
	 * `nodeById` rebuilds on each settle frame, so a fresh `[]` here would churn
	 * the cards' derived work for a graph that did not change.
	 */
	const EMPTY_DESIGNATIONS: readonly QuantityDesignation[] = [];

	/**
	 * Shared empty overrides, so a graph with no settings of its own hands the
	 * same object to `resolveConfig` on every render and the derived config keeps
	 * its identity. A fresh `{}` prop fallback would invalidate every measurement
	 * this component derives, once per render.
	 */
	const NO_OVERRIDES: ConfigOverrides = {};

	/**
	 * The settings whose change the layout cannot show on its own.
	 *
	 * `resize-only` fields recompute radius and scale through a `$derived` layout
	 * built with `relaxIterations: 0`, so nodes grow in place and overlap;
	 * `physics` fields are read per frame, so they change nothing at all while the
	 * loop is stopped. Both need the frame loop kicked. `instant`, `gesture` and
	 * `none` fields either redraw themselves or are correct the moment the next
	 * gesture asks, so kicking for them would settle the graph for nothing.
	 *
	 * Derived from the schema once, at module scope: the list follows
	 * `CONFIG_SCHEMA`, so a field reclassified there needs no edit here.
	 */
	const SETTLE_KICK_PATHS: readonly ConfigPath[] = (
		Object.entries(CONFIG_SCHEMA) as [ConfigPath, (typeof CONFIG_SCHEMA)[ConfigPath]][]
	)
		.filter(
			([, spec]) =>
				spec.control !== 'hidden' && (spec.preview === 'resize-only' || spec.preview === 'physics')
		)
		.map(([path]) => path);

	/** Reads the leaf at a dotted path out of an already-resolved config. */
	function readResolvedValue(config: ResolvedConfig, path: ConfigPath): ConfigValue | undefined {
		let current: unknown = config;
		for (const segment of path.split('.')) {
			if (typeof current !== 'object' || current === null) return undefined;
			current = (current as Record<string, unknown>)[segment];
		}
		if (
			typeof current === 'number' ||
			typeof current === 'boolean' ||
			typeof current === 'string'
		) {
			return current;
		}
		return undefined;
	}

	/**
	 * One string standing for every value that needs a settle kick, so the effect
	 * that kicks depends on those values and nothing else — not on the override
	 * map, whose identity changes on every preview tick regardless of which field
	 * moved.
	 */
	function settleKickFingerprint(config: ResolvedConfig): string {
		return SETTLE_KICK_PATHS.map((path) => String(readResolvedValue(config, path))).join('|');
	}
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import Node from '$lib/components/ui/Node/Node.svelte';
	import NodeChrome from '$lib/components/ui/Node/NodeChrome.svelte';
	import NodeCompactContent from '$lib/components/ui/Node/NodeCompactContent.svelte';
	import NodeDetailsLayer from '$lib/components/ui/Node/NodeDetailsLayer.svelte';
	import DuplicateEdgeDialog from './DuplicateEdgeDialog.svelte';
	import GraphQueryPanel from './GraphQueryPanel.svelte';
	import MergeConfirmDialog from './MergeConfirmDialog.svelte';
	import NodeDetailsContent from './NodeDetailsContent.svelte';
	import AiNodeContent from './AiNodeContent.svelte';
	import NodeActionMenu from './NodeActionMenu.svelte';
	import NavBreadcrumbs from './NavBreadcrumbs.svelte';
	import { mathPlainText } from '../MathText/lib/mathPlainText';
	import type { QuantitySymbol } from '../MathText/lib/mathSymbols';
	import { cycleDesignation, designateAs } from './lib/quantityDesignations.js';
	import NodeEditSheet from './NodeEditSheet.svelte';
	import DeepZoomStack, { type StackFrameArgs, type LayerBaseSize } from './DeepZoomStack.svelte';
	import Stage from './Stage.svelte';
	import TagColorLegend from './TagColorLegend.svelte';
	import SettingsPanel from '$lib/components/ui/SettingsPanel/SettingsPanel.svelte';
	import { resolveConfig, setOverride } from '$lib/config/configOverrides';
	import type { AiClient } from '$lib/ai/aiClient';
	import { defaultAiSettings, type AiSettings } from '$lib/ai/aiSettings';
	import type { PyExecutor } from '$lib/ai/pyExecutor';
	import type { GraphAssetStore } from '$lib/assets/assetStore';
	import { tombstoneAsset } from '$lib/assets/assetTrash';
	import { prefersReducedMotion } from '$lib/reducedMotion';
	import { collectAiAncestors } from './lib/aiAncestry';
	import { collectAiInputs } from './lib/aiInputs';
	import { createFollowUpNode, inheritedScript, promoteAiOutput, setAiPrompt } from './lib/aiNode';
	import { defaultRunMode } from './lib/aiWorkbenchView';
	import { createAiRunController, type AiRunOutcome } from './lib/aiRunController.svelte';
	import type { AiRunMode, NodeContentBlock, NodeData } from '../types/node';
	import type { EdgeData } from '../types/edge';
	import type { GraphCommitIntent } from '../types/history';
	import type { TagColorChangePhase } from './lib/tagColors.js';
	import type {
		GraphAssetMetadata,
		MultigraphData,
		Point,
		TagColorNamespace
	} from '../types/multigraph';
	import { effectiveHitRadius, isPointInCircle } from './lib/hitTest.js';
	import {
		edgeArrowScale,
		edgeBackground,
		edgeRenderPoints,
		edgeStrokeScale,
		edgeStyle,
		type RenderableEdgeVisibility
	} from './lib/edgeStyle.js';
	import { trimSegmentToNodeBorders } from './lib/edgeRender.js';
	import {
		computeEdgeOcclusionWindows,
		edgeOcclusionParametersForZoom,
		type EdgeOcclusionNode
	} from './lib/edgeOcclusion.js';
	import {
		NEW_NODE_TITLE,
		addEdge,
		addNodeContentBlock,
		addNode,
		commitInlineTitleSyntax,
		commitSheetTitleSyntax,
		deleteTagEverywhere,
		duplicateEdgeIdentifier,
		findExistingEdge,
		moveNode,
		neighborsOf,
		removeEdge,
		removeNode,
		referencedAssetIds,
		removeNodeAddon,
		removeNodeContentBlock,
		replaceNodeContentBlockAsset,
		moveNodeContentBlock,
		setNodeAddon,
		setNodeDesignations,
		setNodePinned,
		setTagColor,
		setTaskDone,
		togglePinned,
		updateEdge,
		updateNodeFileContent,
		updateNodeImageContent,
		updateNodeContent
	} from './lib/graph.js';
	import { addonIntentLabel, type NodeAddonName } from './lib/nodeAddons';
	import { deriveGraphLayout, withSettledGraphPositions } from './lib/graphLayout.js';
	import { evaluateGraphQuery, type GraphQueryElementState } from './lib/graphQuery.js';
	import { beaconNodeIds } from './lib/beacons.js';
	import { pinScrollToOrigin } from './lib/pinScroll';
	import { severedComponentAfterMutation } from './lib/severedComponent.js';
	import type { LayoutSettings } from './lib/layoutSettings.js';
	import { DEFAULT_LAYOUT_SETTINGS, withDefaultLayoutSettings } from './lib/layoutSettings.js';
	import {
		composeVisibleLayoutGraph,
		computeBoundedHops,
		edgeVisibilityForPinnedNeighborhood,
		visibleNodeIdsForPinnedNeighborhood,
		withDerivedBoundaryEdgesHidden
	} from './lib/boundedVisibility.js';
	import { composeEdgesForRender, createDataflowModel } from './lib/dataflowLayer.js';
	import { isDerivedEdgeId, type DerivedEdge } from './lib/derivedEdges.js';
	import { computeDataflowDiagnostics } from './lib/dataflowDiagnostics.js';
	import { nodeDiagnosticsView } from './lib/nodeDiagnosticsView.js';
	import {
		quantityChips,
		shouldShowQuantityChips,
		type QuantityChips
	} from '../Node/lib/quantityChips.js';
	import {
		edgeAngleDegrees,
		formatQuantityLabel,
		shouldRevealQuantityLabel
	} from './lib/quantityLabels.js';
	import { LayoutRuntime } from './lib/layoutRuntime.svelte.js';
	import { TransientRevealController } from './lib/transientReveal.svelte.js';
	import { navBreadcrumbs } from './lib/navStack.js';
	import { externalGraphSyncToken } from './lib/graphSync.js';
	import type { EntryGestureDirection } from './lib/entryGestureGate.js';
	import {
		collectLegendTags,
		edgeStrokeColor,
		nodeBorderSegments,
		tagBorderBackground,
		tagUsageCount
	} from './lib/tagColors.js';
	import type { ViewState } from '$lib/migrations.js';
	import {
		EMPTY_EXITING_BUFFER,
		addExitingEdge,
		addExitingNode,
		cancelExitingEdge,
		cancelExitingNode,
		createEdgeEnterAnimation,
		createNodeEnterAnimation,
		edgeOpacityAt,
		exitingEdgeOpacityAt,
		exitingNodeScaleAt,
		hasActiveEdgeEnterAnimations,
		hasActiveExiting,
		hasActiveNodeEnterAnimations,
		nodeEnterScaleAt,
		pruneFinishedEdgeEnterAnimations,
		pruneFinishedExiting,
		pruneFinishedNodeEnterAnimations,
		type EdgeOpacityAnimation,
		type ExitingBuffer,
		type NodeEnterAnimation
	} from './lib/elementTransitions.js';
	import {
		beginCreationPreview,
		creationPreviewScaleAt,
		endCreationPreview,
		isCreationPreviewSettled,
		updateCreationPreview,
		type CreationPreviewState
	} from './lib/creationPreview.js';
	import type { NodeGestureMode } from './lib/creationGesture.js';
	import { planNodeMerge, type NodeMergePlan } from './lib/nodeMerge.js';
	import { computeParallelEdgeOffsets } from './lib/parallelEdges.js';
	import type { FocusLevel } from './lib/focusRuntime.svelte.js';
	import { FocusController } from './lib/focusController.svelte.js';
	import {
		nodeScreenCircle,
		type NodeFocusCandidate,
		type ViewTransform
	} from './lib/nodeFocus.js';
	import { graphIsLost } from './lib/graphOnScreen.js';
	import {
		frameGeometry,
		type FrameGeometry,
		type FrameViewState,
		type NodeFrameLayout
	} from './lib/frameGeometry.js';
	import { interpolateMorph } from './lib/morphGeometry.js';
	import { importRevealTargetNodeId } from './lib/importRevealTarget.js';
	import {
		revealPursuitStep,
		viewportWorldRect,
		type CameraViewState,
		type RevealCircle,
		type RevealPursuit,
		type StageSize
	} from './lib/revealCamera.js';
	import { DEFAULT_MAX_SCALE, DEFAULT_MIN_SCALE } from './lib/graphMath.js';
	import type { Rect } from './lib/zoomBoundary.js';
	import type { StageRect } from './lib/stageCoordinates.js';
	import { hasSize, usableStageRect } from './lib/stageCoordinates.js';

	const CENTERED_POSITION: Point = { x: 0, y: 0 };

	/**
	 * An in-flight import reveal: the pure chase state plus the two things only
	 * this component can supply — who is being chased, and where it was last frame.
	 */
	type ImportRevealPursuit = RevealPursuit & {
		nodeId: string;
		lastTarget: RevealCircle;
	};

	/**
	 * Stand-ins for the node/edge a finishing creation gesture would commit
	 * (see addNode/addEdge in lib/graph.ts) so the preview looks identical to
	 * the real elements it hands off to.
	 */
	const CREATION_PREVIEW_NODE: NodeData = {
		id: 'creation-preview',
		title: NEW_NODE_TITLE,
		description: '',
		tags: [],
		pinned: true
	};
	const CREATION_PREVIEW_EDGE: EdgeData = {
		id: 'creation-preview-edge',
		sourceNodeId: 'creation-preview-source',
		targetNodeId: 'creation-preview',
		tags: []
	};
	/**
	 * The merge gesture's own colour, for both the preview line and the ring on
	 * the node about to absorb — nothing else on the canvas is this amber, so
	 * "absorb into" never reads as "connect to". Kept in sync with the
	 * `.node-wrapper.merge-target` ring in the style block below.
	 */
	const MERGE_PREVIEW_COLOR = '#b45309';
	/**
	 * Breathing room around the revealed node, as a fraction of its own radius —
	 * so the reveal frames a node rather than jamming it against the bezel, at
	 * whatever size the layout drew it.
	 */
	const IMPORT_REVEAL_MARGIN_RADIUS_FACTOR = 0.5;
	const DETAILS_TITLE_ID = 'node-focus-title';
	/** Modest starting corner radius for an image frame's descend morph. */
	const IMAGE_SOURCE_RADIUS_PX = 8;
	/** Fixed logical size of the image level's compact (thumbnail) layer. */
	const IMAGE_COMPACT_PX = 96;

	let {
		multigraphData = {
			nodes: [],
			edges: [],
			posByNodeId: {},
			tagColorConfig: { nodeTags: {}, edgeTags: {} },
			assets: {}
		},
		graphGeneration = 0,
		graphRevision = 0,
		restoredCanvasState = null,
		defaultPrimaryNodeId = '',
		initialTitleEditNodeId,
		layoutSettings = {},
		initialViewState,
		onMultigraphChange,
		onViewStateChange,
		onHistoryGuardChange,
		onHistoryStep,
		nodeRenderOverrides,
		edgeRenderOverrides,
		exitingBuffer,
		assetStore = null,
		assetScope = '',
		dataflowEnabled = true,
		aiClient = null,
		aiExecutor = null,
		aiSettings = defaultAiSettings(),
		onOpenAiSettings,
		settings = NO_OVERRIDES,
		settingsPanelOpen = false,
		onSettingsChange,
		onSettingsPanelClose
	}: {
		multigraphData: MultigraphData;
		/** Bumped when the document is swapped: this component is keyed on it and remounts. */
		graphGeneration?: number;
		/**
		 * Bumped when the *same* document is mutated from outside this component (an
		 * additive import). Not part of the caller's key: the canvas stays mounted
		 * and adopts the incoming graph in place, keeping pan, zoom, focus and nav.
		 */
		graphRevision?: number;
		/**
		 * What the newest `graphRevision` bump is asking to be put back, or `null`
		 * when that bump was an arrival (an additive import) rather than a restore.
		 * The two adopt paths differ in exactly two ways: a restore moves no camera,
		 * and it re-points the pin and beacon state the graph does not carry.
		 */
		restoredCanvasState?: { primaryNodeId: string; severedBeaconPreference: string[] } | null;
		defaultPrimaryNodeId?: string;
		initialTitleEditNodeId?: string | null;
		layoutSettings?: Partial<LayoutSettings>;
		initialViewState?: ViewState;
		/**
		 * `generation` names the external graph load this edit was made to, so a
		 * commit that lands while the canvas is being replaced can be told apart
		 * from one made to the graph now on screen. `intent` says what the edit
		 * was, and carries the canvas state a restore of it has to put back.
		 */
		onMultigraphChange?: (
			data: MultigraphData,
			generation: number,
			intent: GraphCommitIntent
		) => void;
		onViewStateChange?: (state: ViewState) => void;
		/**
		 * Why an undo/redo must not run right now, or `null` when one may.
		 *
		 * Reported outward rather than enforced twice: the state that blocks a
		 * restore — an open edit sheet, a finger mid-drag — lives in here, and the
		 * toolbar has to disable and explain from the same judgement the keyboard
		 * shortcut obeys.
		 */
		onHistoryGuardChange?: (reason: string | null) => void;
		/** Step the history. Fired only from inside the guard. */
		onHistoryStep?: (direction: 'undo' | 'redo') => void;
		/** Static per-node opacity override; used by stories and T04/T05 animation wiring. Default 1. */
		nodeRenderOverrides?: Record<string, { opacity?: number }>;
		/** Static per-edge opacity override; used by stories and T04/T05 animation wiring. Default 1. */
		edgeRenderOverrides?: Record<string, { opacity?: number }>;
		/** Elements that have left the visible set but are still animating out. Rendered but non-interactive. */
		exitingBuffer?: ExitingBuffer;
		assetStore?: GraphAssetStore | null;
		assetScope?: string;
		/** Draw dataflow edges inferred from the math in node descriptions. */
		dataflowEnabled?: boolean;
		/**
		 * The Messages client, or `null` when no key has been entered. Its absence
		 * *is* the no-key state: the page builds one only when it has a key, so
		 * nothing down here has to hold the key to know whether a run can start.
		 */
		aiClient?: AiClient | null;
		/** The page's one Python executor. `null` before it is constructed. */
		aiExecutor?: PyExecutor | null;
		/** Model, preview depth and whether plots go back for checking. */
		aiSettings?: AiSettings;
		/**
		 * Open the key sheet. `afterConnect` runs once a key has been saved, which
		 * is how a run stopped by a missing key resumes without a second press.
		 */
		onOpenAiSettings?: (afterConnect?: () => void) => void;
		/** This graph's persisted tunables, sparse: only what its author changed. */
		settings?: ConfigOverrides;
		/** Whether the settings panel is showing. Owned by the page, beside the toolbar button. */
		settingsPanelOpen?: boolean;
		/** A committed settings map, ready to persist. Never fired while a slider is moving. */
		onSettingsChange?: (next: ConfigOverrides) => void;
		/** The panel asked to close itself; the page owns whether it is open. */
		onSettingsPanelClose?: () => void;
	} = $props();

	/**
	 * The setting a slider is moving right now, if any. One is enough: a pointer
	 * drags one slider at a time, and the panel's contract is that a preview is
	 * transient by construction — it is replaced by the next preview and dropped
	 * by the commit that ends the drag.
	 */
	let settingsPreview = $state<{ path: ConfigPath; value: ConfigValue } | null>(null);

	/**
	 * `settings` with the in-flight preview laid over it.
	 *
	 * Deliberately a plain write rather than `setOverride`: that function drops a
	 * value equal to the shipped default, which is right for a commit (so saved
	 * settings never accumulate no-ops) and wrong here — dragging a slider back
	 * through its default must show the default, not the value underneath it.
	 */
	const previewedOverrides = $derived.by((): ConfigOverrides => {
		const preview = settingsPreview;
		if (preview === null) return settings;
		const next: Partial<Record<ConfigPath, ConfigValue>> = { ...settings };
		next[preview.path] = preview.value;
		// Every key still holds the value of its own leaf; the widened map type is
		// what forgets which key each value came from.
		return next as ConfigOverrides;
	});

	/**
	 * The one place this component reads tunables: the shipped defaults with this
	 * graph's own settings merged over them, plus whatever slider is moving.
	 *
	 * Every measurement, timing and threshold below is derived from `cfg` rather
	 * than captured at import or at component init, and every child that needs one
	 * is handed it explicitly — never left to its own prop default, which is
	 * evaluated once and would silently swallow a change. That is what makes a
	 * slider visible while it is being dragged: the drag feeds `previewedOverrides`
	 * and every pixel below re-derives from it.
	 */
	const cfg = $derived(resolveConfig(previewedOverrides));

	const focusTransitionMs = $derived(cfg.multigraph.focus.entryTransitionMs);
	/**
	 * How long the camera takes to travel to an arriving import.
	 *
	 * The focus morph duration, not a number of its own: it is the one length in
	 * the config that already means "the view is travelling somewhere on its own",
	 * and a second would only invite the two to drift apart. Derived rather than
	 * captured, because that length is a setting the reader can change.
	 */
	const importRevealTransitionMs = $derived(focusTransitionMs);
	/**
	 * Hard cap on how long the reveal may keep chasing a still-moving arrival.
	 *
	 * The pursuit normally ends the moment the node comes to rest, but physics can
	 * jitter below its own settle epsilon indefinitely, and a camera that never
	 * lets go of the reader is worse than one that stops a little early.
	 */
	const importRevealMaxPursuitMs = $derived(focusTransitionMs * 3);
	const focusEntryGestureIdleMs = $derived(cfg.multigraph.focus.entryGestureIdleMs);
	const focusEntryGestureMaxMs = $derived(cfg.multigraph.focus.entryGestureMaxMs);
	const focusDetailsCornerRadiusPx = $derived(cfg.multigraph.focus.detailsCornerRadiusPx);
	const focusDetailsBorderWidthPx = $derived(cfg.multigraph.focus.detailsBorderWidthPx);
	const nodeTextFontSizePx = $derived(cfg.multigraph.nodeTextFontSizePx);
	const nodeBorderWidthPx = $derived(cfg.multigraph.nodeBorderWidthPx);
	const pinnedNodeBorderWidthPx = $derived(cfg.multigraph.pinnedNodeBorderWidthPx);
	const minNodeHitRadiusPx = $derived(cfg.multigraph.minNodeHitRadiusPx);
	const arrowLengthPx = $derived(cfg.multigraph.edgeArrow.lengthPx);
	const arrowHalfHeightPx = $derived(cfg.multigraph.edgeArrow.halfHeightPx);
	const arrowReferenceNodeScale = $derived(cfg.multigraph.edgeArrow.referenceNodeScale);
	const strokeWidthPx = $derived(cfg.multigraph.edgeStroke.widthPx);
	const strokeReferenceNodeScale = $derived(cfg.multigraph.edgeStroke.referenceNodeScale);
	const dataflowCfg = $derived(cfg.multigraph.dataflow);
	/**
	 * This graph's layout tunables, with the `layoutSettings` prop on top.
	 *
	 * Order matters and is not negotiable: ~40 stories pin layout values through
	 * the prop to make a behavior reproducible, and a graph's saved settings must
	 * not be able to overrule a test that pins one. So the config supplies the
	 * base — which is what makes the panel's layout sliders live — and an explicit
	 * prop still wins over it, exactly as it wins over `DEFAULT_LAYOUT_SETTINGS`.
	 */
	const layoutSettingsFromConfig = $derived<Partial<LayoutSettings>>({
		...cfg.multigraph.layout,
		...layoutSettings
	});
	/**
	 * Node chrome is sized from the layout's own base radius, not from
	 * `multigraph.nodeRadiusPx`.
	 *
	 * They ship as the same number and the schema hides the latter for exactly
	 * this reason: the layout trims every edge at `baseRadius * scale`, so a
	 * circle drawn from a second, independent radius would leave its edges
	 * stopping short of — or crossing into — its own border the moment the two
	 * disagreed. Reading one number is what makes them unable to.
	 */
	const nodeRadiusPx = $derived(
		layoutSettingsFromConfig.baseRadius ?? DEFAULT_LAYOUT_SETTINGS.baseRadius
	);
	const nodeDiameterPx = $derived(nodeRadiusPx * 2);
	/** Everything Stage needs; a prop default there is only a story's fallback. */
	const stageTunables = $derived({
		dragThreshold: cfg.interaction.dragThresholdPx,
		doubleClickMs: cfg.interaction.doubleClickMs,
		longPressMs: cfg.interaction.longPressMs,
		longPressDistancePx: cfg.interaction.longPressDistancePx,
		minScale: cfg.multigraph.zoom.minScale,
		maxScale: cfg.multigraph.zoom.maxScale
	});
	/** Everything a rendered Node needs to size its chrome, for the same reason. */
	const nodeChromeTunables = $derived({
		radiusPx: nodeRadiusPx,
		borderWidthPx: nodeBorderWidthPx,
		pinnedBorderWidthPx: pinnedNodeBorderWidthPx,
		fontSizePx: nodeTextFontSizePx
	});

	let graph = $state<MultigraphData>({
		nodes: [],
		edges: [],
		posByNodeId: {},
		tagColorConfig: { nodeTags: {}, edgeTags: {} },
		assets: {}
	});
	let primaryNodeId = $state('');
	let activeDragNodeId = $state<string | null>(null);
	let editNodeId = $state<string | null>(null);
	let actionMenu = $state<{ nodeId: string; position: Point } | null>(null);
	let creationPreview = $state<CreationPreviewState | null>(null);
	let creationArmRequest = $state<{
		id: number;
		sourceNode: NodeData;
		mode: NodeGestureMode;
	} | null>(null);
	let creationArmRequestId = $state(0);
	let duplicateEdgeConfirm = $state<{ edgeId: string } | null>(null);
	/**
	 * A merge that has been planned but not committed, waiting on the direction
	 * confirmation. Holding the whole plan (not the ids) is the point: confirming
	 * commits this `next`, so the count the dialog showed cannot drift from what
	 * lands.
	 */
	let pendingNodeMerge = $state<{
		plan: NodeMergePlan;
		absorbedId: string;
		survivorId: string;
	} | null>(null);
	let titleEditContext = $state<{
		nodeId: string;
		edgeId?: string;
		unpinOnCommit?: boolean;
		/**
		 * Where the caret lands when the input opens. Omitted means select-all,
		 * which is right for a title the author never wrote ("New Node"). Set only
		 * when the seed is meant to be continued rather than replaced — Define
		 * seeds `$k = $` and puts the caret before the closing `$`.
		 */
		caretAt?: number;
	} | null>(null);
	let tagColorLegendOpen = $state(false);
	let graphQueryPanelOpen = $state(false);
	let graphQueryText = $state('');
	let graphQueryPreviewText = $state<string | null>(null);
	let activeQueryRegionIndex = $state(0);
	let fitViewRequest = $state<{
		id: number;
		bounds: import('./lib/graphMath.js').GraphBounds;
	} | null>(null);
	let fitViewRequestId = $state(0);
	let viewStateRequest = $state<{
		id: number;
		panX: number;
		panY: number;
		scale: number;
	} | null>(null);
	let viewStateRequestId = $state(0);
	/**
	 * The node the last adopted import is being revealed by. Session-only, and
	 * kept after the camera lands so the story (and anyone debugging a reveal that
	 * went to the wrong place) can name what was aimed at.
	 */
	let importRevealNodeId = $state<string | null>(null);
	/** True exactly while the reveal camera is in flight or still tracking a settling arrival. */
	let importRevealActive = $state(false);
	/**
	 * Deliberately not `$state`: the frame loop rewrites `lastTarget` on every
	 * tick, and nothing renders from it. `importRevealActive` carries the one bit
	 * the markup needs.
	 */
	let importRevealPursuit: ImportRevealPursuit | null = null;
	let importRevealFrameId: number | null = null;
	let graphRef = $state<HTMLElement | null>(null);
	/**
	 * Endpoints of the most recent severing mutation (edge removal / node
	 * deletion), used as a last-resort beacon hint for pinless components that
	 * carry no pin history. Session-only; overwritten by the next severing
	 * mutation and cleared on external graph sync.
	 */
	let severedBeaconPreference = $state<string[]>([]);
	let lastSyncedGeneration = $state(-1);
	/**
	 * Seeded from the incoming revision rather than from -1, which is the whole
	 * difference between the two sync effects: mounting *is* the ingest, so the
	 * generation effect must fire on mount and the revision effect must not.
	 *
	 * The initial value is all that is wanted here — `untrack` says so rather than
	 * leaving the compiler to guess it was a mistake.
	 */
	let lastSyncedRevision = $state(untrack(() => graphRevision));
	let lastInitialTitleEditKey = $state('');
	let stageViewState = $state<ViewState>({ panX: 0, panY: 0, scale: 1 });
	const stageScale = $derived(stageViewState.scale);
	/** Stage element's live on-screen rect, reported by Stage — never measured here. */
	let stageRect = $state<StageRect | null>(null);
	/**
	 * The last stage measurement with size, for the focus frame alone. The stage
	 * keeps reporting empty measurements too (a window behind a native picker,
	 * a layout pass caught mid-way), and a frame laid out from one collapsed to
	 * a pixel; see `usableStageRect`.
	 */
	let lastSizedStageRect = $state<StageRect | null>(null);
	$effect(() => {
		if (stageRect !== null && hasSize(stageRect)) lastSizedStageRect = stageRect;
	});
	let reduceMotion = $derived(prefersReducedMotion());
	let stageEntryGestureGateRequest = $state<{
		id: number;
		direction: EntryGestureDirection;
		idleMs: number;
		maxMs: number;
	} | null>(null);
	let stageEntryGestureGateRequestId = $state(0);
	/**
	 * Owns the focus state machine (runtime stack, phase, commit/exit/idle). This
	 * component only feeds it live geometry/view deps and renders from its getters.
	 */
	const focus = new FocusController({
		getStageRect: () => stageRect,
		getViewState: () => stageViewState,
		getFillRect: () => focusFillRect(),
		getFocusCandidates: () => focusCandidates(),
		getReduceMotion: () => reduceMotion,
		armEntryGate: (direction) => armStageEntryGestureGate(direction),
		closeOverlays: () => closeOverlays(),
		// Getters, not values: the controller reads `config.*` when a gesture asks,
		// so a plain object literal here would freeze three tunables into the
		// controller for the lifetime of the component.
		config: {
			get transitionMs() {
				return focusTransitionMs;
			},
			get entryGestureIdleMs() {
				return focusEntryGestureIdleMs;
			},
			get entryGestureMaxMs() {
				return focusEntryGestureMaxMs;
			}
		}
	});

	/**
	 * Where the reader came from, and what a jump had to surface to get them
	 * there. Session-only: it never reaches `graph`, so no jump is a graph edit.
	 */
	const transientReveal = new TransientRevealController();

	/**
	 * The node whose details the reader is in, for the trail's last crumb.
	 *
	 * `focus.focusedNodeId` is null at an image level, which would blank the tail
	 * exactly when the reader is deepest — so the trail names the node the stack
	 * was entered on, which is what a jump would return to anyway.
	 */
	const focusRootNodeId = $derived(
		focus.levels[0]?.subjectKind === 'node' ? focus.levels[0].subjectId : null
	);
	const navCrumbs = $derived(navBreadcrumbs(transientReveal.entries, focusRootNodeId));

	/**
	 * Owns every `!ai` node's run: the streamed state the workbench draws, the
	 * digests it shows, and the two commits a run makes. Fed getters for the same
	 * reason `FocusController` is — the client arrives when a key is entered, the
	 * asset store resolves after mount, and `graph` is a new object per commit.
	 */
	const aiRun = createAiRunController({
		client: () => aiClient,
		executor: () => aiExecutor,
		assetStore: () => assetStore,
		assetScope: () => assetScope,
		graph: () => graph,
		commit: (next, label) => commitUserGraph(next, editIntent(label)),
		settings: () => aiSettings
	});

	/**
	 * Measure an AI node's inputs when the reader opens it, and again whenever the
	 * files it would send change.
	 *
	 * Keyed on the asset ids rather than the graph: the digest is what leaves the
	 * machine, so it has to be current before Run is pressed, and it must not be
	 * recomputed because a neighbour moved. `digest` is idempotent at a given
	 * preview depth, so a re-run of this effect that changed nothing costs a
	 * comparison.
	 */
	$effect(() => {
		const nodeId = focusRootNodeId;
		if (nodeId === null || nodeById[nodeId]?.addons?.ai === undefined) return;
		// Read so the effect re-runs when the inputs change; the ids are the key.
		void collectAiInputs(graph, nodeId)
			.map((input) => (input.kind === 'file' ? input.assetId : ''))
			.join('|');
		void aiSettings.previewRows;
		// Untracked: `digest` reads and writes the controller's own digest cache,
		// and tracking that here would make this effect its own trigger.
		untrack(() => void aiRun.digest(nodeId));
	});

	/**
	 * Run this node, and turn a missing key into the sheet plus a second attempt.
	 *
	 * The continuation is the milestone's "Connect succeeds, the sheet closes, the
	 * run continues": the same run, started again once a key is in hand, rather
	 * than a state machine that has to remember where it stopped.
	 */
	function runAiNode(nodeId: string, mode: AiRunMode): void {
		startAiRun(() => aiRun.run(nodeId, mode));
	}

	/**
	 * The "Fix with AI" press: a refine run carrying the traceback the last
	 * execution printed. Routed through the same missing-key retry as Run,
	 * because a reader whose script just failed is exactly the reader who should
	 * not have to press twice.
	 */
	function fixAiNode(nodeId: string): void {
		startAiRun(() => aiRun.runFix(nodeId));
	}

	/** One attempt, retried once behind the key sheet when that is what it needed. */
	function startAiRun(attempt: () => Promise<AiRunOutcome>): void {
		void attempt().then((outcome) => {
			if (outcome !== 'needs-key') return;
			onOpenAiSettings?.(() => void attempt());
		});
	}

	/**
	 * Where a node created *from* another one goes, by the same 2.5 radii in
	 * every case — the reader never dropped it anywhere, so there is nothing to
	 * honour and the layout takes it from there.
	 *
	 * The direction is the caller's, and it says what kind of act this was.
	 * `below` is for a node made *out of* this one and left behind: a promoted
	 * figure, a definition the reader is about to write. `beside` is for a node
	 * the reader is moving *to* — a follow-up — and it is a different spot so a
	 * follow-up and a promoted figure asked for in either order never land on
	 * top of each other.
	 */
	function placementNear(originNodeId: string, direction: 'below' | 'beside'): Point {
		const origin = graphLayout.posByNodeId[originNodeId] ?? CENTERED_POSITION;
		const offset = nodeRadiusPx * 2.5;
		return direction === 'below'
			? { x: origin.x, y: origin.y + offset }
			: { x: origin.x + offset, y: origin.y };
	}

	/**
	 * Give one of an AI node's outputs a node of its own.
	 *
	 * Placed exactly where `createDefiningNode` places the node it makes — below
	 * the node that asked for it — because both are the same act: a node created
	 * *from* another one, with no pointer to say where.
	 *
	 * The reader stays in the workbench they pressed from. A promote is a filing
	 * action, not a journey: they are looking at the figure and saying where it
	 * belongs, and the workbench row they pressed answers by naming the node it
	 * landed in, with a jump for when they do want to go. Unpinned for the same
	 * reason — it hangs off the AI node, so it is inside that component's
	 * neighbourhood rather than a beacon of its own, and the row's jump reveals
	 * it if the hop budget does not.
	 *
	 * `promoteAiOutput` is idempotent, so a second press commits nothing: the
	 * identity check is what keeps a double-tap out of the undo list.
	 */
	function promoteAiOutputToNode(aiNodeId: string, outputName: string): void {
		const next = promoteAiOutput(graph, aiNodeId, outputName, {
			position: placementNear(aiNodeId, 'below')
		});
		if (next === graph) return;
		commitUserGraph(layoutRuntime.relaxAfterMutation(next), editIntent('promote AI output'));
	}

	/**
	 * Turn a composed follow-up into a node the reader is now working in.
	 *
	 * `createDefiningNode`'s shape with the ending swapped: read the departure,
	 * commit once, record the way back, fly there — and then, instead of handing
	 * over the caret, start the run. There is nothing to type: the prompt arrived
	 * from the composer, so by the time this runs the reader has already decided
	 * and the only thing left is the answer
	 * (`docs/ui-decisions/2026-09-07--editing--submitting-a-follow-up-also-starts-its-run.md`).
	 * Nothing here takes DOM focus, which keeps the deep-zoom focus-scroll hazard
	 * `AiNodeContent` documents out of this path entirely.
	 *
	 * One commit for the node, the add-on, the prompt, the edge and both pin
	 * changes, so one Undo takes the whole thing — including giving the parent
	 * its pin back — per
	 * `docs/ui-decisions/2026-08-30--destructive--ship-new-destructive-actions-without-a-confirm.md`.
	 *
	 * The run goes last on purpose. `startAiRun` opens the key sheet when a run
	 * comes back `needs-key`, so a reader with no key lands on the new node with
	 * the sheet over it — which is right, because the run is what they asked for
	 * and the key is what it needs, but only if the node is already made and
	 * focused by then. A missing key must never cost the node.
	 */
	function askAiFollowUp(aiNodeId: string, prompt: string): void {
		// First, before anything moves: `focusRootNodeId` is null once focus is
		// gone, and the camera has to be the one the reader is actually looking at.
		const departure = readDepartureState(focusRootNodeId);

		const created = createFollowUpNode(graph, aiNodeId, {
			prompt,
			position: placementNear(aiNodeId, 'beside')
		});
		// The same object back is the mutation declining — an empty prompt, an
		// unknown parent, a parent without the add-on. Nothing is committed for it.
		if (created.graph === graph || created.nodeId === undefined) return;
		const childId = created.nodeId;
		commitUserGraph(layoutRuntime.relaxAfterMutation(created.graph), editIntent('ask a follow-up'));

		// Nothing was revealed to get here: the child hangs off an authored edge,
		// so it is on screen on its own account and the entry reveals nothing.
		travelToNode(childId, departure, null);

		// `graph` is the committed one and the derived layout has caught up, so the
		// mode is decided against the child as it now exists: no run and no script
		// of its own, but its parent's within reach, which is Change.
		const ai = nodeById[childId]?.addons?.ai;
		if (ai === undefined) return;
		runAiNode(
			childId,
			defaultRunMode(ai, collectAiInputs(graph, childId), {
				inheritedScript: inheritedScript(graph, childId)
			})
		);
	}

	/** Internal enter animations for nodes added by the user (scale 0 → target). */
	let nodeEnterAnimations = $state<Record<string, NodeEnterAnimation>>({});
	/** Internal enter/exit opacity animations for edges added/removed by the user. */
	let edgeEnterAnimations = $state<Record<string, EdgeOpacityAnimation>>({});
	/** Render-only buffer for elements removed by the user that are still animating out. */
	let internalExitingBuffer = $state<ExitingBuffer>(EMPTY_EXITING_BUFFER);

	/**
	 * Memoizes symbol extraction per node, so it must outlive a render rather
	 * than being rebuilt inside the derived chain below.
	 */
	const dataflowModel = createDataflowModel();

	const layoutRuntime: LayoutRuntime = new LayoutRuntime({
		getGraph: () => graph,
		computeHops: (data) => hopsFor(data),
		composeDerivedEdges: (data) => withSpringFactor(dataflowModel(data, dataflowEnabled).edges),
		// A getter, re-read every frame, so a physics slider is live while it moves.
		getLayoutSettings: () => layoutSettingsFromConfig,
		getActiveDragNodeId: () => activeDragNodeId,
		getPreferredBeaconNodeIds: () => severedBeaconPreference,
		applyGraph: (nextGraph) => {
			graph = nextGraph;
		},
		getHasActiveTransitions: (): boolean => {
			const now: number = layoutRuntime.animationNowMs;
			return (
				hasActiveExiting(internalExitingBuffer, now) ||
				hasActiveNodeEnterAnimations(nodeEnterAnimations, now) ||
				hasActiveEdgeEnterAnimations(edgeEnterAnimations, now) ||
				(creationPreview !== null && !isCreationPreviewSettled(creationPreview, now))
			);
		},
		onFrame: (nowMs) => {
			internalExitingBuffer = pruneFinishedExiting(internalExitingBuffer, nowMs);
			nodeEnterAnimations = pruneFinishedNodeEnterAnimations(nodeEnterAnimations, nowMs);
			edgeEnterAnimations = pruneFinishedEdgeEnterAnimations(edgeEnterAnimations, nowMs);
			if (creationPreview?.ending && isCreationPreviewSettled(creationPreview, nowMs)) {
				creationPreview = null;
			}
		}
	});

	/**
	 * `withDefaultLayoutSettings` still runs, but only as a type completion: the
	 * config already supplies every key, so `DEFAULT_LAYOUT_SETTINGS` is a
	 * last-resort fallback for callers of the pure module, not a path this
	 * component takes.
	 */
	const resolvedLayoutSettings = $derived(withDefaultLayoutSettings(layoutSettingsFromConfig));

	/** Tags derived edges with how hard they pull. */
	function withSpringFactor(edges: readonly DerivedEdge[]): DerivedEdge[] {
		const springFactor = resolvedLayoutSettings.derivedEdgeSpringFactor;
		return edges.map((edge) => ({ ...edge, springFactor }));
	}

	/**
	 * The one hop map: how far every node is from where reading starts. Visibility,
	 * node scale, the reveal wave, and physics distance all read the result, and
	 * `LayoutRuntime` is handed this very function rather than rebuilding its own
	 * chain — it needs answers for graphs that do not exist yet (a mutation being
	 * relaxed, the before/after pair of a reveal wave), so it takes the graph.
	 *
	 * Beacons come off the authored edges alone: two clusters an equation ties
	 * together each keep their own anchor, so neither can mostly vanish because
	 * someone wrote an equation. The dataflow model is identity-stable, so a graph
	 * whose content did not change costs a lookup here.
	 */
	function hopsFor(data: MultigraphData): Record<string, number> {
		return computeBoundedHops(
			data,
			dataflowModel(data, dataflowEnabled).edges,
			beaconsWithTransientReveals(data),
			{
				displayedLayers: resolvedLayoutSettings.displayedLayers,
				dataflowDisplayedLayers: resolvedLayoutSettings.dataflowDisplayedLayers
			}
		);
	}

	/**
	 * A jumped-to node rides in as a beacon. `withBeaconHops` overrides exactly
	 * the ids handed to it and expands from none of them, so the target arrives
	 * near-full-size without dragging its authored neighborhood along — which is
	 * precisely what "passing through to read this" should look like. Every
	 * consumer of `hopsFor` (visibility, scale, physics, edges) then agrees about
	 * it for free, and nothing about pinning or `graph` was touched to get there.
	 */
	function beaconsWithTransientReveals(data: MultigraphData): ReadonlySet<string> {
		const beacons = beaconNodeIds(data, { preferredNodeIds: severedBeaconPreference });
		const revealed = transientReveal.revealedNodeIds;
		// The common case: no jump in flight, so the memoized beacon set is handed
		// straight through and this costs nothing per frame. The set is shared, so
		// the union below must build its own rather than adding to it.
		if (revealed.size === 0) return beacons;
		// A node pinned since the jump is already at hop 0. Seeding it would push
		// it back out to BEACON_HOP and draw it smaller than its own pin says.
		const seeds = data.nodes
			.filter((node) => node.pinned !== true && revealed.has(node.id))
			.map((node) => node.id);
		if (seeds.length === 0) return beacons;
		return new Set([...beacons, ...seeds]);
	}

	const dataflow = $derived(dataflowModel(graph, dataflowEnabled));
	/** What the renderer draws: authored edges plus the derived ones. */
	const renderGraph = $derived(composeEdgesForRender(graph, dataflow.edges));
	/** The same derived edges the runtime composes, weighted for the spring. */
	const layoutDerivedEdges = $derived(withSpringFactor(dataflow.edges));
	/** Shared so a node below the size threshold allocates nothing per frame. */
	const EMPTY_QUANTITY_CHIPS: QuantityChips = { labels: [], overflowCount: 0 };
	/**
	 * Quantities each node defines, for the compact-node chips. Keyed by node so
	 * the render loop does no work per node beyond a lookup.
	 */
	const definedQuantityLabelsByNodeId = $derived.by(() => {
		const labelsByNodeId: Record<string, string[]> = {};
		// Definers, not parsed definitions: the canvas draws confirmed reality, and a
		// suggestion nobody accepted has no edge for its chip to explain.
		for (const entry of dataflow.index.entries.values()) {
			for (const nodeId of entry.definerNodeIds) {
				const labels = (labelsByNodeId[nodeId] ??= []);
				// Distinct labels: a node that states one definition two different ways
				// still owns one quantity, and would otherwise show the chip twice.
				if (!labels.includes(entry.symbol.label)) labels.push(entry.symbol.label);
			}
		}
		return new Map(Object.entries(labelsByNodeId));
	});
	const quantityLabelByEdgeId = $derived(
		new Map(
			dataflow.edges.map((edge) => [
				edge.id,
				formatQuantityLabel(
					edge.quantities.map((quantity) => quantity.label),
					dataflowCfg.labelMaxVisibleQuantities
				)
			])
		)
	);
	const hopsByNodeId = $derived(hopsFor(graph));
	const visibleNodeIds = $derived(
		visibleNodeIdsForPinnedNeighborhood(graph, hopsByNodeId, {
			displayedLayers: resolvedLayoutSettings.displayedLayers
		})
	);
	/**
	 * The graph the layout runs over — the same composition `LayoutRuntime` makes
	 * for the frames it relaxes, through the same function, so what is drawn and
	 * what is placed can never be two different graphs. Consumers that only read
	 * `.nodes` (occlusion, hit testing, focus, the node loop) are untouched by the
	 * derived edges riding along in `.edges`.
	 */
	const visibleGraph = $derived(
		composeVisibleLayoutGraph(graph, visibleNodeIds, layoutDerivedEdges)
	);
	/** Needs the visible set, so that out-of-view reads differently from undefined. */
	const dataflowDiagnostics = $derived(
		computeDataflowDiagnostics(dataflow.index, dataflow.edges, { visibleNodeIds })
	);
	/**
	 * Reads the render graph so derived edges get visibility, trimming, and fade —
	 * then takes the fade back off the derived ones, which draw only between two
	 * visible endpoints.
	 */
	const edgeVisibility = $derived(
		withDerivedBoundaryEdgesHidden(
			edgeVisibilityForPinnedNeighborhood(renderGraph, hopsByNodeId, {
				displayedLayers: resolvedLayoutSettings.displayedLayers
			}),
			isDerivedEdgeId
		)
	);
	const renderableEdgeVisibility = $derived(
		edgeVisibility.filter(
			(visibility): visibility is RenderableEdgeVisibility => visibility.kind !== 'hidden'
		)
	);
	const legendTags = $derived(collectLegendTags(graph));
	const activeGraphQueryText = $derived(graphQueryPreviewText ?? graphQueryText);
	const graphQueryResult = $derived(evaluateGraphQuery(graph, activeGraphQueryText));
	const graphLayout = $derived(
		deriveGraphLayout(
			visibleGraph,
			layoutRuntime.layoutOptions(visibleGraph, { hopsByNodeId, relaxIterations: 0 })
		)
	);
	const visibleEdgeOcclusionNodes = $derived.by((): EdgeOcclusionNode[] =>
		visibleGraph.nodes.flatMap((node) => {
			const position = graphLayout.posByNodeId[node.id];
			const radius = graphLayout.radiusByNodeId[node.id];
			if (!position || radius === undefined) return [];
			return [{ nodeId: node.id, position, radius }];
		})
	);
	const visibleEdgeParallelOffsets = $derived.by(() => {
		const visibleEdges: EdgeData[] = [];
		const visualHalfWidthByEdgeId: Record<string, number> = {};

		for (const visibility of renderableEdgeVisibility) {
			if (visibility.kind !== 'visible') continue;

			const edge = visibility.edge;
			const strokeHalfWidth =
				(strokeWidthPx *
					edgeStrokeScale(visibility, graphLayout.scaleByNodeId, strokeReferenceNodeScale)) /
				2;
			const arrowHalfHeight =
				edge.directed === true
					? arrowHalfHeightPx *
						edgeArrowScale(visibility, graphLayout.scaleByNodeId, arrowReferenceNodeScale)
					: 0;
			visibleEdges.push(edge);
			visualHalfWidthByEdgeId[edge.id] = Math.max(strokeHalfWidth, arrowHalfHeight);
		}

		return computeParallelEdgeOffsets(visibleEdges, graphLayout, {
			clearancePx: resolvedLayoutSettings.parallelEdgeClearancePx,
			maxOffsetRadiusFactor: resolvedLayoutSettings.parallelEdgeMaxOffsetRadiusFactor,
			visualHalfWidthByEdgeId
		});
	});
	const nodeById = $derived(Object.fromEntries(graph.nodes.map((node) => [node.id, node])));
	/**
	 * Every visible node's circle in screen space — the same projection the hit
	 * test uses, so "off screen" here means the same thing as "not tappable".
	 */
	const visibleNodeScreenCircles = $derived.by(() => {
		const rect = stageRect;
		if (!rect) return [];
		const view: ViewTransform = {
			panX: stageViewState.panX,
			panY: stageViewState.panY,
			scale: stageViewState.scale
		};
		return visibleGraph.nodes.flatMap((node) => {
			const position = graphLayout.posByNodeId[node.id];
			const radius = graphLayout.radiusByNodeId[node.id];
			if (!position || radius === undefined) return [];
			return [nodeScreenCircle(node.id, position, radius, rect, view)];
		});
	});
	/** True only when there is a graph and the reader has panned or zoomed away from all of it. */
	const graphLost = $derived(
		stageRect !== null && graphIsLost(visibleNodeScreenCircles, stageRect)
	);
	const revealWaveNodeOpacityByNodeId = $derived(layoutRuntime.revealWaveNodeOpacityByNodeId);
	const revealWaveEdgeOpacityByEdgeId = $derived(layoutRuntime.revealWaveEdgeOpacityByEdgeId);
	const revealWavePreviousScaleByNodeId = $derived(layoutRuntime.revealWavePreviousScaleByNodeId);
	const combinedScaleByNodeId = $derived({
		...graphLayout.scaleByNodeId,
		...revealWavePreviousScaleByNodeId
	});
	const revealWavePreviousRadiusByNodeId = $derived.by(() =>
		Object.fromEntries(
			Object.entries(revealWavePreviousScaleByNodeId).map(([nodeId, scale]) => [
				nodeId,
				resolvedLayoutSettings.baseRadius * scale
			])
		)
	);
	const combinedRadiusByNodeId = $derived({
		...graphLayout.radiusByNodeId,
		...revealWavePreviousRadiusByNodeId
	});
	const combinedEdgeLayout = $derived({
		posByNodeId: graphLayout.posByNodeId,
		radiusByNodeId: combinedRadiusByNodeId
	});
	/** Live layout position of the preview's source node; null while it has no layout slot. */
	const creationPreviewSourcePos = $derived(
		creationPreview ? (graphLayout.posByNodeId[creationPreview.sourceNodeId] ?? null) : null
	);
	const creationPreviewScale = $derived(
		creationPreview ? creationPreviewScaleAt(creationPreview, layoutRuntime.animationNowMs) : 0
	);
	/**
	 * The node a merge gesture is currently poised to absorb into, or null while
	 * it is over background or back on its own source (both of which cancel).
	 */
	const mergeTargetNodeId = $derived.by(() => {
		const preview = creationPreview;
		if (!preview || preview.mode !== 'merge' || preview.ending) return null;
		const hoverNodeId = preview.hoverNodeId;
		if (!hoverNodeId || hoverNodeId === preview.sourceNodeId) return null;
		return graphLayout.posByNodeId[hoverNodeId] ? hoverNodeId : null;
	});
	/**
	 * Preview edge trimmed to the node borders exactly like a real edge (source by
	 * its layout radius, target by the preview node's animated radius) so the
	 * handoff to the committed edge does not snap shorter.
	 *
	 * A merge aims at a whole node rather than a point, so once it is over its
	 * target the line snaps to that node's centre and trims to its border — the
	 * same reading as an edge already drawn between them.
	 */
	const creationPreviewEdgePoints = $derived.by(() => {
		const preview = creationPreview;
		if (!preview || preview.ending || !creationPreviewSourcePos) return null;
		const mergeTargetPos = mergeTargetNodeId ? graphLayout.posByNodeId[mergeTargetNodeId] : null;
		return trimSegmentToNodeBorders(
			creationPreviewSourcePos,
			mergeTargetPos ?? preview.point,
			graphLayout.radiusByNodeId[preview.sourceNodeId] ?? 0,
			mergeTargetNodeId
				? (graphLayout.radiusByNodeId[mergeTargetNodeId] ?? 0)
				: resolvedLayoutSettings.baseRadius * creationPreviewScale
		);
	});
	const editNode = $derived(graph.nodes.find((node) => node.id === editNodeId) ?? null);
	const actionMenuNode = $derived.by(() => {
		const menu = actionMenu;
		return menu ? (graph.nodes.find((node) => node.id === menu.nodeId) ?? null) : null;
	});
	/** Merged exiting buffer: external prop (stories/T03 testing) + internal (user actions). */
	const effectiveExitingBuffer = $derived.by((): ExitingBuffer => {
		const ext = exitingBuffer ?? EMPTY_EXITING_BUFFER;
		return {
			nodes: { ...ext.nodes, ...internalExitingBuffer.nodes },
			edges: { ...ext.edges, ...internalExitingBuffer.edges }
		};
	});

	/** Exiting buffer nodes that are not currently in the visible set (avoid double-render). */
	const exitingOnlyNodes = $derived.by(() => {
		const visibleIds = new Set(visibleGraph.nodes.map((n) => n.id));
		return Object.entries(effectiveExitingBuffer.nodes).filter(([id]) => !visibleIds.has(id));
	});

	/** Exiting buffer edges that are not currently in the renderable visible set. */
	const exitingOnlyEdges = $derived.by(() => {
		const renderableIds = new Set(renderableEdgeVisibility.map((v) => v.edge.id));
		return Object.entries(effectiveExitingBuffer.edges).filter(([id]) => !renderableIds.has(id));
	});

	/**
	 * Reveal-wave leftovers minus anything the exiting buffer is already fading:
	 * a deleted node's edges appear in both, and only the buffer still holds the
	 * geometry to place them (the live layout dropped the node).
	 */
	const revealWaveOnlyEdgeVisibility = $derived(
		layoutRuntime.revealWavePreviousOnlyEdgeVisibility.filter(
			(visibility) => !(visibility.edge.id in effectiveExitingBuffer.edges)
		)
	);

	$effect(() => {
		const generation = externalGraphSyncToken(graphGeneration);
		if (generation === lastSyncedGeneration) return;

		lastSyncedGeneration = generation;
		const incoming = untrack(() => multigraphData);
		const primary = untrack(() => defaultPrimaryNodeId);
		const ingestLayoutSettings = untrack(() => layoutSettingsFromConfig);
		layoutRuntime.reset();
		// Cleared before the settle measures anything: a preference left over from
		// the graph being replaced must not pick a beacon in the one arriving.
		severedBeaconPreference = [];
		// Same reason, and stronger: a back entry names nodes and a camera from a
		// graph that is being replaced wholesale, so none of it survives the swap.
		transientReveal.clear();
		// Dataflow shapes the ingest settle too. A graph arriving from storage should
		// come to rest under the same forces it will feel from the first interaction
		// onward, instead of shifting once the runtime takes over — so it settles
		// over the same composition, through the same function. Nothing is hidden
		// yet, so every node is in the visible set.
		const layoutGraphForIngest = untrack(() =>
			composeVisibleLayoutGraph(
				incoming,
				new Set(incoming.nodes.map((node) => node.id)),
				withSpringFactor(dataflowModel(incoming, dataflowEnabled).edges)
			)
		);
		// The same hop map the canvas will draw from, so the graph settles at the
		// sizes it is about to appear at rather than at a first guess.
		const hopsByNodeIdForIngest = untrack(() => hopsFor(incoming));
		const settledLayoutGraph = withSettledGraphPositions(layoutGraphForIngest, {
			settings: ingestLayoutSettings,
			hopsByNodeId: hopsByNodeIdForIngest
		});
		// Positions only: `settledLayoutGraph.edges` carries the derived edges, and
		// the graph the app mutates and saves must never see one.
		graph = { ...incoming, posByNodeId: settledLayoutGraph.posByNodeId };
		primaryNodeId = primary;
		internalExitingBuffer = EMPTY_EXITING_BUFFER;
		nodeEnterAnimations = {};
		edgeEnterAnimations = {};
		// This ingest has just adopted whatever the incoming graph holds, revision
		// included, so the in-place effect below must not adopt it a second time.
		lastSyncedRevision = untrack(() => graphRevision);
	});

	/**
	 * Adopt a graph that changed under a *mounted* canvas — an additive import
	 * folding a second component in beside the reader's work.
	 *
	 * Deliberately not the ingest above. Nothing here is replaced: no
	 * `layoutRuntime.reset()`, no cleared reveal stack or beacon preference, no
	 * re-settle of the whole graph. The incoming `posByNodeId` already places both
	 * the host's nodes and the arriving ones, so this is exactly the treatment any
	 * mutation made in this component gets — relax from where things are, commit,
	 * and let the change save itself back through `onMultigraphChange`.
	 */
	$effect(() => {
		const revision = graphRevision;
		if (revision === lastSyncedRevision) return;

		lastSyncedRevision = revision;
		const restore = untrack(() => restoredCanvasState);
		untrack(() =>
			restore === null
				? adoptGraphInPlace(multigraphData, 'import')
				: restoreGraphInPlace(multigraphData, restore)
		);
	});

	/**
	 * Why an undo or redo must not run right now.
	 *
	 * All three cases are the same shape: something on screen is holding state
	 * that a graph swap underneath it would silently destroy or immediately
	 * overwrite. Stated once, here, so a toolbar tap and a keyboard shortcut
	 * cannot disagree about them.
	 */
	const historyGuardReason = $derived.by(() => {
		// The sheet's draft-reset effect re-runs when its node object is replaced,
		// discarding unsaved title, description and tags without a word — and the
		// toolbar sits above the sheet, so the button is one tap away mid-edit.
		if (editNodeId !== null) return 'Finish editing first.';
		// The stage holds pointer capture and re-commits the finger's position on
		// the next `pointermove`, so a mid-drag restore would be half-overwritten
		// at once — and `handleNodeDragEnd` would then scale a node that may no
		// longer exist.
		if (activeDragNodeId !== null) return 'Finish the drag first.';
		if (creationPreview !== null) return 'Finish the drag first.';
		return null;
	});

	/**
	 * Kicks the frame loop when a setting changes that the canvas cannot show on
	 * its own — the `resize-only` and `physics` fields, and only those.
	 *
	 * It depends on a fingerprint of those resolved values rather than on the
	 * override map, so a preview of an `instant` field (which redraws itself) does
	 * not settle the graph, and a commit that merely re-shapes the map without
	 * changing a value does nothing at all. The first run only records the
	 * baseline: mounting is not a settings change, and the ingest settle above has
	 * already put the graph where it belongs.
	 */
	const layoutSettleFingerprint = $derived(settleKickFingerprint(cfg));
	let lastLayoutSettleFingerprint = $state<string | null>(null);

	$effect(() => {
		const fingerprint = layoutSettleFingerprint;
		const previous = untrack(() => lastLayoutSettleFingerprint);
		if (previous === fingerprint) return;
		lastLayoutSettleFingerprint = fingerprint;
		if (previous === null) return;
		layoutRuntime.settleAfterSettingsChange();
	});

	/**
	 * Opening the settings panel closes whatever else was open, mirroring
	 * `toggleGraphQueryPanel` — the two panels share the same top-left corner, so
	 * both on screen at once would stack one over the other.
	 *
	 * Guarded on the transition rather than the value: `closeOverlays` on every
	 * render while the panel is open would make the panel impossible to edit a
	 * node behind, and would fight the reader's own overlays for no reason.
	 */
	let settingsPanelWasOpen = $state(false);

	$effect(() => {
		const isOpen = settingsPanelOpen;
		if (isOpen === untrack(() => settingsPanelWasOpen)) return;
		settingsPanelWasOpen = isOpen;
		if (isOpen) closeOverlays();
	});

	$effect(() => {
		onHistoryGuardChange?.(historyGuardReason);
	});

	/** Step the history, if nothing on screen would be damaged by it. */
	function stepHistory(direction: 'undo' | 'redo') {
		if (historyGuardReason !== null) return;
		onHistoryStep?.(direction);
	}

	/**
	 * Adopt a graph the history restored: the same in-place treatment an import
	 * gets, minus the camera, plus the state the graph does not carry.
	 *
	 * Deliberately not `adoptGraphInPlace`. An import chases an arrival the reader
	 * has never seen; an undo reverses something they just did, at a place they
	 * are already looking, so moving the camera would be taking the canvas away
	 * from them. The notice names the operation for the case where it happened off
	 * screen.
	 *
	 * Presentation state degrades on purpose. Overlays close as they would for any
	 * commit, nav crumbs naming nodes the restore removed are pruned, focus closes
	 * if its subject went with them, and animations play forward from what the
	 * restore did rather than being replayed backwards.
	 */
	function restoreGraphInPlace(
		incoming: MultigraphData,
		restore: { primaryNodeId: string; severedBeaconPreference: string[] }
	) {
		animateRestoreDifference(incoming);
		// Unconditionally, not only when the current value has vanished: the
		// recorded pointer is part of the state being restored. A value naming no
		// node in the restored graph is the seed's "nothing was recorded yet", and
		// falls back to the same election an unpin or a delete would run.
		primaryNodeId = incoming.nodes.some((node) => node.id === restore.primaryNodeId)
			? restore.primaryNodeId
			: fallbackPrimaryNodeId(incoming);
		severedBeaconPreference = [...restore.severedBeaconPreference];

		const liveNodeIds = new Set(incoming.nodes.map((node) => node.id));
		// Today only `deleteNode` prunes, because until now only a deletion could
		// take a node out from under a back entry. Every restore can.
		transientReveal.pruneMissing(liveNodeIds);
		closeFocusOnMissingSubject(incoming, liveNodeIds);
		closeOverlays();
		commitUserGraph(layoutRuntime.relaxAfterMutation(incoming), editIntent('restore'));
	}

	/**
	 * Grow back what the restore brought and fade out what it took, using the same
	 * primitives a creation and a deletion use.
	 *
	 * The animation buffers are explicit-call state — nothing diffs for them — so
	 * a restore that says nothing leaves an undone deletion popping into place
	 * while an undone creation leaves a node drawn at full size for a frame.
	 */
	function animateRestoreDifference(incoming: MultigraphData) {
		const durationMs = resolvedLayoutSettings.enterExitDurationMs;
		if (durationMs <= 0) return;
		const nowMs = layoutRuntime.now();
		const currentNodeIds = new Set(graph.nodes.map((node) => node.id));
		const currentEdgeIds = new Set(graph.edges.map((edge) => edge.id));
		const incomingNodeIds = new Set(incoming.nodes.map((node) => node.id));
		const incomingEdgeIds = new Set(incoming.edges.map((edge) => edge.id));
		let nextBuffer = internalExitingBuffer;
		let started = false;

		for (const node of incoming.nodes) {
			if (currentNodeIds.has(node.id)) continue;
			nextBuffer = cancelExitingNode(nextBuffer, node.id);
			nodeEnterAnimations = {
				...nodeEnterAnimations,
				[node.id]: createNodeEnterAnimation(
					graphLayout.scaleByNodeId[node.id] ?? 1,
					nowMs,
					durationMs
				)
			};
			started = true;
		}

		for (const edge of incoming.edges) {
			if (currentEdgeIds.has(edge.id)) continue;
			nextBuffer = cancelExitingEdge(nextBuffer, edge.id);
			edgeEnterAnimations = {
				...edgeEnterAnimations,
				[edge.id]: createEdgeEnterAnimation(nowMs, durationMs)
			};
			started = true;
		}

		for (const node of graph.nodes) {
			if (incomingNodeIds.has(node.id)) continue;
			const position = graph.posByNodeId[node.id] ?? CENTERED_POSITION;
			nodeEnterAnimations = Object.fromEntries(
				Object.entries(nodeEnterAnimations).filter(([id]) => id !== node.id)
			);
			nextBuffer = cancelExitingNode(nextBuffer, node.id);
			nextBuffer = addExitingNode(nextBuffer, node.id, {
				nodeData: node,
				x: position.x,
				y: position.y,
				fromScale: graphLayout.scaleByNodeId[node.id] ?? 1,
				startedAtMs: nowMs,
				durationMs
			});
			started = true;
		}

		for (const edge of graph.edges) {
			if (incomingEdgeIds.has(edge.id)) continue;
			const enterAnim = edgeEnterAnimations[edge.id];
			edgeEnterAnimations = Object.fromEntries(
				Object.entries(edgeEnterAnimations).filter(([id]) => id !== edge.id)
			);
			nextBuffer = cancelExitingEdge(nextBuffer, edge.id);
			nextBuffer = addExitingEdge(nextBuffer, edge.id, {
				edgeData: edge,
				fromOpacity: enterAnim ? edgeOpacityAt(enterAnim, nowMs) : 1,
				startedAtMs: nowMs,
				durationMs
			});
			started = true;
		}

		internalExitingBuffer = nextBuffer;
		if (started) layoutRuntime.start();
	}

	/**
	 * Close focus when the restore took its subject away.
	 *
	 * Focus levels hold only a `subjectId`, resolved through `nodeById` behind
	 * `{#if}` guards, and nothing has ever closed focus on a vanished subject
	 * because until now nothing could vanish one — the overlay would simply render
	 * empty. An image level names an asset id, which a restore can drop just as
	 * easily by removing the content block that referenced it.
	 */
	function closeFocusOnMissingSubject(incoming: MultigraphData, liveNodeIds: ReadonlySet<string>) {
		if (!focus.isFocused) return;
		const liveAssetIds = referencedAssetIds(incoming);
		const orphaned = focus.levels.some((level) =>
			level.subjectKind === 'image'
				? !liveAssetIds.has(level.subjectId)
				: !liveNodeIds.has(level.subjectId)
		);
		if (orphaned) focus.closeFocus();
	}

	$effect(() => {
		const nodeId = initialTitleEditNodeId;
		if (!nodeId) return;
		const editKey = `${externalGraphSyncToken(graphGeneration)}:${nodeId}`;
		if (editKey === lastInitialTitleEditKey) return;
		if (!graph.nodes.some((node) => node.id === nodeId)) return;
		lastInitialTitleEditKey = editKey;
		closeOverlays();
		titleEditContext = { nodeId };
	});

	$effect(() => {
		const regionCount = graphQueryResult.regions.length;
		if (regionCount === 0) {
			activeQueryRegionIndex = 0;
			return;
		}
		if (activeQueryRegionIndex >= regionCount) {
			activeQueryRegionIndex = regionCount - 1;
		}
	});

	/**
	 * True while the keyboard belongs to something that takes text, so a bare
	 * letter shortcut cannot fire while an author is typing a node title, a
	 * description, or a search.
	 */
	function keyboardIsInTextEntry(): boolean {
		const active = document.activeElement;
		if (!(active instanceof HTMLElement)) return false;
		if (active.isContentEditable) return true;
		const tag = active.tagName;
		return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
	}

	/**
	 * Escape walks out one level at a time, and a text field is a level: from one
	 * it blurs, which is what escaping an editor means, and only a press with no
	 * field under it closes the surface. The typing guard is per-shortcut rather
	 * than blanket for exactly this reason — Escape is one of the few keys that
	 * is *for* the field. A prompt half-typed in the workbench used to leave with
	 * the surface on the first press; blurring commits it instead.
	 */
	function leaveFocusOnEscape(): void {
		if (!focus.isFocused) return;
		if (keyboardIsInTextEntry()) {
			const active = document.activeElement;
			if (active instanceof HTMLElement) active.blur();
			return;
		}
		focus.closeFocus();
	}

	$effect(() => {
		if (typeof window === 'undefined') return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && focus.isFocused) {
				leaveFocusOnEscape();
				return;
			}
			if (event.metaKey || event.ctrlKey || event.altKey) {
				if (!(event.metaKey || event.ctrlKey)) return;
				const key = event.key.toLowerCase();
				// The description field's native undo is something this codebase has
				// deliberately protected twice, so the guard is copied here on purpose:
				// the branch around it does not have one (Cmd/Ctrl+K skips it), and
				// inheriting that would take a typist's own undo away.
				if ((key === 'z' || key === 'y') && !keyboardIsInTextEntry()) {
					event.preventDefault();
					// `Ctrl+Y` joins `Shift+Cmd/Ctrl+Z` because it is the redo Windows
					// hands expect. Key repeat is fine: each step is a pointer swap plus
					// a relax, and the guard refuses the states where a repeat could hurt.
					stepHistory(key === 'y' || event.shiftKey ? 'redo' : 'undo');
					return;
				}
				if (key !== 'k') return;
				event.preventDefault();
				closeOverlays();
				graphQueryPanelOpen = true;
				return;
			}
			// Bare `F` brings the graph back — see `fitVisibleGraph`. Guarded on text
			// entry above all: `f` is a letter people type.
			if (event.key.toLowerCase() !== 'f' || event.shiftKey) return;
			if (keyboardIsInTextEntry() || focus.isFocused) return;
			event.preventDefault();
			fitVisibleGraph();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	});

	$effect(() => {
		return () => {
			focus.dispose();
			layoutRuntime.stop();
			cancelImportReveal();
		};
	});

	/**
	 * Resolve the node at client coordinates by projecting each visible node's
	 * on-screen circle from its layout + the live stage view — no DOM
	 * measurement. Iterates front-to-back (last rendered is topmost) and honors
	 * the minimum tap radius. Query-excluded nodes are not rendered, so skip
	 * them here too.
	 */
	function getNodeAt(clientX: number, clientY: number): NodeData | null {
		const rect = stageRect;
		if (!rect) return null;
		const view: ViewTransform = {
			panX: stageViewState.panX,
			panY: stageViewState.panY,
			scale: stageViewState.scale
		};
		const nodes = visibleGraph.nodes;
		for (let index = nodes.length - 1; index >= 0; index -= 1) {
			const node = nodes[index];
			if (queryStateForNode(node.id)?.role === 'excluded') continue;
			const position = graphLayout.posByNodeId[node.id];
			const radius = graphLayout.radiusByNodeId[node.id];
			if (!position || radius === undefined) continue;
			const circle = nodeScreenCircle(node.id, position, radius, rect, view);
			const hitRadius = effectiveHitRadius(circle.radius, minNodeHitRadiusPx);
			if (isPointInCircle(clientX, clientY, circle.center.x, circle.center.y, hitRadius)) {
				return node;
			}
		}
		return null;
	}

	function handleNodeMoved(node: NodeData, point: Point) {
		const movedGraph = moveNode(graph, node.id, point);
		commitUserGraph(layoutRuntime.relaxAfterMutation(movedGraph, node.id, 1), editIntent('layout'));
	}

	function handleNodeDragStart(node: NodeData) {
		activeDragNodeId = node.id;
		layoutRuntime.beginDrag();
	}

	function handleNodeDragEnd(node: NodeData) {
		activeDragNodeId = null;

		if (node.pinned) {
			commitUserGraph(layoutRuntime.beginScaleChange(graph, node.id), editIntent('layout'));
			return;
		}

		commitUserGraph(layoutRuntime.relaxAfterMutation(graph, null, 1), editIntent('layout'));
		layoutRuntime.settleAfterDrag();
	}

	function handleNodeMakePrimary(node: NodeData) {
		closeOverlays();
		const wasPinned = node.pinned === true;
		const nextGraph = layoutRuntime.beginScaleChange(togglePinned(graph, node.id), node.id);
		// Before the commit: the intent captures the primary as of *after* the
		// edit, which is the value a restore of this state has to put back.
		primaryNodeId = wasPinned ? fallbackPrimaryNodeId(nextGraph) : node.id;
		commitUserGraph(nextGraph, editIntent(wasPinned ? 'unpin node' : 'pin node'));
	}

	/**
	 * Who becomes primary when whoever held it stops being a candidate — the node
	 * was unpinned, or deleted. Preference order is a pinned node, then the
	 * caller's default, then whatever is left, then nothing at all for an empty
	 * graph.
	 *
	 * One function because it was two identical copies, in `handleNodeMakePrimary`
	 * and in the delete path, and a fallback order that disagrees with itself
	 * between unpinning and deleting is a difference nobody would ever choose on
	 * purpose.
	 *
	 * `source` defaults to the graph on screen; an adopted import passes the
	 * arriving graph instead, because the primary is being re-pointed against a
	 * graph this component has not committed yet.
	 */
	function fallbackPrimaryNodeId(source: MultigraphData = graph): string {
		return (
			source.nodes.find((candidate) => candidate.pinned)?.id ??
			source.nodes.find((candidate) => candidate.id === defaultPrimaryNodeId)?.id ??
			source.nodes[0]?.id ??
			''
		);
	}

	function handleNodeDoubleClickDropOntoNode(sourceNode: NodeData, targetNode: NodeData) {
		const hadPreviewEdge = creationPreview !== null && !creationPreview.ending;
		// closeOverlays() drops the preview, so read it first.
		closeOverlays();
		const existing = findExistingEdge(graph, sourceNode.id, targetNode.id);
		if (existing) {
			duplicateEdgeConfirm = { edgeId: existing.id };
		} else {
			const graphWithEdge = addEdge(graph, sourceNode.id, targetNode.id);
			const newEdge = graphWithEdge.edges[graphWithEdge.edges.length - 1] ?? null;
			commitUserGraph(layoutRuntime.relaxAfterMutation(graphWithEdge), editIntent('add edge'));

			const durationMs = resolvedLayoutSettings.enterExitDurationMs;
			// The preview edge was already drawn at full opacity; fading the real
			// edge in would make it blink on handoff.
			if (newEdge && durationMs > 0 && !hadPreviewEdge) {
				const nowMs = layoutRuntime.now();
				internalExitingBuffer = cancelExitingEdge(internalExitingBuffer, newEdge.id);
				edgeEnterAnimations = {
					...edgeEnterAnimations,
					[newEdge.id]: createEdgeEnterAnimation(nowMs, durationMs)
				};
				layoutRuntime.start();
			}
		}
	}

	function handleNodeDoubleClickDropOntoBackground(sourceNode: NodeData, point: Point) {
		const handoffScale = creationPreview
			? creationPreviewScaleAt(creationPreview, layoutRuntime.now())
			: 0;
		const hadPreviewEdge = creationPreview !== null && !creationPreview.ending;
		// closeOverlays() drops the preview, so read it first.
		closeOverlays();
		const graphWithNode = addNode(graph, { pinned: true, position: point });
		const newNode = graphWithNode.nodes[graphWithNode.nodes.length - 1] ?? null;
		const graphWithEdge = newNode
			? addEdge(graphWithNode, sourceNode.id, newNode.id)
			: graphWithNode;
		const newEdge = graphWithEdge.edges[graphWithEdge.edges.length - 1] ?? null;

		commitUserGraph(layoutRuntime.relaxAfterMutation(graphWithEdge), editIntent('add node'));

		const durationMs = resolvedLayoutSettings.enterExitDurationMs;
		if (durationMs > 0) {
			const nowMs = layoutRuntime.now();
			if (newNode) {
				internalExitingBuffer = cancelExitingNode(internalExitingBuffer, newNode.id);
				const targetScale = graphLayout.scaleByNodeId[newNode.id] ?? 1;
				// Continue from the preview node's current scale so the handoff from
				// preview to real node is seamless (a fully-shown preview skips the
				// enter animation entirely).
				if (handoffScale < targetScale) {
					nodeEnterAnimations = {
						...nodeEnterAnimations,
						[newNode.id]: createNodeEnterAnimation(targetScale, nowMs, durationMs, handoffScale)
					};
				}
			}
			if (newEdge && !hadPreviewEdge) {
				internalExitingBuffer = cancelExitingEdge(internalExitingBuffer, newEdge.id);
				edgeEnterAnimations = {
					...edgeEnterAnimations,
					[newEdge.id]: createEdgeEnterAnimation(nowMs, durationMs)
				};
			}
			if (newNode || newEdge) {
				layoutRuntime.start();
			}
		}

		if (newNode) {
			titleEditContext = { nodeId: newNode.id, edgeId: newEdge?.id, unpinOnCommit: true };
		}
	}

	function openNodeActionMenu(node: NodeData, point: Point) {
		editNodeId = null;
		actionMenu = { nodeId: node.id, position: point };
	}

	/**
	 * The open menu's overlay swallows right-clicks that would otherwise reach the
	 * stage, so it hands the point back here for the same hit test the stage uses:
	 * move the menu onto the node under the cursor, or close over background.
	 */
	function retargetNodeActionMenu(point: Point) {
		const node = getNodeAt(point.x, point.y);
		if (!node) {
			actionMenu = null;
			return;
		}
		openNodeActionMenu(node, point);
	}

	const previewDurationMs = $derived(reduceMotion ? 0 : resolvedLayoutSettings.enterExitDurationMs);

	function handleCreationDragUpdate(
		sourceNode: NodeData,
		point: Point,
		hoverNode: NodeData | null
	) {
		const nowMs = layoutRuntime.now();
		const base =
			creationPreview && !creationPreview.ending && creationPreview.sourceNodeId === sourceNode.id
				? creationPreview
				: beginCreationPreview(sourceNode.id, point, nowMs);
		creationPreview = updateCreationPreview(
			base,
			{ point, hoverNodeId: hoverNode?.id ?? null },
			nowMs,
			previewDurationMs
		);
		layoutRuntime.start();
	}

	function handleCreationCancel(sourceNode: NodeData) {
		if (!creationPreview || creationPreview.sourceNodeId !== sourceNode.id) return;
		const nowMs = layoutRuntime.now();
		const ended = endCreationPreview(creationPreview, nowMs, previewDurationMs);
		creationPreview = ended && !isCreationPreviewSettled(ended, nowMs) ? ended : null;
		if (creationPreview) layoutRuntime.start();
	}

	function armCreationGesture(node: NodeData, mode: NodeGestureMode = 'create') {
		actionMenu = null;
		creationArmRequestId += 1;
		creationArmRequest = { id: creationArmRequestId, sourceNode: node, mode };
		creationPreview = beginCreationPreview(
			node.id,
			graphLayout.posByNodeId[node.id] ?? CENTERED_POSITION,
			layoutRuntime.now(),
			mode
		);
	}

	function handleNodeMergeDropOntoNode(absorbedNode: NodeData, survivorNode: NodeData) {
		closeOverlays();
		commitNodeMerge(absorbedNode.id, survivorNode.id);
	}

	/**
	 * The one place a merge reaches the graph. `planNodeMerge` is a dry run and
	 * the commit in one call, so the confirmation hanging off
	 * `plan.directionConflicts` here shows exactly the `next` it goes on to
	 * commit — the dialog and the mutation cannot drift apart.
	 */
	function commitNodeMerge(absorbedId: string, survivorId: string) {
		const plan = planNodeMerge(graph, absorbedId, survivorId);
		// A mis-aimed merge (unknown or identical ids) returns the graph itself.
		if (plan.next === graph) return;
		// Overwriting an edge's direction is the only thing a merge does that the
		// reader cannot undo in the edit sheet, so it is the only thing that asks.
		// A merge that loses no direction commits with no dialog at all.
		if (plan.directionConflicts.length > 0) {
			pendingNodeMerge = { plan, absorbedId, survivorId };
			return;
		}
		applyNodeMerge(plan, absorbedId, survivorId);
	}

	/** Commits an already-planned merge. Never re-plans: the dialog described this. */
	function applyNodeMerge(plan: NodeMergePlan, absorbedId: string, survivorId: string) {
		// The absorbed node is gone; leaving it primary would strand the pointer.
		if (primaryNodeId === absorbedId) primaryNodeId = survivorId;
		// And a back entry naming it has nowhere to return to — the same prune a
		// deletion pays for, which a merge has always skipped. The exit animation it
		// also skips is filed in `docs/debt/`.
		transientReveal.pruneMissing(new Set(plan.next.nodes.map((node) => node.id)));
		commitUserGraph(layoutRuntime.relaxAfterMutation(plan.next), editIntent('merge nodes'));
	}

	function openEditSheet(nodeId: string) {
		actionMenu = null;
		editNodeId = nodeId;
	}

	function armStageEntryGestureGate(direction: EntryGestureDirection) {
		stageEntryGestureGateRequestId += 1;
		stageEntryGestureGateRequest = {
			id: stageEntryGestureGateRequestId,
			direction,
			idleMs: focusEntryGestureIdleMs,
			maxMs: focusEntryGestureMaxMs
		};
	}

	function closeOverlays() {
		actionMenu = null;
		editNodeId = null;
		creationPreview = null;
		duplicateEdgeConfirm = null;
		// Dropping the plan is the whole cancel: nothing was mutated to undo.
		pendingNodeMerge = null;
		titleEditContext = null;
		tagColorLegendOpen = false;
		graphQueryPanelOpen = false;
		graphQueryPreviewText = null;
	}

	function focusCandidates(): NodeFocusCandidate[] {
		return visibleGraph.nodes.flatMap((node, index) => {
			const position = graphLayout.posByNodeId[node.id];
			const radius = graphLayout.radiusByNodeId[node.id];
			if (!position || radius === undefined) return [];
			return [{ node, position, radius, zIndex: index }];
		});
	}

	/** Live view state feeding `frameGeometry`; the stage rect is reported, not measured. */
	function focusViewState(): FrameViewState | null {
		if (!stageRect) return null;
		return {
			pan: { x: stageViewState.panX, y: stageViewState.panY },
			scale: stageViewState.scale,
			stageRect
		};
	}

	/** The subject node's current layout in graph space + its on-screen content scale. */
	function focusNodeLayout(subjectId: string): NodeFrameLayout | null {
		const node = nodeById[subjectId];
		const center = graphLayout.posByNodeId[subjectId];
		const radius = graphLayout.radiusByNodeId[subjectId];
		if (!node || !center || radius === undefined) return null;
		return {
			center,
			radius,
			nodeScale: graphLayout.scaleByNodeId[subjectId] ?? 1,
			pinned: node.pinned ?? false
		};
	}

	function focusFillRect(): Rect {
		const rect = usableStageRect(stageRect, lastSizedStageRect);
		const width = rect?.width ?? (typeof window === 'undefined' ? 800 : window.innerWidth);
		const height = rect?.height ?? (typeof window === 'undefined' ? 600 : window.innerHeight);
		return {
			left: rect?.left ?? 0,
			top: rect?.top ?? 0,
			width: Math.max(1, width),
			height: Math.max(1, height)
		};
	}

	/**
	 * Compute the level's frame geometry LIVE every render from the subject
	 * node's layout + the live stage view — no captured or measured rect. This
	 * is why the exit morph automatically tracks the node's current on-screen
	 * position; there is nothing to snapshot.
	 */
	function geometryForFocusLevel(level: FocusLevel): FrameGeometry {
		if (level.subjectKind === 'image') {
			// The image frame morphs from the captured on-screen image rect out to
			// the viewport through the SAME interpolation used for node frames.
			const morph = interpolateMorph(level.sourceRect, level.fillRect, level.morphProgress, {
				sourceRadiusPx: IMAGE_SOURCE_RADIUS_PX,
				targetRadiusPx: focusDetailsCornerRadiusPx,
				sourceBorderWidthPx: 0,
				targetBorderWidthPx: focusDetailsBorderWidthPx
			});
			return {
				x: morph.x,
				y: morph.y,
				width: morph.width,
				height: morph.height,
				borderRadiusPx: morph.borderRadiusPx,
				borderWidthPx: morph.borderWidthPx ?? 0
			};
		}
		const layout = focusNodeLayout(level.subjectId);
		const view = focusViewState();
		const fill = focusFillRect();
		if (!layout || !view) {
			return {
				x: fill.left,
				y: fill.top,
				width: fill.width,
				height: fill.height,
				borderRadiusPx: focusDetailsCornerRadiusPx,
				borderWidthPx: focusDetailsBorderWidthPx
			};
		}
		// Passed rather than left to `frameGeometry`'s own fallbacks, which read the
		// constants module and so would be frozen at import.
		return frameGeometry(layout, view, fill, level.morphProgress, {
			targetRadiusPx: focusDetailsCornerRadiusPx,
			targetBorderWidthPx: focusDetailsBorderWidthPx,
			nodeBorderWidthPx,
			pinnedNodeBorderWidthPx
		});
	}

	function baseSizeForFocusLevel(level: FocusLevel): LayerBaseSize {
		if (level.subjectKind === 'image') {
			// Details layer laid out at the captured fill size so its scale is
			// exactly 1 at fit — the image is scaled only by the layer + world
			// transforms, never twice, so it stays crisp.
			return {
				compactPx: IMAGE_COMPACT_PX,
				detailsWidthPx: level.fillRect.width,
				detailsHeightPx: level.fillRect.height
			};
		}
		const fill = focusFillRect();
		return {
			compactPx: nodeDiameterPx,
			detailsWidthPx: fill.width,
			detailsHeightPx: fill.height
		};
	}

	function toggleTagColorLegend() {
		const shouldOpen = !tagColorLegendOpen;
		closeOverlays();
		tagColorLegendOpen = shouldOpen;
	}

	function toggleGraphQueryPanel() {
		const shouldOpen = !graphQueryPanelOpen;
		closeOverlays();
		// The other half of the mutual exclusion: the settings panel is owned by the
		// page, so closing it is a request rather than an assignment.
		if (shouldOpen) onSettingsPanelClose?.();
		graphQueryPanelOpen = shouldOpen;
	}

	function toggleNodePinned(nodeId: string) {
		const wasPinned = nodeById[nodeId]?.pinned === true;
		commitUserGraph(
			layoutRuntime.beginScaleChange(togglePinned(graph, nodeId), nodeId),
			editIntent(wasPinned ? 'unpin node' : 'pin node')
		);
	}

	/**
	 * Go read another node.
	 *
	 * This replaced a pin-to-reveal action, and the difference is the point: no
	 * node is pinned, nothing is written to `graph`, and `onMultigraphChange`
	 * never fires. The target is held on screen only by the nav stack, and leaves
	 * with it. Pinning remains available where it means what it says — the node
	 * menu's Pin — rather than as the side effect of following a reference.
	 *
	 * The reader asked this from inside a node's details, so they land inside the
	 * target's details: the question was "what does that node say", and answering
	 * it by parking them on the canvas made them re-open the same overlay by hand.
	 */
	function jumpToNode(originNodeId: string, targetNodeId: string) {
		const targetNode = nodeById[targetNodeId];
		if (!targetNode) return;
		// Going where the reader already is. Every surface that offers a jump hides
		// it for the current node, so this is the backstop for the one that forgets
		// — and it has been forgotten once, which put a node in its own jump trail
		// behind a crumb that led back to the page it was pushed from.
		if (targetNodeId === originNodeId) return;
		// Read before pushing: the push changes the hop map, and what matters is
		// whether the reader could already see the target — a node that was
		// already on screen must not be taken away again when this entry pops.
		const alreadyVisible = visibleNodeIds.has(targetNodeId);
		travelToNode(
			targetNodeId,
			readDepartureState(originNodeId),
			alreadyVisible ? null : targetNodeId
		);
	}

	/** Where the reader was when they asked to go somewhere else. */
	interface DepartureState {
		/** The node whose details were on screen, or null when none were. */
		originNodeId: string | null;
		originFocused: boolean;
		viewState: ViewState;
	}

	/**
	 * The camera and the overlay as they stand *now*, for the entry that will
	 * bring the reader back to them.
	 *
	 * Every caller reads this before it changes anything, and the two reasons are
	 * different: `focusRootNodeId` is null once focus is gone, so a caller that
	 * closes first has nothing to name; and `stageViewState` is Stage's live
	 * pan/zoom, reported on every change, so reading it first is what makes the
	 * snapshot the exact camera the reader is looking at rather than a
	 * reconstruction of one.
	 */
	function readDepartureState(originNodeId: string | null): DepartureState {
		return {
			originNodeId,
			originFocused: focus.isFocused,
			viewState: {
				panX: stageViewState.panX,
				panY: stageViewState.panY,
				scale: stageViewState.scale
			}
		};
	}

	/**
	 * Land the reader on another node, with the way back recorded.
	 *
	 * Shared by the two journeys that end inside a node's details — following a
	 * reference (`jumpToNode`) and asking a follow-up (`askAiFollowUp`) — so a
	 * third one cannot become a third slightly different version of it.
	 * `revealedNodeId` is what this entry is holding on screen and has to take
	 * away again when it pops: the target for a jump that revealed it, and null
	 * for a node that is visible on its own account.
	 *
	 * Seed, settle and camera all before the overlay opens: the target may have
	 * been off-view, and the details view morphs back down onto the node's
	 * on-screen frame when it closes. Nothing here waits on a frame — the layout
	 * is derived synchronously from the seeded hop map, and an explicit focus
	 * entry commits at once rather than tracking a zoom gesture.
	 */
	function travelToNode(
		targetNodeId: string,
		departure: DepartureState,
		revealedNodeId: string | null
	) {
		closeOverlays();
		if (departure.originNodeId !== null) {
			transientReveal.push({
				originNodeId: departure.originNodeId,
				viewState: departure.viewState,
				revealedNodeId,
				originFocused: departure.originFocused
			});
		}
		relaxAfterTransientRevealChange();
		const bounds = boundsForNodeIds([targetNodeId]);
		if (bounds) fitViewRequest = { id: (fitViewRequestId += 1), bounds };
		enterFocusOnNode(targetNodeId);
	}

	/**
	 * Go back to where one jump started, dropping every jump made after it.
	 *
	 * Unwinding several at once is one restore, not a replay: the camera the
	 * reader wants is the one recorded at the crumb they clicked, and stepping
	 * through the intervening entries would fly them along a route they are
	 * explicitly asking to skip.
	 */
	function navigateToCrumb(index: number) {
		const entry = transientReveal.unwindTo(index);
		if (!entry) return;
		// Unwinding already removed the dropped seeds from the hop map. If the
		// reader pinned one of those nodes while they were there, it stays for that
		// reason instead — which is the correct outcome and needs no special case.
		relaxAfterTransientRevealChange();
		viewStateRequest = {
			id: (viewStateRequestId += 1),
			panX: entry.viewState.panX,
			panY: entry.viewState.panY,
			scale: entry.viewState.scale
		};
		// Going back undoes the jump, so it has to undo what the jump put on screen
		// too: the reader was reading the origin's details, not looking at the
		// canvas.
		if (entry.originFocused) enterFocusOnNode(entry.originNodeId);
	}

	/** Return to where the last jump started — the trail's newest crumb. */
	function navigateBack() {
		navigateToCrumb(transientReveal.depth - 1);
	}

	/**
	 * Enter the details view without a zoom gesture — the same commit the node
	 * menu's Focus item makes. Swapping subjects goes straight through it rather
	 * than closing first: a close tween would play the old node's details shrinking
	 * back onto the canvas before the new one opened.
	 */
	function enterFocusOnNode(nodeId: string) {
		const node = nodeById[nodeId];
		if (node) focus.openFocus(node);
	}

	/**
	 * A seed appearing or disappearing changes who is on screen, which is as
	 * topology-changing for the layout as an edit — so it settles the same way a
	 * content commit does, minus the commit. No graph data changes here: the
	 * settle's own frames write the positions through `LayoutRuntime.applyGraph`,
	 * exactly as a drag does.
	 *
	 * The seeded node pops in and settles rather than riding a reveal wave; the
	 * wave (`beginScaleChange`) is reserved for mutations, and hooking it up here
	 * would mean parameterizing its before/after hop maps.
	 */
	function relaxAfterTransientRevealChange() {
		layoutRuntime.settleAfterDrag();
	}

	/**
	 * What a screen reader says a node is, and what the keyboard can do with it.
	 *
	 * The canvas used to be `aria-hidden` in its entirety, so there was no
	 * accessible name to give and no way to reach a node without a pointer. The
	 * name is the title as a person would read it aloud — `mathPlainText`, the
	 * same projection the details heading and the breadcrumbs use — plus the one
	 * piece of state that changes what the node is doing to the layout around it.
	 */
	function nodeAccessibleName(node: NodeData): string {
		const title = mathPlainText(node.title);
		return node.pinned === true ? `${title}, pinned` : title;
	}

	/**
	 * Enter or Space on a focused node opens its details — the same commit the
	 * action menu's Focus item makes, which is the move that gives a keyboard
	 * reader everything else: the description, the quantity chips, the peek
	 * cards, and the way on to other nodes.
	 *
	 * Ignored unless the wrapper itself is the target: the inline title input
	 * lives inside it and Enter there means commit the title.
	 */
	function handleNodeKeyDown(event: KeyboardEvent, node: NodeData) {
		if (event.target !== event.currentTarget) return;
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		focus.openFocus(node);
	}

	/** Node titles are math; nothing outside a MathText renders the raw source. */
	function titleForNodeId(nodeId: string): string {
		return mathPlainText(nodeById[nodeId]?.title ?? nodeId);
	}

	function leaveFocusForCanvasAction() {
		closeOverlays();
		if (focus.isFocused) {
			focus.closeFocus();
		}
	}

	/**
	 * Turn an unresolved reference into a node that defines it, and hand the
	 * author the cursor.
	 *
	 * The node arrives titled `$k = $` with an empty description and the caret
	 * just before the closing `$`: the equation lives in the title because titles
	 * define on equal terms with descriptions here, and the right-hand side is
	 * left blank because inventing a value would be guessing at the author's
	 * intent. It is placed beside the node that asked for it, the camera is fitted
	 * to it, and a nav entry records the deep zoom the reader left — so Back
	 * returns them to the details they were reading rather than stranding them on
	 * the canvas.
	 *
	 * Ordering is load-bearing twice over. The departure state is read first
	 * because `focusRootNodeId` is null once focus is gone; the title-edit context
	 * is set last because `leaveFocusForCanvasAction()` runs `closeOverlays()`,
	 * which clears it.
	 */
	function createDefiningNode(consumerNodeId: string, quantityLabel: string, quantityKey: string) {
		// The origin is where the *reader* was, not whose input this is: the
		// consumer can be a definer three peek levels down, and Back has to return
		// to the node whose details are actually on screen.
		const departure = readDepartureState(focusRootNodeId);

		leaveFocusForCanvasAction();

		// Asking for this node IS the confirmation that it defines the quantity.
		// Without the designation the repair flow would end in a node whose edge
		// never appears, and a second trip through the edit sheet to say what the
		// button already said.
		const symbol = dataflow.index.entries.get(quantityKey)?.symbol;
		const title = `$${quantityLabel} = $`;
		const nextGraph = addNode(graph, {
			title,
			description: '',
			position: placementNear(consumerNodeId, 'below'),
			outputs: symbol ? [{ base: symbol.base, subscript: symbol.subscript }] : undefined
		});
		const newNode = nextGraph.nodes[nextGraph.nodes.length - 1] ?? null;
		commitUserGraph(layoutRuntime.relaxAfterMutation(nextGraph, null, 1), editIntent('add node'));
		if (!newNode) return;

		if (departure.originNodeId !== null) {
			// Nothing was revealed to get here: an edge-less node is its own
			// component, so it is its own beacon and is on screen regardless. The
			// entry survives the author deleting the new node, because pruning only
			// checks the origin and the revealed id.
			transientReveal.push({
				originNodeId: departure.originNodeId,
				viewState: departure.viewState,
				revealedNodeId: null,
				originFocused: departure.originFocused
			});
		}

		// `graphLayout` is derived, so this reads the post-commit layout — the new
		// node's placed position, not the empty slot it had a statement ago.
		const bounds = boundsForNodeIds([newNode.id]);
		if (bounds) fitViewRequest = { id: (fitViewRequestId += 1), bounds };

		titleEditContext = { nodeId: newNode.id, caretAt: title.length - 1 };
	}

	function deleteNode(nodeId: string) {
		const durationMs = resolvedLayoutSettings.enterExitDurationMs;
		const nowMs = layoutRuntime.now();

		// Capture final-known render data before mutating graph.
		const nodeToRemove = graph.nodes.find((n) => n.id === nodeId) ?? null;
		const nodePos = graph.posByNodeId[nodeId] ?? CENTERED_POSITION;
		const nodeScaleAtDelete = graphLayout.scaleByNodeId[nodeId] ?? 1;
		const affectedEdgeData = renderableEdgeVisibility
			.filter((v) => v.edge.sourceNodeId === nodeId || v.edge.targetNodeId === nodeId)
			.map((v) => v.edge);

		const neighborIds = neighborsOf(graph, nodeId).map((neighbor) => neighbor.id);
		const nextGraph = removeNode(graph, nodeId);
		const { survivorNodeId, severed } = severedComponentAfterMutation(nextGraph, neighborIds);
		// A deletion that orphaned any neighbour created a pinless component, so the
		// election that follows is told where the reader was looking. That includes
		// deleting the last pinned node, which orphans every neighbour at once and
		// so leaves no survivor to play a wave from.
		severedBeaconPreference = severed ? neighborIds : [];

		// Before the commit, and against `nextGraph`: the fallback must not pick the
		// node being deleted, and the intent has to name the primary this state
		// ends with rather than the one it started from.
		if (primaryNodeId === nodeId) primaryNodeId = fallbackPrimaryNodeId(nextGraph);

		if (severed && survivorNodeId !== null) {
			// The deletion cut a component off from every pinned node. Play the reveal
			// wave (as a severing edge removal does) so the orphaned side fades down to
			// its beacon instead of popping. The deleted node and its edges keep using
			// the exiting-buffer fade below: their live geometry is gone, so only the
			// buffer can still place them (the wave's leftovers skip them, see
			// revealWaveOnlyEdgeVisibility).
			commitUserGraph(
				layoutRuntime.beginScaleChange(nextGraph, survivorNodeId),
				editIntent('delete node')
			);
		} else {
			commitUserGraph(layoutRuntime.relaxAfterMutation(nextGraph), editIntent('delete node'));
		}

		if (durationMs > 0) {
			let nextBuffer = internalExitingBuffer;

			if (nodeToRemove) {
				// Cancel any enter animation and start exit.
				nodeEnterAnimations = Object.fromEntries(
					Object.entries(nodeEnterAnimations).filter(([k]) => k !== nodeId)
				);
				nextBuffer = cancelExitingNode(nextBuffer, nodeId);
				nextBuffer = addExitingNode(nextBuffer, nodeId, {
					nodeData: nodeToRemove,
					x: nodePos.x,
					y: nodePos.y,
					fromScale: nodeScaleAtDelete,
					startedAtMs: nowMs,
					durationMs
				});
			}

			for (const edge of affectedEdgeData) {
				const enterAnim = edgeEnterAnimations[edge.id];
				const fromOpacity = enterAnim ? edgeOpacityAt(enterAnim, nowMs) : 1;
				edgeEnterAnimations = Object.fromEntries(
					Object.entries(edgeEnterAnimations).filter(([k]) => k !== edge.id)
				);
				nextBuffer = cancelExitingEdge(nextBuffer, edge.id);
				nextBuffer = addExitingEdge(nextBuffer, edge.id, {
					edgeData: edge,
					fromOpacity,
					startedAtMs: nowMs,
					durationMs
				});
			}

			internalExitingBuffer = nextBuffer;
			if (nodeToRemove || affectedEdgeData.length > 0) {
				layoutRuntime.start();
			}
		}

		// A back entry naming the deleted node has nowhere to return to, and a seed
		// for it would hold a hop open for an id the graph no longer has.
		transientReveal.pruneMissing(new Set(nextGraph.nodes.map((node) => node.id)));

		closeOverlays();
	}

	function saveNodeContent(
		nodeId: string,
		content: {
			title: string;
			description: string;
			tags?: string[];
			inputs?: QuantityDesignation[];
			outputs?: QuantityDesignation[];
		}
	) {
		// Two passes rather than one: the first saves what the sheet's own fields
		// say, the second reads the markers out of the title it just stored — which
		// can rewrite the title and add to the tags and add-ons, additively, since
		// the sheet's fields stay the way to take any of them off again.
		const withFields = updateNodeContent(graph, nodeId, content);
		const listedTags =
			content.tags ?? withFields.nodes.find((node) => node.id === nodeId)?.tags ?? [];
		const withSyntax = commitSheetTitleSyntax(withFields, nodeId, content.title, listedTags);
		commitContentGraph(withSyntax, editIntent('edit node'));
		closeOverlays();
	}

	/**
	 * Store one attachment and give the node a block for it.
	 *
	 * The file's MIME type decides which block it becomes, not the button that
	 * picked it: a PNG chosen through Add file is still an image, and anything
	 * that is not an image is a file block whichever way it arrived.
	 */
	/** A fresh asset id, from the platform where there is one and the clock where there is not. */
	function newAssetId(): string {
		return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
			? crypto.randomUUID()
			: `asset-${Date.now().toString(36)}`;
	}

	/** The metadata a stored file is registered under, from the file itself. */
	function assetMetadataFor(assetId: string, file: File): GraphAssetMetadata {
		return {
			id: assetId,
			kind: file.type.startsWith('image/') ? 'image' : 'file',
			mimeType: file.type,
			name: file.name,
			size: file.size,
			createdAt: Date.now()
		};
	}

	async function addAttachmentToNode(
		nodeId: string,
		file: File
	): Promise<'added' | 'store-failed'> {
		if (!assetStore || !assetScope) return 'store-failed';
		const isImage = file.type.startsWith('image/');
		const assetId = newAssetId();
		const stored = await assetStore.put({
			scope: assetScope,
			assetId,
			blob: file,
			mimeType: file.type,
			name: file.name,
			size: file.size,
			updatedAt: Date.now()
		});
		if (!stored.ok) return 'store-failed';
		const asset = assetMetadataFor(assetId, file);
		// An image's alt starts as its filename, which is what the upload knows;
		// a file has no alt at all, because it is opened rather than rendered.
		const block: NodeContentBlock = isImage
			? { type: 'image', assetId, alt: file.name }
			: { type: 'file', assetId, name: file.name };
		commitUserGraph(
			addNodeContentBlock(graph, nodeId, block, asset),
			editIntent(isImage ? 'add image' : 'add file')
		);
		return 'added';
	}

	function saveNodeImage(
		nodeId: string,
		assetId: string,
		details: { alt: string; caption?: string }
	) {
		commitUserGraph(
			updateNodeImageContent(graph, nodeId, assetId, details),
			editIntent('edit image')
		);
	}

	function saveNodeFile(nodeId: string, assetId: string, details: { caption?: string }) {
		commitUserGraph(
			updateNodeFileContent(graph, nodeId, assetId, details),
			editIntent('edit attachment')
		);
	}

	function moveNodeAttachment(nodeId: string, fromIndex: number, direction: -1 | 1) {
		commitUserGraph(
			moveNodeContentBlock(graph, nodeId, fromIndex, fromIndex + direction),
			editIntent('move attachment')
		);
	}

	/**
	 * Swap the bytes behind one attachment, keeping the name the script opens.
	 *
	 * The workbench's Replace: a fresh export of the same measurement, and a Run
	 * that reads it without a model call. The new blob is stored under a new id
	 * and the *block* is repointed, so the block's `name` (or an image's `alt`)
	 * survives — which is what keeps `analysis.py` opening the same filename, and
	 * what makes `inputsChangedSince` call this a replacement rather than one file
	 * gone and another arrived.
	 *
	 * The old blob is tombstoned rather than deleted, on the same reasoning as a
	 * removal: undo has to be able to put the old bytes back. A block that is not
	 * there to repoint leaves the graph alone and tombstones the blob just stored,
	 * so a replace that raced a delete leaves nothing behind.
	 */
	async function replaceNodeAttachment(
		nodeId: string,
		assetId: string,
		file: File
	): Promise<'added' | 'store-failed'> {
		if (!assetStore || !assetScope) return 'store-failed';
		const nextAssetId = newAssetId();
		const stored = await assetStore.put({
			scope: assetScope,
			assetId: nextAssetId,
			blob: file,
			mimeType: file.type,
			name: file.name,
			size: file.size,
			updatedAt: Date.now()
		});
		if (!stored.ok) return 'store-failed';

		const result = replaceNodeContentBlockAsset(
			graph,
			nodeId,
			assetId,
			nextAssetId,
			assetMetadataFor(nextAssetId, file)
		);
		if (result.graph === graph) {
			await tombstoneAsset(assetStore, assetScope, nextAssetId);
			return 'store-failed';
		}

		commitUserGraph(result.graph, editIntent('replace attachment'));
		for (const removedAssetId of result.removedAssetIds) {
			await tombstoneAsset(assetStore, assetScope, removedAssetId);
		}
		return 'added';
	}

	/**
	 * Removing an attachment tombstones its blob rather than deleting it.
	 *
	 * A hard delete here made this the one edit an undo could not honour: the
	 * content block would come back pointing at nothing. The blob now stays,
	 * marked unreferenced, and the controller collects it once no history entry
	 * can reach it any more.
	 */
	async function deleteNodeAttachment(nodeId: string, assetId: string) {
		const result = removeNodeContentBlock(graph, nodeId, assetId);
		commitUserGraph(result.graph, editIntent('remove attachment'));
		if (!assetStore || !assetScope) return;
		for (const removedAssetId of result.removedAssetIds) {
			await tombstoneAsset(assetStore, assetScope, removedAssetId);
		}
	}

	/**
	 * Add or remove one add-on, with no confirm on the way off: milestone 12's
	 * undo is the safety net, and the intent names the add-on so the history
	 * entry says which one went.
	 */
	function toggleNodeAddon(nodeId: string, name: NodeAddonName, enabled: boolean) {
		commitUserGraph(
			enabled ? setNodeAddon(graph, nodeId, name) : removeNodeAddon(graph, nodeId, name),
			editIntent(addonIntentLabel(name, enabled ? 'add' : 'remove'))
		);
	}

	/**
	 * The details view's task control, routed the way every other edit is. The
	 * intent names the direction rather than the add-on, because that is what the
	 * undo list has to read back: "mark task done", not "edit node".
	 */
	function toggleNodeTaskDone(nodeId: string, done: boolean) {
		commitUserGraph(
			setTaskDone(graph, nodeId, done),
			editIntent(done ? 'mark task done' : 'mark task not done')
		);
	}

	function saveEdgeContent(edgeId: string, patch: Parameters<typeof updateEdge>[2]) {
		commitUserGraph(updateEdge(graph, edgeId, patch), editIntent('edit edge'));
	}

	/**
	 * The swatch is a native `<input type="color">`, whose `input` fires once per
	 * scrub frame — each a real `tagColorConfig` change that sails through the
	 * reference test. The coalesce key folds the run into one entry while the
	 * canvas still previews live; `change` closes it, so a second scrub of the
	 * same tag later starts a new one.
	 */
	function updateTagColor(
		namespace: TagColorNamespace,
		tag: string,
		color: string,
		phase: TagColorChangePhase = 'scrub'
	) {
		commitUserGraph(
			setTagColor(graph, namespace, tag, color),
			editIntent('tag color', {
				coalesceKey: `tag-color:${namespace}:${tag}`,
				...(phase === 'commit' ? { endsCoalesceRun: true } : {})
			})
		);
	}

	function deleteLegendTag(namespace: TagColorNamespace, tag: string) {
		const usageCount = tagUsageCount(graph, namespace, tag);
		if (usageCount > 0) {
			const tagKind = namespace === 'nodeTags' ? 'node tag' : 'edge tag';
			const confirmed = window.confirm(
				`Delete ${tagKind} "${tag}" from ${usageCount} ${usageCount === 1 ? 'use' : 'uses'}?`
			);
			if (!confirmed) return;
		}

		commitUserGraph(deleteTagEverywhere(graph, namespace, tag), editIntent('delete tag'));
	}

	function queryStateForNode(nodeId: string): GraphQueryElementState | undefined {
		return graphQueryResult.nodeStateById[nodeId];
	}

	function queryStateForEdge(edgeId: string): GraphQueryElementState | undefined {
		return graphQueryResult.edgeStateById[edgeId];
	}

	function queryOpacity(state: GraphQueryElementState | undefined): number {
		if (!graphQueryResult.hasActiveQuery || !state) return 1;
		if (state.role === 'focus' || state.role === 'spotlight') return 1;
		if (state.role === 'excluded') return 0;
		if (!graphQueryResult.dimsBackground) return 1;
		if (state.role === 'context') return 0.42;
		if (state.role === 'background') return 0.16;
		return 0;
	}

	function navigateQueryRegion(direction: 'previous' | 'next') {
		const regionCount = graphQueryResult.regions.length;
		if (regionCount === 0) return;
		activeQueryRegionIndex =
			direction === 'next'
				? (activeQueryRegionIndex + 1) % regionCount
				: (activeQueryRegionIndex - 1 + regionCount) % regionCount;
		fitActiveQueryRegion();
	}

	function fitActiveQueryRegion() {
		const region = graphQueryResult.regions[activeQueryRegionIndex];
		if (!region) return;
		const bounds = boundsForNodeIds(region.nodeIds);
		if (!bounds) return;
		fitViewRequest = { id: (fitViewRequestId += 1), bounds };
	}

	/**
	 * Bring the whole visible graph back into view.
	 *
	 * The remedy for an unbounded pan: zooming with the cursor away from the
	 * graph translates the camera without limit, and it is entirely possible to
	 * end up looking at empty canvas with no node on screen and no way back short
	 * of a reload. Bound to a bare `F` rather than given a button, because the
	 * canvas chrome is already three floating controls and this one is only
	 * wanted in the moment it is needed.
	 *
	 * Over the visible set rather than every node: what is hidden past
	 * `displayedLayers` is not what the reader lost, and fitting to it would zoom
	 * out past everything they can actually see.
	 */
	function fitVisibleGraph() {
		const bounds = boundsForNodeIds(visibleGraph.nodes.map((node) => node.id));
		if (!bounds) return;
		fitViewRequest = { id: (fitViewRequestId += 1), bounds };
	}

	/**
	 * One of the three node renders that exist only to be looked at: the reveal
	 * wave's leftovers, the exit fade of something just deleted, and the creation
	 * preview. All three place a `<Node>` at a graph point at some scale with
	 * pointer events off, and all three used to write the same wrapper out by
	 * hand.
	 *
	 * The live node loop deliberately stays separate — it carries the query role,
	 * the quantity chips, the inline title editor and the pin classes, and folding
	 * it in here would cost more in parameters than the duplication saves in
	 * lines.
	 */
	interface PassiveNodeRender {
		/** `data-node-id`, or null for the preview, which is not a node in the graph. */
		nodeId: string | null;
		nodeData: NodeData;
		x: number;
		y: number;
		scale: number;
		/** Null leaves the wrapper's opacity unset, which is what the preview wants. */
		opacity: number | null;
		/** The one data attribute that says which of the three this is. */
		marker: 'data-node-reveal-buffer' | 'data-node-exiting' | 'data-creation-preview-node';
	}

	function passiveNodeStyle(entry: PassiveNodeRender): string {
		const opacity = entry.opacity === null ? '' : ` opacity: ${entry.opacity};`;
		return `left: calc(50% + ${entry.x}px); top: calc(50% + ${entry.y}px); transform: translate(-50%, -50%) scale(${entry.scale});${opacity} pointer-events: none;`;
	}

	function boundsForNodeIds(nodeIds: string[]) {
		const entries = nodeIds.flatMap((nodeId) => {
			const position = graphLayout.posByNodeId[nodeId];
			const radius = graphLayout.radiusByNodeId[nodeId];
			if (!position || radius === undefined) return [];
			return [
				{
					minX: position.x - radius,
					minY: position.y - radius,
					maxX: position.x + radius,
					maxY: position.y + radius
				}
			];
		});
		if (entries.length === 0) return null;
		return {
			minX: Math.min(...entries.map((entry) => entry.minX)),
			minY: Math.min(...entries.map((entry) => entry.minY)),
			maxX: Math.max(...entries.map((entry) => entry.maxX)),
			maxY: Math.max(...entries.map((entry) => entry.maxY))
		};
	}

	function commitUserGraph(nextGraph: MultigraphData, intent: GraphCommitIntent) {
		graph = nextGraph;
		onMultigraphChange?.(nextGraph, lastSyncedGeneration, intent);
	}

	/**
	 * The intent for a commit about to happen, in the words the undo control will
	 * use.
	 *
	 * `primaryNodeId` and `severedBeaconPreference` are read from the live state,
	 * so every call site that re-points either one has to do it *before* it
	 * commits — which is also the only order that records a state consistent with
	 * the graph it belongs to.
	 */
	function editIntent(
		label: string,
		run: { coalesceKey?: string; endsCoalesceRun?: boolean } = {}
	): GraphCommitIntent {
		return {
			label,
			primaryNodeId,
			severedBeaconPreference: [...severedBeaconPreference],
			...(run.coalesceKey === undefined ? {} : { coalesceKey: run.coalesceKey }),
			...(run.endsCoalesceRun === undefined ? {} : { endsCoalesceRun: run.endsCoalesceRun })
		};
	}

	/**
	 * Take an externally mutated graph as this component's own, through the same
	 * path an internal mutation uses, so the new elements settle and animate in
	 * rather than snapping into place on the next reload.
	 *
	 * Committing here calls back out through `onMultigraphChange` — wanted, not
	 * tolerated: the relaxed positions are the ones worth saving. It cannot loop,
	 * because that callback never moves the revision this effect watches.
	 */
	function adoptGraphInPlace(incoming: MultigraphData, label: string) {
		// Read before committing: once `graph` is the incoming one, there is nothing
		// left to diff it against.
		const revealNodeId = importRevealTargetNodeId(graph, incoming);
		// Additive imports keep every host node, so the primary normally survives.
		// This is the same last-resort re-point a deletion does, for the day some
		// other in-place mutation does take it away.
		if (!incoming.nodes.some((node) => node.id === primaryNodeId)) {
			primaryNodeId = fallbackPrimaryNodeId(incoming);
		}
		commitUserGraph(layoutRuntime.relaxAfterMutation(incoming), editIntent(label));
		if (revealNodeId) revealImportedNode(revealNodeId);
	}

	/**
	 * Show the reader what just arrived, by the smallest camera move that does it.
	 *
	 * Only the revision-adopt path calls this. An import lands as its own
	 * component beside the reader's work — off screen more often than not — so
	 * without a camera the whole operation reads as nothing having happened. Every
	 * other mutation is something the reader just did, at a place they are already
	 * looking, and moving the camera for one would be taking the canvas away from
	 * them.
	 *
	 * The camera *pursues* the arrival rather than aiming once. Committing does not
	 * finish the layout: enter animations are still growing radii and the seam
	 * forces are still pushing the new component clear of the host, so a camera
	 * aimed at the position read one statement after the commit lands where the
	 * node used to be — measured at 81px of a node hanging off the right edge in
	 * the dev app. Each frame re-reads where the node is *now* and re-frames.
	 *
	 * The rect that has to stay visible is frozen at the reader's departing view.
	 * That is what makes re-aiming safe: the goal only moves because the target
	 * moved, never because the camera has already travelled — so the "keep what you
	 * could see" guarantee cannot ratchet itself outward frame by frame.
	 */
	function revealImportedNode(nodeId: string) {
		importRevealNodeId = nodeId;
		cancelImportReveal();
		const rect = stageRect;
		if (!rect || rect.width <= 0 || rect.height <= 0) return;
		const stage: StageSize = { width: rect.width, height: rect.height };
		const target = importRevealCircle(nodeId);
		if (!target) return;
		const from: CameraViewState = {
			panX: stageViewState.panX,
			panY: stageViewState.panY,
			scale: stageViewState.scale
		};
		const startedAtMs = Date.now();
		const pursuit: ImportRevealPursuit = {
			nodeId,
			from,
			viewport: viewportWorldRect(from, stage),
			stage,
			startedAtMs,
			durationMs: importRevealTransitionMs,
			deadlineMs: startedAtMs + importRevealMaxPursuitMs,
			marginRadiusFactor: IMPORT_REVEAL_MARGIN_RADIUS_FACTOR,
			minScale: DEFAULT_MIN_SCALE,
			maxScale: DEFAULT_MAX_SCALE,
			// Reduced motion lands at once and then joins the pursuit as a silent
			// observer: no per-frame camera, just one correction if the layout carries
			// the node elsewhere while it settles.
			instant: reduceMotion || typeof requestAnimationFrame !== 'function',
			lastTarget: target
		};
		if (pursuit.instant === true) {
			// Through the pursuit's own step, so the view motion lands on cannot be
			// framed differently from the one the flight would have reached.
			const landing = revealPursuitStep({
				pursuit,
				target,
				previousTarget: target,
				nowMs: startedAtMs,
				restEpsilon: resolvedLayoutSettings.postDragSettleEpsilonPx
			}).goal;
			if (landing) applyCameraView(landing);
		}
		// No rAF (server render): the landing above is all the reveal there can be.
		if (typeof requestAnimationFrame !== 'function') return;

		importRevealPursuit = pursuit;
		importRevealActive = true;
		importRevealFrameId = requestAnimationFrame(stepImportReveal);
	}

	/**
	 * One frame of the pursuit. All the deciding lives in `revealPursuitStep`; this
	 * only supplies where the arrival is drawn now and moves the camera it asks for.
	 */
	function stepImportReveal() {
		importRevealFrameId = null;
		const pursuit = importRevealPursuit;
		if (!pursuit) return;
		const target = importRevealCircle(pursuit.nodeId);
		// The node left the graph mid-flight. Nowhere left to aim; stop where we are.
		if (!target) {
			cancelImportReveal();
			return;
		}
		const step = revealPursuitStep({
			pursuit,
			target,
			previousTarget: pursuit.lastTarget,
			nowMs: Date.now(),
			// The same threshold the drag settle calls "at rest", so one idea of
			// "stopped moving" serves the physics and the camera watching it.
			restEpsilon: resolvedLayoutSettings.postDragSettleEpsilonPx
		});
		pursuit.lastTarget = target;
		if (step.view) applyCameraView(step.view);
		if (!step.done) {
			importRevealFrameId = requestAnimationFrame(stepImportReveal);
			return;
		}
		// The last word on where the camera belongs, from the position the node
		// actually came to rest at. Idempotent when the flight already landed there,
		// and the one correction the reduced-motion path gets.
		if (step.goal) applyCameraView(step.goal);
		cancelImportReveal();
	}

	/** Where the reveal target is drawn right now, off the live derived layout. */
	function importRevealCircle(nodeId: string): RevealCircle | null {
		const position = graphLayout.posByNodeId[nodeId] ?? graph.posByNodeId[nodeId];
		if (!position) return null;
		return {
			center: position,
			radius: graphLayout.radiusByNodeId[nodeId] ?? resolvedLayoutSettings.baseRadius
		};
	}

	/**
	 * Move the stage camera, through `viewStateRequest` — the same one-shot channel
	 * a Back crumb restores an exact camera with. Stage owns pan/zoom and reports
	 * every applied request out through `onViewStateChange`, so the landing view
	 * persists by the ordinary route with nothing special wired for it.
	 */
	function applyCameraView(view: CameraViewState) {
		viewStateRequest = {
			id: (viewStateRequestId += 1),
			panX: view.panX,
			panY: view.panY,
			scale: view.scale
		};
	}

	function cancelImportReveal() {
		importRevealPursuit = null;
		importRevealActive = false;
		if (importRevealFrameId === null) return;
		if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(importRevealFrameId);
		importRevealFrameId = null;
	}

	/**
	 * Commits an edit to a node's own text. Since the dataflow layer is derived
	 * from that text, writing an equation is as topology-changing as drawing an
	 * edge: it can put a node on the canvas that has never been placed by
	 * physics, and taking one away leaves a hole for the rest to close. Both are
	 * cases every structural mutation already handles by committing through the
	 * runtime, and content was the one path that did not, so an edit left the
	 * canvas frozen until the reader next dragged something.
	 *
	 * Unconditional rather than gated on a dataflow diff: the settle stops itself
	 * on the first frame that moves less than `postDragSettleEpsilonPx`, so a
	 * rename costs one frame that moves nothing rather than an equality check on
	 * the whole derived layer.
	 */
	function commitContentGraph(nextGraph: MultigraphData, intent: GraphCommitIntent) {
		commitUserGraph(layoutRuntime.relaxAfterMutation(nextGraph), intent);
		layoutRuntime.settleAfterDrag();
	}

	/**
	 * Advance one quantity around the assignment cycle from the details view.
	 *
	 * Through `commitContentGraph` rather than `saveNodeContent`: a designation is
	 * what draws a derived edge, so changing one is a topology change — and the
	 * save path closes the overlays, which would throw the reader out of the node
	 * they are reading every time they confirmed a ghost.
	 */
	function cycleNodeDesignation(
		nodeId: string,
		symbol: QuantitySymbol,
		suggestedRole?: 'input' | 'output'
	) {
		const node = nodeById[nodeId];
		if (!node) return;
		const next = cycleDesignation(
			{ inputs: node.inputs, outputs: node.outputs },
			symbol,
			suggestedRole
		);
		commitContentGraph(setNodeDesignations(graph, nodeId, next), editIntent('change designation'));
	}

	/**
	 * Confirm that some node defines a quantity — the one tap an unconfirmed peek
	 * row and an unconfirmed diagnostic both offer.
	 *
	 * The first affordance here that edits a node the reader is *not* focused on.
	 * That is the point: the answer to "who defines g?" is a row about another
	 * node, and making the reader travel there to agree with what it already says
	 * costs them their place for a tap that changes nothing else.
	 *
	 * `designateAs` rather than `cycleNodeDesignation`: the cycle's next stop from
	 * the input column is unassigned, so confirming a node that had this quantity
	 * confirmed as an input — reachable in two taps from any ghost chip — would
	 * take the designation away instead of moving it.
	 *
	 * Confirming can immediately surface a conflict diagnostic, when another node
	 * already claims the quantity with a different body. That is correct: the
	 * disagreement was always there, and confirming is what makes the graph state
	 * it.
	 */
	function confirmDefinerOutput(nodeId: string, quantityKey: string) {
		const node = nodeById[nodeId];
		// Read off the index rather than rebuilding from the key: keys are opaque
		// here, and the entry holds the symbol as the author's math produced it.
		const symbol = dataflow.index.entries.get(quantityKey)?.symbol;
		if (!node || !symbol) return;
		commitContentGraph(
			setNodeDesignations(
				graph,
				nodeId,
				designateAs({ inputs: node.inputs, outputs: node.outputs }, symbol, 'output')
			),
			editIntent('confirm definer')
		);
	}
</script>

{#snippet passiveNode(entry: PassiveNodeRender)}
	<div
		class="node-wrapper"
		aria-hidden="true"
		data-node-id={entry.nodeId ?? undefined}
		data-scale={entry.scale}
		data-node-opacity={entry.opacity ?? undefined}
		data-x={entry.x}
		data-y={entry.y}
		{...{ [entry.marker]: 'true' }}
		style={passiveNodeStyle(entry)}
	>
		<Node
			{...nodeChromeTunables}
			nodeData={entry.nodeData}
			isTitleEditing={false}
			borderSegments={nodeBorderSegments(entry.nodeData, graph.tagColorConfig.nodeTags)}
		/>
	</div>
{/snippet}

<div
	class="graph"
	class:focus-active={focus.committed && !focus.exiting}
	bind:this={graphRef}
	style={`--focus-transition-duration: ${focusTransitionMs}ms;`}
	data-settling={layoutRuntime.isSettling ? 'true' : undefined}
	data-scale-change-focal={layoutRuntime.scaleAnchoredNodeIds[0]}
	data-scale-animation-active={layoutRuntime.hasActiveScaleAnimations ? 'true' : undefined}
	data-layered-relayout-active={layoutRuntime.isLayeredRelayoutActive ? 'true' : undefined}
	data-layered-relayout-state={layoutRuntime.relayoutStateKey ?? undefined}
	data-import-reveal-node={importRevealNodeId ?? undefined}
	data-import-reveal-active={importRevealActive ? 'true' : undefined}
>
	<button
		type="button"
		class="toolbar-button tag-color-button"
		aria-haspopup="dialog"
		aria-expanded={tagColorLegendOpen}
		onclick={toggleTagColorLegend}
	>
		Tag colors
	</button>

	<button
		type="button"
		class="toolbar-button graph-query-button"
		aria-haspopup="dialog"
		aria-expanded={graphQueryPanelOpen}
		onclick={toggleGraphQueryPanel}
	>
		Find / Filter
	</button>

	{#if graphLost && !focus.isFocused}
		<!--
			The only affordance for Fit, and it appears exactly when Fit is the
			answer: the canvas is blank because the graph is somewhere off-view, and
			nothing else on screen would tell the reader that. A permanent button
			would be a fourth floating control paid for every session to solve a
			problem that happens in a few of them.
		-->
		<button type="button" class="lost-graph-hint" onclick={fitVisibleGraph}>
			Nothing in view — press <kbd>F</kbd> to fit the graph
		</button>
	{/if}

	{#if transientReveal.top && !focus.isFocused}
		{@const backEntry = transientReveal.top}
		<!--
			The canvas's single-step way back. Inside the details view the breadcrumb
			trail says the same thing and more, so this would be a second control for
			one of the moves it already offers — and one that has to out-stack the
			overlay to be clickable at all. A stack is only ever non-empty because of
			a jump, so it appears exactly when there is something to go back from.
		-->
		<button
			type="button"
			class="toolbar-button nav-back-button"
			data-nav-back={backEntry.originNodeId}
			onclick={navigateBack}
		>
			← Back to {titleForNodeId(backEntry.originNodeId)}
		</button>
	{/if}

	<Stage
		{...stageTunables}
		{getNodeAt}
		{fitViewRequest}
		{viewStateRequest}
		focusEntryBoundaryCandidateForPoint={(input) => focus.entryBoundaryCandidateForPoint(input)}
		entryGestureGateRequest={stageEntryGestureGateRequest}
		initialScale={initialViewState?.scale}
		initialPanX={initialViewState?.panX}
		initialPanY={initialViewState?.panY}
		onNodeMoved={handleNodeMoved}
		onNodeDragStart={handleNodeDragStart}
		onNodeDragEnd={handleNodeDragEnd}
		onNodeMakePrimary={handleNodeMakePrimary}
		onNodeDoubleClickDropOntoNode={handleNodeDoubleClickDropOntoNode}
		onNodeDoubleClickDropOntoBackground={handleNodeDoubleClickDropOntoBackground}
		onNodeLongPress={openNodeActionMenu}
		onNodeContextMenu={openNodeActionMenu}
		{creationArmRequest}
		onCreationDragUpdate={handleCreationDragUpdate}
		onCreationCancel={handleCreationCancel}
		onNodeMergeDropOntoNode={handleNodeMergeDropOntoNode}
		onViewStateLiveChange={(state) => {
			stageViewState = state;
		}}
		onStageRectChange={(rect) => {
			stageRect = rect;
		}}
		onBlockedZoom={(input) => focus.handleBlockedZoom(input)}
		{onViewStateChange}
	>
		<div class="edges" aria-hidden="true">
			{#each renderableEdgeVisibility as visibility (visibility.edge.id)}
				{@const edge = visibility.edge}
				{@const queryEdgeState = queryStateForEdge(edge.id)}
				{#if queryEdgeState?.role !== 'excluded'}
					{@const parallelOffset =
						visibility.kind === 'visible' ? visibleEdgeParallelOffsets[edge.id] : undefined}
					{@const edgePoints = edgeRenderPoints(
						visibility,
						graphLayout,
						graph.posByNodeId,
						parallelOffset
					)}
					{@const edgeLengthPx = Math.hypot(
						edgePoints.target.x - edgePoints.source.x,
						edgePoints.target.y - edgePoints.source.y
					)}
					{@const boundaryFadeRadiusPx =
						visibility.kind === 'boundary'
							? (graphLayout.radiusByNodeId[visibility.visibleNodeId] ?? 0)
							: undefined}
					{@const effectiveEdgeOcclusionParameters = edgeOcclusionParametersForZoom(
						{
							clearancePx: resolvedLayoutSettings.edgeOcclusionClearancePx,
							fadeWidthPx: resolvedLayoutSettings.edgeOcclusionFadeWidthPx,
							zoomScaleExponent: resolvedLayoutSettings.edgeOcclusionZoomScaleExponent
						},
						stageScale
					)}
					{@const edgeOcclusionWindows =
						visibility.kind === 'visible'
							? computeEdgeOcclusionWindows(
									{
										sourceNodeId: edge.sourceNodeId,
										targetNodeId: edge.targetNodeId,
										source: edgePoints.source,
										target: edgePoints.target,
										directed: edge.directed
									},
									visibleEdgeOcclusionNodes,
									{
										...effectiveEdgeOcclusionParameters,
										edgeOcclusionMinOpacity: resolvedLayoutSettings.edgeOcclusionMinOpacity
									}
								)
							: []}
					{@const arrowScale = edgeArrowScale(
						visibility,
						graphLayout.scaleByNodeId,
						arrowReferenceNodeScale
					)}
					{@const strokeScale = edgeStrokeScale(
						visibility,
						graphLayout.scaleByNodeId,
						strokeReferenceNodeScale
					)}
					{@const edgeColor =
						queryEdgeState?.role === 'spotlight' && queryEdgeState.spotlightColor
							? queryEdgeState.spotlightColor
							: edgeStrokeColor(edge, graph.tagColorConfig.edgeTags)}
					{@const edgeEnterAnim = edgeEnterAnimations[edge.id]}
					{@const baseEdgeOpacity =
						edgeRenderOverrides?.[edge.id]?.opacity ??
						(edgeEnterAnim ? edgeOpacityAt(edgeEnterAnim, layoutRuntime.animationNowMs) : 1)}
					{@const edgeOpacity =
						baseEdgeOpacity *
						(revealWaveEdgeOpacityByEdgeId[edge.id] ?? 1) *
						queryOpacity(queryEdgeState)}
					{@const derivedQuantityLabel = quantityLabelByEdgeId.get(edge.id) ?? ''}
					{@const showQuantityLabel =
						derivedQuantityLabel !== '' &&
						visibility.kind === 'visible' &&
						shouldRevealQuantityLabel(edgeLengthPx, stageScale, {
							minStageScale: dataflowCfg.labelMinStageScale,
							minOnScreenLengthPx: dataflowCfg.labelMinOnScreenLengthPx
						})}
					<div
						class="edge"
						class:directed={edge.directed === true && visibility.kind === 'visible'}
						class:boundary={visibility.kind === 'boundary'}
						class:derived={isDerivedEdgeId(edge.id)}
						class:query-spotlight={queryEdgeState?.role === 'spotlight'}
						data-edge-id={edge.id}
						data-edge-derived={isDerivedEdgeId(edge.id) ? 'true' : undefined}
						data-query-role={queryEdgeState?.role}
						data-source-node-id={edge.sourceNodeId}
						data-target-node-id={edge.targetNodeId}
						data-directed={edge.directed === true ? 'true' : undefined}
						data-arrow-target-node-id={edge.directed === true && visibility.kind === 'visible'
							? edge.targetNodeId
							: undefined}
						data-edge-visibility={visibility.kind}
						data-visible-node-id={visibility.kind === 'boundary'
							? visibility.visibleNodeId
							: undefined}
						data-hidden-node-id={visibility.kind === 'boundary'
							? visibility.hiddenNodeId
							: undefined}
						data-boundary-fade-ratio={visibility.kind === 'boundary'
							? visibility.fadeRatio
							: undefined}
						data-boundary-fade-radius={boundaryFadeRadiusPx}
						data-edge-boundary-dashed={visibility.kind === 'boundary' ? 'true' : undefined}
						data-edge-arrow-scale={edge.directed === true && visibility.kind === 'visible'
							? arrowScale
							: undefined}
						data-edge-stroke-scale={strokeScale}
						data-edge-opacity={edgeOpacity}
						data-edge-parallel-count={visibility.kind === 'visible'
							? parallelOffset?.groupCount
							: undefined}
						data-edge-parallel-slot={visibility.kind === 'visible'
							? parallelOffset?.slot
							: undefined}
						data-edge-parallel-offset={visibility.kind === 'visible'
							? (parallelOffset?.offsetDistance ?? 0)
							: undefined}
						data-edge-occlusion-count={visibility.kind === 'visible'
							? edgeOcclusionWindows.length
							: undefined}
						data-edge-occlusion-fade-width={visibility.kind === 'visible'
							? effectiveEdgeOcclusionParameters.edgeOcclusionFadeWidthPx
							: undefined}
						style={`${edgeStyle(edgePoints.source, edgePoints.target)} --edge-background: ${edgeBackground(
							visibility,
							edgeColor,
							{
								occlusionWindows: edgeOcclusionWindows,
								edgeLengthPx,
								edgeArrowLengthPx: arrowLengthPx * arrowScale,
								edgeOcclusionMinOpacity: resolvedLayoutSettings.edgeOcclusionMinOpacity,
								boundaryFadeRadiusPx
							}
						)}; color: ${edgeColor}; --edge-spotlight-color: ${queryEdgeState?.spotlightColor ?? 'transparent'}; --edge-arrow-length: ${arrowLengthPx * arrowScale}px; --edge-arrow-half-height: ${arrowHalfHeightPx * arrowScale}px; --edge-stroke-width: ${strokeWidthPx * strokeScale}px; opacity: ${edgeOpacity};`}
					>
						{#if showQuantityLabel}
							<!-- Counter-rotated so the text stays upright on an edge at any angle. -->
							<span
								class="edge-quantity-label"
								data-edge-quantity-label={edge.id}
								style={`transform: translate(-50%, -50%) rotate(${-edgeAngleDegrees(edgePoints.source, edgePoints.target)}deg);`}
								>{derivedQuantityLabel}</span
							>
						{/if}
					</div>
				{/if}
			{/each}
			{#each revealWaveOnlyEdgeVisibility as visibility (visibility.edge.id)}
				{@const edge = visibility.edge}
				{@const edgePoints = edgeRenderPoints(visibility, combinedEdgeLayout, graph.posByNodeId)}
				{@const edgeLengthPx = Math.hypot(
					edgePoints.target.x - edgePoints.source.x,
					edgePoints.target.y - edgePoints.source.y
				)}
				{@const boundaryFadeRadiusPx =
					visibility.kind === 'boundary'
						? (combinedEdgeLayout.radiusByNodeId[visibility.visibleNodeId] ?? 0)
						: undefined}
				{@const arrowScale = edgeArrowScale(
					visibility,
					combinedScaleByNodeId,
					arrowReferenceNodeScale
				)}
				{@const strokeScale = edgeStrokeScale(
					visibility,
					combinedScaleByNodeId,
					strokeReferenceNodeScale
				)}
				{@const edgeColor = edgeStrokeColor(edge, graph.tagColorConfig.edgeTags)}
				{@const baseEdgeOpacity = edgeRenderOverrides?.[edge.id]?.opacity ?? 1}
				{@const edgeOpacity = baseEdgeOpacity * (revealWaveEdgeOpacityByEdgeId[edge.id] ?? 1)}
				<div
					class="edge"
					class:directed={edge.directed === true && visibility.kind === 'visible'}
					class:boundary={visibility.kind === 'boundary'}
					data-edge-id={edge.id}
					data-source-node-id={edge.sourceNodeId}
					data-target-node-id={edge.targetNodeId}
					data-directed={edge.directed === true ? 'true' : undefined}
					data-arrow-target-node-id={edge.directed === true && visibility.kind === 'visible'
						? edge.targetNodeId
						: undefined}
					data-edge-visibility={visibility.kind}
					data-visible-node-id={visibility.kind === 'boundary'
						? visibility.visibleNodeId
						: undefined}
					data-hidden-node-id={visibility.kind === 'boundary' ? visibility.hiddenNodeId : undefined}
					data-boundary-fade-ratio={visibility.kind === 'boundary'
						? visibility.fadeRatio
						: undefined}
					data-boundary-fade-radius={boundaryFadeRadiusPx}
					data-edge-boundary-dashed={visibility.kind === 'boundary' ? 'true' : undefined}
					data-edge-arrow-scale={edge.directed === true && visibility.kind === 'visible'
						? arrowScale
						: undefined}
					data-edge-stroke-scale={strokeScale}
					data-edge-opacity={edgeOpacity}
					data-edge-reveal-buffer="true"
					style={`${edgeStyle(edgePoints.source, edgePoints.target)} --edge-background: ${edgeBackground(
						visibility,
						edgeColor,
						{
							edgeLengthPx,
							boundaryFadeRadiusPx
						}
					)}; color: ${edgeColor}; --edge-arrow-length: ${arrowLengthPx * arrowScale}px; --edge-arrow-half-height: ${arrowHalfHeightPx * arrowScale}px; --edge-stroke-width: ${strokeWidthPx * strokeScale}px; opacity: ${edgeOpacity}; pointer-events: none;`}
				></div>
			{/each}
			{#each exitingOnlyEdges as [id, entry] (id)}
				{@const sourcePos = graph.posByNodeId[entry.edgeData.sourceNodeId]}
				{@const targetPos = graph.posByNodeId[entry.edgeData.targetNodeId]}
				{#if sourcePos && targetPos}
					{@const edgeOpacity =
						edgeRenderOverrides?.[id]?.opacity ??
						exitingEdgeOpacityAt(entry, layoutRuntime.animationNowMs)}
					{@const edgeColor = edgeStrokeColor(entry.edgeData, graph.tagColorConfig.edgeTags)}
					<div
						class="edge"
						data-edge-id={id}
						data-source-node-id={entry.edgeData.sourceNodeId}
						data-target-node-id={entry.edgeData.targetNodeId}
						data-edge-exiting="true"
						data-edge-opacity={edgeOpacity}
						style={`${edgeStyle(sourcePos, targetPos)} --edge-background: ${edgeColor}; color: ${edgeColor}; --edge-stroke-width: ${strokeWidthPx}px; opacity: ${edgeOpacity}; pointer-events: none;`}
					></div>
				{/if}
			{/each}
			{#if creationPreviewEdgePoints}
				{@const isMergePreview = creationPreview?.mode === 'merge'}
				{@const previewEdgeColor = isMergePreview
					? MERGE_PREVIEW_COLOR
					: edgeStrokeColor(CREATION_PREVIEW_EDGE, graph.tagColorConfig.edgeTags)}
				<div
					class="edge"
					class:merge-preview={isMergePreview}
					data-creation-preview-edge="true"
					data-creation-preview-mode={creationPreview?.mode ?? 'create'}
					style={`${edgeStyle(creationPreviewEdgePoints.source, creationPreviewEdgePoints.target)} --edge-background: ${previewEdgeColor}; color: ${previewEdgeColor}; --edge-stroke-width: ${strokeWidthPx}px; pointer-events: none;`}
				></div>
			{/if}
		</div>

		{#each visibleGraph.nodes as node (node.id)}
			{@const queryNodeState = queryStateForNode(node.id)}
			{#if queryNodeState?.role !== 'excluded'}
				{@const nodePos = graphLayout.posByNodeId[node.id] ?? CENTERED_POSITION}
				{@const nodeTargetScale = graphLayout.scaleByNodeId[node.id] ?? 1}
				{@const nodeEnterAnim = nodeEnterAnimations[node.id]}
				{@const nodeScale = nodeEnterAnim
					? nodeEnterScaleAt(nodeEnterAnim, layoutRuntime.animationNowMs)
					: nodeTargetScale}
				{@const baseNodeOpacity = nodeRenderOverrides?.[node.id]?.opacity ?? 1}
				{@const nodeOpacity =
					baseNodeOpacity *
					(revealWaveNodeOpacityByNodeId[node.id] ?? 1) *
					queryOpacity(queryNodeState)}
				{@const nodeChips = shouldShowQuantityChips(nodeDiameterPx, nodeScale, stageScale, {
					minOnScreenDiameterPx: dataflowCfg.chipMinOnScreenDiameterPx
				})
					? quantityChips(definedQuantityLabelsByNodeId.get(node.id) ?? [], {
							maxVisible: dataflowCfg.chipMaxVisibleQuantities
						})
					: EMPTY_QUANTITY_CHIPS}
				<!--
					Focusable and named, so the graph is reachable without a pointer.
					`.stage-content` sets `pointer-events: none` and hit testing stays
					geometric on the Stage, so nothing here competes with the pointer
					gestures — `onclick` is the handler this role owes its own contract,
					not a second path a mouse can take.
				-->
				<div
					class="node-wrapper"
					class:primary={primaryNodeId === node.id}
					class:focus-owned={focus.focusedNodeId === node.id}
					class:merge-target={mergeTargetNodeId === node.id}
					role="button"
					tabindex="0"
					aria-label={nodeAccessibleName(node)}
					data-node-id={node.id}
					data-merge-target={mergeTargetNodeId === node.id ? 'true' : undefined}
					data-query-role={queryNodeState?.role}
					data-scale={nodeScale}
					data-node-opacity={nodeOpacity}
					data-x={nodePos.x}
					data-y={nodePos.y}
					onkeydown={(event) => handleNodeKeyDown(event, node)}
					onclick={() => focus.openFocus(node)}
					style={`left: calc(50% + ${nodePos.x}px); top: calc(50% + ${nodePos.y}px); transform: translate(-50%, -50%) scale(${nodeScale}); opacity: ${nodeOpacity};`}
				>
					<Node
						{...nodeChromeTunables}
						nodeData={node}
						isTitleEditing={titleEditContext?.nodeId === node.id}
						titleCaretAt={titleEditContext?.nodeId === node.id
							? titleEditContext?.caretAt
							: undefined}
						quantityLabels={nodeChips.labels}
						quantityOverflowCount={nodeChips.overflowCount}
						borderSegments={nodeBorderSegments(node, graph.tagColorConfig.nodeTags)}
						spotlightColor={queryNodeState?.role === 'spotlight'
							? queryNodeState.spotlightColor
							: undefined}
						onTitleCommit={(title) => {
							const createdEdgeId = titleEditContext?.edgeId;
							const shouldUnpin = titleEditContext?.unpinOnCommit === true;
							titleEditContext = null;
							const committedGraph = commitInlineTitleSyntax(graph, node.id, title, createdEdgeId);
							if (shouldUnpin) {
								// `beginScaleChange` kicks the loop on its own account.
								commitUserGraph(
									layoutRuntime.beginScaleChange(
										setNodePinned(committedGraph, node.id, false),
										node.id
									),
									editIntent('rename node')
								);
								return;
							}
							commitContentGraph(committedGraph, editIntent('rename node'));
						}}
					/>
				</div>
			{/if}
		{/each}
		{#each layoutRuntime.revealWavePreviousOnlyNodeIds as nodeId (nodeId)}
			{@const bufferedNode = nodeById[nodeId]}
			{#if bufferedNode}
				{@const nodePos = graph.posByNodeId[nodeId] ?? CENTERED_POSITION}
				{@render passiveNode({
					nodeId,
					nodeData: bufferedNode,
					x: nodePos.x,
					y: nodePos.y,
					scale: revealWavePreviousScaleByNodeId[nodeId] ?? resolvedLayoutSettings.minScale,
					opacity:
						(nodeRenderOverrides?.[nodeId]?.opacity ?? 1) *
						(revealWaveNodeOpacityByNodeId[nodeId] ?? 1),
					marker: 'data-node-reveal-buffer'
				})}
			{/if}
		{/each}
		{#each exitingOnlyNodes as [id, entry] (id)}
			{@render passiveNode({
				nodeId: id,
				nodeData: entry.nodeData,
				x: entry.x,
				y: entry.y,
				scale: exitingNodeScaleAt(entry, layoutRuntime.animationNowMs),
				opacity: nodeRenderOverrides?.[id]?.opacity ?? 1,
				marker: 'data-node-exiting'
			})}
		{/each}
		{#if creationPreview && creationPreviewSourcePos && creationPreviewScale > 0}
			{@render passiveNode({
				nodeId: null,
				nodeData: CREATION_PREVIEW_NODE,
				x: creationPreview.point.x,
				y: creationPreview.point.y,
				scale: creationPreviewScale,
				opacity: null,
				marker: 'data-creation-preview-node'
			})}
		{/if}
	</Stage>

	{#if actionMenu && actionMenuNode}
		<NodeActionMenu
			node={actionMenuNode}
			position={actionMenu.position}
			onAddNodeEdge={() => armCreationGesture(actionMenuNode)}
			onMergeNode={() => armCreationGesture(actionMenuNode, 'merge')}
			onTogglePinned={() => {
				toggleNodePinned(actionMenuNode.id);
				closeOverlays();
			}}
			onEdit={() => openEditSheet(actionMenuNode.id)}
			onFocus={() => focus.openFocus(actionMenuNode)}
			onDelete={() => deleteNode(actionMenuNode.id)}
			onClose={() => (actionMenu = null)}
			onRetarget={retargetNodeActionMenu}
		/>
	{/if}

	{#if editNode}
		<NodeEditSheet
			node={editNode}
			nodes={graph.nodes}
			edges={graph.edges}
			assets={graph.assets ?? {}}
			onSave={(content: {
				title: string;
				description: string;
				tags: string[];
				inputs: QuantityDesignation[];
				outputs: QuantityDesignation[];
			}) => saveNodeContent(editNode.id, content)}
			onAddAttachment={(file) => addAttachmentToNode(editNode.id, file)}
			onSaveImage={(assetId, details) => saveNodeImage(editNode.id, assetId, details)}
			onSaveFile={(assetId, details) => saveNodeFile(editNode.id, assetId, details)}
			onMoveAttachment={(fromIndex, direction) =>
				moveNodeAttachment(editNode.id, fromIndex, direction)}
			onDeleteAttachment={(assetId) => void deleteNodeAttachment(editNode.id, assetId)}
			onToggleAddon={(name, enabled) => toggleNodeAddon(editNode.id, name, enabled)}
			onSaveEdge={saveEdgeContent}
			onCancel={() => (editNodeId = null)}
			onTogglePinned={() => toggleNodePinned(editNode.id)}
			onDelete={() => deleteNode(editNode.id)}
			chipInsertHoldMs={dataflowCfg.chipInsertLongPressMs}
		/>
	{/if}

	{#snippet focusFrame({ level, borderRadiusPx, borderWidthPx, content }: StackFrameArgs)}
		{#if level.subjectKind === 'image'}
			<!-- Pinned like the node frame beside it: a clipping box that is scrolled
			     takes the whole level off screen (`lib/pinScroll.ts`). -->
			<div
				class="focus-image-frame"
				style={`border-radius: ${borderRadiusPx}px; border-width: ${borderWidthPx}px;`}
				onscroll={(event) => pinScrollToOrigin(event.currentTarget)}
			>
				{@render content()}
			</div>
		{:else}
			{@const frameNode = nodeById[level.subjectId]}
			{#if frameNode}
				{@const segments = nodeBorderSegments(frameNode, graph.tagColorConfig.nodeTags)}
				<NodeChrome
					diameterPx={nodeDiameterPx}
					{borderRadiusPx}
					{borderWidthPx}
					pinnedBorderWidthPx={borderWidthPx}
					pinned={frameNode.pinned ?? false}
					hasTagBorder={segments.length > 0}
					tagBorderBackground={tagBorderBackground(segments)}
					detailsMode
					surfaceBackground="#ffffff"
				>
					{@render content()}
				</NodeChrome>
			{/if}
		{/if}
	{/snippet}

	{#snippet focusCompact(level: FocusLevel)}
		{#if level.subjectKind === 'image'}
			<div class="focus-compact-fill">
				<img class="focus-image-thumb" src={level.subjectSrc} alt={level.subjectAlt ?? ''} />
			</div>
		{:else}
			{@const compactNode = nodeById[level.subjectId]}
			{#if compactNode}
				<div class="focus-compact-fill">
					<NodeCompactContent
						title={compactNode.title}
						diameterPx={nodeDiameterPx}
						fontSizePx={nodeTextFontSizePx}
						detailsMode
					/>
				</div>
			{/if}
		{/if}
	{/snippet}

	{#snippet focusDetails(level: FocusLevel)}
		{#if level.subjectKind === 'image'}
			<div
				class="focus-image-details"
				data-focus-subject-id={level.subjectId}
				data-subject-kind="image"
			>
				<img class="focus-image-full" src={level.subjectSrc} alt={level.subjectAlt ?? ''} />
			</div>
		{:else}
			{@const detailsNode = nodeById[level.subjectId]}
			{#if detailsNode?.addons?.ai}
				<!-- An `!ai` node's focus surface is the workbench, not the details
				     view: it is the same full-screen level with a different content
				     variant, which is why nested image zoom over its output grid
				     works without anything here knowing about it. -->
				<div class="focus-surface" data-focus-subject-id={level.subjectId}>
					<NodeDetailsLayer title={detailsNode.title} detailsTitleId={DETAILS_TITLE_ID} detailsMode>
						<AiNodeContent
							node={detailsNode}
							inputs={collectAiInputs(graph, detailsNode.id)}
							digests={aiRun.digestsFor(detailsNode.id)}
							previewRows={aiSettings.previewRows}
							assets={graph.assets ?? {}}
							{assetStore}
							{assetScope}
							runState={aiRun.stateFor(detailsNode.id)}
							hasKey={aiClient !== null}
							model={aiSettings.model}
							ancestors={collectAiAncestors(graph, detailsNode.id)}
							inheritedScript={inheritedScript(graph, detailsNode.id)}
							{titleForNodeId}
							nodeExists={(nodeId) => nodeById[nodeId] !== undefined}
							onPromptChange={(prompt) =>
								commitUserGraph(
									setAiPrompt(graph, detailsNode.id, prompt),
									editIntent('edit AI prompt')
								)}
							onRun={(mode) => runAiNode(detailsNode.id, mode)}
							onCancel={() => aiRun.cancel(detailsNode.id)}
							onPromote={(outputName) => promoteAiOutputToNode(detailsNode.id, outputName)}
							onAskFollowUp={(prompt) => askAiFollowUp(detailsNode.id, prompt)}
							onFix={() => fixAiNode(detailsNode.id)}
							onOpenSettings={() => onOpenAiSettings?.()}
							onJumpToNode={(nodeId) => jumpToNode(detailsNode.id, nodeId)}
							onAddFile={(nodeId, file) => addAttachmentToNode(nodeId, file)}
							onReplaceFile={(nodeId, assetId, file) =>
								replaceNodeAttachment(nodeId, assetId, file)}
							onRemoveFile={(nodeId, assetId) => void deleteNodeAttachment(nodeId, assetId)}
						/>
					</NodeDetailsLayer>
				</div>
			{:else if detailsNode}
				<div class="focus-surface" data-focus-subject-id={level.subjectId}>
					<NodeDetailsLayer title={detailsNode.title} detailsTitleId={DETAILS_TITLE_ID} detailsMode>
						<NodeDetailsContent
							node={detailsNode}
							assets={graph.assets ?? {}}
							{assetStore}
							{assetScope}
							diagnostics={nodeDiagnosticsView(dataflowDiagnostics, detailsNode.id)}
							quantities={dataflow.index.byNodeId.get(detailsNode.id)}
							quantityEntryFor={(key) => dataflow.index.entries.get(key)}
							inputsForNodeId={(nodeId) => nodeById[nodeId]?.inputs ?? EMPTY_DESIGNATIONS}
							outputsForNodeId={(nodeId) => nodeById[nodeId]?.outputs ?? EMPTY_DESIGNATIONS}
							{titleForNodeId}
							currentNodeId={detailsNode.id}
							onCycleDesignation={(symbol, suggestedRole) =>
								cycleNodeDesignation(detailsNode.id, symbol, suggestedRole)}
							onCreateDefiningNode={(quantityLabel, quantityKey, consumerNodeId) =>
								createDefiningNode(consumerNodeId ?? detailsNode.id, quantityLabel, quantityKey)}
							onConfirmDefiner={confirmDefinerOutput}
							onJumpToNode={(nodeId) => jumpToNode(detailsNode.id, nodeId)}
							onToggleTaskDone={(done) => toggleNodeTaskDone(detailsNode.id, done)}
							chipPeekHoldMs={dataflowCfg.chipPeekLongPressMs}
						/>
					</NodeDetailsLayer>
				</div>
			{/if}
		{/if}
	{/snippet}

	{#if focus.isFocused}
		<div
			class="focus-root"
			class:reduced-motion={reduceMotion}
			role={focus.dialogOpen ? 'dialog' : undefined}
			aria-modal={focus.dialogOpen ? 'true' : undefined}
			aria-labelledby={focus.dialogOpen ? DETAILS_TITLE_ID : undefined}
			tabindex="-1"
			data-focus-depth={focus.depth}
			data-exit-scrub={focus.exitScrubActive ? 'true' : undefined}
			onkeydown={(event) => {
				if (event.key !== 'Escape') return;
				// The surface is inside this element, so the press is spent here and
				// does not reach the window listener to be read a second time.
				event.stopPropagation();
				leaveFocusOnEscape();
			}}
		>
			{#if focus.dialogOpen && navCrumbs.length > 1}
				<!--
					Only worth drawing once there is somewhere to go back to: a lone
					current crumb would be a trail naming where the reader is standing.
				-->
				<div class="focus-breadcrumbs">
					<NavBreadcrumbs crumbs={navCrumbs} {titleForNodeId} onNavigate={navigateToCrumb} />
				</div>
			{/if}
			{#if focus.dialogOpen}
				<button
					class="focus-close-button"
					type="button"
					aria-label="Close node focus"
					onclick={() => focus.closeFocus()}
				>
					Close
				</button>
			{/if}
			<DeepZoomStack
				levels={focus.levels}
				{reduceMotion}
				entryGestureIdleMs={focus.entryGestureIdleMs}
				entryGestureMaxMs={focusEntryGestureMaxMs}
				geometryForLevel={geometryForFocusLevel}
				baseSizeForLevel={baseSizeForFocusLevel}
				frame={focusFrame}
				compact={focusCompact}
				details={focusDetails}
				onAscend={(level, delta) => focus.handleExit(level, delta)}
				onDescend={(input) => focus.descendToImage(input)}
			/>
		</div>
	{/if}

	{#if duplicateEdgeConfirm}
		{@const confirmEdgeId = duplicateEdgeConfirm.edgeId}
		<DuplicateEdgeDialog
			edgeIdentifier={duplicateEdgeIdentifier(graph, confirmEdgeId)}
			onCancel={() => (duplicateEdgeConfirm = null)}
			onConfirm={() => {
				const removedEdge = graph.edges.find((e) => e.id === confirmEdgeId) ?? null;
				const nextGraph = removeEdge(graph, confirmEdgeId);
				const endpointIds = removedEdge ? [removedEdge.sourceNodeId, removedEdge.targetNodeId] : [];
				const { survivorNodeId, severed } = severedComponentAfterMutation(nextGraph, endpointIds);
				// Only a removal that orphaned an endpoint creates a pinless component to
				// hint about; keeping a stale hint would steer a later beacon election
				// (e.g. after removing one of two parallel edges, which severs nothing).
				severedBeaconPreference = severed ? endpointIds : [];

				if (severed && survivorNodeId !== null) {
					// The removal cut a component off from every pinned node. Play the
					// reveal wave (as unpinning does) so the severed side fades down to
					// its beacon; the wave also renders the removed edge fading out, so
					// the exiting-buffer fade below must be skipped to avoid drawing the
					// edge twice.
					edgeEnterAnimations = Object.fromEntries(
						Object.entries(edgeEnterAnimations).filter(([k]) => k !== confirmEdgeId)
					);
					internalExitingBuffer = cancelExitingEdge(internalExitingBuffer, confirmEdgeId);
					commitUserGraph(
						layoutRuntime.beginScaleChange(nextGraph, survivorNodeId),
						editIntent('remove edge')
					);
					duplicateEdgeConfirm = null;
					return;
				}

				const durationMs = resolvedLayoutSettings.enterExitDurationMs;
				if (durationMs > 0 && removedEdge) {
					const nowMs = layoutRuntime.now();
					const enterAnim = edgeEnterAnimations[confirmEdgeId];
					const fromOpacity = enterAnim ? edgeOpacityAt(enterAnim, nowMs) : 1;
					edgeEnterAnimations = Object.fromEntries(
						Object.entries(edgeEnterAnimations).filter(([k]) => k !== confirmEdgeId)
					);
					internalExitingBuffer = cancelExitingEdge(internalExitingBuffer, confirmEdgeId);
					internalExitingBuffer = addExitingEdge(internalExitingBuffer, confirmEdgeId, {
						edgeData: removedEdge,
						fromOpacity,
						startedAtMs: nowMs,
						durationMs
					});
					layoutRuntime.start();
				}
				commitUserGraph(layoutRuntime.relaxAfterMutation(nextGraph), editIntent('remove edge'));
				duplicateEdgeConfirm = null;
			}}
		/>
	{/if}

	{#if pendingNodeMerge}
		{@const heldMerge = pendingNodeMerge}
		<MergeConfirmDialog
			conflictCount={heldMerge.plan.directionConflicts.length}
			onCancel={() => (pendingNodeMerge = null)}
			onConfirm={() => {
				// `heldMerge` tracks the state it came from, so read it out before
				// clearing — afterwards it is null and the plan is gone.
				const merge = heldMerge;
				pendingNodeMerge = null;
				applyNodeMerge(merge.plan, merge.absorbedId, merge.survivorId);
			}}
		/>
	{/if}

	{#if tagColorLegendOpen}
		<TagColorLegend
			tags={legendTags}
			onColorChange={updateTagColor}
			onDelete={deleteLegendTag}
			onClose={() => (tagColorLegendOpen = false)}
		/>
	{/if}

	{#if graphQueryPanelOpen}
		<GraphQueryPanel
			query={graphQueryText}
			tags={legendTags}
			result={graphQueryResult}
			activeRegionIndex={activeQueryRegionIndex}
			onQueryChange={(query) => {
				graphQueryText = query;
				graphQueryPreviewText = null;
				activeQueryRegionIndex = 0;
			}}
			onPreviewQueryChange={(query) => (graphQueryPreviewText = query)}
			onRegionNavigate={navigateQueryRegion}
			onClose={() => {
				graphQueryPanelOpen = false;
				graphQueryPreviewText = null;
			}}
		/>
	{/if}

	{#if settingsPanelOpen}
		<SettingsPanel
			overrides={settings}
			onPreview={(path, value) => (settingsPreview = { path, value })}
			onCommit={(path, value) => {
				// The preview goes first: `setOverride` may drop the key (a value equal
				// to the default), and a preview left standing would keep showing the
				// value the user just cleared.
				settingsPreview = null;
				onSettingsChange?.(setOverride(settings, path, value));
			}}
			onOverridesChange={(next) => {
				settingsPreview = null;
				onSettingsChange?.(next);
			}}
			onClose={() => {
				// A preview belongs to a pointer that is no longer on a slider.
				settingsPreview = null;
				onSettingsPanelClose?.();
			}}
		/>
	{/if}
</div>

<style>
	.graph {
		position: relative;
		width: 100vw;
		height: 100vh;
		overflow: hidden;
		touch-action: none;
	}

	.node-wrapper {
		position: absolute;
	}

	.node-wrapper.focus-owned {
		visibility: hidden;
	}

	/* The node a merge is poised to absorb into, ringed in the merge colour
	   (kept in sync with MERGE_PREVIEW_COLOR above). */
	.node-wrapper.merge-target :global(.circle) {
		box-shadow:
			0 0 0 4px color-mix(in srgb, #b45309 62%, transparent),
			0 0 18px color-mix(in srgb, #b45309 45%, transparent);
	}

	/* The wrapper carries a scale transform, so the ring is drawn on the wrapper
	   itself with an offset rather than inherited from the chrome inside it. */
	.node-wrapper:focus-visible {
		outline: 3px solid #2563eb;
		outline-offset: 4px;
		border-radius: 50%;
	}

	.focus-root {
		position: fixed;
		inset: 0;
		z-index: 60;
		pointer-events: none;
		touch-action: none;
	}

	.focus-root.reduced-motion :global(.deep-zoom-layer) {
		transition: none;
	}

	/* NodeChrome's `.circle` is the single bordered box; its absolutely
	   positioned content layers anchor to it. */
	.focus-root :global(.deep-zoom-layer .circle) {
		position: relative;
		box-shadow: none;
	}

	.focus-compact-fill {
		display: grid;
		place-items: center;
		width: 100%;
		height: 100%;
	}

	.focus-surface {
		width: 100%;
		height: 100%;
	}

	/* The single bordered box for an image level (mirrors the node frame's
	   NodeChrome, but neutral: images bring their own subject). */
	.focus-image-frame {
		position: absolute;
		inset: 0;
		box-sizing: border-box;
		border-style: solid;
		border-color: #334155;
		background: #ffffff;
		overflow: hidden;
		overflow-anchor: none;
	}

	.focus-image-thumb {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.focus-image-details {
		width: 100%;
		height: 100%;
	}

	/* Rendered at contain size in the details layer; scaled ONLY by the layer's
	   content transform and the ZoomWorld transform — never a manual second
	   scale — so the image is crisp at fit. */
	.focus-image-full {
		width: 100%;
		height: 100%;
		object-fit: contain;
		user-select: none;
		-webkit-user-drag: none;
	}

	/* Same layer as the Close button it shares the overlay's top edge with, and
	   width-capped so a deep trail wraps under itself rather than running into
	   Close at phone width. */
	.focus-breadcrumbs {
		position: fixed;
		top: calc(1rem + env(safe-area-inset-top));
		left: calc(1rem + env(safe-area-inset-left));
		z-index: 65;
		max-width: min(60vw, calc(100% - 12rem));
		pointer-events: auto;
	}

	.focus-close-button {
		position: fixed;
		top: calc(1rem + env(safe-area-inset-top));
		right: calc(1rem + env(safe-area-inset-right));
		z-index: 65;
		min-height: 2.5rem;
		border: 0;
		border-radius: 999px;
		padding: 0.5rem 0.875rem;
		background: #0f172a;
		color: white;
		font: inherit;
		cursor: pointer;
		pointer-events: auto;
	}

	/* Centred in the empty canvas it is explaining, because there is nothing else
	   on screen for the eye to have gone to. Also a real button: the reader who
	   reaches for the pointer should not have to find the keyboard. */
	.lost-graph-hint {
		position: absolute;
		z-index: 25;
		top: 50%;
		left: 50%;
		border: 1px solid #cbd5e1;
		border-radius: 999px;
		padding: 0.625rem 1rem;
		background: #f8fafc;
		color: #475569;
		font: inherit;
		box-shadow: 0 8px 24px rgb(15 23 42 / 12%);
		cursor: pointer;
		transform: translate(-50%, -50%);
	}

	.lost-graph-hint kbd {
		border: 1px solid #cbd5e1;
		border-radius: 0.25rem;
		padding: 0 0.3rem;
		background: #ffffff;
		color: #0f172a;
		font: inherit;
		font-size: 0.85em;
	}

	.toolbar-button {
		position: absolute;
		z-index: 25;
		bottom: 0.75rem;
		border: 0;
		border-radius: 999px;
		padding: 0.625rem 0.875rem;
		background: #f8fafc;
		color: #0f172a;
		font: inherit;
		box-shadow: 0 8px 24px rgb(15 23 42 / 18%);
	}

	.tag-color-button {
		right: 0.75rem;
	}

	.graph-query-button {
		left: 0.75rem;
	}

	/* Stacked above Find / Filter rather than beside it: the label carries a node
	   title, so its width is not ours to predict. Keeps the toolbar's own z-index
	   because it never renders over the focus overlay — inside the details view
	   the breadcrumb trail is what goes back. */
	.nav-back-button {
		left: 0.75rem;
		bottom: 3.5rem;
		max-width: min(20rem, calc(100% - 1.5rem));
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		cursor: pointer;
	}

	.edges {
		position: absolute;
		inset: 0;
		overflow: visible;
		pointer-events: none;
	}

	.edge {
		position: absolute;
		height: var(--edge-stroke-width);
		transform-origin: left center;
	}

	.edge::before {
		position: absolute;
		inset: 0;
		width: 100%;
		background: var(--edge-background);
		content: '';
	}

	.edge.directed::before {
		width: calc(100% - var(--edge-arrow-length) / 2);
	}

	.edge.boundary::before {
		--edge-dash-length: 8px;
		--edge-dash-gap: 6px;

		mask-image: repeating-linear-gradient(
			to right,
			#000 0 var(--edge-dash-length),
			transparent var(--edge-dash-length) calc(var(--edge-dash-length) + var(--edge-dash-gap))
		);
	}

	/*
	 * The merge preview reads as a pull rather than a connection: a long dash,
	 * spaced wider than either the boundary or the derived stroke so it is never
	 * mistaken for an edge that is about to exist.
	 */
	.edge.merge-preview::before {
		--edge-dash-length: 12px;
		--edge-dash-gap: 8px;

		mask-image: repeating-linear-gradient(
			to right,
			#000 0 var(--edge-dash-length),
			transparent var(--edge-dash-length) calc(var(--edge-dash-length) + var(--edge-dash-gap))
		);
	}

	/*
	 * Derived edges read as inferred rather than drawn: a fine dotted stroke,
	 * tighter than the boundary dash so the two never look alike, and no tag
	 * colour of their own since they carry no tags.
	 */
	.edge.derived::before {
		--edge-dash-length: 2px;
		--edge-dash-gap: 4px;

		mask-image: repeating-linear-gradient(
			to right,
			#000 0 var(--edge-dash-length),
			transparent var(--edge-dash-length) calc(var(--edge-dash-length) + var(--edge-dash-gap))
		);
	}

	.edge-quantity-label {
		position: absolute;
		left: 50%;
		top: 50%;
		padding: 0 0.25em;
		border-radius: 0.25em;
		/* The literal every other surface in this component uses. `--color-surface`
		   was never defined anywhere, so this only ever rendered its fallback. */
		background: #ffffff;
		color: currentColor;
		font-size: 0.75rem;
		font-style: italic;
		line-height: 1.2;
		white-space: nowrap;
	}

	.edge.directed::after {
		position: absolute;
		right: 0;
		top: 50%;
		width: 0;
		height: 0;
		border-top: var(--edge-arrow-half-height) solid transparent;
		border-bottom: var(--edge-arrow-half-height) solid transparent;
		border-left: var(--edge-arrow-length) solid currentColor;
		color: inherit;
		content: '';
		transform: translateY(-50%);
	}

	.edge.query-spotlight::before {
		box-shadow:
			0 0 0 4px color-mix(in srgb, var(--edge-spotlight-color) 42%, transparent),
			0 0 18px color-mix(in srgb, var(--edge-spotlight-color) 58%, transparent);
	}
</style>
