<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import SquareText from '$lib/components/ui/SquareText/SquareText.svelte';
	import { expect, waitFor } from 'storybook/test';

	const { Story } = defineMeta({
		title: 'Components/SquareText',
		component: SquareText,
		tags: [],
		args: {
			text: 'Default text',
			classList: ['title']
		},
		argTypes: {
			text: { control: 'text' },
			classList: { control: 'object' }
		}
	});

	const defaultArgsShort = { text: 'Short', classList: ['title'] };
	const defaultArgsLong = {
		text: 'Long: This is a much longer string of text that should force the SquareText component to grow and potentially scale to fit inside its container.',
		classList: ['title']
	};
	const defaultArgsSummary = {
		text: 'Summary: This is a much longer string of text that should force the SquareText component to grow and potentially scale to fit inside its container.',
		classList: ['title']
	};
</script>

<script lang="ts">
	let retitleText = $state('i');
</script>

<Story name="Summary" args={defaultArgsSummary}>
	{#snippet template(args)}
		<div class="outerContainer">
			<div class="innerContainer">
				<SquareText {...args} text={defaultArgsShort.text} />
			</div>
			<br />
		</div>
		<div class="outerContainer">
			<div class="innerContainer">
				<SquareText {...args} text={defaultArgsLong.text} />
			</div>
			<br />
		</div>
		<div class="outerContainer">
			<div class="innerContainer big">
				<SquareText {...args} />
			</div>
			<br />
		</div>
	{/snippet}
</Story>

<Story
	args={defaultArgsShort}
	name="Test:Short"
	play={async (context) => {
		await expect(context.canvas.getByText(context.args.text)).toBeInTheDocument();
	}}
/>

<Story
	args={defaultArgsLong}
	name="Test:Long"
	play={async (context) => {
		await expect(context.canvas.getByText(context.args.text)).toBeInTheDocument();
	}}
/>

<Story
	args={{ text: 'Text without math', classList: ['title'] }}
	name="Test:TextWithoutMathStaysOnThePlainPath"
	play={async (context) => {
		// The math renderer is an opt-in for content that needs it. A title with no
		// math must be the same DOM it has always been, so nothing about its
		// existing fit or styling can shift under this feature.
		await expect(context.canvas.getByText(context.args.text)).toBeInTheDocument();
		await expect(context.canvasElement.querySelector('[data-math-text]')).toBeNull();
	}}
/>

<Story
	args={{ text: '$E = mc^2$', classList: ['title'] }}
	name="Test:MathTitleRendersAsMath"
	play={async (context) => {
		const math = context.canvasElement.querySelector('math');
		await expect(math).not.toBeNull();
		// Typeset, not the source: seeing the delimiters means the title fell back
		// to raw LaTeX.
		await expect(context.canvasElement.textContent).not.toContain('$');
	}}
/>

<Story
	args={{ text: '$\\mathscr{F} = m a$', classList: ['title'] }}
	name="Test:MathTitleFitsItsSquareOnceFontsLoad"
	play={async (context) => {
		// \mathscr forces Temml's own face, which is fetched only when a glyph needs
		// it. The first fit is therefore measured in a fallback and is wrong; this
		// asserts the re-fit that corrects it.
		await document.fonts.ready;

		const fitted = context.canvasElement.querySelector('.squareText');
		const container = context.canvasElement.querySelector('.innerContainer');
		await expect(fitted).not.toBeNull();
		await expect(container).not.toBeNull();

		await waitFor(() => {
			const box = (fitted as HTMLElement).getBoundingClientRect();
			const bounds = (container as HTMLElement).getBoundingClientRect();
			// Sub-pixel slack: the fit lands on whole pixels, so an exact comparison
			// would flake on fractional layout.
			expect(box.width).toBeLessThanOrEqual(bounds.width + 1);
			expect(box.height).toBeLessThanOrEqual(bounds.height + 1);
		});
	}}
>
	{#snippet template(args)}
		<div class="outerContainer">
			<div class="innerContainer">
				<SquareText {...args} />
			</div>
		</div>
	{/snippet}
</Story>

<Story
	args={{ text: 'Speed $v$', classList: ['title'] }}
	name="Test:MathMixesWithProseInATitle"
	play={async (context) => {
		await expect(context.canvasElement.querySelector('math')).not.toBeNull();
		await expect(context.canvasElement.textContent).toContain('Speed');
	}}
/>

<Story
	name="Test:RefitsWhenTheTextChanges"
	play={async (context) => {
		// The fit effect used to track only the element binding, so a retitle kept
		// the size found for the previous string. Titles change often now that they
		// can hold math, which is how that would have surfaced.
		const fitted = context.canvasElement.querySelector('.squareText') as HTMLElement;
		const before = fitted.offsetWidth;

		(context.canvasElement.querySelector('[data-retitle]') as HTMLElement).click();

		await waitFor(() => {
			expect(fitted.offsetWidth).not.toBe(before);
		});
	}}
>
	{#snippet template()}
		<div class="outerContainer">
			<div class="innerContainer">
				<SquareText text={retitleText} classList={['title']} />
			</div>
			<!--
				Both strings are math-free on purpose. Crossing into math would also
				trip the font effect, which calls setSize too, and the test would pass
				whether or not the fit tracks the text.
			-->
			<button
				type="button"
				data-retitle
				onclick={() => (retitleText = 'A considerably longer replacement title')}
			>
				retitle
			</button>
		</div>
	{/snippet}
</Story>

<style>
	.innerContainer {
		border: 1px solid red;
		width: 100px;
		height: 100px;
	}
	.innerContainer.big {
		width: 200px;
		height: 200px;
	}
	.outerContainer {
		display: flex;
		flex-direction: column;
		align-items: center;
	}
</style>
