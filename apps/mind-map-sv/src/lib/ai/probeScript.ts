/**
 * The fixed Python that measures the input files, and the pure code that reads
 * its output back and turns one measurement into the prose a request carries.
 *
 * The files themselves never leave the machine. What leaves is a digest: name,
 * size, columns with their types, the row count, and the first few rows — how
 * many is a setting. So the probe runs locally, before any request is built,
 * and `renderDigest` is the one place that decides what a digest is allowed to
 * say.
 *
 * ## The probe's contract (T06 drives it)
 *
 * **Input — stdin, one JSON object, read to EOF:**
 * `{ "paths": ["/work/a.csv", ...], "previewRows": 5 }`
 * `previewRows` may be `0` (schema only); a missing key reads as `0`, a missing
 * `paths` as an empty list. Stdin rather than argv so an arbitrarily long path
 * list needs no quoting, and because both a plain `python probe.py < in.json`
 * and Pyodide's `setStdin` supply it the same way.
 *
 * **Output — stdout, one JSON object per line (JSONL), one per path, in the
 * order given:** `{ name, size, kind, columns?, dtypes?, rows?, head? }`.
 * Line-delimited rather than one array so that a run which dies partway
 * through still hands back everything it managed to measure; `parseProbeOutput`
 * keeps the lines that parsed and reports the rest.
 */

import { APP_CONFIG } from '$lib/appConfig';
import { formatByteSize } from '$lib/components/ui/Multigraph/lib/byteSize';

/**
 * One file as the probe measured it. `dtypes` is parallel to `columns`; `head`
 * holds already-stringified cells, because what the request carries is text and
 * the conversion belongs where the types are still known.
 */
export interface MeasuredFileDigest {
	name: string;
	size: number;
	/** `'table'` when pandas read it; `'other'` when it did not, for any reason. */
	kind: 'table' | 'other';
	columns?: string[];
	dtypes?: string[];
	rows?: number;
	head?: string[][];
}

/**
 * Why a file has no measurement at all.
 *
 * - `'blob'` — the asset store could not hand over the bytes, so nothing was
 *   ever put in front of the probe. A document whose blob was never hydrated
 *   into this browser is the case that happens.
 * - `'runtime'` — the Python runtime did not load, so no file was measured.
 */
export type DigestUnavailableReason = 'blob' | 'runtime';

/**
 * A file the probe never saw, standing in its place.
 *
 * The probe cannot produce one — `parseProbeOutput` refuses the kind — because
 * this is not a measurement: it is the run controller saying, in the one shape
 * the workbench already draws a file by, that there is nothing to measure and
 * why. Without it a file whose bytes are out of reach reads as "digesting…"
 * for ever, which is a promise rather than an answer. Name and size come from
 * the graph's asset metadata, which is all that is known.
 */
interface UnavailableFileDigest {
	name: string;
	size: number;
	kind: 'unavailable';
	reason: DigestUnavailableReason;
}

export type FileDigest = MeasuredFileDigest | UnavailableFileDigest;

/**
 * The probe. Kept short and dependency-light on purpose: pandas and the
 * standard library, no network, no writes, and one `except` around every file
 * so a single unreadable input costs its own digest and nothing else.
 */
export const PROBE_SCRIPT = `"""Digest the AI node's input files.

Reads {"paths": [...], "previewRows": N} as JSON on stdin.
Writes one JSON object per path to stdout, one per line:
{"name", "size", "kind": "table"|"other", "columns"?, "dtypes"?, "rows"?, "head"?}
"""

import json
import os
import sys

import pandas as pd


def read_frame(path, suffix):
    if suffix in (".csv", ".txt"):
        return pd.read_csv(path)
    if suffix == ".tsv":
        return pd.read_csv(path, sep="\\t")
    if suffix in (".xlsx", ".xls"):
        return pd.read_excel(path)
    if suffix == ".json":
        return pd.read_json(path)
    return None


def file_size(path):
    try:
        return os.path.getsize(path)
    except OSError:
        return 0


def describe(path, preview_rows):
    name = os.path.basename(path)
    size = file_size(path)
    try:
        frame = read_frame(path, os.path.splitext(path)[1].lower())
        if frame is None:
            return {"name": name, "size": size, "kind": "other"}
        head = frame.head(max(preview_rows, 0)).values.tolist()
        return {
            "name": name,
            "size": size,
            "kind": "table",
            "columns": [str(column) for column in frame.columns],
            "dtypes": [str(dtype) for dtype in frame.dtypes],
            "rows": int(len(frame.index)),
            "head": [[str(cell) for cell in row] for row in head],
        }
    except Exception:
        return {"name": name, "size": size, "kind": "other"}


def main():
    request = json.loads(sys.stdin.read() or "{}")
    preview_rows = int(request.get("previewRows", 0))
    for path in request.get("paths", []):
        print(json.dumps(describe(path, preview_rows)))


main()
`;

