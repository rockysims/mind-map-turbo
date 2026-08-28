import { describe, expect, it } from 'vitest';
import { mathPlainText } from './mathPlainText';

describe('mathPlainText without math', () => {
	it('returns a plain string by identity', () => {
		const text = 'Just a title';
		// Identity, not equality: every visible node projects its title, so the
		// common case must allocate nothing.
		expect(mathPlainText(text)).toBe(text);
	});

	it('returns an empty string by identity', () => {
		const text = '';
		expect(mathPlainText(text)).toBe(text);
	});
});

describe('mathPlainText with math', () => {
	it('projects an all-math title', () => {
		expect(mathPlainText('$v$')).toBe('v');
	});

	it('projects math mixed with prose', () => {
		expect(mathPlainText('Velocity $v$ over time')).toBe('Velocity v over time');
	});

	it('resolves a command to the character a person would say', () => {
		expect(mathPlainText('$\\alpha$')).toBe('α');
	});

	it('keeps a subscript readable', () => {
		expect(mathPlainText('$v_0$')).toBe('v0');
	});

	it('projects an equation with its operators', () => {
		expect(mathPlainText('$F = ma$')).toBe('F=ma');
	});

	it('projects display math the same as inline', () => {
		expect(mathPlainText('$$F = ma$$')).toBe(mathPlainText('$F = ma$'));
	});

	it('projects several math runs in one string', () => {
		expect(mathPlainText('from $a$ to $b$')).toBe('from a to b');
	});
});

describe('mathPlainText invisible operators', () => {
	// These render as nothing but would survive into an accessible name and make
	// an exact search match fail for no visible reason.
	it('strips the function application operator', () => {
		expect(mathPlainText('$\\sin x$')).not.toContain('\u2061');
		expect(mathPlainText('$\\sin x$')).toBe('sinx');
	});

	it('strips invisible times from an implicit product', () => {
		const projected = mathPlainText('$2x$');
		expect(projected).not.toContain('\u2062');
		expect(projected).toBe('2x');
	});
});

describe('mathPlainText with unparseable math', () => {
	it('falls back to the source the author typed', () => {
		expect(mathPlainText('$\\frac{1}{$')).toBe('\\frac{1}{');
	});

	it('keeps surrounding prose when math fails', () => {
		expect(mathPlainText('before $\\frac{1}{$ after')).toBe('before \\frac{1}{ after');
	});

	it('renders a soft error as its text rather than dropping it', () => {
		// Temml renders an unknown command as visible red text rather than failing,
		// so the projection should carry that text instead of losing the run.
		expect(mathPlainText('$\\notarealcommand$')).toContain('notarealcommand');
	});
});

describe('mathPlainText escaping', () => {
	it('treats an escaped dollar as literal text', () => {
		expect(mathPlainText('costs \\$5')).toBe('costs $5');
	});

	it('projects math that follows an escaped dollar', () => {
		expect(mathPlainText('\\$5 and $v$')).toBe('$5 and v');
	});
});
