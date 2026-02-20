<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import type { PageProps } from './$types';

	const { data }: PageProps = $props();
</script>

<h1>Welcome to SvelteKit!</h1>
<p>Visit <a href="https://svelte.dev/docs/kit">svelte.dev/docs/kit</a> to read the documentation</p>
APP_NAME: {data.appName || 'Fallback APP_NAME from page'}<br/>
<br/>
<Button onclick={() => alert('clicked')} class="active:scale-95 active:opacity-90">Click me</Button>
