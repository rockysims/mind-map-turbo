<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, userEvent, waitFor, within } from 'storybook/test';
	import { DBL_CLICK_MS } from '$lib/constants';
	import { makeGraph } from '$lib/components/ui/Multigraph/lib/testFixtures';
	import type { MultigraphData } from '$lib/components/ui/types/multigraph';
	import { parseGraphFileText } from '$lib/graphFile';
	import { CURRENT_SCHEMA_VERSION } from '$lib/migrations';
	import PersistedGraphHarness from './PersistedGraphHarness.svelte';

	const { Story } = defineMeta({
		title: 'Components/GraphPersistence',
		component: PersistedGraphHarness,
		tags: [],
		argTypes: {
			initialGraphId: { control: 'text' },
			graphs: { control: 'object' },
			layoutSettings: { control: 'object' },
			editFreshDefaultRoot: { control: 'boolean' }
		},
		parameters: {
			viewport: {
				defaultViewport: 'phone'
			}
		}
	});

	type PlayContext = {
		canvasElement: HTMLElement;
	};

	function graphWithTitle(title: string, nodeCount = 1): MultigraphData {
		const graph = makeGraph({ nodeCount });
		return {
			...graph,
			nodes: graph.nodes.map((node, index) => (index === 0 ? { ...node, title } : node))
		};
	}

	function getHarness(canvasElement: HTMLElement): HTMLElement {
		const harness = canvasElement.querySelector('.harness');
		if (!(harness instanceof HTMLElement)) throw new Error('Harness not found');
		return harness;
	}

	async function waitForHarnessData(
		canvasElement: HTMLElement,
		name: string,
		value: string
	): Promise<void> {
		const harness = getHarness(canvasElement);
		await waitFor(() => expect(harness.dataset[name]).toBe(value));
	}

	function getCircle(el: HTMLElement, nodeId: string): HTMLElement {
		const circle = el.querySelector(`[data-node-id="${nodeId}"] .circle`);
		if (!circle) throw new Error(`Circle not found for ${nodeId}`);
		return circle as HTMLElement;
	}

	function getNodeWrapper(el: HTMLElement, nodeId: string): HTMLElement {
		const wrapper = el.querySelector(`[data-node-id="${nodeId}"].node-wrapper`);
		if (!wrapper) throw new Error(`Node wrapper not found for ${nodeId}`);
		return wrapper as HTMLElement;
	}

	function getCenter(el: HTMLElement): { x: number; y: number } {
		const rect = el.getBoundingClientRect();
		return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
	}

	function dispatchPointer(
		target: HTMLElement,
		type: 'pointerdown' | 'pointerup',
		clientX: number,
		clientY: number,
		pointerId = 1
	) {
		target.dispatchEvent(
			new PointerEvent(type, {
				clientX,
				clientY,
				pointerId,
				bubbles: true,
				cancelable: true
			})
		);
	}

	async function dispatchDoubleClick(target: HTMLElement, x: number, y: number): Promise<void> {
		dispatchPointer(target, 'pointerdown', x, y);
		dispatchPointer(target, 'pointerup', x, y);
		await new Promise((resolve) => setTimeout(resolve, DBL_CLICK_MS * 0.1));
		dispatchPointer(target, 'pointerdown', x, y);
		dispatchPointer(target, 'pointerup', x, y);
	}

	function waitForLayout(): Promise<void> {
		return new Promise((resolve) => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
		});
	}

	function sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	function queryRevertBanner(canvasElement: HTMLElement): HTMLElement | null {
		return canvasElement.querySelector('.revert-banner');
	}

	/** Import the graph the harness just downloaded, as the toolbar's Import does. */
	async function importDownloadIntoCurrent(canvasElement: HTMLElement): Promise<void> {
		const canvas = within(canvasElement);
		const harness = getHarness(canvasElement);

		await userEvent.click(canvas.getByRole('button', { name: 'Download' }));
		await waitFor(() => expect(harness.dataset.lastDownload).toBeTruthy());
		await userEvent.upload(
			canvas.getByLabelText('Graph file to import'),
			new File([harness.dataset.lastDownload!], 'other-graph.html', { type: 'text/html' })
		);
	}

	/**
	 * Node ids the canvas has actually drawn — the wrappers only, since `Node`
	 * repeats the id on its own root, and never the exiting or reveal-buffer
	 * copies, which are leftovers rather than nodes in the graph.
	 */
	function renderedNodeIds(canvasElement: HTMLElement): string[] {
		return Array.from(
			canvasElement.querySelectorAll(
				'.node-wrapper[data-node-id]:not([data-node-exiting]):not([data-node-reveal-buffer])'
			)
		).map((wrapper) => wrapper.getAttribute('data-node-id') ?? '');
	}

	function waitForFrames(count: number): Promise<void> {
		return new Promise((resolve) => {
			let remaining = count;
			const wait = () => {
				remaining -= 1;
				if (remaining <= 0) {
					resolve();
					return;
				}
				requestAnimationFrame(wait);
			};
			requestAnimationFrame(wait);
		});
	}
