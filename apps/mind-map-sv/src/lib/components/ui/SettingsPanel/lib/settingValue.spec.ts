import { describe, expect, it } from 'vitest';
import { clampToSliderRange, formatSettingValue, parseSettingValue } from './settingValue';

describe('formatSettingValue', () => {
	it('drops binary-float noise without adding trailing zeros', () => {
		expect(formatSettingValue(0.1 + 0.2)).toBe('0.3');
		expect(formatSettingValue(1)).toBe('1');
		expect(formatSettingValue(0.05)).toBe('0.05');
	});

	it('renders a non-finite value as empty text', () => {
		expect(formatSettingValue(Number.NaN)).toBe('');
		expect(formatSettingValue(Number.POSITIVE_INFINITY)).toBe('');
	});
});

describe('parseSettingValue', () => {
	it('accepts values far outside any slider range', () => {
		expect(parseSettingValue('9999')).toBe(9999);
		expect(parseSettingValue('-4.5')).toBe(-4.5);
	});

	it('returns null for text that is not a finite number', () => {
		expect(parseSettingValue('')).toBeNull();
		expect(parseSettingValue('   ')).toBeNull();
		expect(parseSettingValue('abc')).toBeNull();
		expect(parseSettingValue('Infinity')).toBeNull();
	});

	it('rounds when the field is an integer field', () => {
		expect(parseSettingValue('2.4', true)).toBe(2);
		expect(parseSettingValue('2.6', true)).toBe(3);
		expect(parseSettingValue('2.6', false)).toBe(2.6);
	});
});

describe('clampToSliderRange', () => {
	it('folds out-of-range values onto the bounds', () => {
		expect(clampToSliderRange(5, 0, 1)).toBe(1);
		expect(clampToSliderRange(-5, 0, 1)).toBe(0);
		expect(clampToSliderRange(0.4, 0, 1)).toBe(0.4);
	});

	it('passes the value through when the bounds are inverted', () => {
		expect(clampToSliderRange(7, 10, 1)).toBe(7);
	});
});
