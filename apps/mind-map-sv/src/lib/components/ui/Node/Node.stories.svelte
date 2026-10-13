<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { flushSync, mount, unmount } from 'svelte';
	import { expect } from 'storybook/test';

	import { APP_CONFIG } from '$lib/appConfig';
	import Node from '$lib/components/ui/Node/Node.svelte';
	import type { NodeData } from '$lib/components/ui/types/node';

	const { Story } = defineMeta({
		title: 'Components/Node',
		component: Node,
		tags: [],
		argTypes: {
			nodeData: { control: 'object' },
			borderSegments: { control: 'object' }
		},
		args: {
			nodeData: {
				id: 'node id',
				title: 'Node title',
				description: 'Node description',
				tags: []
			},
			borderSegments: []
		}
	});

	type PlayArgs = {
		canvasElement: HTMLElement;
		args: { nodeData: NodeData };
	};

	/** The graph's own node border width: the ring a node with no weight draws. */
	const BASE_BORDER_PX = APP_CONFIG.multigraph.nodeBorderWidthPx;

	function nodePart(root: ParentNode, selector: string): HTMLElement {
		const el = root.querySelector(selector);
		if (!(el instanceof HTMLElement)) throw new Error(`${selector} not found`);
		return el;
	}

	/** The ring is its own layer inside `.circle`, so its width is read there. */
	function ringOf(root: ParentNode): HTMLElement {
		return nodePart(root, '.node .circle > .ring');
	}

	function ringWidth(root: ParentNode): number {
		return parseFloat(window.getComputedStyle(ringOf(root)).borderTopWidth);
	}

	async function playHandler({ canvasElement, args }: PlayArgs) {
		// Get the node element and its children
		const node = canvasElement.querySelector('.node');
		expect(node).toBeInTheDocument();

		const circle = canvasElement.querySelector('.node .circle');
		expect(circle).toBeInTheDocument();

		const square = canvasElement.querySelector('.node .square');
		expect(square).toBeInTheDocument();

		// Get title element - handle truncated titles for long content and closed state
		const titleEl = canvasElement.querySelector('.node .title');
		expect(titleEl).toBeInTheDocument();
		const titleElement = titleEl as HTMLElement;
		const expectedNodeTextFontSize = `${APP_CONFIG.multigraph.nodeTextFontSizePx}px`;
		expect(window.getComputedStyle(titleElement).fontSize).toBe(expectedNodeTextFontSize);
		expect(titleElement.textContent).toBe(args.nodeData.title);
		expect(canvasElement.querySelector('.node .description')).toBeNull();

		// Test 1: Title is visible
		expect(titleElement).toBeInTheDocument();

		// Check that title is within the square bounds
		const squareRect = square!.getBoundingClientRect();
		const titleRect = titleElement.getBoundingClientRect();

		// Title should be within square bounds
		const tolerance = 1;
		expect(titleRect.left).toBeGreaterThanOrEqual(squareRect.left - tolerance);
		expect(titleRect.right).toBeLessThanOrEqual(squareRect.right + tolerance);
		expect(titleRect.top).toBeGreaterThanOrEqual(squareRect.top - tolerance);
		expect(titleRect.bottom).toBeLessThanOrEqual(squareRect.bottom + tolerance);

		const titleCenterX = titleRect.left + titleRect.width / 2;
		const titleCenterY = titleRect.top + titleRect.height / 2;
		expect(Math.abs(titleCenterX - (squareRect.left + squareRect.width / 2))).toBeLessThan(2);
		expect(Math.abs(titleCenterY - (squareRect.top + squareRect.height / 2))).toBeLessThan(2);

		// Test 2: Square is visibly centered in the circle
		const circleRect = circle!.getBoundingClientRect();

		// Calculate centers
		const circleCenterX = circleRect.left + circleRect.width / 2;
		const circleCenterY = circleRect.top + circleRect.height / 2;
		const squareCenterX = squareRect.left + squareRect.width / 2;
		const squareCenterY = squareRect.top + squareRect.height / 2;

		// Square center should be very close to circle center (within 2px tolerance)
		expect(Math.abs(squareCenterX - circleCenterX)).toBeLessThan(2);
		expect(Math.abs(squareCenterY - circleCenterY)).toBeLessThan(2);

		// Test 3: Square is the right size to fit inscribed in the circle (visual check)
		// Verify square is actually square (width ≈ height)
		expect(Math.abs(squareRect.width - squareRect.height)).toBeLessThan(1);

		// Check that all four corners of the square are within the circle
		const circleRadius = circleRect.width / 2;
		const squareCorners = [
			{ x: squareRect.left, y: squareRect.top },
			{ x: squareRect.right, y: squareRect.top },
			{ x: squareRect.left, y: squareRect.bottom },
			{ x: squareRect.right, y: squareRect.bottom }
		];
		squareCorners.forEach((corner) => {
			const distanceFromCenter = Math.sqrt(
				Math.pow(corner.x - circleCenterX, 2) + Math.pow(corner.y - circleCenterY, 2)
			);
			expect(distanceFromCenter).toBeLessThanOrEqual(circleRadius + 1);
		});

		// Test 4: Node has a border with high enough radius to appear circular
		const circleStyles = window.getComputedStyle(circle!);
		const borderRadius = circleStyles.borderRadius;
		const width = parseFloat(circleStyles.width);
		const radiusValue = parseFloat(borderRadius);
		const radiusPercent = radiusValue / width;
		// Pinned or not, a node draws the one configured border width.
		expect(ringWidth(canvasElement)).toBe(BASE_BORDER_PX);
		expect(radiusPercent).toBeGreaterThanOrEqual(0.5);

		// Test 5: at the base width the layered chrome draws what the single
		// bordered box did — an 8 px ring, the content in the 8 px interior, the
		// title square at the outer diameter over √2, and no backdrop.
		expect(BASE_BORDER_PX).toBe(8);
		expect(squareRect.width).toBeCloseTo(282.8, 1);
		expectContentInsetBy(canvasElement, BASE_BORDER_PX);
		expect(circle).not.toHaveAttribute('data-ring-over-base');
		const titleBody = nodePart(canvasElement, '.node .title > .squareTextBody');
		expect(window.getComputedStyle(titleBody).backgroundColor).toBe('rgba(0, 0, 0, 0)');
		expect(window.getComputedStyle(titleBody).boxShadow).toBe('none');
	}

	/** The content box is the circle inset by `insetPx` on every side. */
	function expectContentInsetBy(root: ParentNode, insetPx: number) {
		const circleRect = nodePart(root, '.node .circle').getBoundingClientRect();
		const contentRect = nodePart(root, '.node .circle > .content').getBoundingClientRect();
		expect(contentRect.left - circleRect.left).toBeCloseTo(insetPx, 1);
		expect(contentRect.top - circleRect.top).toBeCloseTo(insetPx, 1);
		expect(contentRect.width).toBeCloseTo(circleRect.width - 2 * insetPx, 1);
		expect(contentRect.height).toBeCloseTo(circleRect.height - 2 * insetPx, 1);
	}

	function badges(canvasElement: HTMLElement): HTMLElement[] {
		return [...canvasElement.querySelectorAll('[data-addon-badge]')].filter(
			(el): el is HTMLElement => el instanceof HTMLElement
		);
	}

	/** Glyph and accessible label of every badge, in the order they are drawn. */
	function badgeSummary(canvasElement: HTMLElement): Array<[string, string, string]> {
		return badges(canvasElement).map((badge) => [
			badge.getAttribute('data-addon-badge') ?? '',
			badge.textContent?.trim() ?? '',
			badge.getAttribute('aria-label') ?? ''
		]);
	}

	/**
	 * The badges sit in the circle's top band, above the inscribed square the
	 * title fills, and the quantity chips sit in the band below it. Asserted
	 * geometrically rather than by class, because "does not collide" is the
	 * actual requirement.
	 */
	function expectBadgesAboveTheTitle(canvasElement: HTMLElement) {
		const row = canvasElement.querySelector('[data-node-addon-badges]');
		const square = canvasElement.querySelector('.node .square');
		const circle = canvasElement.querySelector('.node .circle');
		expect(row).toBeInTheDocument();
		expect(square).toBeInTheDocument();
		const rowRect = (row as HTMLElement).getBoundingClientRect();
		const squareRect = (square as HTMLElement).getBoundingClientRect();
		const circleRect = (circle as HTMLElement).getBoundingClientRect();
		expect(rowRect.bottom).toBeLessThanOrEqual(squareRect.top + 1);
		expect(rowRect.top).toBeGreaterThanOrEqual(circleRect.top - 1);

		// Display only: the canvas hit test is geometric against the circle, and
		// the milestone rules out a tap on the badge meaning anything of its own.
		expect(window.getComputedStyle(row as HTMLElement).pointerEvents).toBe('none');
	}

	function titleColor(canvasElement: HTMLElement): string {
		const titleEl = canvasElement.querySelector('.node .title');
		return window.getComputedStyle(titleEl as HTMLElement).color;
	}

	/** Two files and one image: only the files are counted. */
	const TWO_FILES_AND_AN_IMAGE: NodeData['content'] = [
		{ type: 'file', assetId: 'a1', name: 'measurements.csv' },
		{ type: 'image', assetId: 'a2', alt: 'rig.png' },
		{ type: 'file', assetId: 'a3', name: 'notes.pdf' }
	];

	const SHORT_TITLE = 'Short node title goes here.';
	const LONG_TITLE = 'Really long node title goes here. '.repeat(40);

	/**
	 * The thickest ring the shipped settings draw: the base width times
	 * `borderWeight.maxFactor` (×10, 80 px a side on a 200 px radius). The ring
	 * grows inward under the content, which keeps the base-width interior, so
	 * the title is as readable here as on a plain node.
	 */
	const THICKEST_BORDER_PX = BASE_BORDER_PX * APP_CONFIG.multigraph.borderWeight.maxFactor;

	/** The rect of `selector`, relative to its node's circle. */
	function rectInCircle(root: ParentNode, selector: string) {
		const circleRect = nodePart(root, '.node .circle').getBoundingClientRect();
		const rect = nodePart(root, selector).getBoundingClientRect();
		return {
			left: rect.left - circleRect.left,
			top: rect.top - circleRect.top,
			width: rect.width,
			height: rect.height
		};
	}

	/**
	 * Mount a second node beside the story's own, measure it, and remove it, so
	 * one play function can compare two border widths side by side.
	 */
	async function measureNode<T>(
		canvasElement: HTMLElement,
		props: { nodeData: NodeData; borderWidthPx?: number; quantityLabels?: string[] },
		measure: (host: HTMLElement) => T
	): Promise<T> {
		const host = document.createElement('div');
		canvasElement.appendChild(host);
		const instance = mount(Node, { target: host, props });
		try {
			flushSync();
			// SquareText fits the title in an effect; let it settle before measuring.
			await new Promise((resolve) => requestAnimationFrame(resolve));
			return measure(host);
		} finally {
			await unmount(instance);
			host.remove();
		}
	}

	/**
	 * At the thickest ring the title is still wholly visible inside the
	 * base-width interior, and its box is exactly the box it has on a node with
	 * the base ring: the ring took nothing from it.
	 */
	async function titleKeepsTheBaseInteriorPlayHandler({ canvasElement, args }: PlayArgs) {
		expect(ringWidth(canvasElement)).toBeCloseTo(THICKEST_BORDER_PX, 0);

		const titleEl = nodePart(canvasElement, '.node .title');
		expect(titleEl).toBeVisible();
		expect(titleEl.textContent).toBe(args.nodeData.title);

		// The content keeps the interior at the base width, not the ring's.
		expectContentInsetBy(canvasElement, BASE_BORDER_PX);
		const contentRect = nodePart(canvasElement, '.node .circle > .content').getBoundingClientRect();
		const titleRect = titleEl.getBoundingClientRect();
		const tolerance = 1;
		expect(titleRect.left).toBeGreaterThanOrEqual(contentRect.left - tolerance);
		expect(titleRect.right).toBeLessThanOrEqual(contentRect.right + tolerance);
		expect(titleRect.top).toBeGreaterThanOrEqual(contentRect.top - tolerance);
		expect(titleRect.bottom).toBeLessThanOrEqual(contentRect.bottom + tolerance);

		// Unchanged from the base ring, to the sub-pixel.
		const atThickest = rectInCircle(canvasElement, '.node .title');
		const atBase = await measureNode(
			canvasElement,
			{ nodeData: args.nodeData, borderWidthPx: BASE_BORDER_PX },
			(host) => rectInCircle(host, '.node .title')
		);
		expect(atThickest.left).toBeCloseTo(atBase.left, 1);
		expect(atThickest.top).toBeCloseTo(atBase.top, 1);
		expect(atThickest.width).toBeCloseTo(atBase.width, 1);
		expect(atThickest.height).toBeCloseTo(atBase.height, 1);

		// Over the ring, the title's words get their backdrop.
		expect(nodePart(canvasElement, '.node .circle')).toHaveAttribute('data-ring-over-base', 'true');
		const titleBody = nodePart(canvasElement, '.node .title > .squareTextBody');
		expect(window.getComputedStyle(titleBody).backgroundColor).toBe(BACKDROP);
	}

	const BACKDROP = 'rgba(255, 255, 255, 0.72)';
	const NO_BACKGROUND = 'rgba(0, 0, 0, 0)';

	/** Background colour of the title's words and of the badge and chip rows. */
	function contentBackgrounds(root: ParentNode): string[] {
		return [
			'.node .title > .squareTextBody',
			'[data-node-addon-badges]',
			'[data-node-quantities]'
		].map((selector) => window.getComputedStyle(nodePart(root, selector)).backgroundColor);
	}

	/**
	 * The backdrop exists only where the content overlaps the ring: present on
	 * the title, badge row and chip row of this story's thick-ringed node, and
	 * absent from the same node drawn at the base width.
	 */
	async function backdropOnlyOverTheRingPlayHandler({ canvasElement, args }: PlayArgs) {
		expect(ringWidth(canvasElement)).toBeCloseTo(THICKEST_BORDER_PX, 0);
		expect(nodePart(canvasElement, '.node .circle')).toHaveAttribute('data-ring-over-base', 'true');
		expect(contentBackgrounds(canvasElement)).toEqual([BACKDROP, BACKDROP, BACKDROP]);

		const atBase = await measureNode(
			canvasElement,
			{ nodeData: args.nodeData, borderWidthPx: BASE_BORDER_PX, quantityLabels: QUANTITY_LABELS },
			(host) => ({
				overBase: nodePart(host, '.node .circle').getAttribute('data-ring-over-base'),
				backgrounds: contentBackgrounds(host),
				titleShadow: window.getComputedStyle(nodePart(host, '.node .title > .squareTextBody'))
					.boxShadow
			})
		);
		expect(atBase.overBase).toBeNull();
		expect(atBase.backgrounds).toEqual([NO_BACKGROUND, NO_BACKGROUND, NO_BACKGROUND]);
		expect(atBase.titleShadow).toBe('none');
	}

	const QUANTITY_LABELS = ['k'];

	/**
	 * Fill, then ring, then content: the fill is `.circle`'s own background
	 * under everything (where a picture background would go), the ring is a
	 * see-through-centred layer above it, and the content is stacked above the
	 * ring so a thick ring runs underneath the title rather than over it.
	 */
	async function layerOrderPlayHandler({ canvasElement }: PlayArgs) {
		const circle = nodePart(canvasElement, '.node .circle');
		const ring = ringOf(canvasElement);
		const content = nodePart(canvasElement, '.node .circle > .content');
		expect([...circle.children]).toEqual([ring, content]);

		const circleStyle = window.getComputedStyle(circle);
		const ringStyle = window.getComputedStyle(ring);
		const contentStyle = window.getComputedStyle(content);
		// The fill paints the whole circle, the ring's band included.
		expect(circleStyle.backgroundColor).toBe('rgb(204, 204, 204)');
		expect(circleStyle.backgroundClip).toBe('border-box');
		expect(parseFloat(circleStyle.borderTopWidth)).toBe(0);
		expect(circleStyle.isolation).toBe('isolate');
		// The ring covers the whole circle and is see-through inside its band.
		expect(ringStyle.backgroundColor).toBe(NO_BACKGROUND);
		expect(ringStyle.position).toBe('absolute');
		expect(ring.getBoundingClientRect().width).toBeCloseTo(circle.getBoundingClientRect().width, 1);
		expect(ringStyle.pointerEvents).toBe('none');
		// The content is above the ring, by DOM order and by z-index.
		expect(contentStyle.position).toBe('absolute');
		expect(Number(contentStyle.zIndex)).toBeGreaterThan(Number(ringStyle.zIndex));
	}

	async function pinnedClosedPlayHandler(ctx: PlayArgs) {
		await playHandler(ctx);

		const node = ctx.canvasElement.querySelector('.node');
		expect(node).toHaveAttribute('data-pinned', 'true');

		expect(ringWidth(ctx.canvasElement)).toBe(BASE_BORDER_PX);
	}

	/** The width a pinned node is handed, distinct from the shipped default. */
	const PINNED_CUSTOM_BORDER_PX = 14;

	/**
	 * A pinned node reads the same `borderWidthPx` as any other — there is no
	 * separate pinned width — while keeping its darker colour and white halo.
	 */
	async function pinnedFollowsBorderWidthPlayHandler({ canvasElement }: PlayArgs) {
		const circle = canvasElement.querySelector('.node .circle');
		if (!(circle instanceof HTMLElement)) throw new Error('Node circle not found');
		expect(circle).toHaveAttribute('data-pinned', 'true');
		expect(circle.style.getPropertyValue('--node-border-width')).toBe(
			`${PINNED_CUSTOM_BORDER_PX}px`
		);
		const ringStyles = window.getComputedStyle(ringOf(canvasElement));
		expect(parseFloat(ringStyles.borderTopWidth)).toBe(PINNED_CUSTOM_BORDER_PX);
		expect(ringStyles.borderTopColor).toBe('rgb(85, 85, 85)');
		expect(window.getComputedStyle(circle).boxShadow).toContain('rgb(255, 255, 255)');
	}
