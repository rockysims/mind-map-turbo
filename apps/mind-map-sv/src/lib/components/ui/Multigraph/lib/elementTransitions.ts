import type { EdgeData } from '../../types/edge';
import type { NodeData } from '../../types/node';

export const DEFAULT_ENTER_EXIT_DURATION_MS = 180;

// ---------------------------------------------------------------------------
// Enter animations
// ---------------------------------------------------------------------------

/** Node enters by scaling from 0 up to its target scale. */
export interface NodeEnterAnimation {
	fromScale: number;
	toScale: number;
	startedAtMs: number;
	durationMs: number;
}

/** Edge enters/exits by fading its opacity (fromOpacity to toOpacity). */
export interface EdgeOpacityAnimation {
	fromOpacity: number;
	toOpacity: number;
	startedAtMs: number;
	durationMs: number;
}

export function createNodeEnterAnimation(
	toScale: number,
	startedAtMs: number,
	durationMs = DEFAULT_ENTER_EXIT_DURATION_MS
): NodeEnterAnimation {
	return { fromScale: 0, toScale, startedAtMs, durationMs: Math.max(0, durationMs) };
}

export function createEdgeEnterAnimation(
	startedAtMs: number,
	durationMs = DEFAULT_ENTER_EXIT_DURATION_MS
): EdgeOpacityAnimation {
	return { fromOpacity: 0, toOpacity: 1, startedAtMs, durationMs: Math.max(0, durationMs) };
}

/** Interpolated scale for an entering node at `nowMs`. */
export function nodeEnterScaleAt(anim: NodeEnterAnimation, nowMs: number): number {
	const t = easeInOut(animProgress(anim.startedAtMs, anim.durationMs, nowMs));
	return anim.fromScale + (anim.toScale - anim.fromScale) * t;
}

/** Interpolated opacity for an edge animation at `nowMs`. */
export function edgeOpacityAt(anim: EdgeOpacityAnimation, nowMs: number): number {
	const t = easeInOut(animProgress(anim.startedAtMs, anim.durationMs, nowMs));
	return anim.fromOpacity + (anim.toOpacity - anim.fromOpacity) * t;
}

// ---------------------------------------------------------------------------
// Exiting buffer
// ---------------------------------------------------------------------------

/**
 * Final-known render data for a node that was removed while it was visible.
 * The node animates scale from fromScale to 0 over durationMs.
 */
export interface ExitingNodeEntry {
	nodeData: NodeData;
	x: number;
	y: number;
	/** Scale at the moment the node was removed (start of exit animation). */
	fromScale: number;
	startedAtMs: number;
	durationMs: number;
}

/**
 * Final-known render data for an edge that was removed while it was visible.
 * The edge animates opacity from fromOpacity to 0 over durationMs.
 */
export interface ExitingEdgeEntry {
	edgeData: EdgeData;
	/** Opacity at the moment the edge was removed (start of exit animation). */
	fromOpacity: number;
	startedAtMs: number;
	durationMs: number;
}

export interface ExitingBuffer {
	nodes: Record<string, ExitingNodeEntry>;
	edges: Record<string, ExitingEdgeEntry>;
}

export const EMPTY_EXITING_BUFFER: ExitingBuffer = { nodes: {}, edges: {} };

// --- Buffer reducers --------------------------------------------------------

export function addExitingNode(
	buffer: ExitingBuffer,
	id: string,
	entry: ExitingNodeEntry
): ExitingBuffer {
	return { ...buffer, nodes: { ...buffer.nodes, [id]: entry } };
}

export function addExitingEdge(
	buffer: ExitingBuffer,
	id: string,
	entry: ExitingEdgeEntry
): ExitingBuffer {
	return { ...buffer, edges: { ...buffer.edges, [id]: entry } };
}

/**
 * Cancel the exit of a node (called when the node re-enters mid-exit).
 * Returns the same buffer object if the id was not present.
 */
export function cancelExitingNode(buffer: ExitingBuffer, id: string): ExitingBuffer {
	if (!(id in buffer.nodes)) return buffer;
	const nodes = Object.fromEntries(Object.entries(buffer.nodes).filter(([k]) => k !== id));
	return { ...buffer, nodes };
}

