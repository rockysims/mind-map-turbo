<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, userEvent, waitFor, within } from 'storybook/test';
	import { tick } from 'svelte';
	import GraphQueryPanel from './GraphQueryPanel.svelte';
	import GraphQueryPanelHarness from './GraphQueryPanelHarness.svelte';
	import { makeGraph } from './lib/testFixtures';

	const { Story } = defineMeta({
		title: 'Components/Multigraph/GraphQueryPanel',
		component: GraphQueryPanel,
		tags: []
	});

	/** Node tags `lab` and `a`, and one edge tagged `rel`, so both button groups render. */
	const GRAPH = makeGraph({
		nodes: [
			{ id: 'n0', title: 'Bench', description: '', tags: ['lab'] },
			{ id: 'n1', title: 'Notes', description: '', tags: ['a'] }
		],
		edges: [{ source: 'n0', target: 'n1', tags: ['rel'] }]
	});

	/** Text around the tag that must survive a cycle: a quoted "lab", another tag, a word. */
	const TYPED_QUERY = '"lab notes" #a +#lab x';

	type ButtonState = {
		pressed: boolean;
		mode: 'none' | 'focus' | 'spotlight' | 'exclude';
		label: string;
		name: string;
	};

	function harness(canvasElement: HTMLElement): HTMLElement {
		const found = canvasElement.querySelector('[data-graph-query-panel-harness]');
		if (!(found instanceof HTMLElement)) throw new Error('no query panel harness');
		return found;
	}

	/**
	 * The tag's button, found by the stable start of its accessible name; the
	 * state that follows the comma changes with every click.
	 */
	function tagButton(
		canvasElement: HTMLElement,
		kind: 'Node' | 'Edge',
		tag: string
	): HTMLButtonElement {
		const found = within(canvasElement).getByRole('button', {
			name: new RegExp(`^${kind} tag ${tag},`)
		});
		if (!(found instanceof HTMLButtonElement)) throw new Error(`no button for ${tag}`);
		return found;
	}

	async function expectQuery(canvasElement: HTMLElement, query: string): Promise<void> {
		await waitFor(() => expect(harness(canvasElement)).toHaveAttribute('data-query', query));
	}

	async function expectPreview(canvasElement: HTMLElement, preview: string): Promise<void> {
		await waitFor(() => expect(harness(canvasElement)).toHaveAttribute('data-preview', preview));
	}

	function expectButton(button: HTMLButtonElement, expected: ButtonState): void {
		expect(button).toHaveAttribute('aria-pressed', String(expected.pressed));
		expect(button).toHaveAttribute('data-mode', expected.mode);
		expect(button.querySelector('.tag-label')).toHaveTextContent(expected.label);
		expect(button).toHaveAccessibleName(expected.name);
	}
</script>

<Story
	name="UserCyclesNodeTagThroughEveryMode"
	play={async ({ canvasElement }) => {
		expectButton(tagButton(canvasElement, 'Node', 'lab'), {
			pressed: false,
			mode: 'none',
			label: '#lab',
			name: 'Node tag lab, not in query'
		});

		const steps: Array<{ query: string } & ButtonState> = [
			{
				query: '#lab',
				pressed: true,
				mode: 'focus',
				label: '#lab',
				name: 'Node tag lab, in focus'
			},
			{
				query: '+#lab',
				pressed: true,
				mode: 'spotlight',
				label: '+#lab',
				name: 'Node tag lab, spotlighted'
			},
			{
				query: '-#lab',
				pressed: true,
				mode: 'exclude',
				label: '-#lab',
				name: 'Node tag lab, excluded'
			},
			// The fourth click forgets the tag: the query is empty again, and the
			// button reads exactly as it did before the first.
			{
				query: '',
				pressed: false,
				mode: 'none',
				label: '#lab',
				name: 'Node tag lab, not in query'
			}
		];

		for (const { query, ...button } of steps) {
			tagButton(canvasElement, 'Node', 'lab').click();
			await expectQuery(canvasElement, query);
			expectButton(tagButton(canvasElement, 'Node', 'lab'), button);
		}

		// The neighbouring tag never moved.
		expectButton(tagButton(canvasElement, 'Node', 'a'), {
			pressed: false,
			mode: 'none',
			label: '#a',
			name: 'Node tag a, not in query'
		});
	}}
