import type { NodeData } from '../../types/node';
import type { Rect } from './zoomBoundary';

export type FocusSubjectKind = 'node' | 'placeholder' | (string & {});

export type FocusLevelPhase = 'entering' | 'active' | 'exiting' | 'closing';

export interface FocusLevel {
	id: string;
	subjectKind: FocusSubjectKind;
	subjectId: string;
	sourceRect: Rect;
	fillRect: Rect;
	borderWidthPx?: number;
	morphProgress: number;
	phase: FocusLevelPhase;
}

export interface PushFocusLevelInput {
	subjectKind: FocusSubjectKind;
	subjectId: string;
	sourceRect: Rect;
	fillRect: Rect;
	borderWidthPx?: number;
	morphProgress?: number;
	phase?: FocusLevelPhase;
}

export interface OpenFocusInput {
	borderWidthPx?: number;
	morphProgress?: number;
	phase?: FocusLevelPhase;
}

const DEFAULT_RECT: Rect = { left: 0, top: 0, width: 0, height: 0 };

export class FocusRuntime {
	levels = $state<FocusLevel[]>([]);

	get isFocused(): boolean {
		return this.levels.length > 0;
	}

	get depth(): number {
		return this.levels.length;
	}

	get activeLevel(): FocusLevel | null {
		return this.levels[this.levels.length - 1] ?? null;
	}

	get focusedNodeId(): string | null {
		const active = this.activeLevel;
		return active?.subjectKind === 'node' ? active.subjectId : null;
	}

	push(input: PushFocusLevelInput): FocusLevel {
		const level: FocusLevel = {
			id: `${input.subjectKind}:${input.subjectId}:${this.levels.length + 1}`,
			subjectKind: input.subjectKind,
			subjectId: input.subjectId,
			sourceRect: input.sourceRect,
			fillRect: input.fillRect,
			borderWidthPx: input.borderWidthPx,
			morphProgress: clamp01(input.morphProgress ?? 1),
			phase: input.phase ?? 'active'
		};
		this.levels = [...this.levels, level];
		return level;
	}

	pop(): FocusLevel | null {
		const active = this.activeLevel;
		if (!active) return null;
		this.levels = this.levels.slice(0, -1);
		return active;
	}

	setProgress(
		progress: number,
		phase: FocusLevelPhase = this.activeLevel?.phase ?? 'active'
	): void {
		this.updateActive((level) => ({
			...level,
			morphProgress: clamp01(progress),
			phase
		}));
	}

	open(
		node: NodeData,
		sourceRect: Rect = DEFAULT_RECT,
		fillRect: Rect = sourceRect,
		options: OpenFocusInput = {}
	): void {
		this.levels = [];
		this.push({
			subjectKind: 'node',
			subjectId: node.id,
			sourceRect,
			fillRect,
			borderWidthPx: options.borderWidthPx,
			morphProgress: options.morphProgress ?? 1,
			phase: options.phase ?? 'active'
		});
	}

	close(): void {
		this.levels = [];
	}

	private updateActive(updater: (level: FocusLevel) => FocusLevel): void {
		const active = this.activeLevel;
		if (!active) return;
		this.levels = [...this.levels.slice(0, -1), updater(active)];
	}
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}
