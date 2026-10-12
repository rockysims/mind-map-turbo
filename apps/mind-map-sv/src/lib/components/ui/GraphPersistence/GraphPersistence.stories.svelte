<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, userEvent, waitFor, within } from 'storybook/test';
	import { DBL_CLICK_MS, LONG_PRESS_MS } from '$lib/constants';
	import { makeGraph } from '$lib/components/ui/Multigraph/lib/testFixtures';
	import {
		rectContainsRect,
		viewportWorldRect,
		type CameraViewState,
		type StageSize
	} from '$lib/components/ui/Multigraph/lib/revealCamera';
	import type { MultigraphData } from '$lib/components/ui/types/multigraph';
	import { parseGraphFileText, serializeGraphFile } from '$lib/graphFile';
	import { CURRENT_SCHEMA_VERSION, NEUTRAL_VIEW_STATE } from '$lib/migrations';
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

	/** A graph file claiming it was written by the app build `appVersion`. */
	function graphFileWrittenBy(appVersion: string, title: string): string {
		return serializeGraphFile({
			data: graphWithTitle(title),
			viewState: NEUTRAL_VIEW_STATE,
			appVersion
		});
	}

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
		type: 'pointerdown' | 'pointermove' | 'pointerup',
		clientX: number,
		clientY: number,
		pointerId = 1,
		pointerType = ''
	) {
		target.dispatchEvent(
			new PointerEvent(type, {
				clientX,
				clientY,
				pointerId,
				pointerType,
				bubbles: true,
				cancelable: true
			})
		);
	}

	/** Touch long-press: the only pointer type that still opens the menu by holding. */
	async function dispatchLongPress(target: HTMLElement, x: number, y: number): Promise<void> {
		dispatchPointer(target, 'pointerdown', x, y, 1, 'touch');
		await sleep(LONG_PRESS_MS + 20);
	}

	/**
	 * A pinned chain of three, so the whole graph stays inside the displayed
	 * layers and every node is there to be deleted, dragged or focused.
	 */
	function undoChainGraph(): MultigraphData {
		return makeGraph({
			nodeCount: 3,
			pinned: [0],
			edges: [
				[0, 1],
				[1, 2]
			],
			posByNodeId: { n0: { x: -320, y: 0 }, n1: { x: 0, y: 0 }, n2: { x: 320, y: 0 } }
		});
	}

	/**
	 * A pinned node and a free one joined by an `@rel` edge, started stretched
	 * well past the default band so the load's settle pulls the free end in to
	 * the band's upper edge. That edge is a rest the spring defines, rather than
	 * anywhere inside the band's dead zone, so an undo has a definite distance to
	 * walk back to.
	 */
	function edgeLengthPairGraph(): MultigraphData {
		return makeGraph({
			nodeCount: 2,
			pinned: [0],
			edges: [{ source: 'n0', target: 'n1', tags: ['rel'] }],
			posByNodeId: { n0: { x: -500, y: 0 }, n1: { x: 500, y: 0 } }
		});
	}

	/** World-space distance between two drawn nodes, from their layout positions. */
	function nodeDistance(canvasElement: HTMLElement, sourceId: string, targetId: string): number {
		const source = getNodeWrapper(canvasElement, sourceId).dataset;
		const target = getNodeWrapper(canvasElement, targetId).dataset;
		return Math.hypot(Number(target.x) - Number(source.x), Number(target.y) - Number(source.y));
	}

	/** Drag a legend slider: scrub frames with the graph following, then the release. */
	async function dragLegendSlider(
		slider: HTMLInputElement,
		positions: readonly number[]
	): Promise<void> {
		for (const position of positions) {
			slider.value = String(position);
			slider.dispatchEvent(new Event('input', { bubbles: true }));
			await waitForFrames(2);
		}
		slider.dispatchEvent(new Event('change', { bubbles: true }));
	}

	/** Delete a node the way a reader does: hold it, then pick Delete. */
	async function deleteNodeFromMenu(canvasElement: HTMLElement, nodeId: string): Promise<void> {
		const circle = getCircle(canvasElement, nodeId);
		const center = getCenter(circle);
		await dispatchLongPress(circle, center.x, center.y);
		within(canvasElement).getByRole('menuitem', { name: 'Delete' }).click();
	}

	function dispatchKey(
		target: HTMLElement,
		key: string,
		modifiers: { metaKey?: boolean; ctrlKey?: boolean } = {}
	): void {
		target.dispatchEvent(
			new KeyboardEvent('keydown', { key, ...modifiers, bubbles: true, cancelable: true })
		);
	}

	/** The toolbar's undo control, by the half of its name that never changes. */
	function undoButton(canvasElement: HTMLElement): HTMLElement {
		return within(canvasElement).getByRole('button', { name: /^Undo/ });
	}

	function redoButton(canvasElement: HTMLElement): HTMLElement {
		return within(canvasElement).getByRole('button', { name: /^Redo/ });
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

	/** Import the graph the harness just saved, as the toolbar's Import does. */
	async function importDownloadIntoCurrent(canvasElement: HTMLElement): Promise<void> {
		const canvas = within(canvasElement);
		const harness = getHarness(canvasElement);

		await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
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

	/** Multigraph's root element, which carries the reveal markers. */
	function getGraphRoot(canvasElement: HTMLElement): HTMLElement {
		const graph = canvasElement.querySelector('.graph');
		if (!(graph instanceof HTMLElement)) throw new Error('Graph root not found');
		return graph;
	}

	/** The pan/zoom surface — the rect the camera math calls the viewport. */
	function getStage(canvasElement: HTMLElement): HTMLElement {
		const stage = canvasElement.querySelector('.stage');
		if (!(stage instanceof HTMLElement)) throw new Error('Stage not found');
		return stage;
	}

	/** The live view state the canvas reported out and the controller persisted. */
	function persistedViewState(harness: HTMLElement): CameraViewState {
		return {
			panX: Number(harness.dataset.viewPanX),
			panY: Number(harness.dataset.viewPanY),
			scale: Number(harness.dataset.viewScale)
		};
	}

	function stageSize(canvasElement: HTMLElement): StageSize {
		const rect = getStage(canvasElement).getBoundingClientRect();
		return { width: rect.width, height: rect.height };
	}

	/** True when `inner`'s on-screen box sits wholly inside `outer`'s. */
	function screenBoxContains(outer: HTMLElement, inner: HTMLElement): boolean {
		const outerRect = outer.getBoundingClientRect();
		const innerRect = inner.getBoundingClientRect();
		return (
			innerRect.left >= outerRect.left &&
			innerRect.right <= outerRect.right &&
			innerRect.top >= outerRect.top &&
			innerRect.bottom <= outerRect.bottom
		);
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
		await waitFor(() =>
			expect(harness.dataset.notice).toBe('Draft cached in this browser. Save to keep it.')
		);
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
			expect(harness.dataset.notice).toBe('Draft cached in this browser. Save to keep it.')
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
			expect(harness.dataset.notice).toBe('Changed in another tab. Kept your cached draft.')
		);
		await expect(harness.dataset.primaryTitle).toBe('Original Graph');
	}}
