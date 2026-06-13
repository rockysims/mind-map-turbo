import { describe, expect, it } from 'vitest';
import { trimSegmentToNodeBorders } from './edgeRender';

describe('trimSegmentToNodeBorders', () => {
	it('trims a horizontal segment to just outside both node borders', () => {
		expect(trimSegmentToNodeBorders({ x: 0, y: 0 }, { x: 300, y: 0 }, 50, 75, 4)).toEqual({
			source: { x: 54, y: 0 },
			target: { x: 221, y: 0 }
		});
	});

	it('trims a vertical segment along the same unit direction', () => {
		expect(trimSegmentToNodeBorders({ x: 10, y: 10 }, { x: 10, y: 210 }, 20, 30, 5)).toEqual({
			source: { x: 10, y: 35 },
			target: { x: 10, y: 175 }
		});
	});

	it('keeps very short segments non-negative in length', () => {
		const trimmed = trimSegmentToNodeBorders({ x: 0, y: 0 }, { x: 10, y: 0 }, 100, 100, 4);

		expect(trimmed.source).toEqual({ x: 5, y: 0 });
		expect(trimmed.target).toEqual({ x: 5, y: 0 });
	});

	it('leaves a zero-length segment unchanged', () => {
		expect(trimSegmentToNodeBorders({ x: 1, y: 2 }, { x: 1, y: 2 }, 10, 10)).toEqual({
			source: { x: 1, y: 2 },
			target: { x: 1, y: 2 }
		});
	});
});
