export interface NodeScaleAnimation {
	fromScale: number;
	toScale: number;
	startedAtMs: number;
	durationMs: number;
}

export function createScaleAnimations(
	fromScales: Record<string, number>,
	toScales: Record<string, number>,
	startedAtMs: number,
	durationMs: number
): Record<string, NodeScaleAnimation> {
	const resolvedDuration = Math.max(0, durationMs);

	return Object.fromEntries(
		Object.entries(toScales)
			.filter(([nodeId, toScale]) => Math.abs((fromScales[nodeId] ?? toScale) - toScale) > 0.0001)
			.map(([nodeId, toScale]) => [
				nodeId,
				{
					fromScale: fromScales[nodeId] ?? toScale,
					toScale,
					startedAtMs,
					durationMs: resolvedDuration
				}
			])
	);
}

export function animatedScalesAt(
	animations: Record<string, NodeScaleAnimation>,
	nowMs: number
): Record<string, number> {
	return Object.fromEntries(
		Object.entries(animations).map(([nodeId, animation]) => [
			nodeId,
			interpolateScale(animation, nowMs)
		])
	);
}

export function hasActiveScaleAnimations(
	animations: Record<string, NodeScaleAnimation>,
	nowMs: number
): boolean {
	return Object.values(animations).some((animation) => animationProgress(animation, nowMs) < 1);
}

export function pruneFinishedScaleAnimations(
	animations: Record<string, NodeScaleAnimation>,
	nowMs: number
): Record<string, NodeScaleAnimation> {
	return Object.fromEntries(
		Object.entries(animations).filter(([, animation]) => animationProgress(animation, nowMs) < 1)
	);
}

export function interpolateScale(animation: NodeScaleAnimation, nowMs: number): number {
	const progress = easeInOut(animationProgress(animation, nowMs));
	return animation.fromScale + (animation.toScale - animation.fromScale) * progress;
}

function animationProgress(animation: NodeScaleAnimation, nowMs: number): number {
	if (animation.durationMs <= 0) return 1;
	return clamp((nowMs - animation.startedAtMs) / animation.durationMs, 0, 1);
}

function easeInOut(progress: number): number {
	return progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