/>

<Story
	name="SaveAndImportRoundTrip"
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

		// Save captures HTML into data-last-download without a real browser download.
		await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(harness.dataset.lastDownload).toBeTruthy());
		await expect(harness.dataset.notice).toBe('Saved export-graph.html. Check your downloads.');

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
	name="OpeningAFileFromANewerAppSaysSo"
	args={{
		initialGraphId: 'stable',
		graphs: {
			stable: graphWithTitle('Stable Graph')
		},
		appVersion: '2026-08-30T21:41:32-07:00 efa2bbc',
		simulateImportText: graphFileWrittenBy('2026-09-15T10:02:00-07:00 abc1234', 'From The Future')
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);
		const harness = getHarness(canvasElement);

		await waitForHarnessData(canvasElement, 'loadedGraphId', 'stable');
		await userEvent.click(canvas.getByRole('button', { name: 'Import text' }));

		await waitFor(() => expect(harness.dataset.lastImportResult).toBe('imported'));

		// The import succeeds — the warning is about what the next Save would do,
		// which is wrap this newer graph back up in this older app's code. Amber,
		// because that is the toolbar's colour for work at risk.
		await waitFor(() =>
			expect(harness.dataset.notice).toBe('Newer app: 2026-09-15. Saving here downgrades it.')
		);
		expect(harness.dataset.noticeSeverity).toBe('warning');
		expect(harness.dataset.primaryTitle).toBe('From The Future');
	}}
