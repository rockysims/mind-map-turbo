<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, within } from 'storybook/test';
	
	import Node from '$lib/components/ui/Node/Node.svelte';
	import type { NodeData } from '$lib/components/ui/types/node';
	
	const { Story } = defineMeta({
		title: 'Node',
		component: Node,
		tags: [],
	argTypes: {
		nodeData: { control: 'object' },
		isOpen: { control: 'boolean' }
		},
		args: {
		nodeData: {
			id: 'node id',
			title: 'Node title',
			description: 'Node description'
		},
		isOpen: false
		}
	});
	
	type PlayArgs = {
		canvasElement: HTMLElement;
		args: { nodeData: NodeData; isOpen: boolean };
	};
	
	async function playHandler(
		{ canvasElement, args }: PlayArgs,
		options: { short: boolean; open: boolean }
	) {
		const canvas = within(canvasElement);
	
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
		if (!options.open || options.short) {
			expect(titleElement.textContent).toBe(args.nodeData.title);
		} else {
			const displayedTitle = titleElement.textContent || '';
			expect(args.nodeData.title.startsWith(displayedTitle)).toBe(true);
		}
	
		// Get description element (only for open nodes)
		let descriptionElement: HTMLElement | null = null;
		if (options.open) {
			const descEl = canvasElement.querySelector('.node .description');
			expect(descEl).not.toBeNull();
			if (descEl === null) throw new Error('descriptionElement is null');
			descriptionElement = descEl as HTMLElement;
			if (options.short) {
				descriptionElement = canvas.getByText(args.nodeData.description);
			} else {
				expect(descriptionElement.textContent).toBe(args.nodeData.description);
			}
		} else {
			// Closed: description should not be visible
			const descEl = canvasElement.querySelector('.node .description');
			expect(descEl).toBeNull();
		}
	
		// Test 1: Title is visible
		expect(titleElement).toBeInTheDocument();
	
		if (options.open) {
			expect(descriptionElement).toBeInTheDocument();
		}
	
		// Check that title is within the square bounds
		const squareRect = square!.getBoundingClientRect();
		const titleRect = titleElement.getBoundingClientRect();
	
		// Title should be within square bounds
		expect(titleRect.left).toBeGreaterThanOrEqual(squareRect.left);
		expect(titleRect.right).toBeLessThanOrEqual(squareRect.right);
		expect(titleRect.top).toBeGreaterThanOrEqual(squareRect.top);
		expect(titleRect.bottom).toBeLessThanOrEqual(squareRect.bottom);
	
		// For closed nodes: title should be centered vertically and horizontally in the square
		if (!options.open) {
			const squareCenterX = squareRect.left + squareRect.width / 2;
			const squareCenterY = squareRect.top + squareRect.height / 2;
			const titleCenterX = titleRect.left + titleRect.width / 2;
			const titleCenterY = titleRect.top + titleRect.height / 2;
		
			// Title center should be very close to square center (within 2px tolerance)
			expect(Math.abs(titleCenterX - squareCenterX)).toBeLessThan(2);
			expect(Math.abs(titleCenterY - squareCenterY)).toBeLessThan(2);
		}
	
		// Description checks (only for open nodes)
		if (options.open && descriptionElement) {
			const descriptionRect = descriptionElement.getBoundingClientRect();
			const descriptionStyles = window.getComputedStyle(descriptionElement);
			const marginRight = parseFloat(descriptionStyles.marginRight);
			const descriptionEffectiveRight = descriptionRect.right + marginRight;
			expect(descriptionRect.left).toBeGreaterThanOrEqual(squareRect.left);
			expect(descriptionEffectiveRight).toBeLessThanOrEqual(squareRect.right);
			expect(descriptionRect.top).toBeGreaterThanOrEqual(squareRect.top);
			expect(descriptionRect.bottom).toBeLessThanOrEqual(squareRect.bottom);
		}
	
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
		squareCorners.forEach(corner => {
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
		expect(radiusPercent).toBeGreaterThanOrEqual(0.5);

		// Test 5–7: Description scrollbar, styling, and title-above-description (open only)
		if (options.open && descriptionElement) {
			const descriptionStyles = window.getComputedStyle(descriptionElement);
			const hasVerticalScroll = descriptionElement.scrollHeight > descriptionElement.clientHeight;
			if (options.short) {
				expect(hasVerticalScroll).toBe(false);
				expect(descriptionStyles.overflowY).not.toBe('scroll');
			} else {
				expect(hasVerticalScroll).toBe(true);
			}
			if (!options.short) {



				console.log({descriptionStyles, '.borderRadius': descriptionStyles.borderRadius});



				expect(descriptionStyles.boxShadow).not.toBe('');
				expect(parseFloat(descriptionStyles.borderRadius)).toBeGreaterThan(0);
			}
			const descriptionRect = descriptionElement.getBoundingClientRect();
			expect(titleRect.bottom).toBeLessThanOrEqual(descriptionRect.top);
		}
	}
</script>

<Story
	name="ShortClosed"
	args={{
		nodeData: {
			id: 'node id short title',
			title: 'Short node title goes here.',
			description:
				'Node description and of course the description is probably going to be fairly long. Certainly multiple sentences. Maybe more.'
		},
		isOpen: false
	}}
	play={(ctx) => playHandler(ctx, { short: true, open: false })}
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
				)
		},
		isOpen: false
	}}
	play={(ctx) => playHandler(ctx, { short: false, open: false })}
/>

<Story
	name="ShortOpen"
	args={{
		nodeData: {
			id: 'node id short open',
			title: 'Node title short open',
			description: 'Node description and of course the description is probably going to be fairly long. Likely multiple sentences long. Maybe even more.'
		},
		isOpen: true
	}}
	play={(ctx) => playHandler(ctx, { short: true, open: true })}
/>

<Story
	name="LongOpen"
	args={{
		nodeData: {
			id: 'node id long open',
			title: 'Node title long open. '.repeat(10),
			description: 'Node description and of course the description is probably going to be fairly long. Likely multiple sentences long. Maybe even more. '.repeat(10)
		},
		isOpen: true
	}}
	play={(ctx) => playHandler(ctx, { short: false, open: true })}
/>
