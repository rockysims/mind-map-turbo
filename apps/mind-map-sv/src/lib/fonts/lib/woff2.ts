/**
 * Just enough WOFF2 and OpenType parsing to read a font's name table.
 *
 * We redistribute a font binary (see `../OFL.txt`), and OFL 1.1 §2 is satisfied
 * by the notice carried in that binary's own name table. `mathScriptFont.spec.ts`
 * asserts the notice is really there, which needs a way to read it.
 *
 * Both functions here are pure and take bytes. Brotli decompression, which sits
 * between them, is the caller's job so that neither function needs `node:zlib`.
 */

/** A WOFF2 table's position and size within the decompressed table stream. */
export interface Woff2TableEntry {
	tag: string;
	offset: number;
	length: number;
}

export interface NameRecord {
	nameID: number;
	platformID: number;
	value: string;
}

const WOFF2_SIGNATURE = 0x774f4632; // 'wOF2'
const WOFF2_HEADER_BYTES = 48;
const CUSTOM_TAG = 0x3f;

/**
 * Tag index → tag, as fixed by the WOFF2 spec. A directory entry stores this
 * index in the low six bits of its flags byte instead of a four-byte tag; index
 * 63 means an arbitrary tag follows inline.
 */
const KNOWN_TAGS = [
	'cmap',
	'head',
	'hhea',
	'hmtx',
	'maxp',
	'name',
	'OS/2',
	'post',
	'cvt ',
	'fpgm',
	'glyf',
	'loca',
	'prep',
	'CFF ',
	'VORG',
	'EBDT',
	'EBLC',
	'gasp',
	'hdmx',
	'kern',
	'LTSH',
	'PCLT',
	'VDMX',
	'vhea',
	'vmtx',
	'BASE',
	'GDEF',
	'GPOS',
	'GSUB',
	'EBSC',
	'JSTF',
	'MATH',
	'CBDT',
	'CBLC',
	'COLR',
	'CPAL',
	'SVG ',
	'sbix',
	'acnt',
	'avar',
	'bdat',
	'bloc',
	'bsln',
	'cvar',
	'fdsc',
	'feat',
	'fmtx',
	'fvar',
	'gvar',
	'hsty',
	'just',
	'lcar',
	'mort',
	'morx',
	'opbd',
	'prop',
	'trak',
	'Zapf',
	'Silf',
	'Glat',
	'Gloc',
	'Feat',
	'Sill'
];

/** Variable-length integer, seven bits per byte, high bit continues. */
function readUIntBase128(view: DataView, start: number): { value: number; next: number } {
	let value = 0;
	for (let index = 0; index < 5; index += 1) {
		const byte = view.getUint8(start + index);
		// A leading 0x80 would encode a redundant zero, which the spec rejects.
		if (index === 0 && byte === 0x80) throw new Error('woff2: invalid UIntBase128');
		value = value * 128 + (byte & 0x7f);
		if ((byte & 0x80) === 0) return { value, next: start + index + 1 };
	}
	throw new Error('woff2: UIntBase128 longer than 5 bytes');
}

/**
 * Whether a directory entry carries a transformLength alongside its origLength.
 *
 * The sense of the transform version is inverted for `glyf` and `loca`, whose
 * default state is transformed, versus every other table's default of untouched.
 */
function hasTransformLength(tag: string, transformVersion: number): boolean {
	return tag === 'glyf' || tag === 'loca' ? transformVersion !== 3 : transformVersion !== 0;
}

/**
 * Locate each table inside the Brotli stream that follows a WOFF2 directory.
 *
 * Offsets are cumulative: WOFF2 drops per-table offsets and relies on the
 * directory order, so a table's position is the sum of the lengths before it.
 */
