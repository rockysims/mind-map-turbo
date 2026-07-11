<script lang="ts">
	import DeepZoomStack from './DeepZoomStack.svelte';
	import type { FocusLevel } from './lib/focusRuntime.svelte';
	import type { ZoomWorldState } from './lib/zoomWorldController';

	const fillRect = { left: 16, top: 16, width: 720, height: 460 };

	let levels = $state<FocusLevel[]>([
		createLevel('root', { left: 260, top: 180, width: 180, height: 180 }, 1)
	]);

	function createLevel(
		subjectId: string,
		sourceRect: FocusLevel['sourceRect'],
		depth: number
	): FocusLevel {
		return {
			id: `placeholder:${subjectId}:${depth}`,
			subjectKind: 'placeholder',
			subjectId,
			sourceRect,
			fillRect,
			worldState: { panX: 0, panY: 0, scale: 1 },
			morphProgress: 1,
			phase: 'active'
		};
	}

	function activeDepth(): number {
		return levels.length;
	}

	function descend(event: WheelEvent) {
		if (event.deltaY >= 0 || activeDepth() >= 3) return;
		event.preventDefault();
		event.stopPropagation();
		const depth = activeDepth() + 1;
		levels = [
			...levels,
			createLevel(`child-${depth}`, { left: 220, top: 160, width: 220, height: 150 }, depth)
		];
	}

	function ascend(_level: FocusLevel, delta: number) {
		if (delta < 1 || levels.length <= 1) return;
		levels = levels.slice(0, -1);
	}

	function updateWorldState(level: FocusLevel, state: ZoomWorldState) {
		levels = levels.map((candidate) =>
			candidate.id === level.id ? { ...candidate, worldState: state } : candidate
		);
	}
</script>

<div class="deep-zoom-stack-harness" data-depth={levels.length}>
	{#snippet renderLevel(level: FocusLevel)}
		<section class="placeholder-level" data-subject-id={level.subjectId}>
			<h1>{level.subjectId}</h1>
			<div
				class="placeholder-child"
				role="button"
				tabindex="0"
				onwheel={descend}
				data-can-descend={activeDepth() < 3 ? 'true' : undefined}
			>
				Nested region
			</div>
		</section>
	{/snippet}

	<DeepZoomStack
		{levels}
		entryGestureIdleMs={0}
		entryGestureMaxMs={0}
		{renderLevel}
		onAscend={ascend}
		onWorldStateChange={updateWorldState}
	/>
</div>

<style>
	.deep-zoom-stack-harness {
		position: relative;
		width: 760px;
		height: 500px;
		overflow: hidden;
		background: #eef2ff;
	}

	.placeholder-level {
		display: grid;
		align-content: center;
		justify-items: center;
		gap: 1.25rem;
		width: 100%;
		height: 100%;
		box-sizing: border-box;
		border: 8px solid #334155;
		border-radius: var(--deep-zoom-border-radius);
		background: #fff;
		color: #0f172a;
	}

	h1 {
		margin: 0;
		font-size: 2rem;
	}

	.placeholder-child {
		display: grid;
		place-items: center;
		width: 12rem;
		height: 8rem;
		border: 2px solid #2563eb;
		border-radius: 0.75rem;
		background: #dbeafe;
		font-weight: 700;
	}
</style>
