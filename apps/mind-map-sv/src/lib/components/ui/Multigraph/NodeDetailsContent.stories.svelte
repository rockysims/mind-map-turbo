<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect } from 'storybook/test';
	import NodeDetailsContent from './NodeDetailsContent.svelte';
	import type { NodeData } from '../types/node';

	function makeNode(description: string): NodeData {
		return { id: 'node-1', title: 'Kinematics', description, tags: [] };
	}

	const PROSE_ONLY = 'First line.\nSecond line.\n\nAfter a blank line.';

	const { Story } = defineMeta({
		title: 'Components/Multigraph/NodeDetailsContent',
		component: NodeDetailsContent,
		tags: [],
		args: {
			node: makeNode('Constant acceleration gives $$v = v_0 + a t$$ for velocity $v$.')
		}
	});

	function focusContent(canvasElement: HTMLElement): HTMLElement {
		const content = canvasElement.querySelector('.focus-content');
		if (!(content instanceof HTMLElement)) {
			throw new Error('focus content not found');
		}
		return content;
	}
</script>

<Story
	name="ShowsTypesetMathInADescription"
	play={async ({ canvasElement }) => {
		const content = focusContent(canvasElement);

		expect(content.querySelectorAll('[data-segment="display-math"] math')).toHaveLength(1);
		expect(content.querySelectorAll('[data-segment="inline-math"] math')).toHaveLength(1);
		expect(content.textContent).toContain('Constant acceleration gives');
	}}
/>

<Story
	name="LeavesADescriptionWithoutMathUnchanged"
	args={{ node: makeNode(PROSE_ONLY) }}
	play={async ({ canvasElement }) => {
		const content = focusContent(canvasElement);
		const description = content.querySelector('.description');
		if (!(description instanceof HTMLElement)) {
			throw new Error('description not found');
		}

		expect(content.querySelectorAll('math')).toHaveLength(0);
		expect(description.textContent).toBe(PROSE_ONLY);
		expect(getComputedStyle(description).whiteSpace).toBe('pre-wrap');
	}}
/>

<Story
	name="OmitsTheDescriptionWhenItIsBlank"
	args={{ node: makeNode('   \n  ') }}
	play={async ({ canvasElement }) => {
		expect(focusContent(canvasElement).querySelector('.description')).toBeNull();
	}}
/>

<Story
	name="AddsNoScrollContainerSoWheelInputReachesTheZoomWorld"
	play={async ({ canvasElement }) => {
		const content = focusContent(canvasElement);
		const description = content.querySelector('.description');
		if (!(description instanceof HTMLElement)) {
			throw new Error('description not found');
		}

		// Focus mode relies on wheel events reaching ZoomWorld underneath, so nothing
		// in this subtree may become scrollable.
		for (const element of [content, description, ...description.querySelectorAll('*')]) {
			const { overflowX, overflowY } = getComputedStyle(element);
			expect([overflowX, overflowY]).not.toContain('scroll');
			expect([overflowX, overflowY]).not.toContain('auto');
		}
	}}
/>

<Story
	name="ShowsNoDiagnosticsWhenEveryQuantityResolves"
	play={async ({ canvasElement }) => {
		// A clean description reads exactly as it did before diagnostics existed.
		expect(
			focusContent(canvasElement).querySelector('[data-quantity-diagnostics]')
		).not.toBeInTheDocument();
	}}
/>

<Story
	name="OffersToDefineAnUnresolvedQuantity"
	args={{
		node: makeNode('Energy is $$E = m c^2$$.'),
		diagnostics: {
			items: [
				{ key: 'm', label: 'm', state: 'unresolved', nodeIds: [] },
				{ key: 'c', label: 'c', state: 'unresolved', nodeIds: [] }
			],
			cycleNodeIds: []
		},
		onCreateDefiningNode: () => {}
	}}
	play={async ({ canvasElement }) => {
		const content = focusContent(canvasElement);
		expect(content.querySelector('[data-quantity-diagnostics]')).toBeInTheDocument();
		expect(content.querySelector('[data-diagnostic-quantity="m"]')).toHaveAttribute(
			'data-diagnostic-state',
			'unresolved'
		);
		// An unresolved quantity is an invitation to extend the graph.
		expect(content.querySelector('[data-create-defining-node="m"]')).toBeInTheDocument();
	}}
/>

<Story
	name="OffersAWayToReachAnOutOfViewDefiner"
	args={{
		node: makeNode('Weight is $$w = m g$$.'),
		diagnostics: {
			items: [{ key: 'g', label: 'g', state: 'out-of-view', nodeIds: ['gravity-node'] }],
			cycleNodeIds: []
		},
		titleForNodeId: () => 'Gravity',
		onRevealNode: () => {}
	}}
	play={async ({ canvasElement }) => {
		const content = focusContent(canvasElement);
		expect(content.querySelector('[data-diagnostic-quantity="g"]')).toHaveAttribute(
			'data-diagnostic-state',
			'out-of-view'
		);
		// Reachable, and named, so it is not mistaken for an error.
		expect(content.querySelector('[data-reveal-node="gravity-node"]')).toHaveTextContent('Gravity');
		expect(content.querySelector('[data-create-defining-node="g"]')).not.toBeInTheDocument();
	}}
/>

<Story
	name="NamesTheCompetingDefinersOfAConflictingQuantity"
	args={{
		node: makeNode('Weight is $$w = m g$$.'),
		diagnostics: {
			items: [{ key: 'g', label: 'g', state: 'conflict', nodeIds: ['earth', 'moon'] }],
			cycleNodeIds: []
		},
		titleForNodeId: (nodeId) => (nodeId === 'earth' ? 'Earth' : 'Moon'),
		onRevealNode: () => {}
	}}
	play={async ({ canvasElement }) => {
		const content = focusContent(canvasElement);
		expect(content.querySelector('[data-diagnostic-quantity="g"]')).toHaveAttribute(
			'data-diagnostic-state',
			'conflict'
		);
		expect(content.querySelector('[data-reveal-node="earth"]')).toHaveTextContent('Earth');
		expect(content.querySelector('[data-reveal-node="moon"]')).toHaveTextContent('Moon');
	}}
/>

<Story
	name="SurfacesACycleAndNamesTheOtherNodesInIt"
	args={{
		node: makeNode('Circular: $$x = y$$.'),
		diagnostics: { items: [], cycleNodeIds: ['other'] },
		titleForNodeId: () => 'Other',
		onRevealNode: () => {}
	}}
	play={async ({ canvasElement }) => {
		const content = focusContent(canvasElement);
		expect(content.querySelector('[data-diagnostic-state="cycle"]')).toBeInTheDocument();
		expect(content.querySelector('[data-reveal-node="other"]')).toHaveTextContent('Other');
	}}
/>