export function parseWoff2Directory(bytes: Uint8Array): {
	tables: Woff2TableEntry[];
	compressedStart: number;
	compressedLength: number;
} {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(0) !== WOFF2_SIGNATURE) throw new Error('woff2: bad signature');

	const numTables = view.getUint16(12);
	const totalCompressedSize = view.getUint32(20);

	const tables: Woff2TableEntry[] = [];
	let cursor = WOFF2_HEADER_BYTES;
	let offset = 0;

	for (let index = 0; index < numTables; index += 1) {
		const flags = view.getUint8(cursor);
		cursor += 1;

		const tagIndex = flags & 0x3f;
		let tag: string;
		if (tagIndex === CUSTOM_TAG) {
			tag = String.fromCharCode(
				view.getUint8(cursor),
				view.getUint8(cursor + 1),
				view.getUint8(cursor + 2),
				view.getUint8(cursor + 3)
			);
			cursor += 4;
		} else {
			tag = KNOWN_TAGS[tagIndex];
		}

		const origLength = readUIntBase128(view, cursor);
		cursor = origLength.next;
		let length = origLength.value;

		if (hasTransformLength(tag, flags >> 6)) {
			const transformLength = readUIntBase128(view, cursor);
			cursor = transformLength.next;
			length = transformLength.value;
		}

		tables.push({ tag, offset, length });
		offset += length;
	}

	return { tables, compressedStart: cursor, compressedLength: totalCompressedSize };
}

function decodeUtf16Be(bytes: Uint8Array): string {
	let out = '';
	for (let index = 0; index + 1 < bytes.length; index += 2) {
		out += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
	}
	return out;
}

/** Read an OpenType `name` table. Windows records are UTF-16BE, Macintosh single-byte. */
export function parseNameTable(bytes: Uint8Array): NameRecord[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const count = view.getUint16(2);
	const stringOffset = view.getUint16(4);

	const records: NameRecord[] = [];
	for (let index = 0; index < count; index += 1) {
		const base = 6 + index * 12;
		const platformID = view.getUint16(base);
		const nameID = view.getUint16(base + 6);
		const length = view.getUint16(base + 8);
		const offset = view.getUint16(base + 10);

		const start = stringOffset + offset;
		const raw = bytes.subarray(start, start + length);
		records.push({
			nameID,
			platformID,
			value: platformID === 1 ? String.fromCharCode(...raw) : decodeUtf16Be(raw)
		});
	}
	return records;
}

/** First value for `nameID`, preferring the Windows record when both exist. */
export function nameValue(records: NameRecord[], nameID: number): string | undefined {
	const matches = records.filter((record) => record.nameID === nameID);
	const windows = matches.find((record) => record.platformID === 3);
	return (windows ?? matches[0])?.value;
}

export interface CmapSubtableHeader {
	format: number;
	platformID: number;
	encodingID: number;
	language: number;
}

/**
 * The header of each `cmap` subtable, without decoding its mappings.
 *
 * `language` is worth inspecting on its own: it must be zero on every subtable,
 * and a non-zero value makes Chromium's font sanitiser reject the whole file.
 */
export function parseCmapSubtables(bytes: Uint8Array): CmapSubtableHeader[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const numTables = view.getUint16(2);

	const headers: CmapSubtableHeader[] = [];
	for (let index = 0; index < numTables; index += 1) {
		const recordOffset = 4 + index * 8;
		const subtableOffset = view.getUint32(recordOffset + 4);
		const format = view.getUint16(subtableOffset);
		// Formats 0, 4 and 6 store a 16-bit length then language; formats 8 and
		// above widen both to 32 bits.
		const language =
			format < 8 ? view.getUint16(subtableOffset + 4) : view.getUint32(subtableOffset + 8);

		headers.push({
			format,
			platformID: view.getUint16(recordOffset),
			encodingID: view.getUint16(recordOffset + 2),
			language
		});
	}
	return headers;
}

/**
 * Every code point mapped by a `cmap` table's format 12 subtable.
 *
 * Format 12 is the only subtable consulted, because it is the only one that can
 * address code points above U+FFFF and our font's script capitals live there.
 * A font whose coverage is described solely by a format 4 subtable therefore
 * reads as empty rather than partially parsed.
 */
export function parseCmapCodepoints(bytes: Uint8Array): Set<number> {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const numTables = view.getUint16(2);

	const codepoints = new Set<number>();
	for (let index = 0; index < numTables; index += 1) {
		const subtableOffset = view.getUint32(4 + index * 8 + 4);
		if (view.getUint16(subtableOffset) !== 12) continue;

		const groupCount = view.getUint32(subtableOffset + 12);
		for (let group = 0; group < groupCount; group += 1) {
			const base = subtableOffset + 16 + group * 12;
			const start = view.getUint32(base);
			const end = view.getUint32(base + 4);
			for (let codepoint = start; codepoint <= end; codepoint += 1) {
				codepoints.add(codepoint);
			}
		}
	}
	return codepoints;
}
