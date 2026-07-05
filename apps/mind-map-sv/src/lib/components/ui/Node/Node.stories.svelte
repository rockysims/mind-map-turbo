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
			borderSegments: { control: 'object' },
			detailsMode: { control: 'boolean' },
			detailsProgress: { control: 'number' }
		},
		args: {
			nodeData: {
				id: 'node id',
				title: 'Node title',
				description: 'Node description',
				tags: []
			},
			borderSegments: [],
			detailsMode: false,
			detailsProgress: 0
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
		const expectedBorderWidth = args.nodeData.pinned
			? APP_CONFIG.multigraph.pinnedNodeBorderWidthPx
			: APP_CONFIG.multigraph.nodeBorderWidthPx;
		expect(parseFloat(circleStyles.borderWidth)).toBe(expectedBorderWidth);
		expect(radiusPercent).toBeGreaterThanOrEqual(0.5);
	}

	async function pinnedClosedPlayHandler(ctx: PlayArgs) {
		await playHandler(ctx);

		const node = ctx.canvasElement.querySelector('.node');
		expect(node).toHaveAttribute('data-pinned', 'true');

		const circle = ctx.canvasElement.querySelector('.node .circle');
		expect(circle).toBeInTheDocument();
		const circleStyles = window.getComputedStyle(circle as HTMLElement);
		expect(parseFloat(circleStyles.borderWidth)).toBe(
			APP_CONFIG.multigraph.pinnedNodeBorderWidthPx
		);
	}

	async function midProgressPlayHandler({ canvasElement }: PlayArgs) {
		const node = canvasElement.querySelector('.node');
		const circle = canvasElement.querySelector('.node .circle') as HTMLElement | null;
		expect(node).toHaveAttribute('data-details-progress', '0.5');
		expect(node).not.toHaveAttribute('data-details-mode');
		expect(circle).toBeInTheDocument();
		expect(parseFloat(window.getComputedStyle(circle!).borderRadius)).toBeCloseTo(109);
		expect(canvasElement.querySelector('.node .details')).toBeNull();
	}

	async function detailsPlayHandler({ canvasElement, args }: PlayArgs) {
		const node = canvasElement.querySelector('.node');
		const circle = canvasElement.querySelector('.node .circle') as HTMLElement | null;
		expect(node).toHaveAttribute('data-details-mode', 'true');
		expect(node).toHaveAttribute('data-details-progress', '1');
		expect(circle).toBeInTheDocument();
		expect(parseFloat(window.getComputedStyle(circle!).borderRadius)).toBe(
			APP_CONFIG.multigraph.focus.detailsCornerRadiusPx
		);
		expect(canvasElement.querySelector('.node .title')).toBeNull();
		expect(canvasElement.querySelector('.node .details-title')?.textContent).toBe(
			args.nodeData.title
		);
		expect(canvasElement.querySelector('.details-body')).toBeInTheDocument();
	}
</script>

<Story
	name="ShortClosed"
	args={{
		nodeData: {
			id: 'node id short title',
			title: 'Short node title goes here.',
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
			title: 'Really long node title goes here. '.repeat(40),
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
	name="MidProgress"
	args={{
		nodeData: {
			id: 'node id mid progress',
			title: 'Zooming toward focus',
			description: 'The real graph node is spending zoom at the boundary.',
			tags: []
		},
		detailsProgress: 0.5
	}}
	play={midProgressPlayHandler}
/>

<Story
	name="Details"
	args={{
		nodeData: {
			id: 'node id details',
			title: 'Node details',
			description: 'Detailed node description',
			tags: []
		},
		detailsMode: true,
		detailsProgress: 1
	}}
	play={detailsPlayHandler}
>
	<p class="description">Detailed node description rendered by the parent.</p>
</Story>

<Story
	name="PinnedTaggedDetails"
	args={{
		nodeData: {
			id: 'node id pinned tagged details',
			title: 'Pinned tagged details',
			description: 'Pinned tagged details description',
			tags: ['topic', 'urgent'],
			pinned: true
		},
		borderSegments: [
			{ color: '#ff0000', startTurn: 0, endTurn: 0.5 },
			{ color: '#00ff00', startTurn: 0.5, endTurn: 1 }
		],
		detailsMode: true,
		detailsProgress: 1
	}}
	play={async (ctx) => {
		await detailsPlayHandler(ctx);
		const node = ctx.canvasElement.querySelector('.node');
		const circle = ctx.canvasElement.querySelector('.node .circle') as HTMLElement | null;
		expect(node).toHaveAttribute('data-pinned', 'true');
		expect(node).toHaveAttribute('data-tag-border', 'true');
		expect(parseFloat(window.getComputedStyle(circle!).borderWidth)).toBe(
			APP_CONFIG.multigraph.pinnedNodeBorderWidthPx
		);
	}}
>
	<p class="description">Shared border styling carries into details mode.</p>
</Story>
