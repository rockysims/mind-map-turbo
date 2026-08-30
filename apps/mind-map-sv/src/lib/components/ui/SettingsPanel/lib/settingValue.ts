/**
 * Pure helpers shared by the settings field controls: how a number is shown in a
 * text box, how typed text becomes a number again, and how an out-of-range value
 * is folded onto a slider without lying about the value itself.
 */

/** Decimals kept when rendering a value into a text box. */
export const SETTING_VALUE_PRECISION = 6;

/**
 * Render a number for a text input. Rounds away binary-float noise
 * (`0.30000000000000004` → `0.3`) without introducing trailing zeros.
 */
export function formatSettingValue(value: number, precision = SETTING_VALUE_PRECISION): string {
	if (!Number.isFinite(value)) return '';
	return String(Number(value.toFixed(precision)));
}

/**
 * Parse text typed into a numeric field. Returns `null` for anything that is not
 * a finite number, which callers treat as "revert to the current value" rather
 * than as a value to commit. Deliberately does no range checking — slider bounds
 * are a convenience, not a cage.
 */
export function parseSettingValue(text: string, integer = false): number | null {
	const trimmed = text.trim();
	if (trimmed === '') return null;
	const parsed = Number(trimmed);
	if (!Number.isFinite(parsed)) return null;
	return integer ? Math.round(parsed) : parsed;
}

/**
 * Fold a value onto `min..max` for the slider thumb. The true value is still
 * shown by the paired numeric input, so this clamps the display only.
 */
export function clampToSliderRange(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	if (min > max) return value;
	return Math.min(max, Math.max(min, value));
}
