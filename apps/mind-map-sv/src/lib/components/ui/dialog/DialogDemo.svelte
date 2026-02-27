<script lang="ts">
	import * as Dialog from './index.js';
	let { initialOpen }: { initialOpen?: boolean } = $props();
	let open = $state((() => initialOpen ?? false)());
	// let open = true;
	//TODO: figure out why initialOpen is not working
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger>Open dialog</Dialog.Trigger>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Dialog title</Dialog.Title>
			<Dialog.Description>
				Placeholder description for the dialog in Storybook.
			</Dialog.Description>
		</Dialog.Header>
	</Dialog.Content>
</Dialog.Root>