</script>

<Story
	name="FreshDefaultGraphStartsPinnedAndTitleEditing"
	args={{
		editFreshDefaultRoot: true
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const harness = getHarness(canvasElement);

		await waitForHarnessData(canvasElement, 'loadedGraphId', 'default');
		expect(harness.dataset.primaryTitle).toBe('Root');

		await waitFor(() => expect(canvasElement.querySelector('.title-input')).toBeInTheDocument());
		const titleInput = canvasElement.querySelector('.title-input') as HTMLInputElement | null;
		expect(titleInput).toBeInTheDocument();
		await waitFor(() => expect(document.activeElement).toBe(titleInput));
		expect(canvasElement.querySelector('[data-node-id="n0"] .node')).toHaveAttribute(
			'data-pinned',
			'true'
		);

		titleInput!.value = 'Fresh idea';
		titleInput!.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
		);

		await waitFor(() =>
			expect(canvasElement.querySelector('.title-input')).not.toBeInTheDocument()
		);
		await waitFor(() => expect(harness.dataset.primaryTitle).toBe('Fresh idea'));
		expect(canvasElement.querySelector('[data-node-id="n0"] .node')).toHaveAttribute(
			'data-pinned',
			'true'
		);
	}}
/>

<Story
	name="ExistingGraphLoadsFromPersistence"
	args={{
		initialGraphId: 'saved',
		graphs: {
			saved: graphWithTitle('Saved Graph')
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const harness = getHarness(canvasElement);

		await waitForHarnessData(canvasElement, 'loadedGraphId', 'saved');
		await expect(harness.dataset.primaryTitle).toBe('Saved Graph');
		await expect(harness.dataset.notice).toBe('Draft saved locally. Download needed.');
	}}
/>

<Story
	name="UserChangesGraphAndItSaves"
	args={{
		initialGraphId: 'editable',
		graphs: {
			editable: graphWithTitle('Editable Graph')
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);
		const harness = getHarness(canvasElement);

		await waitForHarnessData(canvasElement, 'loadedGraphId', 'editable');
		await userEvent.click(canvas.getByRole('button', { name: 'Simulate graph change' }));

		await waitFor(() => expect(harness.dataset.primaryTitle).toBe('Changed Node'));
		await waitFor(() =>
			expect(harness.dataset.notice).toBe('Draft saved locally. Download needed.')
		);
		await expect(harness.dataset.graphIds).toContain('editable');
	}}
/>

<Story
	name="UserCreatesNewGraphInCurrentTab"
	args={{
		initialGraphId: 'default',
		graphs: {
			default: graphWithTitle('Default Graph')
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);
		const harness = getHarness(canvasElement);

		await waitForHarnessData(canvasElement, 'loadedGraphId', 'default');
		await userEvent.click(canvas.getByRole('button', { name: 'New' }));

		await waitForHarnessData(canvasElement, 'loadedGraphId', 'graph-new');
		await expect(harness.dataset.primaryTitle).toBe('Root');
		await expect(harness.dataset.documentStatus).toBe('new-clean');
		await expect(harness.dataset.graphIds).toContain('graph-new');
	}}
/>

<Story
	name="PinningAnimatesWhenGraphEchoesFromPersistence"
	args={{
		initialGraphId: 'animated',
		graphs: {
			animated: makeGraph({
				nodeCount: 4,
				pinned: [0],
				edges: [
					[0, 1],
					[1, 2],
					[2, 3]
				],
				posByNodeId: {
					n0: { x: -420, y: 0 },
					n1: { x: -140, y: 0 },
					n2: { x: 140, y: 0 },
					n3: { x: 420, y: 0 }
				}
			})
		},
		layoutSettings: {
			scaleFalloff: 0.5,
			minScale: 0.2,
			scaleAnimationDurationMs: 120,
			postScaleChangeSettleMaxFrames: 8,
			relaxIterations: 1
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		await waitForHarnessData(canvasElement, 'loadedGraphId', 'animated');
		await waitForLayout();

		const harness = getHarness(canvasElement);
		expect(harness.dataset.graphGeneration).toBe('1');
		expect(harness.dataset.scaleAnimationDurationMs).toBe('120');
		expect(Number(getNodeWrapper(canvasElement, 'n3').dataset.scale)).toBe(0.2);

		const generationBeforePin = harness.dataset.graphGeneration;
		const circle = getCircle(canvasElement, 'n3');
		const center = getCenter(circle);
		await dispatchDoubleClick(circle, center.x, center.y);
		await waitForFrames(2);

		const node = canvasElement.querySelector('[data-node-id="n3"] .node');
		expect(node).toHaveAttribute('data-pinned', 'true');
		expect(harness.dataset.graphGeneration).toBe(generationBeforePin);
		await waitFor(() => {
			expect(canvasElement.querySelector('.graph')).toHaveAttribute(
				'data-scale-animation-active',
				'true'
			);
			const animatedPinnedScale = Number(getNodeWrapper(canvasElement, 'n3').dataset.scale);
			const animatedNeighborScale = Number(getNodeWrapper(canvasElement, 'n2').dataset.scale);
			expect(animatedPinnedScale).toBeGreaterThan(0.2);
			expect(animatedPinnedScale).toBeLessThan(1);
			expect(animatedNeighborScale).toBeLessThan(0.5);
		});

		await sleep(140);
		await waitForLayout();

		expect(Number(getNodeWrapper(canvasElement, 'n3').dataset.scale)).toBe(1);
		expect(Number(getNodeWrapper(canvasElement, 'n2').dataset.scale)).toBe(0.5);
		expect(Number(getNodeWrapper(canvasElement, 'n1').dataset.scale)).toBe(0.5);
	}}
/>

<Story
	name="ExternalStorageEventDoesNotReplaceDirtyGraph"
	args={{
		initialGraphId: 'shared',
		graphs: {
			shared: graphWithTitle('Original Graph')
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);
		const harness = getHarness(canvasElement);

		await waitForHarnessData(canvasElement, 'loadedGraphId', 'shared');
		await userEvent.click(canvas.getByRole('button', { name: 'Simulate external reload' }));

		await waitFor(() =>
			expect(harness.dataset.notice).toBe('Kept local draft; another tab changed this document.')
		);
		await expect(harness.dataset.primaryTitle).toBe('Original Graph');
	}}
/>

<Story
	name="DownloadAndImportRoundTrip"
	args={{
		initialGraphId: 'export-graph',
		graphs: {
			'export-graph': graphWithTitle('Export Me')
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);
		const harness = getHarness(canvasElement);

		await waitForHarnessData(canvasElement, 'loadedGraphId', 'export-graph');
		await expect(harness.dataset.primaryTitle).toBe('Export Me');

		// Download captures HTML into data-last-download without a real browser download.
		await userEvent.click(canvas.getByRole('button', { name: 'Download' }));
		await waitFor(() => expect(harness.dataset.lastDownload).toBeTruthy());
		await expect(harness.dataset.notice).toBe('Matches downloaded file.');

		const exportedHtml = harness.dataset.lastDownload!;
		const parsed = parseGraphFileText(exportedHtml);
		expect(exportedHtml).toContain('mind-map-embedded-graph');
		expect(exportedHtml).toContain(`"schemaVersion": ${CURRENT_SCHEMA_VERSION}`);
		expect(typeof parsed.viewState.panX).toBe('number');
		expect(typeof parsed.viewState.panY).toBe('number');
		expect(typeof parsed.viewState.scale).toBe('number');

		// Import the exported HTML back.
		await userEvent.click(canvas.getByRole('button', { name: 'Import last download' }));

		await waitFor(() => expect(harness.dataset.lastImportResult).toBe('imported'));
		await waitFor(() => expect(harness.dataset.documentStatus).toBe('file-clean'));

		// Graph data is preserved.
		await expect(harness.dataset.primaryTitle).toBe('Export Me');

		// View state is restored from the file.
		expect(harness.dataset.viewPanX).toBe(String(parsed.viewState.panX));
		expect(harness.dataset.viewPanY).toBe(String(parsed.viewState.panY));
		expect(harness.dataset.viewScale).toBe(String(parsed.viewState.scale));
	}}
/>

<Story
	name="ImportInvalidJsonKeepsExistingGraph"
	args={{
		initialGraphId: 'stable',
		graphs: {
			stable: graphWithTitle('Stable Graph')
		},
		simulateImportText: '{ not valid json !!!'
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);
		const harness = getHarness(canvasElement);

		await waitForHarnessData(canvasElement, 'loadedGraphId', 'stable');
		await expect(harness.dataset.primaryTitle).toBe('Stable Graph');

		await userEvent.click(canvas.getByRole('button', { name: 'Import text' }));

		await waitFor(() => expect(harness.dataset.lastImportResult).toBe('invalid'));
		await waitFor(() => expect(harness.dataset.notice).toMatch(/Import failed/));

		// Existing graph is still rendered.
		expect(harness.dataset.primaryTitle).toBe('Stable Graph');
	}}
/>

<Story
	name="ImportConfirmsReplacementOfNonEmptyGraph"
	args={{
		initialGraphId: 'nonempty',
		graphs: {
			nonempty: graphWithTitle('Non-Empty Graph', 3)
		},
		confirmResponse: true
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);
		const harness = getHarness(canvasElement);

		await waitForHarnessData(canvasElement, 'loadedGraphId', 'nonempty');
		await expect(harness.dataset.nodeCount).toBe('3');

		// Download so we have a valid payload to import.
		await userEvent.click(canvas.getByRole('button', { name: 'Download' }));
		await waitFor(() => expect(harness.dataset.lastDownload).toBeTruthy());

		// Import with confirmResponse=true; replacement is confirmed.
		await userEvent.click(canvas.getByRole('button', { name: 'Import last download' }));

		await waitFor(() => expect(harness.dataset.lastImportResult).toBe('imported'));
		await waitFor(() => expect(harness.dataset.documentStatus).toBe('file-clean'));
		expect(harness.dataset.nodeCount).toBe('3');
	}}
