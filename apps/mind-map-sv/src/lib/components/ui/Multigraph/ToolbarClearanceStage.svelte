<script lang="ts">
	/**
	 * The page's real arrangement for a sheet story: the graph toolbar fixed at
	 * the top, publishing its measured `--graph-toolbar-clearance`, over a stage
	 * that fills the viewport the way the canvas does. A story renders a sheet or
	 * dialog inside, then asserts it stops below the toolbar's actual box.
	 *
	 * The notice is the app's longest two-sentence one, so on a phone the toolbar
	 * wraps to its full height — the case a guessed clearance got wrong.
	 */
	import type { Snippet } from 'svelte';
	import GraphToolbar from '../GraphToolbar/GraphToolbar.svelte';

	let { children }: { children: Snippet } = $props();
</script>

<GraphToolbar notice="Draft cached in this browser. Save to keep it." />
<div class="stage" data-clearance-stage>
	{@render children()}
</div>

<style>
	.stage {
		position: fixed;
		inset: 0;
		background: #f8fafc;
	}
</style>
