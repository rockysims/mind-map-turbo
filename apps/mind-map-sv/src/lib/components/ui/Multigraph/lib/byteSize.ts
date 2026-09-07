/**
 * Human-readable byte sizes for attachment rows.
 *
 * Binary units, because a file picked off a disk is measured the way the OS
 * measures it. One decimal place at most: the reader is deciding whether a file
 * is small enough to embed in a save file, and no such decision turns on the
 * second digit.
 */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
const STEP = 1024;

function roundToOneDecimal(value: number): number {
	return Math.round(value * 10) / 10;
}

/**
 * Formats a byte count as e.g. `0 B`, `512 B`, `1.5 KB`, `5 MB`.
 *
 * The rounded value, not the raw one, is what decides whether to step up a
 * unit, so a size that only reaches the next unit after rounding is shown there
 * rather than as `1024 KB`. Anything not a positive finite number reads as
 * `0 B` — a row still has to draw when a store hands back a bad size.
 */
export function formatByteSize(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

	let value = bytes;
	let unitIndex = 0;
	while (unitIndex < UNITS.length - 1 && roundToOneDecimal(value) >= STEP) {
		value /= STEP;
		unitIndex += 1;
	}

	// Whole bytes only at the base unit: "1.5 B" names nothing that exists.
	const rounded = unitIndex === 0 ? Math.round(value) : roundToOneDecimal(value);
	return `${rounded} ${UNITS[unitIndex]}`;
}
