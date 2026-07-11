import type { NodeData } from '../../types/node';
import type { Point } from '../../types/multigraph';
import type { EntryGestureDirection } from './entryGestureGate';
import type { FocusEntryBoundaryCandidate } from './focusEntryBoundary';
import { FocusRuntime, type FocusLevel } from './focusRuntime.svelte';
import { focalNodeForPoint, type NodeFocusCandidate, type ViewTransform } from './nodeFocus';
import type { Rect } from './zoomBoundary';
import type { StageRect } from './stageCoordinates';

/** Timing constants the controller needs; sourced from `APP_CONFIG.multigraph.focus`. */
export interface FocusControllerConfig {
	/** Focus overlay morph duration for entry/close tweens. */
	transitionMs: number;
	/** Quiet gap before residual zoom input becomes a fresh gesture. */
	entryGestureIdleMs: number;
	/** Hard cap for swallowing residual boundary-crossing zoom input. */
	entryGestureMaxMs: number;
}

/**
 * Getter/callback dependency surface, mirroring `LayoutRuntime`. The controller
 * never measures the DOM or reads app state directly — everything it needs is
 * fed through these getters so it stays unit-testable with plain fakes.
 */
export interface FocusControllerDeps {
	getStageRect: () => StageRect | null;
	getViewState: () => { panX: number; panY: number; scale: number };
	getFillRect: () => Rect;
	getFocusCandidates: () => NodeFocusCandidate[];
	getReduceMotion: () => boolean;
	/** Arm the residual-gesture gate (Multigraph wires this to its Stage request). */
	armEntryGate: (direction: EntryGestureDirection) => void;
	/** Close menus/sheets/panels when a focus commit or scrub takes over. */
	closeOverlays: () => void;
	config: FocusControllerConfig;
}

/** Input reported by Stage when a zoom-in gesture is blocked at the boundary. */
export interface BlockedZoomInput {
	direction: 'in' | 'out';
	focalPoint: Point;
	boundaryProgress?: number;
	committed?: boolean;
	nodeId?: string;
	viewState: ViewTransform;
}

/** Input for resolving the sticky boundary-entry candidate under the cursor. */
export interface EntryBoundaryCandidateInput {
	focalPoint: Point;
	requestedScale: number;
	viewState: ViewTransform;
	stickyNodeId?: string;
}

/**
 * Owns the focus state machine: the recursive `FocusRuntime` stack, the morph
 * phase, entry scrub → commit → exit scrub → close lifecycle, and the idle
 * unmount that hands an uncommitted entry surface back to the in-stage node.
 *
 * Camera-on-pop note: a level's parent camera is recomputed from the
 * entry(identity)/exit(centered-fit) invariants rather than stored — entry only
 * commits at centered-and-fit (identity world) and the exit gate guarantees a
 * child is centered-and-fit before it pops, so the parent camera is fully
 * determined by those invariants. This is validated by the nested-image task.
 */
export class FocusController {
	#runtime = new FocusRuntime();
	#deps: FocusControllerDeps;
	#entryGestureIdleMs = $state(0);
	#tweenRaf: number | null = null;
	#idleUnmountTimeoutId: ReturnType<typeof setTimeout> | null = null;

	constructor(deps: FocusControllerDeps) {
		this.#deps = deps;
	}

	get isFocused(): boolean {
		return this.#runtime.isFocused;
	}

	get levels(): FocusLevel[] {
		return this.#runtime.levels;
	}

	get activeLevel(): FocusLevel | null {
		return this.#runtime.activeLevel;
	}

	get depth(): number {
		return this.#runtime.depth;
	}

	get focusedNodeId(): string | null {
		return this.#runtime.focusedNodeId;
	}

	get entryGestureIdleMs(): number {
		return this.#entryGestureIdleMs;
	}

	/**
	 * True once the morph reached committed state (active or partial exit scrub).
	 * Derived from the active level's phase — cannot disagree with FocusLevel.phase.
	 */
	get committed(): boolean {
		const active = this.activeLevel;
		return active != null && (active.phase === 'active' || active.phase === 'exiting');
	}

	/** True while the terminal close tween is in flight (phase 'closing'). */
	get exiting(): boolean {
		return this.activeLevel?.phase === 'closing';
	}

	/** Dialog chrome (role, close affordance) shows only from commit through close. */
	get dialogOpen(): boolean {
		return this.isFocused && this.activeLevel?.phase !== 'entering';
	}

