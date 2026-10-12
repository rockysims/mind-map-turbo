import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '$lib/appConfig';
import { parseResultLines, renderResultTex } from './aiResults';

describe('parseResultLines', () => {
	it('reads a plain line with a symbol, a value and a unit', () => {
		expect(parseResultLines('RESULT R_{th} = 12.3 K/W')).toEqual([
			{ symbol: 'R_{th}', value: '12.3', unit: 'K/W' }
		]);
	});

	it('reads a line with no unit and leaves the field off', () => {
		expect(parseResultLines('RESULT n = 41000')).toEqual([{ symbol: 'n', value: '41000' }]);
	});

	it('finds results among ordinary script chatter, in the order they were printed', () => {
		const stdout = [
			'Loading three files…',
			'RESULT R_{th} = 12.3 K/W',
			'shape: (41000, 4)',
			'RESULT \\tau = 0.44 s',
			'done'
		].join('\n');

		expect(parseResultLines(stdout)).toEqual([
			{ symbol: 'R_{th}', value: '12.3', unit: 'K/W' },
			{ symbol: '\\tau', value: '0.44', unit: 's' }
		]);
	});

	it('tolerates leading and trailing whitespace around the line', () => {
		expect(parseResultLines('   \tRESULT v_0 = 9.81 m/s^2  \t ')).toEqual([
			{ symbol: 'v_0', value: '9.81', unit: 'm/s^2' }
		]);
	});

	it('tolerates a carriage return left by a CRLF stream', () => {
		expect(parseResultLines('RESULT g = 9.81 m/s\r\nnext line')).toEqual([
			{ symbol: 'g', value: '9.81', unit: 'm/s' }
		]);
	});

	it('accepts spacing either side of the equals sign, or none', () => {
		expect(parseResultLines('RESULT a=1\nRESULT b   =   2')).toEqual([
			{ symbol: 'a', value: '1' },
			{ symbol: 'b', value: '2' }
		]);
	});

	it('accepts a negative value and one in exponent notation', () => {
		expect(parseResultLines('RESULT d = -4.2 mm\nRESULT k = 1.6e-19 C')).toEqual([
			{ symbol: 'd', value: '-4.2', unit: 'mm' },
			{ symbol: 'k', value: '1.6e-19', unit: 'C' }
		]);
	});

	it('keeps the value as the script printed it rather than a reparsed number', () => {
		expect(parseResultLines('RESULT m = 1.500')[0].value).toBe('1.500');
	});

	it('skips a line whose value is not a number', () => {
		expect(parseResultLines('RESULT x = TBD')).toEqual([]);
	});

	it('skips a value that is a number word rather than a finite one', () => {
		expect(parseResultLines('RESULT x = Infinity\nRESULT y = NaN')).toEqual([]);
	});

	it('skips a symbol containing a space, because the symbol ends at the space', () => {
		expect(parseResultLines('RESULT R th = 12.3 K/W')).toEqual([]);
	});

	it('skips a symbol carrying a character outside the allowlist', () => {
		expect(parseResultLines('RESULT $R$ = 12.3\nRESULT R-th = 1\nRESULT \\%x = 2')).toEqual([]);
	});

	it('keeps a symbol built from letters, digits, braces, a caret and a command', () => {
		expect(parseResultLines('RESULT \\sigma_{1}^{2} = 4')).toEqual([
			{ symbol: '\\sigma_{1}^{2}', value: '4' }
		]);
	});

	it('skips a line that is merely about results', () => {
		const stdout = ['# RESULT lines follow', 'RESULT lines follow', 'see RESULT x = 1'].join('\n');

		expect(parseResultLines(stdout)).toEqual([]);
	});

	// The unit is "whatever follows", so a result trailed by commentary is not
	// skipped — the truncation is what stops the commentary becoming the unit.
	it('truncates rather than trusts whatever follows the value', () => {
		expect(
			parseResultLines('RESULT x = 1 unit and then a whole sentence', { unitMaxChars: 4 })
		).toEqual([{ symbol: 'x', value: '1', unit: 'unit' }]);
	});

	it('truncates a long unit to the configured length', () => {
		const [result] = parseResultLines(`RESULT x = 1 ${'K'.repeat(200)}`);

		expect(result.unit).toHaveLength(APP_CONFIG.ai.resultUnitMaxChars);
	});

	it('keeps at most the configured number of distinct symbols, first ones winning', () => {
		const stdout = Array.from({ length: 6 }, (_, index) => `RESULT s${index} = ${index}`).join(
			'\n'
		);

		expect(parseResultLines(stdout, { maxResults: 3 }).map((result) => result.symbol)).toEqual([
			's0',
			's1',
			's2'
		]);
	});

	it('caps at the shipped number by default', () => {
		const stdout = Array.from({ length: 40 }, (_, index) => `RESULT s${index} = ${index}`).join(
			'\n'
		);

		expect(parseResultLines(stdout)).toHaveLength(APP_CONFIG.ai.maxResultsPerRun);
	});

	// A running value printed each iteration is one quantity, not thirty, so the
	// repeats must neither shuffle the list nor eat the cap.
	it('resolves a repeated symbol to its last value, in its first position', () => {
		const stdout = ['RESULT a = 1', 'RESULT b = 2', 'RESULT a = 3 K'].join('\n');

		expect(parseResultLines(stdout)).toEqual([
			{ symbol: 'a', value: '3', unit: 'K' },
			{ symbol: 'b', value: '2' }
		]);
	});

	it('does not let repeats of one symbol crowd out later quantities', () => {
		const stdout = ['RESULT a = 1', 'RESULT a = 2', 'RESULT a = 3', 'RESULT b = 4'].join('\n');

		expect(parseResultLines(stdout, { maxResults: 2 })).toEqual([
			{ symbol: 'a', value: '3' },
			{ symbol: 'b', value: '4' }
		]);
	});

	it('returns nothing for stdout that printed no results at all', () => {
		expect(parseResultLines('')).toEqual([]);
		expect(parseResultLines('all quiet\nnothing to report\n')).toEqual([]);
	});

	it('is case sensitive about the keyword', () => {
		expect(parseResultLines('result x = 1\nResult y = 2')).toEqual([]);
	});
});

