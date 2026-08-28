import { describe, expect, it } from 'vitest';
import { hasMath, splitMathSegments } from './mathSegments';

describe('splitMathSegments', () => {
	it('returns a single text segment for a description with no math', () => {
		const description = 'Just prose, no math here.';
		expect(splitMathSegments(description)).toEqual([
			{ kind: 'text', content: description, source: description }
		]);
	});

	it('preserves newlines in text so pre-wrap rendering is unchanged', () => {
		const description = 'first line\nsecond line';
		expect(splitMathSegments(description)).toEqual([
			{ kind: 'text', content: description, source: description }
		]);
	});

	it('returns no segments for an empty description', () => {
		expect(splitMathSegments('')).toEqual([]);
	});

	it('extracts a display expression and strips its delimiters', () => {
		expect(splitMathSegments('$$v = v_0 + a t$$')).toEqual([
			{ kind: 'display-math', content: 'v = v_0 + a t', source: '$$v = v_0 + a t$$' }
		]);
	});

	it('extracts an inline expression and strips its delimiters', () => {
		expect(splitMathSegments('$\\alpha$')).toEqual([
			{ kind: 'inline-math', content: '\\alpha', source: '$\\alpha$' }
		]);
	});

	it('matches the display delimiter before the inline one', () => {
		const segments = splitMathSegments('$$a$$');
		expect(segments).toEqual([{ kind: 'display-math', content: 'a', source: '$$a$$' }]);
	});

	it('splits surrounding text, inline math, and display math in order', () => {
		expect(splitMathSegments('Given $x$, we get:\n$$y = 2x$$\ndone')).toEqual([
			{ kind: 'text', content: 'Given ', source: 'Given ' },
			{ kind: 'inline-math', content: 'x', source: '$x$' },
			{ kind: 'text', content: ', we get:\n', source: ', we get:\n' },
			{ kind: 'display-math', content: 'y = 2x', source: '$$y = 2x$$' },
			{ kind: 'text', content: '\ndone', source: '\ndone' }
		]);
	});

	it('handles adjacent inline expressions with no gap between them', () => {
		expect(splitMathSegments('$a$$b$')).toEqual([
			{ kind: 'inline-math', content: 'a', source: '$a$' },
			{ kind: 'inline-math', content: 'b', source: '$b$' }
		]);
	});

	it('handles adjacent display expressions with no gap between them', () => {
		expect(splitMathSegments('$$a$$$$b$$')).toEqual([
			{ kind: 'display-math', content: 'a', source: '$$a$$' },
			{ kind: 'display-math', content: 'b', source: '$$b$$' }
		]);
	});

	it('treats an empty display expression as an empty math segment', () => {
		expect(splitMathSegments('$$$$')).toEqual([
			{ kind: 'display-math', content: '', source: '$$$$' }
		]);
	});

	it('leaves an escaped dollar as literal text without opening a segment', () => {
		expect(splitMathSegments('costs \\$5 today')).toEqual([
			{ kind: 'text', content: 'costs $5 today', source: 'costs \\$5 today' }
		]);
	});

	it('does not let a pair of escaped dollars form a math segment', () => {
		const segments = splitMathSegments('\\$5 and \\$9');
		expect(segments).toEqual([{ kind: 'text', content: '$5 and $9', source: '\\$5 and \\$9' }]);
	});

	it('ignores an escaped dollar when looking for the closing delimiter', () => {
		expect(splitMathSegments('$a \\$ b$')).toEqual([
			{ kind: 'inline-math', content: 'a \\$ b', source: '$a \\$ b$' }
		]);
	});

	it('treats a delimiter after an escaped backslash as a real delimiter', () => {
		expect(splitMathSegments('$x\\\\$')).toEqual([
			{ kind: 'inline-math', content: 'x\\\\', source: '$x\\\\$' }
		]);
	});

	it('leaves an unterminated inline delimiter as literal text', () => {
		const description = 'costs 5 $ per unit';
		expect(splitMathSegments(description)).toEqual([
			{ kind: 'text', content: description, source: description }
		]);
	});

	it('leaves an unterminated display delimiter as literal text', () => {
		const description = 'opens $$a but never closes';
		expect(splitMathSegments(description)).toEqual([
			{ kind: 'text', content: description, source: description }
		]);
	});

	it('does not consume to the end of the string on an unterminated delimiter', () => {
		const segments = splitMathSegments('$x$ then a stray $ and more text');
		expect(segments).toEqual([
			{ kind: 'inline-math', content: 'x', source: '$x$' },
			{
				kind: 'text',
				content: ' then a stray $ and more text',
				source: ' then a stray $ and more text'
			}
		]);
	});

	it('excludes delimiter characters from every math segment content', () => {
		const segments = splitMathSegments('$a$ and $$b$$');
		const mathContents = segments
			.filter((segment) => segment.kind !== 'text')
			.map((segment) => segment.content);
		expect(mathContents).toEqual(['a', 'b']);
	});

	it.each([
		'',
		'no math at all',
		'$a$',
		'$$a$$',
		'$a$$b$',
		'$$a$$$$b$$',
		'costs \\$5 today',
		'$a \\$ b$',
		'opens $$a but never closes',
		'trailing $ dollar',
		'$$$$',
		'Given $x$, we get:\n$$y = 2x$$\ndone'
	])('reproduces the original description by concatenating sources: %j', (description) => {
		const rejoined = splitMathSegments(description)
			.map((segment) => segment.source)
			.join('');
		expect(rejoined).toBe(description);
	});
});

describe('hasMath', () => {
	it('is false for prose without delimiters', () => {
		expect(hasMath('no math at all')).toBe(false);
	});

	it('is false when the only dollars are escaped', () => {
		expect(hasMath('costs \\$5 today')).toBe(false);
	});

	it('is false for an unterminated delimiter', () => {
		expect(hasMath('opens $$a but never closes')).toBe(false);
	});

	it('is true for inline math', () => {
		expect(hasMath('a $x$ b')).toBe(true);
	});

	it('is true for display math', () => {
		expect(hasMath('a $$x$$ b')).toBe(true);
	});
});
