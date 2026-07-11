<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, waitFor } from 'storybook/test';
	import DeepZoomLayerHarness from './DeepZoomLayerHarness.svelte';

	const { Story } = defineMeta({
		title: 'Components/Multigraph/DeepZoomLayer',
		component: DeepZoomLayerHarness,
		tags: []
	});

	function setScrub(root: ParentNode, value: number) {
		const input = root.querySelector('[data-scrub="progress"]') as HTMLInputElement;
		input.value = String(value);
		input.dispatchEvent(new Event('input', { bubbles: true }));
	}

	function layerOf(root: ParentNode): HTMLElement {
		return root.querySelector('[data-morph-surface="true"]') as HTMLElement;
	}

	function compactLayer(root: ParentNode): HTMLElement | null {
		return root.querySelector('.deep-zoom-compact-layer');
	}

	function detailsLayer(root: ParentNode): HTMLElement | null {
		return root.querySelector('.deep-zoom-details-layer');
	}
</script>

<!--
	The morph surface is ONE frame element (the `frame` snippet) whose inner
	content crossfades between a fixed-layout compact layer and a fixed-layout
	details layer, each transform-scaled to the frame. These stories scrub
	progress and assert on the surface's data-* attributes.
-->

<Story
	name="ScrubbingCrossfadesLayersWithoutRelayout"
	play={async ({ canvasElement }) => {
		const root = canvasElement;
		setScrub(root, 0);
		await waitFor(() => expect(layerOf(root).dataset.morphProgress).toBe('0'));

		const compact0 = compactLayer(root) as HTMLElement;
		const compactBaseWidth = compact0.dataset.layerBaseWidth;
		const compactScale0 = compact0.dataset.layerScale;
		expect(Number(compact0.dataset.layerOpacity)).toBe(1);
		// Details is lazy: absent until progress first exceeds 0.
		expect(detailsLayer(root)).toBeNull();

		setScrub(root, 0.5);
		await waitFor(() => expect(detailsLayer(root)).not.toBeNull());
		const compactMid = compactLayer(root) as HTMLElement;
		const detailsMid = detailsLayer(root) as HTMLElement;
		const detailsBaseWidth = detailsMid.dataset.layerBaseWidth;
		const detailsScaleMid = detailsMid.dataset.layerScale;

		// No re-layout: base sizes are constant while transforms change.
		expect(compactMid.dataset.layerBaseWidth).toBe(compactBaseWidth);
		expect(compactMid.dataset.layerScale).not.toBe(compactScale0);
		// Opacity crosses over.
		expect(Number(compactMid.dataset.layerOpacity)).toBeCloseTo(0.5, 5);
		expect(Number(detailsMid.dataset.layerOpacity)).toBeCloseTo(0.5, 5);

		setScrub(root, 1);
		await waitFor(() => expect(layerOf(root).dataset.morphProgress).toBe('1'));
		const compactEnd = compactLayer(root) as HTMLElement;
		const detailsEnd = detailsLayer(root) as HTMLElement;
		expect(compactEnd.dataset.layerBaseWidth).toBe(compactBaseWidth);
		expect(detailsEnd.dataset.layerBaseWidth).toBe(detailsBaseWidth);
		expect(detailsEnd.dataset.layerScale).not.toBe(detailsScaleMid);
		expect(Number(compactEnd.dataset.layerOpacity)).toBe(0);
		expect(Number(detailsEnd.dataset.layerOpacity)).toBe(1);
		// Details laid out at fill size sits at scale 1 when committed.
		expect(Number(detailsEnd.dataset.layerScale)).toBeCloseTo(1, 5);

		// Reverse: layout still constant, opacity crosses back.
		setScrub(root, 0);
		await waitFor(() => expect(layerOf(root).dataset.morphProgress).toBe('0'));
		const compactBack = compactLayer(root) as HTMLElement;
		expect(compactBack.dataset.layerBaseWidth).toBe(compactBaseWidth);
		expect(Number(compactBack.dataset.layerOpacity)).toBe(1);
		expect(Number((detailsLayer(root) as HTMLElement).dataset.layerOpacity)).toBe(0);
	}}
/>