</script>

<Story
	name="ShortClosed"
	args={{
		nodeData: {
			id: 'node id short title',
			title: SHORT_TITLE,
			description:
				'Node description and of course the description is probably going to be fairly long. Certainly multiple sentences. Maybe more.',
			tags: []
		}
	}}
	play={playHandler}
/>

<Story
	name="LongClosed"
	args={{
		nodeData: {
			id: 'node id long title',
			title: LONG_TITLE,
			description:
				'Node description and of course the description is probably going to be fairly long. Likely multiple sentences long. Maybe even more. '.repeat(
					10
				),
			tags: []
		}
	}}
	play={playHandler}
/>

<Story
	name="ShortTitleStaysInsideTheCircleAtTheThickestBorder"
	args={{
		nodeData: {
			id: 'node id short title thickest border',
			title: SHORT_TITLE,
			description: '',
			tags: []
		},
		borderWidthPx: THICKEST_BORDER_PX
	}}
	play={titleKeepsTheBaseInteriorPlayHandler}
/>

<Story
	name="LongTitleStaysInsideTheCircleAtTheThickestBorder"
	args={{
		nodeData: {
			id: 'node id long title thickest border',
			title: LONG_TITLE,
			description: '',
			tags: []
		},
		borderWidthPx: THICKEST_BORDER_PX
	}}
	play={titleKeepsTheBaseInteriorPlayHandler}