describe('renderResultTex', () => {
	it('renders a symbol, a value and an upright unit', () => {
		expect(renderResultTex({ symbol: 'R_{th}', value: '12.3', unit: 'K/W' })).toBe(
			'R_{th} = 12.3\\ \\text{K/W}'
		);
	});

	it('omits the unit block entirely when there is no unit', () => {
		expect(renderResultTex({ symbol: 'n', value: '41000' })).toBe('n = 41000');
	});

	it('escapes a unit character that would otherwise be read as TeX', () => {
		expect(renderResultTex({ symbol: 'r', value: '5', unit: '% of full scale' })).toBe(
			'r = 5\\ \\text{\\% of full scale}'
		);
	});

	it('escapes a backslash without escaping the braces its escape introduces', () => {
		expect(renderResultTex({ symbol: 'x', value: '1', unit: 'a\\b' })).toBe(
			'x = 1\\ \\text{a\\textbackslash{}b}'
		);
	});

	it('escapes every character TeX would otherwise act on', () => {
		expect(renderResultTex({ symbol: 'x', value: '1', unit: '{}$&#%_~^' })).toBe(
			'x = 1\\ \\text{\\{\\}\\$\\&\\#\\%\\_\\textasciitilde{}\\textasciicircum{}}'
		);
	});

	it('leaves an ordinary unit alone', () => {
		expect(renderResultTex({ symbol: 'v', value: '3', unit: 'm/s' })).toBe('v = 3\\ \\text{m/s}');
	});
});