/**
 * Read the probe's stdout back.
 *
 * Every line that parses as a digest is kept, in order. Everything else — a
 * traceback the runtime wrote after the last good line, a half-flushed line, a
 * stray `print` — is reported instead of thrown: a request built from four of
 * five files is worth more than no request at all, and the caller shows what
 * went missing. Consecutive unparsable lines are reported as one error, so a
 * traceback reads as the one failure it is rather than six.
 */
export function parseProbeOutput(stdout: string): {
	digests: MeasuredFileDigest[];
	errors: string[];
} {
	const digests: MeasuredFileDigest[] = [];
	const errors: string[] = [];
	let pending: string[] = [];

	const flush = (): void => {
		if (pending.length === 0) return;
		errors.push(pending.join('\n'));
		pending = [];
	};

	for (const line of stdout.split('\n')) {
		const trimmed = line.trim();
		if (trimmed === '') continue;

		const digest = parseDigestLine(trimmed);
		if (digest) {
			flush();
			digests.push(digest);
			continue;
		}
		pending.push(trimmed);
	}
	flush();

	return { digests, errors };
}

function parseDigestLine(line: string): MeasuredFileDigest | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return undefined;
	}
	return toDigest(parsed);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
	// Every non-null, non-array object indexes by string at runtime; TS keeps
	// `unknown` opaque until something says so, and the guard above is that.
	return value as Record<string, unknown>;
}

function toDigest(value: unknown): MeasuredFileDigest | undefined {
	const record = asRecord(value);
	if (!record) return undefined;
	const { name, size, kind } = record;
	if (typeof name !== 'string' || typeof size !== 'number') return undefined;
	if (kind !== 'table' && kind !== 'other') return undefined;

	const columns = stringArray(record.columns);
	const dtypes = stringArray(record.dtypes);
	const head = stringMatrix(record.head);
	return {
		name,
		size,
		kind,
		...(columns ? { columns } : {}),
		...(dtypes ? { dtypes } : {}),
		...(typeof record.rows === 'number' ? { rows: record.rows } : {}),
		...(head ? { head } : {})
	};
}

function stringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.every((entry) => typeof entry === 'string') ? [...value] : undefined;
}

function stringMatrix(value: unknown): string[][] | undefined {
	if (!Array.isArray(value)) return undefined;
	const rows: string[][] = [];
	for (const row of value) {
		const cells = stringArray(row);
		if (!cells) return undefined;
		rows.push(cells);
	}
	return rows;
}

/**
 * One digest as the prose a request carries.
 *
 * `previewRows` is the ceiling, not a request: a digest that arrived with a
 * hundred head rows still renders at most this many, because the setting is the
 * user's promise about how much of their data leaves the machine and the digest
 * is not the place to renegotiate it. Zero rows means schema only.
 */
export function renderDigest(
	digest: FileDigest,
	previewRows: number = APP_CONFIG.ai.previewRows
): string {
	const lines = [`${digest.name} — ${formatByteSize(digest.size)}`];
	if (digest.kind !== 'table') return lines.join('\n');

	const columns = digest.columns ?? [];
	if (columns.length > 0) {
		lines.push(`${columns.length} columns: ${describeColumns(columns, digest.dtypes)}`);
	}
	if (digest.rows !== undefined) {
		lines.push(`${digest.rows} ${digest.rows === 1 ? 'row' : 'rows'}`);
	}

	const rowLimit = Math.max(Math.floor(previewRows), 0);
	const head = (digest.head ?? []).slice(0, rowLimit);
	if (rowLimit > 0 && head.length > 0) {
		lines.push(`First ${head.length} ${head.length === 1 ? 'row' : 'rows'}:`);
		if (columns.length > 0) lines.push(columns.join(' | '));
		for (const row of head) lines.push(row.join(' | '));
	}

	return lines.join('\n');
}

/** `time (float64), ch1 (float64)` — types dropped when the probe had none. */
function describeColumns(columns: string[], dtypes: string[] | undefined): string {
	return columns
		.map((column, index) => {
			const dtype = dtypes?.[index];
			return dtype === undefined ? column : `${column} (${dtype})`;
		})
		.join(', ');
}
