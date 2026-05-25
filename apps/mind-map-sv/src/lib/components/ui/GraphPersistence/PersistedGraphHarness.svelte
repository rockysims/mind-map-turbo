<script lang="ts">
	import { onMount } from 'svelte';
	import { APP_CONFIG } from '$lib/appConfig';
	import { makeGraph } from '$lib/components/ui/Multigraph/lib/testFixtures';
	import Multigraph from '$lib/components/ui/Multigraph/Multigraph.svelte';
	import GraphToolbar from '$lib/components/ui/GraphToolbar/GraphToolbar.svelte';
	import type { LayoutSettings } from '$lib/components/ui/Multigraph/lib/layoutSettings';
	import type { MultigraphData } from '$lib/components/ui/types/multigraph';
	import { DEFAULT_GRAPH_ID } from '$lib/graphRoute';
	import { graphStorageKey } from '$lib/persistence';
	import { SaveScheduler } from '$lib/saveScheduler';
	import { InMemoryPersistence } from './inMemoryPersistence';
	import { usePersistedGraph } from './usePersistedGraph.svelte';

	let {
		initialGraphId = DEFAULT_GRAPH_ID,
		graphs = {},
		layoutSettings = {}
	}: {
		initialGraphId?: string;
		graphs?: Record<string, MultigraphData>;
		layoutSettings?: Partial<LayoutSettings>;
	} = $props();

	let now = 0;
	const namespace = `storybook-${initialGraphIdAtMount()}`;
	const persistence = new InMemoryPersistence(graphsAtMount(), () => {
		now += 1;
		return now;
	});
	let routedGraphId = $state(initialGraphIdAtMount());
	const persisted = usePersistedGraph({
		persistence,
		createScheduler: (onStatus) =>
			new SaveScheduler({
				persistence,
				debounceMs: 0,
				now: () => {
					now += 1;
					return now;
				},
				estimateUsageBytes: () => 0,
				quotaBudgetBytes: APP_CONFIG.persistence.quotaBudgetBytes,
				quotaWarningRatio: APP_CONFIG.persistence.quotaWarningRatio,
				onStatus
			}),
		createDefaultGraph,
		navigate: async (graphId) => {
			routedGraphId = graphId;
			await persisted.load(graphId, { flushCurrent: false });
		},
		storageNamespace: namespace,
		createGraphId: () => 'graph-new'
	});

	const graphIds = $derived(persisted.graphSummaries.map((summary) => summary.id).join(','));
	const primaryTitle = $derived(persisted.graph.nodes[0]?.title ?? '');
	const defaultPrimaryNodeId = $derived(persisted.graph.nodes[0]?.id ?? '');

	onMount(() => {
		void persisted.load(routedGraphId);

		return () => {
			persisted.dispose();
		};
	});

	function createDefaultGraph(): MultigraphData {
		return makeGraph({ nodeCount: 1 });
	}

	function initialGraphIdAtMount(): string {
		return initialGraphId;
	}

	function graphsAtMount(): Record<string, MultigraphData> {
		return graphs;
	}

	function changeGraph(): void {
		persisted.notifyGraphChanged(renamePrimaryNode(persisted.graph, 'Changed Node'));
	}

	async function simulateExternalReload(): Promise<void> {
		const graphId = persisted.loadedGraphId || routedGraphId;
		await persistence.save(graphId, renamePrimaryNode(persisted.graph, 'Externally Reloaded'));
		await persisted.handleStorageEvent({ key: graphStorageKey(namespace, graphId) });
	}

	function renamePrimaryNode(graph: MultigraphData, title: string): MultigraphData {
		return {
			...graph,
			nodes: graph.nodes.map((node, index) => (index === 0 ? { ...node, title } : node))
		};
	}
</script>

<div
	class="harness"
	data-loaded-graph-id={persisted.loadedGraphId}
	data-routed-graph-id={routedGraphId}
	data-notice={persisted.notice}
	data-graph-ids={graphIds}
	data-node-count={persisted.graph.nodes.length}
	data-primary-title={primaryTitle}
	data-graph-generation={persisted.graphGeneration}
	data-scale-animation-duration-ms={layoutSettings.scaleAnimationDurationMs ?? ''}
>
	<GraphToolbar
		selectedGraphId={routedGraphId}
		graphSummaries={persisted.graphSummaries}
		notice={persisted.notice}
		onGraphSelected={(graphId) => void persisted.selectGraph(graphId)}
		onNewGraph={() => void persisted.createGraph()}
		onDeleteGraph={() => void persisted.deleteGraph(routedGraphId)}
	/>

	<div class="harness-actions" aria-label="Story harness controls">
		<button type="button" onclick={changeGraph}>Simulate graph change</button>
		<button type="button" onclick={() => void simulateExternalReload()}>
			Simulate external reload
		</button>
	</div>

	{#key `${persisted.loadedGraphId}:${persisted.graphGeneration}`}
		<Multigraph
			multigraphData={persisted.graph}
			graphGeneration={persisted.graphGeneration}
			{defaultPrimaryNodeId}
			{layoutSettings}
			onMultigraphChange={persisted.notifyGraphChanged}
		/>
	{/key}
</div>

<style>
	.harness {
		position: relative;
		min-height: 100vh;
	}

	.harness-actions {
		position: fixed;
		z-index: 41;
		right: 1rem;
		bottom: 1rem;
		display: flex;
		gap: 0.5rem;
	}
</style>
