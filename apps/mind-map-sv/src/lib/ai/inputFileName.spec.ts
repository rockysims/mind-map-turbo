import { describe, expect, it } from 'vitest';
import { executorInputName } from './inputFileName';

describe('executorInputName', () => {
	it('leaves an ordinary filename alone', () => {
		expect(executorInputName('sweep-02.csv')).toBe('sweep-02.csv');
	});

	it('keeps only the basename, whichever separator the filesystem used', () => {
		expect(executorInputName('bench/2026-09/sweep.csv')).toBe('sweep.csv');
		expect(executorInputName('C:\\bench\\sweep.csv')).toBe('sweep.csv');
	});

	it('trims the surrounding whitespace a pasted name carries', () => {
		expect(executorInputName('  sweep.csv \n')).toBe('sweep.csv');
	});

	it('substitutes a name for anything that would not be a file', () => {
		expect(executorInputName('')).toBe('input');
		expect(executorInputName('   ')).toBe('input');
		expect(executorInputName('.')).toBe('input');
		expect(executorInputName('data/..')).toBe('input');
		expect(executorInputName('outputs/')).toBe('input');
	});
});