/**
 * Cancel the exit of an edge (called when the edge re-enters mid-exit).
 * Returns the same buffer object if the id was not present.
 */
export function cancelExitingEdge(buffer: ExitingBuffer, id: string): ExitingBuffer {
	if (!(id in buffer.edges)) return buffer;
	const edges = Object.fromEntries(Object.entries(buffer.edges).filter(([k]) => k !== id));
	return { ...buffer, edges };
}

/** Remove all nodes and edges whose exit animation has completed. */
export function pruneFinishedExiting(buffer: ExitingBuffer, nowMs: number): ExitingBuffer {
	const nodes = Object.fromEntries(
		Object.entries(buffer.nodes).filter(
			([, e]) => animProgress(e.startedAtMs, e.durationMs, nowMs) < 1
		)
	);
	const edges = Object.fromEntries(
		Object.entries(buffer.edges).filter(
			([, e]) => animProgress(e.startedAtMs, e.durationMs, nowMs) < 1
		)
	);
	return { nodes, edges };
}

/** True if any exiting element still has animation in progress. */
export function hasActiveExiting(buffer: ExitingBuffer, nowMs: number): boolean {
	return (
		Object.values(buffer.nodes).some((e) => animProgress(e.startedAtMs, e.durationMs, nowMs) < 1) ||
		Object.values(buffer.edges).some((e) => animProgress(e.startedAtMs, e.durationMs, nowMs) < 1)
	);
}

/** True if any node enter animation is still in progress. */
export function hasActiveNodeEnterAnimations(
	anims: Record<string, NodeEnterAnimation>,
	nowMs: number
): boolean {
	return Object.values(anims).some((a) => animProgress(a.startedAtMs, a.durationMs, nowMs) < 1);
}

/** True if any edge opacity animation is still in progress. */
export function hasActiveEdgeEnterAnimations(
	anims: Record<string, EdgeOpacityAnimation>,
	nowMs: number
): boolean {
	return Object.values(anims).some((a) => animProgress(a.startedAtMs, a.durationMs, nowMs) < 1);
}

/** Remove all node enter animations that have completed. */
export function pruneFinishedNodeEnterAnimations(
	anims: Record<string, NodeEnterAnimation>,
	nowMs: number
): Record<string, NodeEnterAnimation> {
	return Object.fromEntries(
		Object.entries(anims).filter(([, a]) => animProgress(a.startedAtMs, a.durationMs, nowMs) < 1)
	);
}

/** Remove all edge opacity animations that have completed. */
export function pruneFinishedEdgeEnterAnimations(
	anims: Record<string, EdgeOpacityAnimation>,
	nowMs: number
): Record<string, EdgeOpacityAnimation> {
	return Object.fromEntries(
		Object.entries(anims).filter(([, a]) => animProgress(a.startedAtMs, a.durationMs, nowMs) < 1)
	);
}

// --- Exiting value queries ---------------------------------------------------

/** Scale of an exiting node at `nowMs` (fromScale to 0). */
export function exitingNodeScaleAt(entry: ExitingNodeEntry, nowMs: number): number {
	const t = easeInOut(animProgress(entry.startedAtMs, entry.durationMs, nowMs));
	return entry.fromScale * (1 - t);
}

/** Opacity of an exiting edge at `nowMs` (fromOpacity to 0). */
export function exitingEdgeOpacityAt(entry: ExitingEdgeEntry, nowMs: number): number {
	const t = easeInOut(animProgress(entry.startedAtMs, entry.durationMs, nowMs));
	return entry.fromOpacity * (1 - t);
}

// ---------------------------------------------------------------------------
// Shared easing (same curve as scaleAnimation.ts)
// ---------------------------------------------------------------------------

function easeInOut(t: number): number {
	return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function animProgress(startedAtMs: number, durationMs: number, nowMs: number): number {
	if (durationMs <= 0) return 1;
	return clamp((nowMs - startedAtMs) / durationMs, 0, 1);
}
