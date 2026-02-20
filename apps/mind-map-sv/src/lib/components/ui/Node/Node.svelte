<script lang="ts">
	import SquareText from '$lib/components/ui/SquareText/SquareText.svelte';
	import type { NodeData } from '$lib/components/ui/types/node';

	let descriptionRef = $state<HTMLElement | null>(null);

	const {
		nodeData = {
			id: 'id_fallback',
			title: 'title_fallback',
			description: 'description_fallback'
		},
		isOpen = false
	} = $props<{
		nodeData: NodeData;
		isOpen: boolean;
	}>();

	function updateVerticalScrollClass() {
		if (!descriptionRef) return;
		const hasVerticalScrollbar =
			descriptionRef.scrollHeight > descriptionRef.clientHeight;
		if (hasVerticalScrollbar) {
			descriptionRef.classList.add('vScroll');
		} else {
			descriptionRef.classList.remove('vScroll');
		}
	}

	$effect(() => {
		if (!isOpen) return;
		if (descriptionRef) updateVerticalScrollClass();
	});
</script>

<div class="node" class:open={isOpen}>
	<div class="circle">
		<!-- closed -->
		{#if !isOpen}
			<div class="square">
				<SquareText classList={['title']} text={nodeData.title} />
			</div>
		{/if}

		<!-- open -->
		{#if isOpen}
			<div class="square">
				<div class="title">
					{nodeData.title}
				</div>
				<div class="description" bind:this={descriptionRef}>
					{nodeData.description}
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.node .circle {
		display: flex;
		justify-content: center;
		align-items: center;
		width: 400px;
		height: 400px;
		border-radius: 400px;
		border: 2px solid #aaaaaa;
	}

	.node .square {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		text-align: center;
		width: calc(400px / sqrt(2));
		height: calc(400px / sqrt(2));
	}

	.node .title {
		font-weight: bold;
		padding-bottom: 15px;
		text-align: center;
	}

	.node .description {
		display: none;
	}

	.node.open .title {
		overflow: clip;
		text-wrap-mode: nowrap;
		text-overflow: ellipsis;
		width: 100%;
		padding: 0 8px 8px 8px;
	}

	.node.open .description {
		display: flex;
		max-height: 80%;
		padding: 0 8px;
		margin-right: -12px;
		overflow-y: auto;
		text-align: center;
	}

	.node.open .square > * {
		box-sizing: border-box;
	}

	/* vScroll is added at runtime when description has vertical scrollbar */
	.node.open .description.vScroll {
		text-align: left;
		border-radius: 3px;
		box-shadow: 0px 0px 2px 0px #aaaaaa;
	}
</style>