	/**
	 * A partial exit scrub is in flight: the frame is shrinking, so wheel input
	 * can land outside it (past the rounded corners, or on the exposed stage).
	 * The single focus input surface (DeepZoomStack) captures those off-frame
	 * wheels and forwards them to the active world, so the exit keeps scrubbing
	 * instead of zooming the stage or scrolling the page. Exposed for the
	 * `data-exit-scrub` marker the exit-scrub e2e asserts on.
	 */
	get exitScrubActive(): boolean {
		const active = this.activeLevel;
		return Boolean(active && active.phase === 'exiting' && active.morphProgress < 1);
	}

	/**
	 * Explicit Focus (long-press menu): there is no zoom gesture, so enter the
	 * committed state directly through the same single morph surface. Reduced
	 * motion behaves identically (no intermediate frames to skip).
	 */
	openFocus(node: NodeData): void {
		this.commitFocus(node, 0);
	}

	/**
	 * Drive the shared morph surface to the committed (progress 1) state for a
	 * node, reusing the already-mounted entry-scrub level when present so the
	 * SAME surface element spans entry → committed.
	 */
	commitFocus(node: NodeData, entryGestureIdleMs: number): void {
		this.clearIdleUnmount();
		this.cancelTween();
		this.#deps.closeOverlays();
		if (this.#runtime.focusedNodeId === node.id) {
			this.#runtime.setProgress(1, 'active');
		} else {
			const fill = this.#deps.getFillRect();
			this.#runtime.open(node, fill, fill, { morphProgress: 1, phase: 'active' });
		}
		this.#entryGestureIdleMs = entryGestureIdleMs;
	}

	/**
	 * Entry scrub: mount (or update) the single morph surface at the scrubbed
	 * progress. The surface is `pointer-events: none` below progress 1, so the
	 * stage keeps receiving the wheel/pinch that drives the scrub.
	 */
	beginOrUpdateEntryScrub(node: NodeData, progress: number): void {
		this.clearIdleUnmount();
		this.cancelTween();
		if (this.#runtime.focusedNodeId === node.id) {
			this.#runtime.setProgress(progress, 'entering');
			return;
		}
		this.#deps.closeOverlays();
		this.#entryGestureIdleMs = 0;
		const fill = this.#deps.getFillRect();
		this.#runtime.open(node, fill, fill, { morphProgress: progress, phase: 'entering' });
	}

	handleBlockedZoom(input: BlockedZoomInput): void {
		if (this.committed || this.exiting || !this.#deps.getStageRect()) return;
		const candidate =
			(input.nodeId
				? this.#deps.getFocusCandidates().find((entry) => entry.node.id === input.nodeId)
				: this.candidateForPoint(input.focalPoint, input.viewState)) ?? null;
		if (!candidate) {
			if (this.isFocused) this.scheduleIdleUnmount();
			return;
		}
		const progress = Math.min(1, Math.max(0, input.boundaryProgress ?? 0));
		if (progress <= 0) {
			if (this.#runtime.focusedNodeId === candidate.node.id) {
				this.#runtime.setProgress(0, 'entering');
				this.scheduleIdleUnmount();
			}
			return;
		}
		if (progress >= 1 || input.committed === true) {
			this.commitFocus(candidate.node, this.#deps.config.entryGestureIdleMs);
			return;
		}
		this.beginOrUpdateEntryScrub(candidate.node, progress);
	}

	/** Exit scrub from the focused world's zoom-out boundary (via DeepZoomStack). */
	handleExit(_level: FocusLevel, delta: number): void {
		// Guard also blocks reversals while the terminal close tween is running.
		if (!this.isFocused || this.exiting) return;
		this.cancelTween();
		if (delta <= 0) {
			// Revert to committed state (user zoomed back in past the exit boundary).
			this.#runtime.setProgress(1, 'active');
			return;
		}
		if (delta >= 1) {
			// Wheel-out crossed the full exit threshold — use the unified close path.
			this.closeFocus();
			return;
		}
		// Partial exit scrub: morph the frame down while staying committed so the
		// world keeps driving and the graph stays marked focus-active.
		this.#runtime.setProgress(Math.max(0, 1 - delta), 'exiting');
	}

	/**
	 * Unified close: used by Escape, the close button, and wheel-out completion
	 * (handleExit delta >= 1). Tweens progress to 0 then unmounts. Arms the
	 * residual-gesture gate on every close for consistent wheel swallowing.
	 */
	closeFocus(): void {
		if (!this.isFocused || this.exiting) return;
		this.clearIdleUnmount();
		this.cancelTween();
		this.#deps.armEntryGate('out');
		const from = this.activeLevel?.morphProgress ?? 1;
		const transitionMs = this.#deps.config.transitionMs;
		if (
			this.#deps.getReduceMotion() ||
			transitionMs <= 0 ||
			typeof requestAnimationFrame !== 'function'
		) {
			this.#runtime.setProgress(0, 'closing');
			this.#finishClose();
			return;
		}
		// Defer #finishClose by one rAF so the DOM renders at progress 0 (the
		// node handoff geometry) before the level unmounts.
		this.#tweenProgress(from, 0, transitionMs, 'closing', () => {
			requestAnimationFrame(() => this.#finishClose());
		});
	}

	/**
	 * The entry-scrub surface stays mounted while progress is 0 so a gentle
	 * scrub hovering at the zone edge reuses one surface. Only after the entry
	 * gesture idles (reusing `entryGestureIdleMs`) do we unmount and hand the
	 * frame back to the in-stage node — pixel-identically, since at progress 0
	 * the surface geometry equals the node's derived on-screen rect.
	 */
	scheduleIdleUnmount(): void {
		this.clearIdleUnmount();
		if (this.committed || this.exiting || typeof window === 'undefined') return;
		this.#idleUnmountTimeoutId = setTimeout(() => {
			this.#idleUnmountTimeoutId = null;
			const level = this.#runtime.activeLevel;
			if (!this.committed && !this.exiting && level && level.morphProgress <= 0) {
				this.#runtime.close();
			}
		}, this.#deps.config.entryGestureIdleMs);
	}

