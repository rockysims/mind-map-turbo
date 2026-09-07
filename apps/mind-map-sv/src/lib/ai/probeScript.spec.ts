import { describe, expect, it } from 'vitest';
import {
	PROBE_SCRIPT,
	parseProbeOutput,
	renderDigest,
	type MeasuredFileDigest
} from './probeScript';

function tableDigest(rowCount: number, over: Partial<MeasuredFileDigest> = {}): MeasuredFileDigest {
	return {
		name: 'sweep.csv',
		size: 2048,
		kind: 'table',
		columns: ['time', 'ch1'],
		dtypes: ['float64', 'float64'],
		rows: 1000,
		head: Array.from({ length: rowCount }, (_, index) => [`${index}.0`, `${index * 2}.5`]),
		...over
	};
}

describe('PROBE_SCRIPT', () => {
	it('is pandas, prints JSON, and falls back rather than raising', () => {
		expect(PROBE_SCRIPT).toContain('import pandas as pd');
		expect(PROBE_SCRIPT).toContain('json.dumps');
		expect(PROBE_SCRIPT).toContain('except Exception:');
		expect(PROBE_SCRIPT).toContain('"kind": "other"');
	});

	it('reads its request from stdin and covers the four reader families', () => {
		expect(PROBE_SCRIPT).toContain('sys.stdin.read()');
		expect(PROBE_SCRIPT).toContain('previewRows');
		expect(PROBE_SCRIPT).toContain('pd.read_csv(path)');
		expect(PROBE_SCRIPT).toContain('pd.read_csv(path, sep="\\t")');
		expect(PROBE_SCRIPT).toContain('pd.read_excel(path)');
		expect(PROBE_SCRIPT).toContain('pd.read_json(path)');
	});

	it('stays short enough to read at a glance', () => {
		expect(PROBE_SCRIPT.split('\n').length).toBeLessThan(70);
	});
});

describe('parseProbeOutput', () => {
	it('reads one digest per line of clean output', () => {
		const stdout = [
			JSON.stringify({ name: 'a.csv', size: 10, kind: 'table', columns: ['x'], rows: 2 }),
			JSON.stringify({ name: 'b.bin', size: 20, kind: 'other' }),
			''
		].join('\n');

		expect(parseProbeOutput(stdout)).toEqual({
			digests: [
				{ name: 'a.csv', size: 10, kind: 'table', columns: ['x'], rows: 2 },
				{ name: 'b.bin', size: 20, kind: 'other' }
			],
			errors: []
		});
	});

	it('keeps what parsed and reports a trailing traceback as one error', () => {
		const stdout = [
			JSON.stringify({ name: 'a.csv', size: 10, kind: 'other' }),
			'Traceback (most recent call last):',
			'  File "<exec>", line 4, in main',
			'MemoryError'
		].join('\n');

		expect(parseProbeOutput(stdout)).toEqual({
			digests: [{ name: 'a.csv', size: 10, kind: 'other' }],
			errors: ['Traceback (most recent call last):\nFile "<exec>", line 4, in main\nMemoryError']
		});
	});

	it('reads empty output as nothing at all', () => {
		expect(parseProbeOutput('')).toEqual({ digests: [], errors: [] });
		expect(parseProbeOutput('\n  \n')).toEqual({ digests: [], errors: [] });
	});

	it('rejects JSON that is not a digest', () => {
		const result = parseProbeOutput('{"name": "a.csv"}\n[1,2]\n"just a string"');

		expect(result.digests).toEqual([]);
		expect(result.errors).toEqual(['{"name": "a.csv"}\n[1,2]\n"just a string"']);
	});

	it('drops fields of the wrong shape rather than the whole digest', () => {
		const stdout = JSON.stringify({
			name: 'a.csv',
			size: 10,
			kind: 'table',
			columns: ['x', 3],
			head: 'nope',
			rows: 5
		});

		expect(parseProbeOutput(stdout).digests).toEqual([
			{ name: 'a.csv', size: 10, kind: 'table', rows: 5 }
		]);
	});
});

describe('renderDigest', () => {
	it('renders schema only at zero rows', () => {
		expect(renderDigest(tableDigest(5), 0)).toBe(
			['sweep.csv — 2 KB', '2 columns: time (float64), ch1 (float64)', '1000 rows'].join('\n')
		);
	});

	it('renders five rows under the column header', () => {
		expect(renderDigest(tableDigest(5), 5)).toBe(
			[
				'sweep.csv — 2 KB',
				'2 columns: time (float64), ch1 (float64)',
				'1000 rows',
				'First 5 rows:',
				'time | ch1',
				'0.0 | 0.5',
				'1.0 | 2.5',
				'2.0 | 4.5',
				'3.0 | 6.5',
				'4.0 | 8.5'
			].join('\n')
		);
	});

	it('renders every row it has when asked for twenty and given seven', () => {
		const rendered = renderDigest(tableDigest(7), 20);

		expect(rendered).toContain('First 7 rows:');
		expect(rendered.split('\n')).toHaveLength(4 + 1 + 7);
	});

	it('renders twenty rows out of twenty', () => {
		const rendered = renderDigest(tableDigest(20), 20);

		expect(rendered).toContain('First 20 rows:');
		expect(rendered.split('\n')).toHaveLength(4 + 1 + 20);
	});

	it('never emits more rows than asked for, whatever the digest carries', () => {
		const rendered = renderDigest(tableDigest(100), 5);
		const dataRows = rendered.split('\n').slice(5);

		expect(rendered).toContain('First 5 rows:');
		expect(dataRows).toEqual(['0.0 | 0.5', '1.0 | 2.5', '2.0 | 4.5', '3.0 | 6.5', '4.0 | 8.5']);
	});

	it('renders a non-tabular file as name and size only', () => {
		expect(renderDigest({ name: 'scope.bin', size: 1536, kind: 'other' }, 20)).toBe(
			'scope.bin — 1.5 KB'
		);
	});

	it('omits the preview when the probe returned no head, and defaults the row count', () => {
		expect(renderDigest(tableDigest(0, { head: undefined }))).toBe(
			['sweep.csv — 2 KB', '2 columns: time (float64), ch1 (float64)', '1000 rows'].join('\n')
		);
	});

	it('drops the types when the probe reported none, and singularises one row', () => {
		expect(renderDigest(tableDigest(1, { dtypes: undefined, rows: 1 }), 5)).toBe(
			[
				'sweep.csv — 2 KB',
				'2 columns: time, ch1',
				'1 row',
				'First 1 row:',
				'time | ch1',
				'0.0 | 0.5'
			].join('\n')
		);
	});
});