/>

<Story
	name="ContentGetsABackdropOnlyOverAThickRing"
	args={{
		nodeData: {
			id: 'node id backdrop over ring',
			title: 'Rig measurements',
			description: '',
			tags: [],
			addons: { task: { done: false } }
		},
		borderWidthPx: THICKEST_BORDER_PX,
		quantityLabels: QUANTITY_LABELS
	}}
	play={backdropOnlyOverTheRingPlayHandler}
/>

<Story
	name="TheFillLiesUnderTheRingAndTheRingUnderTheContent"
	args={{
		nodeData: {
			id: 'node id layer order',
			title: 'Layered node',
			description: '',
			tags: []
		},
		borderWidthPx: THICKEST_BORDER_PX
	}}
	play={layerOrderPlayHandler}
/>

<Story
	name="PinnedClosed"
	args={{
		nodeData: {
			id: 'node id pinned closed',
			title: 'Pinned node title',
			description: 'Pinned node description',
			tags: [],
			pinned: true
		}
	}}
	play={pinnedClosedPlayHandler}
/>

<Story
	name="APinnedNodeDrawsTheNodeBorderWidth"
	args={{
		nodeData: {
			id: 'node id pinned custom border',
			title: 'Pinned node title',
			description: '',
			tags: [],
			pinned: true
		},
		borderWidthPx: PINNED_CUSTOM_BORDER_PX
	}}
	play={pinnedFollowsBorderWidthPlayHandler}
