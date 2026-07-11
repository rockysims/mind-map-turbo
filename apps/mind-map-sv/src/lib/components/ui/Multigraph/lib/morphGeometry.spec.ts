import { describe, expect, it } from 'vitest';
import { interpolateMorph } from './morphGeometry';

const source = { left: 20, top: 30, width: 120, height: 120 };
const fill = { left: 0, top: 0, width: 320, height: 200 };

describe('single-element morph geometry', () => {
	it('returns the source rect and source radius at progress zero', () => {
		expect(interpolateMorph(source, fill, 0, { targetRadiusPx: 16 })).toEqual({
			x: 20,
			y: 30,
			width: 120,
			height: 120,
			borderRadiusPx: 60
		});
	});

	it('returns the fill rect and target radius at progress one', () => {
		expect(interpolateMorph(source, fill, 1, { targetRadiusPx: 16 })).toEqual({
			x: 0,
			y: 0,
			width: 320,
			height: 200,
			borderRadiusPx: 16
		});
	});

	it('interpolates position, size, and corner radius through aspect-ratio changes', () => {
		expect(interpolateMorph(source, fill, 0.5, { targetRadiusPx: 16 })).toEqual({
			x: 10,
			y: 15,
			width: 220,
			height: 160,
			borderRadiusPx: 38
		});
	});

	it('applies an easing hook to every channel', () => {
		expect(interpolateMorph(source, fill, 0.5, { targetRadiusPx: 16, ease: (t) => t * t })).toEqual(
			{
				x: 15,
				y: 22.5,
				width: 170,
				height: 140,
				borderRadiusPx: 49
			}
		);
	});

	it('clamps progress before easing', () => {
		expect(interpolateMorph(source, fill, 2, { targetRadiusPx: 16 }).width).toBe(320);
		expect(interpolateMorph(source, fill, -1, { targetRadiusPx: 16 }).width).toBe(120);
	});

	it('omits the border-width channel when no border widths are supplied', () => {
		expect(interpolateMorph(source, fill, 0.5, { targetRadiusPx: 16 })).not.toHaveProperty(
			'borderWidthPx'
		);
	});

	it('interpolates the border-width channel when both ends are supplied', () => {
		const options = { targetRadiusPx: 16, sourceBorderWidthPx: 4, targetBorderWidthPx: 12 };
		expect(interpolateMorph(source, fill, 0, options).borderWidthPx).toBe(4);
		expect(interpolateMorph(source, fill, 0.5, options).borderWidthPx).toBe(8);
		expect(interpolateMorph(source, fill, 1, options).borderWidthPx).toBe(12);
	});

	it('eases the border-width channel with every other channel', () => {
		expect(
			interpolateMorph(source, fill, 0.5, {
				targetRadiusPx: 16,
				sourceBorderWidthPx: 4,
				targetBorderWidthPx: 12,
				ease: (t) => t * t
			}).borderWidthPx
		).toBe(6);
	});
});
