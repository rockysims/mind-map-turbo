<script module lang="ts">
	import type { QuantityDesignation } from '../types/node';

	/**
	 * Shared so a node with no confirmed inputs allocates nothing. The peek
	 * cascade asks for a definer's inputs on every render of every card, and
	 * `nodeById` rebuilds on each settle frame, so a fresh `[]` here would churn
	 * the cards' derived work for a graph that did not change.
	 */
	const EMPTY_DESIGNATIONS: readonly QuantityDesignation[] = [];
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
	import NodeActionMenu from './NodeActionMenu.svelte';
	import NavBreadcrumbs from './NavBreadcrumbs.svelte';
	import { mathPlainText } from '../MathText/lib/mathPlainText';
	import type { QuantitySymbol } from '../MathText/lib/mathSymbols';
	import { cycleDesignation, designateAs } from './lib/quantityDesignations.js';
	import NodeEditSheet from './NodeEditSheet.svelte';
	import DeepZoomStack, { type StackFrameArgs, type LayerBaseSize } from './DeepZoomStack.svelte';
	import Stage from './Stage.svelte';
	import TagColorLegend from './TagColorLegend.svelte';
	import { APP_CONFIG } from '$lib/appConfig';
	import type { GraphAssetStore } from '$lib/assets/assetStore';
	import { prefersReducedMotion } from '$lib/reducedMotion';
	import type { NodeData } from '../types/node';
	import type { EdgeData } from '../types/edge';
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
		addNodeImageContent,
		addNode,
		commitInlineTitleSyntax,
		deleteTagEverywhere,
		duplicateEdgeIdentifier,
		findExistingEdge,
		moveNode,
		neighborsOf,
		removeEdge,
		removeNode,
		removeNodeImageContent,
		moveNodeContentBlock,
		setNodeDesignations,
		setNodePinned,
		setTagColor,
		togglePinned,
		updateEdge,
		updateNodeImageContent,
		updateNodeContent
	} from './lib/graph.js';
	import { deriveGraphLayout, withSettledGraphPositions } from './lib/graphLayout.js';
	import { evaluateGraphQuery, type GraphQueryElementState } from './lib/graphQuery.js';
	import { beaconNodeIds } from './lib/beacons.js';
	import { hopsFromPinned } from './lib/layout.js';
	import type { LayoutSettings } from './lib/layoutSettings.js';
	import { withDefaultLayoutSettings } from './lib/layoutSettings.js';
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
	import {
		EDGE_ARROW_HALF_HEIGHT,
		EDGE_ARROW_LENGTH,
		EDGE_STROKE_WIDTH,
		MIN_NODE_HIT_RADIUS
	} from '$lib/constants.js';
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
	import { NODE_RADIUS, NODE_TEXT_FONT_SIZE } from '$lib/constants.js';

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
	const FOCUS_TRANSITION_MS = APP_CONFIG.multigraph.focus.entryTransitionMs;
	/**
	 * How long the camera takes to travel to an arriving import.
	 *
	 * The focus morph duration, not a new constant: it is the one length in the
	 * config that already means "the view is travelling somewhere on its own", and
	 * a second number would only invite the two to drift apart.
	 */
	const IMPORT_REVEAL_TRANSITION_MS = APP_CONFIG.multigraph.focus.entryTransitionMs;
	/**
	 * Breathing room around the revealed node, as a fraction of its own radius —
	 * so the reveal frames a node rather than jamming it against the bezel, at
	 * whatever size the layout drew it.
	 */
	const IMPORT_REVEAL_MARGIN_RADIUS_FACTOR = 0.5;
	/**
	 * Hard cap on how long the reveal may keep chasing a still-moving arrival.
	 *
	 * The pursuit normally ends the moment the node comes to rest, but physics can
	 * jitter below its own settle epsilon indefinitely, and a camera that never
	 * lets go of the reader is worse than one that stops a little early.
	 */
	const IMPORT_REVEAL_MAX_PURSUIT_MS = APP_CONFIG.multigraph.focus.entryTransitionMs * 3;
	const DETAILS_TITLE_ID = 'node-focus-title';
	const NODE_DIAMETER_PX = NODE_RADIUS * 2;
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
		defaultPrimaryNodeId = '',
		initialTitleEditNodeId,
		layoutSettings = {},
		initialViewState,
		onMultigraphChange,
		onViewStateChange,
		nodeRenderOverrides,
		edgeRenderOverrides,
		exitingBuffer,
		assetStore = null,
		assetScope = '',
		dataflowEnabled = true
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
		defaultPrimaryNodeId?: string;
		initialTitleEditNodeId?: string | null;
		layoutSettings?: Partial<LayoutSettings>;
		initialViewState?: ViewState;
		onMultigraphChange?: (data: MultigraphData) => void;
		onViewStateChange?: (state: ViewState) => void;
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
	} = $props();

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
		config: {
			transitionMs: FOCUS_TRANSITION_MS,
			entryGestureIdleMs: APP_CONFIG.multigraph.focus.entryGestureIdleMs,
			entryGestureMaxMs: APP_CONFIG.multigraph.focus.entryGestureMaxMs
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
		getLayoutSettings: () => layoutSettings,
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

	const resolvedLayoutSettings = $derived(withDefaultLayoutSettings(layoutSettings));

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
					APP_CONFIG.multigraph.dataflow.labelMaxVisibleQuantities
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
				(EDGE_STROKE_WIDTH * edgeStrokeScale(visibility, graphLayout.scaleByNodeId)) / 2;
			const arrowHalfHeight =
				edge.directed === true
					? EDGE_ARROW_HALF_HEIGHT * edgeArrowScale(visibility, graphLayout.scaleByNodeId)
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
		const settings = untrack(() => layoutSettings);
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
			settings,
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
		untrack(() => adoptGraphInPlace(multigraphData));
	});

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

	$effect(() => {
		if (typeof window === 'undefined') return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && focus.isFocused) {
				focus.closeFocus();
				return;
			}
			if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
			event.preventDefault();
			closeOverlays();
			graphQueryPanelOpen = true;
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
			const hitRadius = effectiveHitRadius(circle.radius, MIN_NODE_HIT_RADIUS);
			if (isPointInCircle(clientX, clientY, circle.center.x, circle.center.y, hitRadius)) {
				return node;
			}
		}
		return null;
	}

	function handleNodeMoved(node: NodeData, point: Point) {
		const movedGraph = moveNode(graph, node.id, point);
		commitUserGraph(layoutRuntime.relaxAfterMutation(movedGraph, node.id, 1));
	}

	function handleNodeDragStart(node: NodeData) {
		activeDragNodeId = node.id;
		layoutRuntime.beginDrag();
	}

	function handleNodeDragEnd(node: NodeData) {
		activeDragNodeId = null;

		if (node.pinned) {
			commitUserGraph(layoutRuntime.beginScaleChange(graph, node.id));
			return;
		}

		commitUserGraph(layoutRuntime.relaxAfterMutation(graph, null, 1));
		layoutRuntime.settleAfterDrag();
	}

	function handleNodeMakePrimary(node: NodeData) {
		closeOverlays();
		const wasPinned = node.pinned === true;
		commitUserGraph(layoutRuntime.beginScaleChange(togglePinned(graph, node.id), node.id));

		if (!wasPinned) {
			primaryNodeId = node.id;
			return;
		}

		primaryNodeId =
			graph.nodes.find((candidate) => candidate.pinned)?.id ??
			graph.nodes.find((candidate) => candidate.id === defaultPrimaryNodeId)?.id ??
			graph.nodes[0]?.id ??
			'';
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
			commitUserGraph(layoutRuntime.relaxAfterMutation(graphWithEdge));

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

		commitUserGraph(layoutRuntime.relaxAfterMutation(graphWithEdge));

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
		commitUserGraph(layoutRuntime.relaxAfterMutation(plan.next));
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
			idleMs: APP_CONFIG.multigraph.focus.entryGestureIdleMs,
			maxMs: APP_CONFIG.multigraph.focus.entryGestureMaxMs
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
		const rect = stageRect;
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
				targetRadiusPx: APP_CONFIG.multigraph.focus.detailsCornerRadiusPx,
				sourceBorderWidthPx: 0,
				targetBorderWidthPx: APP_CONFIG.multigraph.focus.detailsBorderWidthPx
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
				borderRadiusPx: APP_CONFIG.multigraph.focus.detailsCornerRadiusPx,
				borderWidthPx: APP_CONFIG.multigraph.focus.detailsBorderWidthPx
			};
		}
		return frameGeometry(layout, view, fill, level.morphProgress);
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
			compactPx: NODE_DIAMETER_PX,
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
		graphQueryPanelOpen = shouldOpen;
	}

	function toggleNodePinned(nodeId: string) {
		commitUserGraph(layoutRuntime.beginScaleChange(togglePinned(graph, nodeId), nodeId));
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
		const originFocused = focus.isFocused;
		closeOverlays();
		// `stageViewState` is Stage's live pan/zoom, reported on every change — so
		// the snapshot is the exact camera the reader is looking at, not a
		// reconstruction of one.
		transientReveal.push({
			originNodeId,
			viewState: {
				panX: stageViewState.panX,
				panY: stageViewState.panY,
				scale: stageViewState.scale
			},
			revealedNodeId: alreadyVisible ? null : targetNodeId,
			originFocused
		});
		// Seed, settle and camera all before the overlay opens: the target may have
		// been off-view, and the details view morphs back down onto the node's
		// on-screen frame when it closes. Nothing here waits on a frame — the
		// layout is derived synchronously from the seeded hop map, and an explicit
		// focus entry commits at once rather than tracking a zoom gesture.
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
		const originNodeId = focusRootNodeId;
		const originFocused = focus.isFocused;
		// Stage's live pan/zoom, so the snapshot is the exact camera the reader is
		// looking at rather than a reconstruction of one.
		const departureViewState = {
			panX: stageViewState.panX,
			panY: stageViewState.panY,
			scale: stageViewState.scale
		};

		leaveFocusForCanvasAction();

		const origin = graphLayout.posByNodeId[consumerNodeId] ?? CENTERED_POSITION;
		// Asking for this node IS the confirmation that it defines the quantity.
		// Without the designation the repair flow would end in a node whose edge
		// never appears, and a second trip through the edit sheet to say what the
		// button already said.
		const symbol = dataflow.index.entries.get(quantityKey)?.symbol;
		const title = `$${quantityLabel} = $`;
		const nextGraph = addNode(graph, {
			title,
			description: '',
			position: { x: origin.x, y: origin.y + NODE_RADIUS * 2.5 },
			outputs: symbol ? [{ base: symbol.base, subscript: symbol.subscript }] : undefined
		});
		const newNode = nextGraph.nodes[nextGraph.nodes.length - 1] ?? null;
		commitUserGraph(layoutRuntime.relaxAfterMutation(nextGraph, null, 1));
		if (!newNode) return;

		if (originNodeId) {
			// Nothing was revealed to get here: an edge-less node is its own
			// component, so it is its own beacon and is on screen regardless. The
			// entry survives the author deleting the new node, because pruning only
			// checks the origin and the revealed id.
			transientReveal.push({
				originNodeId,
				viewState: departureViewState,
				revealedNodeId: null,
				originFocused
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
		const nextHops = hopsFromPinned(nextGraph);
		const survivorId = neighborIds.find((id) => Number.isFinite(nextHops[id]));
		const seversComponent =
			survivorId !== undefined && neighborIds.some((id) => !Number.isFinite(nextHops[id]));
		// Only a severing deletion creates a pinless component to hint about.
		severedBeaconPreference = seversComponent ? neighborIds : [];

		if (seversComponent && survivorId !== undefined) {
			// The deletion cut a component off from every pinned node. Play the reveal
			// wave (as a severing edge removal does) so the orphaned side fades down to
			// its beacon instead of popping. The deleted node and its edges keep using
			// the exiting-buffer fade below: their live geometry is gone, so only the
			// buffer can still place them (the wave's leftovers skip them, see
			// revealWaveOnlyEdgeVisibility).
			commitUserGraph(layoutRuntime.beginScaleChange(nextGraph, survivorId));
		} else {
			commitUserGraph(layoutRuntime.relaxAfterMutation(nextGraph));
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

		restorePrimaryNodeAfterDelete(nodeId);
		closeOverlays();
	}

	/** Re-points the primary node after `nodeId` was deleted (no-op otherwise). */
	function restorePrimaryNodeAfterDelete(nodeId: string) {
		if (primaryNodeId !== nodeId) return;

		primaryNodeId = fallbackPrimaryNodeId(graph);
	}

	/** Who becomes primary when the node holding it is no longer in `source`. */
	function fallbackPrimaryNodeId(source: MultigraphData): string {
		return (
			source.nodes.find((candidate) => candidate.pinned)?.id ??
			source.nodes.find((candidate) => candidate.id === defaultPrimaryNodeId)?.id ??
			source.nodes[0]?.id ??
			''
		);
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
		commitContentGraph(updateNodeContent(graph, nodeId, content));
		closeOverlays();
	}

	async function addImageToNode(
		nodeId: string,
		file: File,
		details: { alt: string; caption?: string }
	): Promise<'added' | 'unsupported' | 'store-failed'> {
		if (!file.type.startsWith('image/')) return 'unsupported';
		if (!assetStore || !assetScope) return 'store-failed';
		const assetId =
			typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
				? crypto.randomUUID()
				: `asset-${Date.now().toString(36)}`;
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
		const asset: GraphAssetMetadata = {
			id: assetId,
			kind: 'image',
			mimeType: file.type,
			name: file.name,
			size: file.size,
			createdAt: Date.now()
		};
		commitUserGraph(
			addNodeImageContent(
				graph,
				nodeId,
				{ type: 'image', assetId, alt: details.alt, caption: details.caption },
				asset
			)
		);
		return 'added';
	}

	function saveNodeImage(
		nodeId: string,
		assetId: string,
		details: { alt: string; caption?: string }
	) {
		commitUserGraph(updateNodeImageContent(graph, nodeId, assetId, details));
	}

	function moveNodeImage(nodeId: string, fromIndex: number, direction: -1 | 1) {
		commitUserGraph(moveNodeContentBlock(graph, nodeId, fromIndex, fromIndex + direction));
	}

	async function deleteNodeImage(nodeId: string, assetId: string) {
		const result = removeNodeImageContent(graph, nodeId, assetId);
		commitUserGraph(result.graph);
		if (!assetStore || !assetScope) return;
		for (const removedAssetId of result.removedAssetIds) {
			await assetStore.delete(assetScope, removedAssetId);
		}
	}

	function saveEdgeContent(edgeId: string, patch: Parameters<typeof updateEdge>[2]) {
		commitUserGraph(updateEdge(graph, edgeId, patch));
	}

	function updateTagColor(namespace: TagColorNamespace, tag: string, color: string) {
		commitUserGraph(setTagColor(graph, namespace, tag, color));
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

		commitUserGraph(deleteTagEverywhere(graph, namespace, tag));
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

	function commitUserGraph(nextGraph: MultigraphData) {
		graph = nextGraph;
		onMultigraphChange?.(nextGraph);
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
	function adoptGraphInPlace(incoming: MultigraphData) {
		// Read before committing: once `graph` is the incoming one, there is nothing
		// left to diff it against.
		const revealNodeId = importRevealTargetNodeId(graph, incoming);
		// Additive imports keep every host node, so the primary normally survives.
		// This is the same last-resort re-point a deletion does, for the day some
		// other in-place mutation does take it away.
		if (!incoming.nodes.some((node) => node.id === primaryNodeId)) {
			primaryNodeId = fallbackPrimaryNodeId(incoming);
		}
		commitUserGraph(layoutRuntime.relaxAfterMutation(incoming));
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
			durationMs: IMPORT_REVEAL_TRANSITION_MS,
			deadlineMs: startedAtMs + IMPORT_REVEAL_MAX_PURSUIT_MS,
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
	function commitContentGraph(nextGraph: MultigraphData) {
		commitUserGraph(layoutRuntime.relaxAfterMutation(nextGraph));
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
		commitContentGraph(setNodeDesignations(graph, nodeId, next));
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
			)
		);
	}
</script>

<div
	class="graph"
	class:focus-active={focus.committed && !focus.exiting}
	bind:this={graphRef}
	style={`--focus-transition-duration: ${FOCUS_TRANSITION_MS}ms;`}
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
					{@const arrowScale = edgeArrowScale(visibility, graphLayout.scaleByNodeId)}
					{@const strokeScale = edgeStrokeScale(visibility, graphLayout.scaleByNodeId)}
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
							minStageScale: APP_CONFIG.multigraph.dataflow.labelMinStageScale,
							minOnScreenLengthPx: APP_CONFIG.multigraph.dataflow.labelMinOnScreenLengthPx
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
								edgeArrowLengthPx: EDGE_ARROW_LENGTH * arrowScale,
								edgeOcclusionMinOpacity: resolvedLayoutSettings.edgeOcclusionMinOpacity,
								boundaryFadeRadiusPx
							}
						)}; color: ${edgeColor}; --edge-spotlight-color: ${queryEdgeState?.spotlightColor ?? 'transparent'}; --edge-arrow-length: ${EDGE_ARROW_LENGTH * arrowScale}px; --edge-arrow-half-height: ${EDGE_ARROW_HALF_HEIGHT * arrowScale}px; --edge-stroke-width: ${EDGE_STROKE_WIDTH * strokeScale}px; opacity: ${edgeOpacity};`}
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
				{@const arrowScale = edgeArrowScale(visibility, combinedScaleByNodeId)}
				{@const strokeScale = edgeStrokeScale(visibility, combinedScaleByNodeId)}
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
					)}; color: ${edgeColor}; --edge-arrow-length: ${EDGE_ARROW_LENGTH * arrowScale}px; --edge-arrow-half-height: ${EDGE_ARROW_HALF_HEIGHT * arrowScale}px; --edge-stroke-width: ${EDGE_STROKE_WIDTH * strokeScale}px; opacity: ${edgeOpacity}; pointer-events: none;`}
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
						style={`${edgeStyle(sourcePos, targetPos)} --edge-background: ${edgeColor}; color: ${edgeColor}; --edge-stroke-width: ${EDGE_STROKE_WIDTH}px; opacity: ${edgeOpacity}; pointer-events: none;`}
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
					style={`${edgeStyle(creationPreviewEdgePoints.source, creationPreviewEdgePoints.target)} --edge-background: ${previewEdgeColor}; color: ${previewEdgeColor}; --edge-stroke-width: ${EDGE_STROKE_WIDTH}px; pointer-events: none;`}
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
				{@const nodeChips = shouldShowQuantityChips(NODE_RADIUS * 2, nodeScale, stageScale, {
					minOnScreenDiameterPx: APP_CONFIG.multigraph.dataflow.chipMinOnScreenDiameterPx
				})
					? quantityChips(definedQuantityLabelsByNodeId.get(node.id) ?? [], {
							maxVisible: APP_CONFIG.multigraph.dataflow.chipMaxVisibleQuantities
						})
					: EMPTY_QUANTITY_CHIPS}
				<div
					class="node-wrapper"
					class:primary={primaryNodeId === node.id}
					class:focus-owned={focus.focusedNodeId === node.id}
					class:merge-target={mergeTargetNodeId === node.id}
					data-node-id={node.id}
					data-merge-target={mergeTargetNodeId === node.id ? 'true' : undefined}
					data-query-role={queryNodeState?.role}
					data-scale={nodeScale}
					data-node-opacity={nodeOpacity}
					data-x={nodePos.x}
					data-y={nodePos.y}
					style={`left: calc(50% + ${nodePos.x}px); top: calc(50% + ${nodePos.y}px); transform: translate(-50%, -50%) scale(${nodeScale}); opacity: ${nodeOpacity};`}
				>
					<Node
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
									)
								);
								return;
							}
							commitContentGraph(committedGraph);
						}}
					/>
				</div>
			{/if}
		{/each}
		{#each layoutRuntime.revealWavePreviousOnlyNodeIds as nodeId (nodeId)}
			{@const bufferedNode = nodeById[nodeId]}
			{#if bufferedNode}
				{@const nodePos = graph.posByNodeId[nodeId] ?? CENTERED_POSITION}
				{@const nodeScale =
					revealWavePreviousScaleByNodeId[nodeId] ?? resolvedLayoutSettings.minScale}
				{@const baseNodeOpacity = nodeRenderOverrides?.[nodeId]?.opacity ?? 1}
				{@const nodeOpacity = baseNodeOpacity * (revealWaveNodeOpacityByNodeId[nodeId] ?? 1)}
				<div
					class="node-wrapper"
					data-node-id={nodeId}
					data-scale={nodeScale}
					data-node-opacity={nodeOpacity}
					data-node-reveal-buffer="true"
					data-x={nodePos.x}
					data-y={nodePos.y}
					style={`left: calc(50% + ${nodePos.x}px); top: calc(50% + ${nodePos.y}px); transform: translate(-50%, -50%) scale(${nodeScale}); opacity: ${nodeOpacity}; pointer-events: none;`}
				>
					<Node
						nodeData={bufferedNode}
						isTitleEditing={false}
						borderSegments={nodeBorderSegments(bufferedNode, graph.tagColorConfig.nodeTags)}
					/>
				</div>
			{/if}
		{/each}
		{#each exitingOnlyNodes as [id, entry] (id)}
			{@const exitScale = exitingNodeScaleAt(entry, layoutRuntime.animationNowMs)}
			{@const nodeOpacity = nodeRenderOverrides?.[id]?.opacity ?? 1}
			<div
				class="node-wrapper"
				data-node-id={id}
				data-scale={exitScale}
				data-node-opacity={nodeOpacity}
				data-node-exiting="true"
				data-x={entry.x}
				data-y={entry.y}
				style={`left: calc(50% + ${entry.x}px); top: calc(50% + ${entry.y}px); transform: translate(-50%, -50%) scale(${exitScale}); opacity: ${nodeOpacity}; pointer-events: none;`}
			>
				<Node
					nodeData={entry.nodeData}
					isTitleEditing={false}
					borderSegments={nodeBorderSegments(entry.nodeData, graph.tagColorConfig.nodeTags)}
				/>
			</div>
		{/each}
		{#if creationPreview && creationPreviewSourcePos && creationPreviewScale > 0}
			<div
				class="node-wrapper"
				data-creation-preview-node="true"
				data-scale={creationPreviewScale}
				data-x={creationPreview.point.x}
				data-y={creationPreview.point.y}
				style={`left: calc(50% + ${creationPreview.point.x}px); top: calc(50% + ${creationPreview.point.y}px); transform: translate(-50%, -50%) scale(${creationPreviewScale}); pointer-events: none;`}
			>
				<Node
					nodeData={CREATION_PREVIEW_NODE}
					isTitleEditing={false}
					borderSegments={nodeBorderSegments(CREATION_PREVIEW_NODE, graph.tagColorConfig.nodeTags)}
				/>
			</div>
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
			onAddImage={(file, details) => addImageToNode(editNode.id, file, details)}
			onSaveImage={(assetId, details) => saveNodeImage(editNode.id, assetId, details)}
			onMoveImage={(fromIndex, direction) => moveNodeImage(editNode.id, fromIndex, direction)}
			onDeleteImage={(assetId) => void deleteNodeImage(editNode.id, assetId)}
			onSaveEdge={saveEdgeContent}
			onCancel={() => (editNodeId = null)}
			onTogglePinned={() => toggleNodePinned(editNode.id)}
			onDelete={() => deleteNode(editNode.id)}
		/>
	{/if}

	{#snippet focusFrame({ level, borderRadiusPx, borderWidthPx, content }: StackFrameArgs)}
		{#if level.subjectKind === 'image'}
			<div
				class="focus-image-frame"
				style={`border-radius: ${borderRadiusPx}px; border-width: ${borderWidthPx}px;`}
			>
				{@render content()}
			</div>
		{:else}
			{@const frameNode = nodeById[level.subjectId]}
			{#if frameNode}
				{@const segments = nodeBorderSegments(frameNode, graph.tagColorConfig.nodeTags)}
				<NodeChrome
					diameterPx={NODE_DIAMETER_PX}
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
						diameterPx={NODE_DIAMETER_PX}
						fontSizePx={NODE_TEXT_FONT_SIZE}
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
			{#if detailsNode}
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
				if (event.key === 'Escape') focus.closeFocus();
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
				entryGestureMaxMs={APP_CONFIG.multigraph.focus.entryGestureMaxMs}
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
				const nextHops = hopsFromPinned(nextGraph);
				const endpointIds = removedEdge ? [removedEdge.sourceNodeId, removedEdge.targetNodeId] : [];
				const survivorId = endpointIds.find((id) => Number.isFinite(nextHops[id]));
				const seversComponent =
					survivorId !== undefined && endpointIds.some((id) => !Number.isFinite(nextHops[id]));
				// Only a severing removal creates a pinless component to hint about;
				// keeping a stale hint would steer a later beacon election (e.g. after
				// removing one of two parallel edges, which severs nothing).
				severedBeaconPreference = seversComponent ? endpointIds : [];

				if (seversComponent && survivorId !== undefined) {
					// The removal cut a component off from every pinned node. Play the
					// reveal wave (as unpinning does) so the severed side fades down to
					// its beacon; the wave also renders the removed edge fading out, so
					// the exiting-buffer fade below must be skipped to avoid drawing the
					// edge twice.
					edgeEnterAnimations = Object.fromEntries(
						Object.entries(edgeEnterAnimations).filter(([k]) => k !== confirmEdgeId)
					);
					internalExitingBuffer = cancelExitingEdge(internalExitingBuffer, confirmEdgeId);
					commitUserGraph(layoutRuntime.beginScaleChange(nextGraph, survivorId));
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
				commitUserGraph(layoutRuntime.relaxAfterMutation(nextGraph));
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
		background: var(--color-surface, #fff);
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
