import { describe, expect, it } from 'vitest';
import { attachmentSizeWarning } from './attachmentSizeWarning';

describe('attachmentSizeWarning', () => {
	it('names the file, what it costs a saved copy, and asks', () => {
		expect(attachmentSizeWarning({ name: 'clip.mp4', size: 30 * 1024 * 1024 })).toBe(
			'clip.mp4 — this file adds about 40 MB to every saved copy of this document. ' +
				'Attach it anyway?'
		);
	});

	it('quotes the base64 cost rather than the size on disk', () => {
		// 3 MB of bytes is 4 MB of base64, and the 4 MB is what a save pays.
		const message = attachmentSizeWarning({ name: 'sweep.csv', size: 3 * 1024 * 1024 });

		expect(message).toContain('about 4 MB');
		expect(message).not.toContain('3 MB');
	});

	it('rounds a fractional byte up rather than down', () => {
		// 10 × 4 / 3 is 13.3; the sentence says "about", and a size is a whole
		// number of bytes either way.
		expect(attachmentSizeWarning({ name: 'tiny.bin', size: 10 })).toContain('about 14 B');
	});
});
