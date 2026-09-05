import { describe, expect, it } from 'vitest';
import { formatByteSize } from './byteSize';

describe('formatByteSize', () => {
	it.each([
		[0, '0 B'],
		[1, '1 B'],
		[512, '512 B'],
		[1023, '1023 B'],
		[1024, '1 KB'],
		[1536, '1.5 KB'],
		[1024 * 1024, '1 MB'],
		[5 * 1024 * 1024, '5 MB'],
		[1024 * 1024 * 1024, '1 GB'],
		[1024 ** 4, '1 TB'],
		// Past the largest unit the scale stops rather than inventing one.
		[1024 ** 5, '1024 TB']
	])('formats %i bytes as %s', (bytes, expected) => {
		expect(formatByteSize(bytes)).toBe(expected);
	});

	it('steps up a unit when rounding would otherwise read as 1024 of the smaller one', () => {
		expect(formatByteSize(1024 * 1024 - 1)).toBe('1 MB');
	});

	it('reads a missing or nonsensical size as zero rather than refusing to draw', () => {
		expect(formatByteSize(-1)).toBe('0 B');
		expect(formatByteSize(Number.NaN)).toBe('0 B');
		expect(formatByteSize(Number.POSITIVE_INFINITY)).toBe('0 B');
	});
});
