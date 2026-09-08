import { describe, expect, it } from 'vitest';
import { disambiguateExecutorNames, executorInputName } from './inputFileName';

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

	it('steps a file called outputs aside, because that name is the output directory', () => {
		expect(executorInputName('outputs')).toBe('outputs.input');
		// Only the exact name collides; the runtime's filesystem is case-sensitive.
		expect(executorInputName('outputs.csv')).toBe('outputs.csv');
		expect(executorInputName('Outputs')).toBe('Outputs');
	});

	it('substitutes a name for anything that would not be a file', () => {
		expect(executorInputName('')).toBe('input');
		expect(executorInputName('   ')).toBe('input');
		expect(executorInputName('.')).toBe('input');
		expect(executorInputName('data/..')).toBe('input');
		expect(executorInputName('outputs/')).toBe('input');
	});
});

describe('disambiguateExecutorNames', () => {
	it('sanitises every name and leaves a list with no repeats alone', () => {
		expect(disambiguateExecutorNames(['bench/sweep.csv', '  notes.txt ', 'outputs'])).toEqual([
			'sweep.csv',
			'notes.txt',
			'outputs.input'
		]);
	});

	it('keeps the first occurrence and numbers the repeats before the extension', () => {
		expect(disambiguateExecutorNames(['plot.png', 'plot.png', 'plot.png'])).toEqual([
			'plot.png',
			'plot-2.png',
			'plot-3.png'
		]);
	});

	it('numbers repeats that only collide once they are sanitised', () => {
		// An attachment carrying a directory and a run output written under the
		// bare name are the same name by the time either reaches the runtime.
		expect(disambiguateExecutorNames(['run-a/clean.csv', 'clean.csv'])).toEqual([
			'clean.csv',
			'clean-2.csv'
		]);
	});

	it('steps past a suffixed name that a later original asks for', () => {
		expect(disambiguateExecutorNames(['plot.png', 'plot.png', 'plot-2.png'])).toEqual([
			'plot.png',
			'plot-2.png',
			'plot-2-2.png'
		]);
	});

	it('suffixes a name with no extension, and a dotfile, at the end', () => {
		expect(disambiguateExecutorNames(['README', 'README'])).toEqual(['README', 'README-2']);
		expect(disambiguateExecutorNames(['.env', '.env'])).toEqual(['.env', '.env-2']);
	});

	it('keeps the last dot as the extension, so a double extension survives', () => {
		expect(disambiguateExecutorNames(['archive.tar.gz', 'archive.tar.gz'])).toEqual([
			'archive.tar.gz',
			'archive.tar-2.gz'
		]);
	});

	it('depends on the order and on nothing else', () => {
		const names = ['plot.png', 'clean.csv', 'plot.png'];
		expect(disambiguateExecutorNames(names)).toEqual(disambiguateExecutorNames([...names]));
		expect(disambiguateExecutorNames(['plot.png', 'plot.png'])).toEqual(['plot.png', 'plot-2.png']);
	});

	it('answers an empty list with an empty list', () => {
		expect(disambiguateExecutorNames([])).toEqual([]);
	});
});
