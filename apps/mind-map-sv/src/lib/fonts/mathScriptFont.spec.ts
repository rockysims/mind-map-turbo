/**
 * Guards the font binary we redistribute.
 *
 * We ship `MindMapScript-Regular.woff2` instead of Temml's equivalent because
 * Temml's copy advertises "you may not use this font for commercial purposes"
 * in place of the SIL Open Font License its glyphs are really under. Since the
 * production build inlines the font into `index.html` as a data URI, whatever
 * that binary claims is a claim we distribute. These tests fail if a rebuild or
 * a dependency bump reintroduces the problem.
 *
 * See `THIRD-PARTY-NOTICES.md` and `scripts/build-math-script-font.py`.
 */

import { brotliDecompressSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	nameValue,
	parseCmapCodepoints,
	parseCmapSubtables,
	parseNameTable,
	parseWoff2Directory
} from './lib/woff2';

const NAME_ID = {
	copyright: 0,
	family: 1,
	fullName: 4,
	postScriptName: 6,
	licenseDescription: 13,
	licenseUrl: 14
} as const;

/**
 * `build.assetsInlineLimit` in `vite.config.ts`. The offline build inlines
 * stylesheet text but deletes sibling asset files, so a font over this limit
 * would be emitted as a separate file and then deleted, silently.
 */
const ASSETS_INLINE_LIMIT = 16384;

const fontBytes = new Uint8Array(
	readFileSync(fileURLToPath(new URL('./MindMapScript-Regular.woff2', import.meta.url)))
);
const oflText = readFileSync(fileURLToPath(new URL('./OFL.txt', import.meta.url)), 'utf8');

/**
 * The eight script capitals Unicode had already assigned in Letterlike Symbols
 * before the Mathematical Alphanumeric Symbols block existed. The later block
 * leaves holes at their positions, so these letters are not a plain offset from
 * U+1D49C. Restated here rather than imported so the test is an independent
 * check on what the build script produced.
 */
const LETTERLIKE_SUBSTITUTES: Record<string, number> = {
	B: 0x212c,
	E: 0x2130,
	F: 0x2131,
	H: 0x210b,
	I: 0x2110,
	L: 0x2112,
	M: 0x2133,
	R: 0x211b
};
const MATH_SCRIPT_CAPITAL_A = 0x1d49c;
const ALPHABET = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];

function expectedCodepoint(letter: string): number {
	return (
		LETTERLIKE_SUBSTITUTES[letter] ??
		MATH_SCRIPT_CAPITAL_A + letter.charCodeAt(0) - 'A'.charCodeAt(0)
	);
}

const { names, codepoints, cmapSubtables } = (() => {
	const { tables, compressedStart, compressedLength } = parseWoff2Directory(fontBytes);
	const decompressed = brotliDecompressSync(
		fontBytes.subarray(compressedStart, compressedStart + compressedLength)
	);

	function tableBytes(tag: string): Uint8Array {
		const entry = tables.find((table) => table.tag === tag);
		if (!entry) throw new Error(`font has no ${tag} table`);
		return decompressed.subarray(entry.offset, entry.offset + entry.length);
	}

	return {
		names: parseNameTable(tableBytes('name')),
		codepoints: parseCmapCodepoints(tableBytes('cmap')),
		cmapSubtables: parseCmapSubtables(tableBytes('cmap'))
	};
})();

describe('MindMapScript-Regular.woff2', () => {
	describe('the license the binary declares', () => {
		it('names the SIL Open Font License', () => {
			expect(nameValue(names, NAME_ID.licenseDescription)).toContain(
				'SIL Open Font License, Version 1.1'
			);
		});

		it('points its license URL at the OFL rather than a font editor vendor', () => {
			expect(nameValue(names, NAME_ID.licenseUrl)).toBe('https://openfontlicense.org');
		});

		it('makes no non-commercial claim', () => {
			const everyName = names.map((record) => record.value).join('\n');
			expect(everyName).not.toMatch(/non-?commercial|not use this font for commercial/i);
		});

		it('carries no trace of the font editor that mislabelled the upstream copy', () => {
			const everyName = names.map((record) => record.value).join('\n');
			expect(everyName).not.toMatch(/FontCreator|high-logic/i);
		});
	});

	describe('attribution required by OFL 1.1 §2', () => {
		it('credits both upstream copyright holders', () => {
			const copyright = nameValue(names, NAME_ID.copyright) ?? '';
			expect(copyright).toContain('Design Science');
			expect(copyright).toContain('Khan Academy');
		});

		it('declares the modification so the derivative is not passed off as the original', () => {
			expect(nameValue(names, NAME_ID.licenseDescription)).toContain('Modifications copyright');
		});

		it('ships the full license text alongside the binary', () => {
			expect(oflText).toContain('SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007');
			expect(oflText).toContain('with Reserved Font Name KaTeX_Script.');
		});
	});

	describe('the Reserved Font Name restriction in OFL 1.1 §4', () => {
		// KaTeX reserves KaTeX_Script, so a derivative may not present itself
		// under that name. Only the user-facing names are restricted, which is
		// why the license description above may still mention it.
		it.each([NAME_ID.family, NAME_ID.fullName, NAME_ID.postScriptName])(
			'does not use the reserved name in name ID %i',
			(nameID) => {
				expect(nameValue(names, nameID)).not.toContain('KaTeX');
			}
		);

		it('presents our own family name', () => {
			expect(nameValue(names, NAME_ID.family)).toBe('MindMapScript');
		});
	});

	describe('the glyph coverage \\mathscr depends on', () => {
		it.each(ALPHABET)('maps script capital %s', (letter) => {
			expect(codepoints.has(expectedCodepoint(letter))).toBe(true);
		});

		it('maps the eight Letterlike Symbols code points, not the holes beside them', () => {
			// U+1D49D would be script capital B on a naive offset, but Unicode left
			// it unassigned and put the letter at U+212C instead.
			expect(codepoints.has(0x1d49d)).toBe(false);
			expect(codepoints.has(0x212c)).toBe(true);
		});

		it('no longer answers for ASCII, so it cannot be mistaken for a text font', () => {
			for (const letter of ALPHABET) {
				expect(codepoints.has(letter.charCodeAt(0))).toBe(false);
			}
		});
	});

	describe('what browsers require of the character map', () => {
		// Setting this to the name table's Windows language ID (1033) instead of
		// zero made Chromium refuse the font, reported only as a network error
		// on the font load with no hint that the bytes were the problem.
		it('leaves the language field zero on every subtable', () => {
			expect(cmapSubtables.map((subtable) => subtable.language)).toEqual(
				cmapSubtables.map(() => 0)
			);
		});

		it('publishes a format 12 subtable, the only kind that reaches beyond U+FFFF', () => {
			expect(cmapSubtables.some((subtable) => subtable.format === 12)).toBe(true);
		});
	});

	describe('the single-file build', () => {
		it('stays small enough for Vite to inline', () => {
			expect(fontBytes.byteLength).toBeLessThan(ASSETS_INLINE_LIMIT);
		});
	});
});
