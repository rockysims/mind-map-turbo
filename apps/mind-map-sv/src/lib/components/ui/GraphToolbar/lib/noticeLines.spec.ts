import { describe, expect, it } from 'vitest';
import { noticeLines } from './noticeLines';

describe('noticeLines', () => {
	it('stacks a two-sentence notice as two lines', () => {
		expect(noticeLines('Draft cached in this browser. Save to keep it.')).toEqual([
			'Draft cached in this browser.',
			'Save to keep it.'
		]);
	});

	it('keeps a single-sentence notice on one line', () => {
		expect(noticeLines('Caching draft...')).toEqual(['Caching draft...']);
	});

	it('keeps a filename intact because its dot is not followed by whitespace', () => {
		expect(noticeLines('Saved active.html. Check your downloads.')).toEqual([
			'Saved active.html.',
			'Check your downloads.'
		]);
	});

	it('splits the blocked-storage warning into its two sentences', () => {
		expect(noticeLines('Caching is blocked here. Save to a file to keep it.')).toEqual([
			'Caching is blocked here.',
			'Save to a file to keep it.'
		]);
	});

	it('renders a blank notice as one blank line so the status region stays mounted', () => {
		expect(noticeLines('')).toEqual(['']);
		expect(noticeLines('   ')).toEqual(['']);
	});
});
