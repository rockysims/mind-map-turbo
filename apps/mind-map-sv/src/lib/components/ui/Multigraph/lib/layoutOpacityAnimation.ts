export interface NodeLayoutOpacityAnimation {
	fromOpacity: number;
	toOpacity: number;
	startedAtMs: number;
	durationMs: number;
}

export function createLayoutOpacityAnimations(
	fromOpacities: Record<string, number>,
	toOpacities: Record<string, number>,
	startedAtMs: number,
	durationMs: number
): Record<string, NodeLayoutOpacityAnimation> {
	const resolvedDuration = Math.max(0, durationMs);

	return Object.fromEntries(
		Object.entries(toOpacities)
			.filter(
				([nodeId, toOpacity]) => Math.abs((fromOpacities[nodeId] ?? toOpacity) - toOpacity) > 0.0001
			)
			.map(([nodeId, toOpacity]) => [
				nodeId,
				{
					fromOpacity: fromOpacities[nodeId] ?? toOpacity,
					toOpacity,
					startedAtMs,
					durationMs: resolvedDuration
				}
			])
	);
}

export function animatedOpacitiesAt(
	animations: Record<string, NodeLayoutOpacityAnimation>,
	nowMs: number
): Record<string, number> {
	return Object.fromEntries(
		Object.entries(animations).map(([nodeId, animation]) => [
			nodeId,
			interpolateOpacity(animation, nowMs)
		])
	);
}

export function hasActiveLayoutOpacityAnimations(
	animations: Record<string, NodeLayoutOpacityAnimation>,
	nowMs: number
): boolean {
	return activeLayoutOpacityAnimationNodeIds(animations, nowMs).length > 0;
}

export function activeLayoutOpacityAnimationNodeIds(
	animations: Record<string, NodeLayoutOpacityAnimation>,
	nowMs: number
): string[] {
	return Object.entries(animations)
		.filter(([, animation]) => animationProgress(animation, nowMs) < 1)
		.map(([nodeId]) => nodeId);
}

export function pruneFinishedLayoutOpacityAnimations(
	animations: Record<string, NodeLayoutOpacityAnimation>,
	nowMs: number
): Record<string, NodeLayoutOpacityAnimation> {
	return Object.fromEntries(
		Object.entries(animations).filter(([, animation]) => animationProgress(animation, nowMs) < 1)
	);
}

export function interpolateOpacity(animation: NodeLayoutOpacityAnimation, nowMs: number): number {
	const progress = easeInOut(animationProgress(animation, nowMs));
	return animation.fromOpacity + (animation.toOpacity - animation.fromOpacity) * progress;
}

function animationProgress(animation: NodeLayoutOpacityAnimation, nowMs: number): number {
	if (animation.durationMs <= 0) return 1;
	return clamp((nowMs - animation.startedAtMs) / animation.durationMs, 0, 1);
}

function easeInOut(progress: number): number {
	return progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