	clearIdleUnmount(): void {
		if (this.#idleUnmountTimeoutId === null) return;
		clearTimeout(this.#idleUnmountTimeoutId);
		this.#idleUnmountTimeoutId = null;
	}

	cancelTween(): void {
		if (this.#tweenRaf !== null && typeof cancelAnimationFrame === 'function') {
			cancelAnimationFrame(this.#tweenRaf);
		}
		this.#tweenRaf = null;
	}

	/** Tear down pending timers/frames (called from the component's effect cleanup). */
	dispose(): void {
		this.clearIdleUnmount();
		this.cancelTween();
	}

	entryBoundaryCandidateForPoint(
		input: EntryBoundaryCandidateInput
	): FocusEntryBoundaryCandidate | null {
		if (
			input.requestedScale <= input.viewState.scale ||
			this.committed ||
			this.exiting ||
			!this.#deps.getStageRect()
		) {
			return null;
		}
		// Once the boundary is steering toward a subject, that gesture owns it:
		// steering slides the node around the screen (often out from under the
		// cursor, sometimes over other nodes' circles), so re-hit-testing every
		// wheel event would drop or flip the subject mid-scrub. The sticky
		// subject wins until the gesture releases (zoom-out) or it disappears.
		const sticky = input.stickyNodeId
			? (this.#deps.getFocusCandidates().find((entry) => entry.node.id === input.stickyNodeId) ??
				null)
			: null;
		const candidate = sticky ?? this.candidateForPoint(input.focalPoint, input.viewState);
		if (!candidate) return null;
		return {
			nodeId: candidate.node.id,
			position: candidate.position,
			radius: candidate.radius
		};
	}

	candidateForPoint(focalPoint: Point, view: ViewTransform): NodeFocusCandidate | null {
		const stageRect = this.#deps.getStageRect();
		if (!stageRect) return null;
		return focalNodeForPoint(this.#deps.getFocusCandidates(), focalPoint, stageRect, view);
	}

	#finishClose(): void {
		this.cancelTween();
		this.clearIdleUnmount();
		this.#runtime.close();
		this.#entryGestureIdleMs = 0;
	}

	#tweenProgress(
		from: number,
		to: number,
		durationMs: number,
		phase: FocusLevel['phase'],
		onDone?: () => void
	): void {
		this.cancelTween();
		const startedAt = Date.now();
		const step = () => {
			const elapsed = Date.now() - startedAt;
			const t = durationMs > 0 ? Math.min(1, elapsed / durationMs) : 1;
			this.#runtime.setProgress(from + (to - from) * t, phase);
			if (t < 1) {
				this.#tweenRaf = requestAnimationFrame(step);
			} else {
				this.#tweenRaf = null;
				onDone?.();
			}
		};
		this.#tweenRaf = requestAnimationFrame(step);
	}
}