>
	{#snippet template()}
		<GraphQueryPanelHarness graph={GRAPH} />
	{/snippet}
</Story>

<Story
	name="UserCyclesEdgeTagWithEdgeMarker"
	play={async ({ canvasElement }) => {
		// From the keyboard first: a tag button is a native button, so Enter and
		// Space each advance the cycle.
		tagButton(canvasElement, 'Edge', 'rel').focus();
		// Keyboard focus previews the spotlight, the same as hover.
		await expectPreview(canvasElement, '+@rel');
		await userEvent.keyboard('{Enter}');
		await expectQuery(canvasElement, '@rel');
		// Committing clears the preview, and focus on a tag now in the query does
		// not bring it back.
		await expectPreview(canvasElement, '');
		expectButton(tagButton(canvasElement, 'Edge', 'rel'), {
			pressed: true,
			mode: 'focus',
			label: '@rel',
			name: 'Edge tag rel, in focus'
		});

		await userEvent.keyboard(' ');
		await expectQuery(canvasElement, '+@rel');
		expectButton(tagButton(canvasElement, 'Edge', 'rel'), {
			pressed: true,
			mode: 'spotlight',
			label: '+@rel',
			name: 'Edge tag rel, spotlighted'
		});

		tagButton(canvasElement, 'Edge', 'rel').click();
		await expectQuery(canvasElement, '-@rel');
		expectButton(tagButton(canvasElement, 'Edge', 'rel'), {
			pressed: true,
			mode: 'exclude',
			label: '-@rel',
			name: 'Edge tag rel, excluded'
		});

		tagButton(canvasElement, 'Edge', 'rel').click();
		await expectQuery(canvasElement, '');
		expectButton(tagButton(canvasElement, 'Edge', 'rel'), {
			pressed: false,
			mode: 'none',
			label: '@rel',
			name: 'Edge tag rel, not in query'
		});
	}}
>
	{#snippet template()}
		<GraphQueryPanelHarness graph={GRAPH} />
	{/snippet}
</Story>

<Story
	name="CyclingEditsOnlyThatTagInATypedQuery"
	play={async ({ canvasElement }) => {
		expectButton(tagButton(canvasElement, 'Node', 'lab'), {
			pressed: true,
			mode: 'spotlight',
			label: '+#lab',
			name: 'Node tag lab, spotlighted'
		});

		tagButton(canvasElement, 'Node', 'lab').click();

		// Only the token's own text changed: the quoted phrase that mentions
		// "lab", the other tag and the trailing word all survive in place.
		await expectQuery(canvasElement, '"lab notes" #a -#lab x');
		expect(within(canvasElement).getByLabelText('Graph query')).toHaveValue(
			'"lab notes" #a -#lab x'
		);
		expectButton(tagButton(canvasElement, 'Node', 'a'), {
			pressed: true,
			mode: 'focus',
			label: '#a',
			name: 'Node tag a, in focus'
		});
	}}
>
	{#snippet template()}
		<GraphQueryPanelHarness graph={GRAPH} initialQuery={TYPED_QUERY} />
	{/snippet}
</Story>

<Story
	name="HoverPreviewsSpotlightOnlyForATagNotInTheQuery"
	play={async ({ canvasElement }) => {
		await expectPreview(canvasElement, '');

		// A tag the query does not name previews as a spotlight on top of it.
		const absent = tagButton(canvasElement, 'Node', 'a');
		absent.dispatchEvent(new MouseEvent('mouseenter'));
		await expectPreview(canvasElement, '#lab +#a');
		absent.dispatchEvent(new MouseEvent('mouseleave'));
		await expectPreview(canvasElement, '');

		// A tag already in the query previews nothing: the reader chose its state.
		// Waiting for a value that is already there proves nothing, so flush the
		// update and read the attribute once.
		const present = tagButton(canvasElement, 'Node', 'lab');
		present.dispatchEvent(new MouseEvent('mouseenter'));
		await tick();
		expect(harness(canvasElement)).toHaveAttribute('data-preview', '');
		present.dispatchEvent(new MouseEvent('mouseleave'));
		await tick();
		expect(harness(canvasElement)).toHaveAttribute('data-preview', '');

		// The committed query never moved while hovering.
		expect(harness(canvasElement)).toHaveAttribute('data-query', '#lab');
	}}
>
	{#snippet template()}
		<GraphQueryPanelHarness graph={GRAPH} initialQuery="#lab" />
	{/snippet}
</Story>
