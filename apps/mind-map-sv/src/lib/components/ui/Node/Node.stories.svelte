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
		await settleBackdrops(canvasElement);
		expect(backdropOf(canvasElement, TITLE_WORDS)).toEqual(NO_BACKDROP);
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
	 * Short enough that its words sit well inside the inner edge of the thickest
	 * ring. `SHORT_TITLE` is not: at the shipped 38 px font its fitted words
	 * reach about 10 px onto an 80 px ring, and rightly get the backdrop.
	 */
	const CENTRED_TITLE = 'Short title';

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
		measure: (host: HTMLElement) => T | Promise<T>
	): Promise<T> {
		const host = document.createElement('div');
		canvasElement.appendChild(host);
		const instance = mount(Node, { target: host, props });
		try {
			flushSync();
			// SquareText fits the title in an effect; let it settle before measuring.
			await new Promise((resolve) => requestAnimationFrame(resolve));
			return await measure(host);
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
	}

	/** The title's words, their own box rather than the fitted square. */
	const TITLE_WORDS = '.node .title > .squareTextBody';
	const BADGE_ROW = '[data-node-addon-badges]';
	const CHIP_ROW = '[data-node-quantities]';

	const BACKDROP = 'rgba(255, 255, 255, 0.72)';
	/** The backdrop's resting colour: present, fully transparent, painting nothing. */
	const CLEAR = 'rgba(255, 255, 255, 0)';
	const NO_BACKGROUND = 'rgba(0, 0, 0, 0)';
	const ON_THE_RING = { overRing: 'true', background: BACKDROP };
	const NO_BACKDROP = { overRing: null, background: CLEAR };

	function nextFrame(): Promise<void> {
		return new Promise((resolve) => requestAnimationFrame(() => resolve()));
	}

	/**
	 * Let `NodeChrome`'s observers mark the content (they report after layout),
	 * then let any backdrop fade they started run to its end, so the colours
	 * read are the settled ones rather than a frame of the transition.
	 */
	async function settleBackdrops(root: ParentNode) {
		await nextFrame();
		await nextFrame();
		const targets = [...root.querySelectorAll(`${TITLE_WORDS}, ${BADGE_ROW}, ${CHIP_ROW}`)];
		await Promise.all(
			targets.flatMap((el) => el.getAnimations().map((a) => a.finished.catch(() => undefined)))
		);
	}

	/** Whether `selector` is marked as over the ring, and the backdrop colour it shows. */
	function backdropOf(root: ParentNode, selector: string) {
		const el = nodePart(root, selector);
		return {
			overRing: el.getAttribute('data-over-ring'),
			background: window.getComputedStyle(el).backgroundColor
		};
	}

	/**
	 * How far the farthest corner of `selector`'s box lies from the circle's
	 * centre, against the ring's inner edge: an independent check that each
	 * story's case really is the one it claims, words inside the inner edge or
	 * reaching past it.
	 */
	function reachPastInnerEdge(root: ParentNode, selector: string): number {
		const circleRect = nodePart(root, '.node .circle').getBoundingClientRect();
		const rect = nodePart(root, selector).getBoundingClientRect();
		const cx = circleRect.left + circleRect.width / 2;
		const cy = circleRect.top + circleRect.height / 2;
		const farthest = Math.hypot(
			Math.max(Math.abs(rect.left - cx), Math.abs(rect.right - cx)),
			Math.max(Math.abs(rect.top - cy), Math.abs(rect.bottom - cy))
		);
		return farthest - (circleRect.width / 2 - ringWidth(root));
	}

	/**
	 * A title short enough that its words sit well inside the inner edge of the
	 * thickest ring: no backdrop, though the ring is far wider than the base.
	 */
	async function shortTitleClearOfTheRingPlayHandler(ctx: PlayArgs) {
		await titleKeepsTheBaseInteriorPlayHandler(ctx);
		await settleBackdrops(ctx.canvasElement);
		expect(reachPastInnerEdge(ctx.canvasElement, TITLE_WORDS)).toBeLessThan(0);
		expect(backdropOf(ctx.canvasElement, TITLE_WORDS)).toEqual(NO_BACKDROP);
	}

	/** A title long enough to fill the square reaches the ring, and gets the backdrop. */
	async function longTitleOverTheRingPlayHandler(ctx: PlayArgs) {
		await titleKeepsTheBaseInteriorPlayHandler(ctx);
		await settleBackdrops(ctx.canvasElement);
		expect(reachPastInnerEdge(ctx.canvasElement, TITLE_WORDS)).toBeGreaterThan(0);
		expect(backdropOf(ctx.canvasElement, TITLE_WORDS)).toEqual(ON_THE_RING);
	}

	/**
	 * The backdrop exists only where an element overlaps the ring: under the
	 * thickest ring the badge and chip rows, out in the bands above and below
	 * the title square, reach it and get one; the short title's words, near the
	 * centre, do not. The same node at the base width shows none at all.
	 */
	async function backdropOnlyOverTheRingPlayHandler({ canvasElement, args }: PlayArgs) {
		expect(ringWidth(canvasElement)).toBeCloseTo(THICKEST_BORDER_PX, 0);
		await settleBackdrops(canvasElement);
		expect(reachPastInnerEdge(canvasElement, TITLE_WORDS)).toBeLessThan(0);
		expect(reachPastInnerEdge(canvasElement, BADGE_ROW)).toBeGreaterThan(0);
		expect(reachPastInnerEdge(canvasElement, CHIP_ROW)).toBeGreaterThan(0);
		expect(backdropOf(canvasElement, TITLE_WORDS)).toEqual(NO_BACKDROP);
		expect(backdropOf(canvasElement, BADGE_ROW)).toEqual(ON_THE_RING);
		expect(backdropOf(canvasElement, CHIP_ROW)).toEqual(ON_THE_RING);

		const atBase = await measureNode(
			canvasElement,
			{ nodeData: args.nodeData, borderWidthPx: BASE_BORDER_PX, quantityLabels: QUANTITY_LABELS },
			async (host) => {
				await settleBackdrops(host);
				return [TITLE_WORDS, BADGE_ROW, CHIP_ROW].map((selector) => backdropOf(host, selector));
			}
		);
		expect(atBase).toEqual([NO_BACKDROP, NO_BACKDROP, NO_BACKDROP]);
	}

	/**
	 * A ring only a little wider than the base: the measurement runs (the ring
	 * is past the base) but finds the badge and chip rows inside its inner edge,
	 * so nothing gets a backdrop.
	 */
	async function badgesClearOfAModerateRingPlayHandler({ canvasElement }: PlayArgs) {
		expect(ringWidth(canvasElement)).toBeCloseTo(MODERATE_BORDER_PX, 0);
		expect(MODERATE_BORDER_PX).toBeGreaterThan(BASE_BORDER_PX);
		await settleBackdrops(canvasElement);
		for (const selector of [TITLE_WORDS, BADGE_ROW, CHIP_ROW]) {
			expect(reachPastInnerEdge(canvasElement, selector)).toBeLessThan(0);
			expect(backdropOf(canvasElement, selector)).toEqual(NO_BACKDROP);
		}
	}

	/** Whether a `prefers-reduced-motion: reduce` rule turns `el`'s transition off. */
	function reducedMotionDropsTransition(el: Element): boolean {
		for (const sheet of document.styleSheets) {
			for (const rule of sheet.cssRules) {
				if (!(rule instanceof CSSMediaRule)) continue;
				if (!rule.media.mediaText.includes('prefers-reduced-motion: reduce')) continue;
				for (const inner of rule.cssRules) {
					if (
						inner instanceof CSSStyleRule &&
						el.matches(inner.selectorText) &&
						inner.style.getPropertyValue('transition-property') === 'none'
					) {
						return true;
					}
				}
			}
		}
		return false;
	}

	/**
	 * The backdrop fades: its colour transitions over 150 ms, and a node that
	 * mounts with its badge row on the ring runs that transition rather than
	 * snapping. Under reduced motion a rule drops the transition.
	 */
	async function backdropFadesPlayHandler({ canvasElement, args }: PlayArgs) {
		const row = nodePart(canvasElement, BADGE_ROW);
		const style = window.getComputedStyle(row);
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			expect(style.transitionProperty).toBe('none');
		} else {
			expect(style.transitionProperty).toBe('background-color, box-shadow');
			expect(style.transitionDuration).toBe('0.15s, 0.15s');
		}
		for (const selector of [TITLE_WORDS, BADGE_ROW]) {
			expect(reducedMotionDropsTransition(nodePart(canvasElement, selector))).toBe(true);
		}

		// A fresh node: the moment its row is marked, a colour transition runs.
		const fading = await measureNode(
			canvasElement,
			{ nodeData: args.nodeData, borderWidthPx: THICKEST_BORDER_PX },
			async (host) => {
				const freshRow = nodePart(host, BADGE_ROW);
				for (let i = 0; i < 10 && !freshRow.hasAttribute('data-over-ring'); i++) {
					await nextFrame();
				}
				return {
					overRing: freshRow.getAttribute('data-over-ring'),
					transitions: freshRow
						.getAnimations()
						.filter((a): a is CSSTransition => a instanceof CSSTransition)
						.map((a) => a.transitionProperty)
						.sort()
				};
			}
		);
		expect(fading.overRing).toBe('true');
		if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			expect(fading.transitions).toEqual(['background-color', 'box-shadow']);
		}
	}

	const QUANTITY_LABELS = ['k'];

	/** A ring past the base whose inner edge still clears the badge and chip rows. */
	const MODERATE_BORDER_PX = BASE_BORDER_PX * 1.5;

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
			title: CENTRED_TITLE,
			description: '',
			tags: []
		},
		borderWidthPx: THICKEST_BORDER_PX
	}}
	play={shortTitleClearOfTheRingPlayHandler}
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
	play={longTitleOverTheRingPlayHandler}
/>

<Story
	name="ContentGetsABackdropOnlyWhereItOverlapsAThickRing"
	args={{
		nodeData: {
			id: 'node id backdrop over ring',
			title: 'Rig',
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
	name="BadgesInsideAModerateRingGetNoBackdrop"
	args={{
		nodeData: {
			id: 'node id moderate ring',
			title: 'Rig',
			description: '',
			tags: [],
			addons: { task: { done: false } }
		},
		borderWidthPx: MODERATE_BORDER_PX,
		quantityLabels: QUANTITY_LABELS
	}}
	play={badgesClearOfAModerateRingPlayHandler}
/>

<Story
	name="TheBackdropFadesInAndReducedMotionDropsTheFade"
	args={{
		nodeData: {
			id: 'node id backdrop fade',
			title: 'Rig',
			description: '',
			tags: [],
			addons: { task: { done: false } }
		},
		borderWidthPx: THICKEST_BORDER_PX
	}}
	play={backdropFadesPlayHandler}
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
