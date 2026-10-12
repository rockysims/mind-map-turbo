<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
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
		expect(parseFloat(circleStyles.borderWidth)).toBe(APP_CONFIG.multigraph.nodeBorderWidthPx);
		expect(radiusPercent).toBeGreaterThanOrEqual(0.5);
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
	 * The widest border a sized node can draw with the shipped defaults: the
	 * configured width at `borderWeight.maxFactor`. Read from `APP_CONFIG` so these
	 * stories follow the default if it is ever lowered.
	 */
	const THICKEST_BORDER_PX =
		APP_CONFIG.multigraph.nodeBorderWidthPx * APP_CONFIG.multigraph.borderWeight.maxFactor;

	/**
	 * A border drawn inside the circle eats into the content area, so at the
	 * thickest border the title must still sit wholly inside the padding box:
	 * the circle's rect inset by the rendered border on every side.
	 */
	async function titleInsideThickestBorderPlayHandler({ canvasElement, args }: PlayArgs) {
		const circle = canvasElement.querySelector('.node .circle');
		const titleEl = canvasElement.querySelector('.node .title');
		if (!(circle instanceof HTMLElement)) throw new Error('Circle not found');
		if (!(titleEl instanceof HTMLElement)) throw new Error('Title not found');

		const border = parseFloat(window.getComputedStyle(circle).borderTopWidth);
		expect(border).toBeCloseTo(THICKEST_BORDER_PX, 0);

		expect(titleEl).toBeVisible();
		expect(titleEl.textContent).toBe(args.nodeData.title);

		const circleRect = circle.getBoundingClientRect();
		const titleRect = titleEl.getBoundingClientRect();
		const tolerance = 1;
		expect(titleRect.left).toBeGreaterThanOrEqual(circleRect.left + border - tolerance);
		expect(titleRect.right).toBeLessThanOrEqual(circleRect.right - border + tolerance);
		expect(titleRect.top).toBeGreaterThanOrEqual(circleRect.top + border - tolerance);
		expect(titleRect.bottom).toBeLessThanOrEqual(circleRect.bottom - border + tolerance);
	}

	async function pinnedClosedPlayHandler(ctx: PlayArgs) {
		await playHandler(ctx);

		const node = ctx.canvasElement.querySelector('.node');
		expect(node).toHaveAttribute('data-pinned', 'true');

		const circle = ctx.canvasElement.querySelector('.node .circle');
		expect(circle).toBeInTheDocument();
		const circleStyles = window.getComputedStyle(circle as HTMLElement);
		expect(parseFloat(circleStyles.borderWidth)).toBe(APP_CONFIG.multigraph.nodeBorderWidthPx);
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
		const styles = window.getComputedStyle(circle);
		expect(parseFloat(styles.borderTopWidth)).toBe(PINNED_CUSTOM_BORDER_PX);
		expect(styles.borderTopColor).toBe('rgb(85, 85, 85)');
		expect(styles.boxShadow).toContain('rgb(255, 255, 255)');
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
	play={titleInsideThickestBorderPlayHandler}
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
	play={titleInsideThickestBorderPlayHandler}
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