/>

<Story
	name="MultiTagBorder"
	args={{
		nodeData: {
			id: 'node id multi tag',
			title: 'Tagged node',
			description: 'Tagged node description',
			tags: ['topic', 'urgent']
		},
		borderSegments: [
			{ color: '#ff0000', startTurn: 0, endTurn: 0.5 },
			{ color: '#00ff00', startTurn: 0.5, endTurn: 1 }
		]
	}}
	play={async ({ canvasElement }) => {
		const node = canvasElement.querySelector('.node');
		expect(node).toHaveAttribute('data-tag-border', 'true');
	}}
/>

<Story
	name="TaskNotDone"
	args={{
		nodeData: {
			id: 'node id task open',
			title: 'Change the filters',
			description: 'Task node description',
			tags: [],
			addons: { task: { done: false } }
		}
	}}
	play={async ({ canvasElement }) => {
		expect(badgeSummary(canvasElement)).toEqual([['task', '☐', 'Task, not done']]);
		expectBadgesAboveTheTitle(canvasElement);
		// Not done reads exactly like any other node; only done is muted.
		expect(canvasElement.querySelector('.node')).not.toHaveAttribute('data-task-done');
	}}
/>

<Story
	name="TaskDone"
	args={{
		nodeData: {
			id: 'node id task done',
			title: 'Change the filters',
			description: 'Task node description',
			tags: [],
			addons: { task: { done: true, doneAt: 1_700_000_000_000 } }
		}
	}}
	play={async ({ canvasElement }) => {
		expect(badgeSummary(canvasElement)).toEqual([['task', '☑', 'Task, done']]);
		expectBadgesAboveTheTitle(canvasElement);
		expect(canvasElement.querySelector('.node')).toHaveAttribute('data-task-done', 'true');
		expect(titleColor(canvasElement)).toBe('rgb(100, 116, 139)');
	}}