/>

<Story
	name="ImportFileFoldsIntoCurrentGraphWithoutRemount"
	args={{
		initialGraphId: 'import-host',
		graphs: {
			'import-host': graphWithTitle('Host Graph', 3)
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);
		const harness = getHarness(canvasElement);

		await waitForHarnessData(canvasElement, 'loadedGraphId', 'import-host');
		await expect(harness.dataset.nodeCount).toBe('3');
		await waitFor(() => expect(renderedNodeIds(canvasElement)).toHaveLength(3));

		// Download so the import has a real graph file to fold in.
		await userEvent.click(canvas.getByRole('button', { name: 'Download' }));
		await waitFor(() => expect(harness.dataset.lastDownload).toBeTruthy());
		const exportedHtml = harness.dataset.lastDownload!;
		const generationBeforeImport = harness.dataset.graphGeneration;

		await userEvent.upload(
			canvas.getByLabelText('Graph file to import'),
			new File([exportedHtml], 'other-graph.html', { type: 'text/html' })
		);

		await waitFor(() => expect(harness.dataset.lastImportIntoCurrent).toBe('imported:3'));

		// Both components are present, and the canvas was never remounted.
		expect(harness.dataset.nodeCount).toBe('6');
		expect(harness.dataset.graphGeneration).toBe(generationBeforeImport);
		expect(harness.dataset.primaryTitle).toBe('Host Graph');

		// The point of the whole exercise: the mounted canvas draws the arrivals,
		// with no reload. Counting the harness's data attributes is not enough —
		// they report what the controller holds, not what the reader can see.
		await waitFor(() => expect(renderedNodeIds(canvasElement)).toHaveLength(6));
		expect(new Set(renderedNodeIds(canvasElement)).size).toBe(6);
		expect(Number(harness.dataset.graphRevision)).toBe(1);
	}}
