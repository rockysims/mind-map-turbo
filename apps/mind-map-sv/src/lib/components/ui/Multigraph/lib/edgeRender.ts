import type { Point } from '../../types/multigraph';

export const EDGE_NODE_GAP_PX = 4;

export function trimSegmentToNodeBorders(
	source: Point,
	target: Point,
	sourceRadius: number,
	targetRadius: number,
	sourceGap = 0,
	targetGap = sourceGap
): { source: Point; target: Point } {
	const dx = target.x - source.x;
	const dy = target.y - source.y;
	const length = Math.hypot(dx, dy);
	if (length === 0) return { source, target };

	const unitX = dx / length;
	const unitY = dy / length;
	const sourceOffset = Math.min(sourceRadius + sourceGap, length / 2);
	const targetOffset = Math.min(targetRadius + targetGap, length - sourceOffset);

	return {
		source: {
			x: source.x + unitX * sourceOffset,
			y: source.y + unitY * sourceOffset
		},
		target: {
			x: target.x - unitX * targetOffset,
			y: target.y - unitY * targetOffset
		}
	};
}