/>

<Story
	name="OpeningAFileFromAnOlderAppSaysNothing"
	args={{
		initialGraphId: 'stable',
		graphs: {
			stable: graphWithTitle('Stable Graph')
		},
		appVersion: '2026-08-30T21:41:32-07:00 efa2bbc',
		simulateImportText: graphFileWrittenBy('2026-05-07T09:00:00-07:00 0000001', 'From The Past')
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);
		const harness = getHarness(canvasElement);

		await waitForHarnessData(canvasElement, 'loadedGraphId', 'stable');
		await userEvent.click(canvas.getByRole('button', { name: 'Import text' }));

		await waitFor(() => expect(harness.dataset.lastImportResult).toBe('imported'));
		await waitFor(() => expect(harness.dataset.primaryTitle).toBe('From The Past'));

		// Opening an older document is the ordinary upgrade path, so it is silent
		// and stays the ordinary colour.
		expect(harness.dataset.notice).not.toMatch(/newer/);
		expect(harness.dataset.noticeSeverity).toBe('info');
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

		// Save so we have a valid payload to import.
		await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
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

		// Save so the import has a real graph file to fold in.
		await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
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
	name="ImportedComponentIsRevealedByTheCamera"
	args={{
		initialGraphId: 'import-reveal',
		graphs: {
			'import-reveal': graphWithTitle('Host Graph', 3)
		}
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const harness = getHarness(canvasElement);

		await waitForHarnessData(canvasElement, 'loadedGraphId', 'import-reveal');
		await waitFor(() => expect(renderedNodeIds(canvasElement)).toHaveLength(3));

		// The camera the reader is looking at before anything arrives, and the world
		// rect it shows them. Both are read off the canvas's own reported view state.
		const stage = stageSize(canvasElement);
		const viewBeforeImport = persistedViewState(harness);
		const visibleBeforeImport = viewportWorldRect(viewBeforeImport, stage);
		const hostNodeIds = new Set(renderedNodeIds(canvasElement));

		await importDownloadIntoCurrent(canvasElement);
		await waitFor(() => expect(harness.dataset.lastImportIntoCurrent).toBe('imported:3'));
		await waitFor(() => expect(renderedNodeIds(canvasElement)).toHaveLength(6));

		// The reveal aims at an arrival, never at something the reader already had.
		const graphRoot = getGraphRoot(canvasElement);
		const revealNodeId = graphRoot.dataset.importRevealNode ?? '';
		expect(revealNodeId).not.toBe('');
		expect(hostNodeIds.has(revealNodeId)).toBe(false);

		// Reduced motion lands the camera synchronously; otherwise wait out the flight.
		await waitFor(() => expect(graphRoot.dataset.importRevealActive).toBeUndefined(), {
			timeout: 5000
		});

		// The landing camera reached the controller through the ordinary
		// onViewStateChange path, so the persisted numbers are the final ones.
		const viewAfterImport = persistedViewState(harness);
		expect(viewAfterImport.scale).toBeLessThan(viewBeforeImport.scale);

		// Minimal and anchored: everything the reader could see is still in frame.
		expect(rectContainsRect(viewportWorldRect(viewAfterImport, stage), visibleBeforeImport)).toBe(
			true
		);

		// And the point of the whole exercise — the arrival is on screen, drawn
		// inside the stage by that very view state. Asserted directly rather than
		// through waitFor: the reveal has declared itself finished, so anything
		// still hanging off an edge here is a reveal that undershot.
		expect(screenBoxContains(getStage(canvasElement), getCircle(canvasElement, revealNodeId))).toBe(
			true
		);

		// Still true once the layout has completely stopped moving. This is the drift
		// case: committing does not finish the settle, so a camera that aimed once at
		// the position read after the commit lands short of where the node ends up.
		// The reveal keeps re-framing the arrival until it comes to rest.
		await waitFor(() => {
			expect(graphRoot.dataset.settling).toBeUndefined();
			expect(graphRoot.dataset.scaleAnimationActive).toBeUndefined();
			expect(graphRoot.dataset.layeredRelayoutActive).toBeUndefined();
		});
		await waitForFrames(4);
		expect(screenBoxContains(getStage(canvasElement), getCircle(canvasElement, revealNodeId))).toBe(
			true
		);
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
		// Exact, not inferred: the entry holds the graph on both sides of the import.
		expect(harness.dataset.snapshotAddedNodeCount).toBe('3');
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
		// A history operation now, not a document swap: the canvas stays mounted
		// and the reader keeps their pan, zoom, focus and nav.
		expect(harness.dataset.graphGeneration).toBe(generationBeforeRevert);
		await waitFor(() => expect(queryRevertBanner(canvasElement)).toBeNull());
		expect(harness.dataset.snapshotLabel).toBe('');

		// And, for the first time, the revert itself is redoable.
		await userEvent.click(canvas.getByRole('button', { name: /^Undo/ }));
		await waitFor(() => expect(harness.dataset.nodeCount).toBe('6'));
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

		// A later edit re-offers nothing: dismissing is per-entry and permanent.
		await userEvent.click(canvas.getByRole('button', { name: 'Simulate graph change' }));
		await waitFor(() => expect(harness.dataset.primaryTitle).toBe('Changed Node'));
		expect(queryRevertBanner(canvasElement)).toBeNull();
		expect(harness.dataset.snapshotLabel).toBe('');
	}}
/>

<Story
	name="UndoRestoresADeletedNodeWithoutRemounting"
	args={{
		initialGraphId: 'undo-delete',
		graphs: { 'undo-delete': undoChainGraph() },
		layoutSettings: { enterExitDurationMs: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const harness = getHarness(canvasElement);
		await waitForHarnessData(canvasElement, 'loadedGraphId', 'undo-delete');
		await waitForLayout();

		const generationBefore = harness.dataset.graphGeneration;
		const cameraBefore = persistedViewState(harness);
		await deleteNodeFromMenu(canvasElement, 'n1');
		await waitFor(() => expect(harness.dataset.nodeCount).toBe('2'));

		expect(undoButton(canvasElement)).toHaveAccessibleName('Undo delete node');
		await userEvent.click(undoButton(canvasElement));

		await waitFor(() => expect(harness.dataset.nodeCount).toBe('3'));
		await waitFor(() => expect(renderedNodeIds(canvasElement)).toContain('n1'));
		// Its edges come back with it, and nothing about the reader's place moves:
		// the canvas adopts the older graph in place rather than remounting.
		expect(canvasElement.querySelectorAll('[data-edge-id]').length).toBeGreaterThan(0);
		expect(harness.dataset.graphGeneration).toBe(generationBefore);
		expect(persistedViewState(harness)).toEqual(cameraBefore);
	}}
/>

<Story
	name="UndoClosesFocusWhenTheRestoreRemovesItsSubject"
	args={{
		initialGraphId: 'undo-focus',
		graphs: { 'undo-focus': undoChainGraph() },
		layoutSettings: { enterExitDurationMs: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const harness = getHarness(canvasElement);
		await waitForHarnessData(canvasElement, 'loadedGraphId', 'undo-focus');
		await waitForLayout();

		await deleteNodeFromMenu(canvasElement, 'n1');
		await waitFor(() => expect(harness.dataset.nodeCount).toBe('2'));

		await userEvent.click(undoButton(canvasElement));
		await waitFor(() => expect(renderedNodeIds(canvasElement)).toContain('n1'));

		// Focus the node that just came back, then take it away again with a redo.
		const restored = getCircle(canvasElement, 'n1');
		const restoredCenter = getCenter(restored);
		await dispatchLongPress(restored, restoredCenter.x, restoredCenter.y);
		within(canvasElement).getByRole('menuitem', { name: 'Focus' }).click();
		await waitFor(() =>
			expect(canvasElement.querySelector('.deep-zoom-stack')).toBeInTheDocument()
		);

		await userEvent.click(redoButton(canvasElement));

		// Nothing today closes focus on a vanished subject, because until now
		// nothing could vanish one — the overlay would render empty instead.
		await waitFor(() => expect(harness.dataset.nodeCount).toBe('2'));
		await waitFor(() => expect(canvasElement.querySelector('.deep-zoom-stack')).toBeNull());
	}}
/>

<Story
	name="UndoStandsDownWhileTheEditSheetIsOpen"
	args={{
		initialGraphId: 'undo-sheet',
		graphs: { 'undo-sheet': undoChainGraph() },
		layoutSettings: { enterExitDurationMs: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const harness = getHarness(canvasElement);
		await waitForHarnessData(canvasElement, 'loadedGraphId', 'undo-sheet');
		await waitForLayout();

		await deleteNodeFromMenu(canvasElement, 'n2');
		await waitFor(() => expect(harness.dataset.nodeCount).toBe('2'));
		expect(undoButton(canvasElement)).toHaveAttribute('aria-disabled', 'false');

		const circle = getCircle(canvasElement, 'n1');
		const center = getCenter(circle);
		await dispatchLongPress(circle, center.x, center.y);
		within(canvasElement).getByRole('menuitem', { name: 'Edit' }).click();
		await waitFor(() =>
			expect(canvasElement.querySelector('.node-edit-sheet')).toBeInTheDocument()
		);

		// The sheet's draft-reset effect would discard unsaved text without a word,
		// and the toolbar sits above the sheet — the button is one tap away.
		await waitFor(() => expect(undoButton(canvasElement)).toHaveAttribute('aria-disabled', 'true'));
		await userEvent.click(undoButton(canvasElement));

		expect(harness.dataset.nodeCount).toBe('2');
		await waitFor(() => expect(harness.dataset.notice).toBe('Finish editing first.'));
	}}
/>

<Story
	name="UndoIsInertWhileANodeDragIsInFlight"
	args={{
		initialGraphId: 'undo-drag',
		graphs: { 'undo-drag': undoChainGraph() },
		layoutSettings: { enterExitDurationMs: 0, relaxIterations: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const harness = getHarness(canvasElement);
		await waitForHarnessData(canvasElement, 'loadedGraphId', 'undo-drag');
		await waitForLayout();

		await deleteNodeFromMenu(canvasElement, 'n2');
		await waitFor(() => expect(harness.dataset.nodeCount).toBe('2'));

		const stage = getStage(canvasElement);
		const circle = getCircle(canvasElement, 'n1');
		const center = getCenter(circle);
		dispatchPointer(circle, 'pointerdown', center.x, center.y);
		dispatchPointer(stage, 'pointermove', center.x + 60, center.y + 40);

		// The stage holds pointer capture and re-commits the finger's position on
		// the next move, so a mid-drag restore would be half-overwritten at once —
		// and the drag's own end would then scale a node that may no longer exist.
		await waitFor(() => expect(undoButton(canvasElement)).toHaveAttribute('aria-disabled', 'true'));
		expect(harness.dataset.nodeCount).toBe('2');

		dispatchPointer(stage, 'pointerup', center.x + 60, center.y + 40);
		await waitFor(() =>
			expect(undoButton(canvasElement)).toHaveAttribute('aria-disabled', 'false')
		);
	}}
/>

<Story
	name="DisabledUndoWritesItsReasonToTheNotice"
	args={{
		initialGraphId: 'undo-empty',
		graphs: { 'undo-empty': undoChainGraph() }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const harness = getHarness(canvasElement);
		await waitForHarnessData(canvasElement, 'loadedGraphId', 'undo-empty');

		const undo = undoButton(canvasElement);
		expect(undo).toHaveAttribute('aria-disabled', 'true');
		expect(undo).toHaveAccessibleName('Undo');
		expect(undo).toHaveAccessibleDescription('Nothing to undo. Opened files start fresh.');

		// `aria-disabled`, not `disabled`, so the tap still lands and can answer:
		// `title` is hover-only and this app is mobile-first.
		await userEvent.click(undo);

		await waitFor(() =>
			expect(harness.dataset.notice).toBe('Nothing to undo. Opened files start fresh.')
		);
	}}
/>

<Story
	name="KeyboardUndoStandsDownInsideTextEntry"
	args={{
		initialGraphId: 'undo-typing',
		graphs: { 'undo-typing': undoChainGraph() },
		layoutSettings: { enterExitDurationMs: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);
		const harness = getHarness(canvasElement);
		await waitForHarnessData(canvasElement, 'loadedGraphId', 'undo-typing');
		await waitForLayout();

		await deleteNodeFromMenu(canvasElement, 'n2');
		await waitFor(() => expect(harness.dataset.nodeCount).toBe('2'));

		const stage = getStage(canvasElement);
		dispatchKey(stage, 'k', { metaKey: true });
		await waitFor(() => expect(canvas.getByLabelText('Graph query')).toBeInTheDocument());
		const queryInput = canvas.getByLabelText('Graph query') as HTMLInputElement;
		queryInput.focus();

		dispatchKey(queryInput, 'z', { metaKey: true });
		await waitForLayout();

		// The field's own undo belongs to whoever is typing; the graph's does not.
		expect(harness.dataset.nodeCount).toBe('2');
	}}
/>

<Story
	name="KeyboardUndoAndRedoStepTheGraph"
	args={{
		initialGraphId: 'undo-keys',
		graphs: { 'undo-keys': undoChainGraph() },
		layoutSettings: { enterExitDurationMs: 0 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const harness = getHarness(canvasElement);
		await waitForHarnessData(canvasElement, 'loadedGraphId', 'undo-keys');
		await waitForLayout();

		await deleteNodeFromMenu(canvasElement, 'n2');
		await waitFor(() => expect(harness.dataset.nodeCount).toBe('2'));

		const stage = getStage(canvasElement);
		dispatchKey(stage, 'z', { metaKey: true });
		await waitFor(() => expect(harness.dataset.nodeCount).toBe('3'));

		// `Ctrl+Y` is the redo Windows hands expect, beside `Shift+Cmd/Ctrl+Z`.
		dispatchKey(stage, 'y', { ctrlKey: true });
		await waitFor(() => expect(harness.dataset.nodeCount).toBe('2'));
	}}
/>

<Story
	name="UndoWalksAnEdgeLengthDragBackInOneStep"
	args={{
		initialGraphId: 'undo-edge-length',
		graphs: { 'undo-edge-length': edgeLengthPairGraph() },
		// One relax step per mutation, so a restore's own relax barely starts the
		// walk and only the settle it kicks can finish it — which is the half of
		// the restore this story exists to pin.
		layoutSettings: { enterExitDurationMs: 0, relaxIterations: 1 }
	}}
	play={async ({ canvasElement }: PlayContext) => {
		const canvas = within(canvasElement);
		await waitForHarnessData(canvasElement, 'loadedGraphId', 'undo-edge-length');
		await waitForLayout();
		const root = getGraphRoot(canvasElement);
		const endpointDistance = () => nodeDistance(canvasElement, 'n0', 'n1');
		const settled = () =>
			waitFor(() => expect(root.dataset.settling).toBeUndefined(), { timeout: 5000 });

		await settled();
		const before = endpointDistance();

		await userEvent.click(canvas.getByRole('button', { name: 'Tags' }));
		const slider = canvas.getByLabelText('Edge length for edge tag rel') as HTMLInputElement;
		await dragLegendSlider(slider, [0.5, 1, 1.5, 2]);
		await settled();
		const stretched = endpointDistance();
		expect(stretched).toBeGreaterThan(before + 40);

		await userEvent.click(
			within(canvas.getByRole('dialog', { name: 'Tags' })).getByRole('button', { name: 'Close' })
		);

		// Four `input`s and a `change`, one entry: the label names the slider, and
		// a single undo takes the whole drag back with nothing behind it.
		expect(undoButton(canvasElement)).toHaveAccessibleName('Undo edge length');
		await userEvent.click(undoButton(canvasElement));

		// A restore keeps the positions nodes occupy now and puts the factor back,
		// so the pair starts the undo stretched to ×4 under a ×1 band. The spring
		// walks it back in to where the load's settle left it.
		await settled();
		expect(Math.abs(endpointDistance() - before)).toBeLessThan(2);
		expect(undoButton(canvasElement)).toHaveAttribute('aria-disabled', 'true');

		// And forward again: ×4 restored onto a pair at ×1's rest.
		await userEvent.click(redoButton(canvasElement));
		await settled();
		expect(Math.abs(endpointDistance() - stretched)).toBeLessThan(2);
	}}
/>

<style>
	:global(body) {
		min-height: 100vh;
	}
</style>
