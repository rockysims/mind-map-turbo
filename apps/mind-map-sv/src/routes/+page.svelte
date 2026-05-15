<script lang="ts">
	import Multigraph from '$lib/components/ui/Multigraph/Multigraph.svelte';
	import type { MultigraphData } from '$lib/components/ui/types/multigraph';

	const graph: MultigraphData = {
		nodes: [{ id: 'n0', title: 'Node 0', description: 'Description for node 0' }],
		edges: [],
		posByNodeId: { n0: { x: 0, y: 0 } }
	};
</script>

<Multigraph multigraphData={graph} defaultPrimaryNodeId="n0" />
