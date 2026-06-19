export interface LongPressInput {
	duration: number;
	distance: number;
	minDuration: number;
	maxDistance: number;
}

export function recognizeLongPress({
	duration,
	distance,
	minDuration,
	maxDistance
}: LongPressInput): boolean {
	return duration >= minDuration && distance <= maxDistance;
}
