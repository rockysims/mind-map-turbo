import { brotliDecompressSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	nameValue,
	parseCmapSubtables,
	parseNameTable,
	parseWoff2Directory,
	type NameRecord
} from './woff2';

const fontBytes = new Uint8Array(
	readFileSync(fileURLToPath(new URL('../MindMapScript-Regular.woff2', import.meta.url)))
);

/** Build a minimal OpenType name table so decoding is tested without a font. */
function buildNameTable(
	records: { platformID: number; nameID: number; bytes: number[] }[]
): Uint8Array {
	const headerLength = 6 + records.length * 12;
	const strings: number[] = [];
	const directory: number[] = [];

	for (const record of records) {
		const offset = strings.length;
		strings.push(...record.bytes);
		directory.push(
			record.platformID >> 8,
			record.platformID & 0xff,
			0,
			1,
			0,
			0,
			record.nameID >> 8,
			record.nameID & 0xff,
			record.bytes.length >> 8,
			record.bytes.length & 0xff,
			offset >> 8,
			offset & 0xff
		);
	}

	return new Uint8Array([
		0,
		0,
		records.length >> 8,
		records.length & 0xff,
		headerLength >> 8,
		headerLength & 0xff,
		...directory,
		...strings
	]);
}

function utf16Be(text: string): number[] {
	return [...text].flatMap((character) => {
		const code = character.charCodeAt(0);
		return [code >> 8, code & 0xff];
	});
}

describe('parseWoff2Directory', () => {
	describe('when given something that is not a WOFF2', () => {
		it('rejects it rather than reading garbage offsets', () => {
			expect(() => parseWoff2Directory(new Uint8Array(64))).toThrow(/bad signature/);
		});
	});

	describe('when given our committed font', () => {
		it('finds the tables a TrueType-flavoured font must have', () => {
			const { tables } = parseWoff2Directory(fontBytes);
			const tags = tables.map((table) => table.tag);
			expect(tags).toEqual(expect.arrayContaining(['name', 'cmap', 'head', 'glyf', 'loca']));
		});

		it('lays tables out back to back, since WOFF2 stores no per-table offset', () => {
			const { tables } = parseWoff2Directory(fontBytes);
			let expected = 0;
			for (const table of tables) {
				expect(table.offset).toBe(expected);
				expected += table.length;
			}
		});

		it('reports a compressed range that lies inside the file', () => {
			const { compressedStart, compressedLength } = parseWoff2Directory(fontBytes);
			expect(compressedStart).toBeGreaterThan(48);
			expect(compressedStart + compressedLength).toBeLessThanOrEqual(fontBytes.byteLength);
		});

		it('describes a stream that Brotli can actually decompress to those lengths', () => {
			const { tables, compressedStart, compressedLength } = parseWoff2Directory(fontBytes);
			const decompressed = brotliDecompressSync(
				fontBytes.subarray(compressedStart, compressedStart + compressedLength)
			);
			const last = tables[tables.length - 1];
			expect(decompressed.byteLength).toBeGreaterThanOrEqual(last.offset + last.length);
		});
	});
});

describe('parseNameTable', () => {
	describe('for Windows records', () => {
		it('decodes UTF-16BE', () => {
			const table = buildNameTable([{ platformID: 3, nameID: 1, bytes: utf16Be('MindMapScript') }]);
			expect(parseNameTable(table)[0].value).toBe('MindMapScript');
		});

		it('keeps the newlines a multi-line license notice depends on', () => {
			const table = buildNameTable([{ platformID: 3, nameID: 13, bytes: utf16Be('a\nb') }]);
			expect(parseNameTable(table)[0].value).toBe('a\nb');
		});
	});

	describe('for Macintosh records', () => {
		it('decodes single-byte characters instead of pairing them up', () => {
			const table = buildNameTable([
				{ platformID: 1, nameID: 1, bytes: [...'Mac'].map((c) => c.charCodeAt(0)) }
			]);
			expect(parseNameTable(table)[0].value).toBe('Mac');
		});
	});

	describe('when several records share a string pool', () => {
		it('reads each one at its own offset', () => {
			const table = buildNameTable([
				{ platformID: 3, nameID: 1, bytes: utf16Be('first') },
				{ platformID: 3, nameID: 13, bytes: utf16Be('second') }
			]);
			expect(parseNameTable(table).map((record) => record.value)).toEqual(['first', 'second']);
		});
	});
});

describe('parseCmapSubtables', () => {
	/** A cmap with one subtable of the given format, language in its native width. */
	function buildCmap(format: number, language: number): Uint8Array {
		const subtableOffset = 12;
		const header = [
			0,
			0,
			0,
			1,
			0,
			3,
			0,
			1,
			subtableOffset >>> 24,
			(subtableOffset >>> 16) & 0xff,
			(subtableOffset >>> 8) & 0xff,
			subtableOffset & 0xff
		];
		// Format 4 keeps length and language in 16 bits; format 12 widens both to
		// 32 and inserts a reserved field, moving language four bytes later.
		const subtable =
			format < 8
				? [0, format, 0, 0, language >> 8, language & 0xff]
				: [
						0,
						format,
						0,
						0,
						0,
						0,
						0,
						0,
						language >>> 24,
						(language >>> 16) & 0xff,
						(language >>> 8) & 0xff,
						language & 0xff
					];
		return new Uint8Array([...header, ...subtable]);
	}

	describe('for a 16-bit format', () => {
		it('reads language from the narrow field', () => {
			expect(parseCmapSubtables(buildCmap(4, 1033))[0].language).toBe(1033);
		});
	});

	describe('for a 32-bit format', () => {
		it('reads language from the wider field further into the subtable', () => {
			expect(parseCmapSubtables(buildCmap(12, 1033))[0].language).toBe(1033);
		});
	});

	describe('for our committed font', () => {
		it('reports the platform and encoding pairs the font actually declares', () => {
			const { tables, compressedStart, compressedLength } = parseWoff2Directory(fontBytes);
			const cmap = tables.find((table) => table.tag === 'cmap');
			const decompressed = brotliDecompressSync(
				fontBytes.subarray(compressedStart, compressedStart + compressedLength)
			);
			const subtables = parseCmapSubtables(
				decompressed.subarray(cmap!.offset, cmap!.offset + cmap!.length)
			);
			expect(subtables.map((subtable) => `${subtable.platformID}/${subtable.encodingID}`)).toEqual([
				'0/3',
				'0/4',
				'3/1',
				'3/10'
			]);
		});
	});
});

describe('nameValue', () => {
	const records: NameRecord[] = [
		{ nameID: 1, platformID: 1, value: 'mac' },
		{ nameID: 1, platformID: 3, value: 'windows' }
	];

	describe('when a name exists for more than one platform', () => {
		it('prefers the Windows record, which is the one modern tools read', () => {
			expect(nameValue(records, 1)).toBe('windows');
		});
	});

	describe('when a name exists for only one platform', () => {
		it('falls back to whatever is present', () => {
			expect(nameValue([records[0]], 1)).toBe('mac');
		});
	});

	describe('when the name is absent', () => {
		it('returns undefined rather than an empty string, so callers can tell', () => {
			expect(nameValue(records, 13)).toBeUndefined();
		});
	});
});