/>

<Story
	name="AttachmentCount"
	args={{
		nodeData: {
			id: 'node id attachments',
			title: 'Rig measurements',
			description: 'Data node description',
			tags: [],
			content: TWO_FILES_AND_AN_IMAGE
		}
	}}
	play={async ({ canvasElement }) => {
		// The image on this node is not counted: it shows itself in the details
		// view, where a file has nothing but this glyph to announce it.
		expect(badgeSummary(canvasElement)).toEqual([['attachments', '📎2', '2 attachments']]);
		expectBadgesAboveTheTitle(canvasElement);
		expect(canvasElement.querySelector('.node')).not.toHaveAttribute('data-task-done');
	}}
/>

<Story
	name="DoneTaskWithAttachments"
	args={{
		nodeData: {
			id: 'node id task and attachments',
			title: 'Rig measurements',
			description: 'Both at once',
			tags: [],
			addons: { task: { done: true, doneAt: 1_700_000_000_000 } },
			content: TWO_FILES_AND_AN_IMAGE
		}
	}}
	play={async ({ canvasElement }) => {
		// Two glyphs, task first — the plan's clutter budget for this milestone.
		expect(badgeSummary(canvasElement)).toEqual([
			['task', '☑', 'Task, done'],
			['attachments', '📎2', '2 attachments']
		]);
		expectBadgesAboveTheTitle(canvasElement);
		expect(titleColor(canvasElement)).toBe('rgb(100, 116, 139)');
	}}
/>