<Story
	name="TheSameSurfaceElementSpansTheWholeScrub"
	play={async ({ canvasElement }) => {
		const root = canvasElement;
		setScrub(root, 0);
		await waitFor(() => expect(layerOf(root).dataset.morphProgress).toBe('0'));
		const first = layerOf(root);

		setScrub(root, 0.5);
		await waitFor(() => expect(layerOf(root).dataset.morphProgress).toBe('0.5'));
		setScrub(root, 1);
		await waitFor(() => expect(layerOf(root).dataset.morphProgress).toBe('1'));
		setScrub(root, 0);
		await waitFor(() => expect(layerOf(root).dataset.morphProgress).toBe('0'));

		// One and the same DOM node spanned the entire scrub (never recreated).
		expect(layerOf(root)).toBe(first);
		expect(first).toHaveAttribute('data-morph-surface', 'true');
	}}
/>

<Story
	name="DetailsContentMountsOnceLazily"
	play={async ({ canvasElement }) => {
		const root = canvasElement;
		setScrub(root, 0);
		await waitFor(() => expect(layerOf(root).dataset.morphProgress).toBe('0'));
		expect(root.querySelectorAll('.deep-zoom-details-layer').length).toBe(0);
		expect(root.querySelectorAll('[data-details-content="true"]').length).toBe(0);

		setScrub(root, 0.3);
		await waitFor(() => expect(root.querySelectorAll('.deep-zoom-details-layer').length).toBe(1));

		setScrub(root, 1);
		await waitFor(() => expect(layerOf(root).dataset.morphProgress).toBe('1'));
		expect(root.querySelectorAll('.deep-zoom-details-layer').length).toBe(1);

		// Returning to 0 keeps the single mounted instance (no unmount thrash).
		setScrub(root, 0);
		await waitFor(() => expect(layerOf(root).dataset.morphProgress).toBe('0'));
		expect(root.querySelectorAll('.deep-zoom-details-layer').length).toBe(1);
		expect(root.querySelectorAll('[data-details-content="true"]').length).toBe(1);
	}}
/>

<Story
	name="SurfaceIgnoresPointerEventsUntilCommitted"
	play={async ({ canvasElement }) => {
		const root = canvasElement;
		setScrub(root, 0.5);
		await waitFor(() => expect(layerOf(root).dataset.morphProgress).toBe('0.5'));

		const layer = layerOf(root);
		expect(layer).toHaveAttribute('data-morph-interactive', 'false');
		expect(window.getComputedStyle(layer).pointerEvents).toBe('none');

		const scrubRect = layer.getBoundingClientRect();
		const hitDuringScrub = document.elementFromPoint(
			scrubRect.left + scrubRect.width / 2,
			scrubRect.top + scrubRect.height / 2
		);
		// The surface is transparent to hit-testing, so a point over it reaches
		// the element beneath, not the surface.
		expect(layer.contains(hitDuringScrub)).toBe(false);
		expect((hitDuringScrub as HTMLElement)?.closest('[data-beneath="true"]')).not.toBeNull();

		setScrub(root, 1);
		await waitFor(() => expect(layerOf(root).dataset.morphProgress).toBe('1'));
		expect(layer).toHaveAttribute('data-morph-interactive', 'true');
		expect(window.getComputedStyle(layer).pointerEvents).not.toBe('none');

		const committedRect = layer.getBoundingClientRect();
		const hitCommitted = document.elementFromPoint(
			committedRect.left + committedRect.width / 2,
			committedRect.top + committedRect.height / 2
		);
		expect(layer.contains(hitCommitted)).toBe(true);
	}}
/>

<Story
	name="ReducedMotionReachesEndStatesWithoutIntermediateFrames"
	args={{ reduceMotion: true }}
	play={async ({ canvasElement }) => {
		const root = canvasElement;

		// A partial scrub below the midpoint snaps to the compact end state.
		setScrub(root, 0.4);
		await waitFor(() => expect(layerOf(root).dataset.morphProgress).toBe('0'));
		const layerLow = layerOf(root);
		expect(Number(layerLow.dataset.morphWidth)).toBe(100);
		expect(Number((compactLayer(root) as HTMLElement).dataset.layerOpacity)).toBe(1);
		const detailsLow = detailsLayer(root);
		if (detailsLow) expect(Number(detailsLow.dataset.layerOpacity)).toBe(0);

		// A partial scrub above the midpoint snaps to the details end state.
		setScrub(root, 0.6);
		await waitFor(() => expect(layerOf(root).dataset.morphProgress).toBe('1'));
		const layerHigh = layerOf(root);
		expect(Number(layerHigh.dataset.morphWidth)).toBe(440);
		expect(Number((compactLayer(root) as HTMLElement).dataset.layerOpacity)).toBe(0);
		expect(Number((detailsLayer(root) as HTMLElement).dataset.layerOpacity)).toBe(1);
	}}
/>
