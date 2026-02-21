<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Multigraph from '$lib/components/ui/Multigraph/Multigraph.svelte';
	import { expect } from 'storybook/test';

	const { Story } = defineMeta({
		title: 'Components/Multigraph',
		component: Multigraph,
		tags: [],
		argTypes: {
			multigraphData: { control: 'object' },
			defaultPrimaryNodeId: { control: 'text' }
		}
	});
</script>

<Story name="Single"
	args={{
		multigraphData: {
			nodes: [
				{ id: '1', title: 'Node 1', description: 'Node 1 description' }
			],
			edges: [],
			posByNodeId: {}
		},
		defaultPrimaryNodeId: '1'
	}}
	play={
		async (context) => {
			await expect(
				context.canvas.getByText(context.args.multigraphData.nodes[0].title)
			).toBeInTheDocument();
		}
	}
/>
