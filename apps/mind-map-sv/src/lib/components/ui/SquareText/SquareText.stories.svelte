<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import SquareText from '$lib/components/ui/SquareText/SquareText.svelte';
	import { expect } from 'storybook/test';

	const { Story } = defineMeta({
		title: 'Components/SquareText',
		component: SquareText,
		tags: [],
		argTypes: {
			text: { control: 'text' },
			classList: { control: 'object' }
		}
	});
</script>

<Story name="Short" args={{ text: 'Hello', classList: ['title'] }} play={
	async (context) => {
		await expect(
			context.canvas.getByText(context.args.text)
		).toBeInTheDocument();
	}
} />

<Story
	name="Long"
	args={{
		text: 'This is a much longer piece of text that should force the SquareText component to grow and potentially scale to fit inside its container.',
		classList: ['title']
	}}
	play={
		async (context) => {
			await expect(
				context.canvas.getByText(context.args.text)
			).toBeInTheDocument();
		}
	}
/>
