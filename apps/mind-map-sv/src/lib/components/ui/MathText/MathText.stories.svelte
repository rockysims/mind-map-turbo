<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect } from 'storybook/test';
	import MathText from './MathText.svelte';

	const { Story } = defineMeta({
		title: 'Components/MathText',
		component: MathText,
		tags: [],
		args: {
			text: 'Velocity is $v$, so the position obeys $$x = x_0 + v t$$ over time.'
		},
		argTypes: {
			text: { control: 'text' }
		}
	});

	const PROSE_WITH_NEWLINES = 'First line.\nSecond line.\n\nAfter a blank line.';
	const WIDE_EQUATION =
		'$$\\sum_{i=1}^{n} \\sqrt{\\alpha_i^2 + \\beta_i^2 + \\gamma_i^2 + \\delta_i^2 + \\epsilon_i^2 + \\zeta_i^2}$$';

	function mathText(canvasElement: HTMLElement): HTMLElement {
		const root = canvasElement.querySelector('[data-math-text]');
		if (!(root instanceof HTMLElement)) {
			throw new Error('MathText root not found');
		}
		return root;
	}
</script>

<Story
	name="RendersInlineAndDisplayMathAroundText"
	play={async ({ canvasElement }) => {
		const root = mathText(canvasElement);

		expect(root.querySelectorAll('[data-segment="inline-math"] math')).toHaveLength(1);
		expect(root.querySelectorAll('[data-segment="display-math"] math')).toHaveLength(1);
		expect(root.textContent).toContain('Velocity is');
		expect(root.textContent).toContain('over time.');
	}}
/>

<Story
	name="RendersPlainProseWithNewlinesPreserved"
	args={{ text: PROSE_WITH_NEWLINES }}
	play={async ({ canvasElement }) => {
		const root = mathText(canvasElement);

		expect(root.querySelectorAll('math')).toHaveLength(0);
		expect(root.querySelectorAll('[data-segment]')).toHaveLength(1);
		expect(root.textContent).toBe(PROSE_WITH_NEWLINES);
		expect(getComputedStyle(root.querySelector('[data-segment="text"]')!).whiteSpace).toBe(
			'pre-wrap'
		);
	}}
/>

<Story
	name="AddsNoStrayWhitespaceBetweenAdjacentSegments"
	args={{ text: 'a$x$b$$y$$c' }}
	play={async ({ canvasElement }) => {
		const root = mathText(canvasElement);
		const textSegments = [...root.querySelectorAll('[data-segment="text"]')].map(
			(node) => node.textContent
		);

		// Template whitespace between segments would render as spaces the author
		// never typed, so the text runs must come back exactly as written.
		expect(textSegments).toEqual(['a', 'b', 'c']);
	}}
/>

<Story
	name="KeepsSurroundingTextWhenAnExpressionIsInvalid"
	args={{ text: 'Before $$\\frac{1}{$$ after.' }}
	play={async ({ canvasElement }) => {
		const root = mathText(canvasElement);

		expect(root.querySelector('[data-math-error="true"]')).toBeTruthy();
		expect(root.querySelector('.temml-error')).toBeTruthy();
		expect(root.textContent).toContain('Before');
		expect(root.textContent).toContain('after.');
	}}
/>

<Story
	name="LeavesEscapedDollarsAsLiteralText"
	args={{ text: 'It costs \\$5, not \\$9.' }}
	play={async ({ canvasElement }) => {
		const root = mathText(canvasElement);

		expect(root.querySelectorAll('math')).toHaveLength(0);
		expect(root.textContent).toBe('It costs $5, not $9.');
	}}
/>

<Story name="ScalesAnOverWideDisplayEquationToFit" args={{ text: WIDE_EQUATION }}>
	{#snippet template(args)}
		<div class="narrow-column">
			<MathText {...args} />
		</div>
	{/snippet}
</Story>

<Story
	name="ScalesAnOverWideDisplayEquationToFitItsColumn"
	args={{ text: WIDE_EQUATION }}
	play={async ({ canvasElement }) => {
		// Glyph widths depend on the math font, so measuring before it loads would
		// compare against the fallback rather than what the reader sees.
		await document.fonts.ready;

		const root = mathText(canvasElement);
		const wrapper = root.querySelector('[data-segment="display-math"]');
		const inner = wrapper?.firstElementChild;
		if (!(wrapper instanceof HTMLElement) || !(inner instanceof HTMLElement)) {
			throw new Error('display math wrapper not found');
		}

		expect(inner.scrollWidth).toBeGreaterThan(wrapper.clientWidth);
		expect(inner.style.transform).toMatch(/^scale\(0\./);
		// Scaled to fit rather than clipped: the visible box stays inside the column.
		expect(inner.getBoundingClientRect().width).toBeLessThanOrEqual(
			wrapper.getBoundingClientRect().width + 1
		);
	}}
>
	{#snippet template(args)}
		<div class="narrow-column">
			<MathText {...args} />
		</div>
	{/snippet}
</Story>

<style>
	.narrow-column {
		/* Narrow enough that the sample equation overflows on any platform's math
		   font, so the story exercises scaling rather than depending on metrics. */
		width: 120px;
		border: 1px solid #cbd5e1;
		padding: 0.5rem;
	}
</style>