/>

<Story
	name="ImportOffersARevertNamingWhatArrived"
	args={{
		initialGraphId: 'revert-offer',
		graphs: {
			'revert-offer': graphWithTitle('Host Graph', 3)
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const harness = getHarness(canvasElement);

		await waitForHarnessData(canvasElement, 'loadedGraphId', 'revert-offer');
		expect(queryRevertBanner(canvasElement)).toBeNull();

		await importDownloadIntoCurrent(canvasElement);
		await waitFor(() => expect(harness.dataset.lastImportIntoCurrent).toBe('imported:3'));

		const banner = queryRevertBanner(canvasElement);
		expect(banner).toBeInTheDocument();
		expect(banner).toHaveTextContent('Imported 3 nodes');
		expect(banner).toHaveTextContent('from moments ago');
		expect(harness.dataset.snapshotLabel).toBe('import');
		expect(harness.dataset.snapshotNodeCount).toBe('3');
	}}
/>

<Story
	name="RevertConfirmedRestoresThePreImportGraph"
	args={{
		initialGraphId: 'revert-confirm',
		graphs: {
			'revert-confirm': graphWithTitle('Host Graph', 3)
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);
		const harness = getHarness(canvasElement);

		await waitForHarnessData(canvasElement, 'loadedGraphId', 'revert-confirm');
		await importDownloadIntoCurrent(canvasElement);
		await waitFor(() => expect(harness.dataset.nodeCount).toBe('6'));
		const generationBeforeRevert = harness.dataset.graphGeneration;

		await userEvent.click(canvas.getByRole('button', { name: 'Revert…' }));
		const dialog = canvas.getByRole('dialog');
		expect(dialog).toHaveTextContent('Revert to the graph from moments ago?');
		expect(dialog).toHaveTextContent('Everything changed since then is lost too');
		await userEvent.click(within(dialog).getByRole('button', { name: 'Revert' }));

		await waitFor(() => expect(harness.dataset.nodeCount).toBe('3'));
		expect(harness.dataset.primaryTitle).toBe('Host Graph');
		expect(Number(harness.dataset.graphGeneration)).toBe(Number(generationBeforeRevert) + 1);
		await waitFor(() => expect(queryRevertBanner(canvasElement)).toBeNull());
		expect(harness.dataset.snapshotLabel).toBe('');
	}}
/>

<Story
	name="RevertCancelledChangesNothing"
	args={{
		initialGraphId: 'revert-cancel',
		graphs: {
			'revert-cancel': graphWithTitle('Host Graph', 3)
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);
		const harness = getHarness(canvasElement);

		await waitForHarnessData(canvasElement, 'loadedGraphId', 'revert-cancel');
		await importDownloadIntoCurrent(canvasElement);
		await waitFor(() => expect(harness.dataset.nodeCount).toBe('6'));
		const generationBeforeCancel = harness.dataset.graphGeneration;

		await userEvent.click(canvas.getByRole('button', { name: 'Revert…' }));
		await userEvent.click(
			within(canvas.getByRole('dialog')).getByRole('button', { name: 'Cancel' })
		);

		await waitFor(() => expect(canvas.queryByRole('dialog')).toBeNull());
		expect(harness.dataset.nodeCount).toBe('6');
		expect(harness.dataset.graphGeneration).toBe(generationBeforeCancel);
		// The offer is still standing, so a cancel costs the reader nothing.
		expect(queryRevertBanner(canvasElement)).toBeInTheDocument();
	}}
/>

<Story
	name="DismissedRevertOfferDoesNotComeBack"
	args={{
		initialGraphId: 'revert-dismiss',
		graphs: {
			'revert-dismiss': graphWithTitle('Host Graph', 3)
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);
		const harness = getHarness(canvasElement);

		await waitForHarnessData(canvasElement, 'loadedGraphId', 'revert-dismiss');
		await importDownloadIntoCurrent(canvasElement);
		await waitFor(() => expect(queryRevertBanner(canvasElement)).toBeInTheDocument());

		await userEvent.click(canvas.getByRole('button', { name: 'Dismiss' }));

		await waitFor(() => expect(queryRevertBanner(canvasElement)).toBeNull());
		expect(harness.dataset.nodeCount).toBe('6');

		// A later edit reloads nothing and re-offers nothing: the snapshot is gone.
		await userEvent.click(canvas.getByRole('button', { name: 'Simulate graph change' }));
		await waitFor(() => expect(harness.dataset.primaryTitle).toBe('Changed Node'));
		expect(queryRevertBanner(canvasElement)).toBeNull();
		expect(harness.dataset.snapshotLabel).toBe('');
	}}
/>

<style>
	:global(body) {
		min-height: 100vh;
	}
</style>
