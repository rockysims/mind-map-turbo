/**
 * Splits a toolbar notice into the sentences it is written as, so the toolbar
 * can stack them instead of stretching into one long line.
 *
 * Only sentence punctuation followed by whitespace ends a line: filenames like
 * `active.html` have to stay in one piece. A notice with no sentence break
 * comes back as a single line, and a blank notice as one blank line so the
 * status region still renders and can announce later updates.
 */
export function noticeLines(notice: string): string[] {
	const lines = notice
		.replace(/([.!?])\s+/g, '$1\n')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '');
	return lines.length > 0 ? lines : [''];
}
