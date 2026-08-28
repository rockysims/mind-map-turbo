/**
 * Pure segmentation of a node description into text and math runs.
 *
 * This decides *where* math is, not how it renders — no DOM and no math engine.
 */

export type MathSegmentKind = 'text' | 'inline-math' | 'display-math';

export interface MathSegment {
	kind: MathSegmentKind;
	/**
	 * Text to display, or the expression with its delimiters stripped. Escaped
	 * dollars are unescaped here so consumers render what the author meant.
	 */
	content: string;
	/**
	 * The exact input slice. Concatenating every segment's source reproduces the
	 * original description, which keeps the split verifiably lossless.
	 */
	source: string;
}

export const DISPLAY_DELIMITER = '$$';
export const INLINE_DELIMITER = '$';

/**
 * A delimiter is escaped only when preceded by an odd number of backslashes, so
 * `\$` is literal while `\\$` is an escaped backslash followed by a delimiter.
 */
function isEscaped(source: string, index: number): boolean {
	let backslashes = 0;
	for (let i = index - 1; i >= 0 && source[i] === '\\'; i -= 1) {
		backslashes += 1;
	}
	return backslashes % 2 === 1;
}

function indexOfUnescaped(source: string, delimiter: string, from: number): number {
	for (let i = from; i <= source.length - delimiter.length; i += 1) {
		if (source.startsWith(delimiter, i) && !isEscaped(source, i)) {
			return i;
		}
	}
	return -1;
}

/**
 * Split a description into ordered text, inline math, and display math
 * segments.
 *
 * `$$` is matched before `$`. An unterminated delimiter stays literal text
 * rather than swallowing the rest of the description, so a stray dollar cannot
 * blank out everything after it.
 */
export function splitMathSegments(description: string): MathSegment[] {
	const segments: MathSegment[] = [];
	let textSource = '';
	let textContent = '';
	let index = 0;

	function flushText(): void {
		if (textSource === '') {
			return;
		}
		segments.push({ kind: 'text', content: textContent, source: textSource });
		textSource = '';
		textContent = '';
	}

	function keepAsText(raw: string, display: string = raw): void {
		textSource += raw;
		textContent += display;
	}

	while (index < description.length) {
		if (description[index] === '\\' && description[index + 1] === INLINE_DELIMITER) {
			keepAsText('\\$', '$');
			index += 2;
			continue;
		}

		if (description.startsWith(DISPLAY_DELIMITER, index)) {
			const close = indexOfUnescaped(description, DISPLAY_DELIMITER, index + 2);
			if (close === -1) {
				keepAsText(DISPLAY_DELIMITER);
				index += 2;
				continue;
			}
			flushText();
			segments.push({
				kind: 'display-math',
				content: description.slice(index + 2, close),
				source: description.slice(index, close + 2)
			});
			index = close + 2;
			continue;
		}

		if (description[index] === INLINE_DELIMITER) {
			const close = indexOfUnescaped(description, INLINE_DELIMITER, index + 1);
			if (close === -1) {
				keepAsText(INLINE_DELIMITER);
				index += 1;
				continue;
			}
			flushText();
			segments.push({
				kind: 'inline-math',
				content: description.slice(index + 1, close),
				source: description.slice(index, close + 1)
			});
			index = close + 1;
			continue;
		}

		keepAsText(description[index]);
		index += 1;
	}

	flushText();
	return segments;
}

/** True when a description contains at least one math segment. */
export function hasMath(description: string): boolean {
	return splitMathSegments(description).some((segment) => segment.kind !== 'text');
}
