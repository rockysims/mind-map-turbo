<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import SonnerDemo from './SonnerDemo.svelte';

	const { Story } = defineMeta({
		title: 'Example/Sonner',
		component: SonnerDemo,
		tags: []
	});
</script>

<Story name="Example">
	<SonnerDemo />
</Story>
