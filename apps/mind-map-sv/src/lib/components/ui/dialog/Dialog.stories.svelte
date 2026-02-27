<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import DialogDemo from './DialogDemo.svelte';

	const { Story } = defineMeta({
		title: 'Components/Dialog',
		component: DialogDemo,
		tags: []
	});
</script>

<Story name="Closed">
	<DialogDemo />
</Story>

<Story name="Open">
	<DialogDemo initialOpen={true} />
</Story>
