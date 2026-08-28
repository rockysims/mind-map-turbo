<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn } from 'storybook/test';
	import NavBreadcrumbs from './NavBreadcrumbs.svelte';
	import { navBreadcrumbs, type NavStackEntry } from './lib/navStack';

	function entry(originNodeId: string): NavStackEntry {
		return {
			originNodeId,
			viewState: { panX: 0, panY: 0, scale: 1 },
			revealedNodeId: null,
			originFocused: true
		};
	}

	const TITLES: Record<string, string> = {
		weight: 'Weight',
		gravity: 'Gravity',
		scale: 'Scale',
		radius: 'Radius',
		mass: 'Mass',
		here: 'Density'
	};

	const titleForNodeId = (nodeId: string) => TITLES[nodeId] ?? nodeId;

	type NavigateSpy = { mock: { calls: Array<[number]> } };

	const { Story } = defineMeta({
		title: 'Components/Multigraph/NavBreadcrumbs',
		component: NavBreadcrumbs,
		tags: [],
		args: {
			crumbs: navBreadcrumbs([entry('weight'), entry('gravity')], 'here'),
			titleForNodeId,
			onNavigate: fn()
		}
	});

	function crumbs(canvasElement: HTMLElement): string[] {
		return Array.from(canvasElement.querySelectorAll('[data-nav-breadcrumbs] .crumb')).map(
			(crumb) => crumb.textContent?.trim() ?? ''
		);
	}
</script>

<Story
	name="ReadsAsThePathTheReaderTook"
	play={async ({ canvasElement }) => {
		const trail = canvasElement.querySelector('[data-nav-breadcrumbs]');
		expect(trail).toHaveAttribute('aria-label', 'Jump history');

		// Oldest first, ending where the reader is: the trail is read left to right
		// as the route in, so unwinding is reading it backwards.
		expect(crumbs(canvasElement)).toEqual(['Weight', 'Gravity', 'Density']);
		expect(canvasElement.querySelector('[data-nav-crumb-node="weight"]')).toHaveAttribute(
			'data-nav-crumb',
			'0'
		);
	}}
/>

<Story
	name="ClickingACrumbReportsItsPlaceInTheStack"
	play={async ({ canvasElement, args }) => {
		(canvasElement.querySelector('[data-nav-crumb-node="weight"]') as HTMLElement).click();
		(canvasElement.querySelector('[data-nav-crumb-node="gravity"]') as HTMLElement).click();

		// The index is the stack position, which is what unwinding takes. Reporting
		// a node id instead would be ambiguous the moment a reader jumps back to a
		// node they have already passed through.
		const navigateSpy = args.onNavigate as unknown as NavigateSpy;
		expect(navigateSpy.mock.calls.map((call) => call[0])).toEqual([0, 1]);
	}}
/>

<Story
	name="TheCurrentCrumbIsNotAWayToGoAnywhere"
	play={async ({ canvasElement, args }) => {
		const current = canvasElement.querySelector('[data-nav-crumb-current="here"]') as HTMLElement;

		// It names where the reader already is, so a button would promise a move it
		// cannot make.
		expect(current.tagName).toBe('SPAN');
		expect(current).toHaveAttribute('aria-current', 'page');
		current.click();

		const navigateSpy = args.onNavigate as unknown as NavigateSpy;
		expect(navigateSpy.mock.calls).toHaveLength(0);
	}}
/>

<Story
	name="ALongTrailKeepsItsHeadAndItsTail"
	args={{
		crumbs: navBreadcrumbs(
			[entry('weight'), entry('gravity'), entry('scale'), entry('radius'), entry('mass')],
			'here'
		),
		titleForNodeId,
		onNavigate: fn()
	}}
	play={async ({ canvasElement, args }) => {
		// "Where did this start" and "where am I" are the two questions a deep trail
		// is asked; the middle is what collapses.
		expect(crumbs(canvasElement)).toEqual(['Weight', '…', 'Radius', 'Mass', 'Density']);
		expect(canvasElement.querySelector('[data-nav-crumb-elided]')).toHaveAttribute(
			'data-nav-crumb-elided',
			'2'
		);

		// A surviving tail crumb still unwinds to its own entry, not to the slot it
		// happens to occupy after truncation.
		(canvasElement.querySelector('[data-nav-crumb-node="mass"]') as HTMLElement).click();
		const navigateSpy = args.onNavigate as unknown as NavigateSpy;
		expect(navigateSpy.mock.calls.at(-1)?.[0]).toBe(4);
	}}
/>

<Story
	name="ALongTitleTruncatesInsteadOfCrowdingOutTheTrail"
	args={{
		crumbs: navBreadcrumbs([entry('weight')], 'here'),
		titleForNodeId: (nodeId: string) =>
			nodeId === 'weight' ? 'A node whose title runs on and on and on' : 'Density',
		onNavigate: fn()
	}}
	play={async ({ canvasElement }) => {
		const crumb = canvasElement.querySelector('[data-nav-crumb-node="weight"]') as HTMLElement;
		const style = getComputedStyle(crumb);

		// The trail sits over the reader's content, so one verbose title must not
		// take the width the rest of the path needs.
		expect(style.textOverflow).toBe('ellipsis');
		expect(style.whiteSpace).toBe('nowrap');
		expect(crumb.getBoundingClientRect().width).toBeLessThanOrEqual(
			parseFloat(style.maxWidth) + 0.5
		);
		// Truncated on screen, whole to a screen reader and on hover.
		expect(crumb).toHaveAttribute('title', 'Back to A node whose title runs on and on and on');
	}}
/>
