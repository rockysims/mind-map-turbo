<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import SquareText from '$lib/components/ui/SquareText/SquareText.svelte';
	import { expect } from 'storybook/test';

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

<Story name="Summary" args={defaultArgsSummary}>
	{#snippet template(args)}
	<div class="outerContainer">
		<div class="innerContainer">
			<SquareText {...args} text={defaultArgsShort.text} />
		</div>
		<br/>
	</div>
	<div class="outerContainer">
		<div class="innerContainer">
			<SquareText {...args} text={defaultArgsLong.text} />
		</div>
		<br/>
	</div>
	<div class="outerContainer">
		<div class="innerContainer big">
			<SquareText {...args} />
		</div>
		<br/>
	</div>
   {/snippet}
</Story>

<Story
	args={defaultArgsShort}
	name="Test:Short"
	play={
		async (context) => {
			await expect(
				context.canvas.getByText(context.args.text)
			).toBeInTheDocument();
		}
	}
/>

<Story
	args={defaultArgsLong}
	name="Test:Long"
	play={
		async (context) => {
			await expect(
				context.canvas.getByText(context.args.text)
			).toBeInTheDocument();
		}
	}
/>
