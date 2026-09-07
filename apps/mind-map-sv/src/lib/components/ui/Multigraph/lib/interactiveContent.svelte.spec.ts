/**
 * The interactive-content rule, over real elements.
 *
 * The `.svelte.spec.ts` suffix is what puts a spec in the `client` Vitest
 * project, the one that runs in Chromium: the rule is `Element.closest` against
 * a selector, and there is no honest way to check a selector without a DOM to
 * match it in.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { startsOnInteractiveContent } from './interactiveContent';

function render(html: string): HTMLElement {
	const host = document.createElement('div');
	host.innerHTML = html;
	document.body.append(host);
	return host;
}

function target(html: string, selector: string): Element {
	const found = render(html).querySelector(selector);
	if (found === null) throw new Error(`no ${selector} in the fixture`);
	return found;
}

afterEach(() => {
	document.body.replaceChildren();
});

describe('startsOnInteractiveContent', () => {
	it('claims every control a press can act on by itself', () => {
		const cases: [string, string][] = [
			['<button>Run</button>', 'button'],
			['<a href="#x">Open</a>', 'a'],
			['<input />', 'input'],
			['<textarea></textarea>', 'textarea'],
			['<select><option>one</option></select>', 'select'],
			['<label>Rows<input /></label>', 'label'],
			['<div contenteditable="true">notes</div>', '[contenteditable]']
		];

		for (const [html, selector] of cases) {
			expect(startsOnInteractiveContent(target(html, selector))).toBe(true);
		}
	});

	it('claims a disclosure, which is the press deep zoom used to swallow', () => {
		// A captured pointerdown retargets the click at the zoom world, so a
		// `<summary>` inside focus never opened its details. The whole disclosure
		// counts, not just its summary: a press in an open panel is a press on
		// content the reader opened deliberately.
		const html = '<details open><summary>What Claude will see</summary><pre>rows</pre></details>';
		expect(startsOnInteractiveContent(target(html, 'summary'))).toBe(true);
		expect(startsOnInteractiveContent(target(html, 'pre'))).toBe(true);
		expect(startsOnInteractiveContent(target(html, 'details'))).toBe(true);
	});

	it('claims a press on anything inside a control, not just the control itself', () => {
		expect(startsOnInteractiveContent(target('<button><span>Run</span></button>', 'span'))).toBe(
			true
		);
	});

	it('leaves plain content, and no element at all, to the world', () => {
		expect(startsOnInteractiveContent(target('<p>Prompt</p>', 'p'))).toBe(false);
		expect(startsOnInteractiveContent(target('<div><img alt="plot" /></div>', 'img'))).toBe(false);
		expect(startsOnInteractiveContent(null)).toBe(false);
		expect(startsOnInteractiveContent(document.createTextNode('text'))).toBe(false);
	});
});
