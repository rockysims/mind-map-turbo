import { describe, expect, it } from 'vitest';
import { borderWidthFactorForSize } from './sizeBorder';

const MIB = 1024 * 1024;

// Explicit settings throughout, so the shipped defaults can change without
// breaking these cases.
const SETTINGS = {
	referenceBytes: MIB,
	widthPerDoubling: 0.15,
	minFactor: 0.5,
	maxFactor: 3
};

describe('borderWidthFactorForSize', () => {
	it('draws exactly the configured border at the reference size', () => {
		expect(borderWidthFactorForSize(MIB, SETTINGS)).toBe(1);
	});

	it('adds widthPerDoubling for twice the reference and removes it for half', () => {
		expect(borderWidthFactorForSize(2 * MIB, SETTINGS)).toBeCloseTo(1.15, 12);
		expect(borderWidthFactorForSize(MIB / 2, SETTINGS)).toBeCloseTo(0.85, 12);
	});

	it('follows widthPerDoubling rather than a fixed slope', () => {
		const settings = { ...SETTINGS, widthPerDoubling: 0.25 };
		expect(borderWidthFactorForSize(4 * MIB, settings)).toBeCloseTo(1.5, 12);
	});

	it('floors far-below-reference sizes at minFactor', () => {
		expect(borderWidthFactorForSize(1, SETTINGS)).toBe(0.5);
		expect(borderWidthFactorForSize(10 * 1024, SETTINGS)).toBe(0.5);
	});

	it('caps far-above-reference sizes at maxFactor', () => {
		expect(borderWidthFactorForSize(1e15, SETTINGS)).toBe(3);
	});

	it('lands between the bounds for a mid-range size', () => {
		// 100 MiB: 1 + 0.15 * log2(100) ≈ 1.9966.
		expect(borderWidthFactorForSize(100 * MIB, SETTINGS)).toBeCloseTo(
			1 + 0.15 * Math.log2(100),
			12
		);
	});

	it.each([
		['undefined', undefined],
		['zero', 0],
		['NaN', Number.NaN],
		['Infinity', Number.POSITIVE_INFINITY],
		['-Infinity', Number.NEGATIVE_INFINITY],
		['a negative size', -2048]
	])('treats %s as no size (factor 1)', (_label, size) => {
		expect(borderWidthFactorForSize(size, SETTINGS)).toBe(1);
	});

	it.each([
		['referenceBytes 0', { referenceBytes: 0 }],
		['a negative referenceBytes', { referenceBytes: -MIB }],
		['referenceBytes NaN', { referenceBytes: Number.NaN }],
		['referenceBytes Infinity', { referenceBytes: Number.POSITIVE_INFINITY }],
		['widthPerDoubling NaN', { widthPerDoubling: Number.NaN }],
		['widthPerDoubling Infinity', { widthPerDoubling: Number.POSITIVE_INFINITY }],
		['a NaN bound', { minFactor: Number.NaN }]
	])('returns 1 for a degenerate setting: %s', (_label, override) => {
		expect(borderWidthFactorForSize(100 * MIB, { ...SETTINGS, ...override })).toBe(1);
	});

	it('clamps to the crossed bounds whichever way round they are given', () => {
		const crossed = { ...SETTINGS, minFactor: 2, maxFactor: 1.5 };
		expect(borderWidthFactorForSize(1, crossed)).toBe(1.5);
		expect(borderWidthFactorForSize(1e15, crossed)).toBe(2);
		// The reference size sits below both bounds, so it floors at the lower.
		expect(borderWidthFactorForSize(MIB, crossed)).toBe(1.5);
	});

	it('draws a flat border when widthPerDoubling is 0', () => {
		const flat = { ...SETTINGS, widthPerDoubling: 0 };
		expect(borderWidthFactorForSize(1, flat)).toBe(1);
		expect(borderWidthFactorForSize(1e15, flat)).toBe(1);
	});

	it('fills missing settings from the shipped defaults', () => {
		expect(borderWidthFactorForSize(MIB)).toBe(1);
		expect(borderWidthFactorForSize(MIB, { widthPerDoubling: 0.5 })).toBe(1);
		expect(borderWidthFactorForSize(2 * MIB, { widthPerDoubling: 0.5 })).toBeCloseTo(1.5, 12);
	});
});
