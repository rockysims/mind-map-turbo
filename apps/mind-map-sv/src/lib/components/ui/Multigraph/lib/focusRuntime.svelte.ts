import type { NodeData } from '../../types/node';

export class FocusRuntime {
	focusedNodeId = $state<string | null>(null);
	entryProgress = $state(0);

	get isFocused(): boolean {
		return this.focusedNodeId !== null;
	}

	open(node: NodeData): void {
		this.focusedNodeId = node.id;
		this.entryProgress = 1;
	}

	close(): void {
		this.focusedNodeId = null;
		this.entryProgress = 0;
	}

	preview(progress: number): void {
		this.entryProgress = Math.max(0, Math.min(1, progress));
	}
}
