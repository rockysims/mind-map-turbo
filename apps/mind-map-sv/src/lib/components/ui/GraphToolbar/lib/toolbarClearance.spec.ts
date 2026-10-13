import { describe, expect, it } from 'vitest';
import { toolbarClearancePx } from './toolbarClearance';

describe('toolbarClearancePx', () => {
	it('adds the gap above the toolbar again below it', () => {
		// A 12px offset and a 56px row: the panel stops 12px under the row.
		expect(toolbarClearancePx({ top: 12, bottom: 68 })).toBe(80);
	});

	it('grows with the row when it wraps onto more lines', () => {
		expect(toolbarClearancePx({ top: 12, bottom: 160 })).toBe(172);
	});

	it('rounds a fractional box up, never down into the toolbar', () => {
		expect(toolbarClearancePx({ top: 12, bottom: 68.2 })).toBe(81);
	});

	it('adds no negative gap for a row pushed above the viewport', () => {
		expect(toolbarClearancePx({ top: -4, bottom: 40 })).toBe(40);
	});
});
