import { describe, expect, it } from 'vitest';
import type { MultigraphData } from '../../types/multigraph';
import {
	createLayoutSourceReducer,
	excludedGraphElements,
	withoutExcludedElements
} from './excludedElements';
import { evaluateGraphQuery } from './graphQuery';
import { makeGraph } from './testFixtures';

/**
 * hub ── ab(link) ── leaf ── bc(bridge) ── far
 *  │
 *  └── hd ── chore(!task)      island (no edges)
 */
const graph = makeGraph({
	nodes: [
		{ id: 'hub', title: 'Hub', description: '', tags: ['hidden', 'core'] },
		{ id: 'leaf', title: 'Leaf', description: '', tags: ['other'] },
		{ id: 'far', title: 'Far side', description: 'a distant phrase', tags: [] },
		{
			id: 'chore',
			title: 'Open chore',
			description: '',
			tags: [],
			addons: { task: { done: false } }
		},
		{ id: 'island', title: 'Island', description: '', tags: ['other'] }
	],
	edges: [
		{ id: 'ab', source: 'hub', target: 'leaf', tags: ['link'] },
		{ id: 'bc', source: 'leaf', target: 'far', tags: ['bridge'] },
		{ id: 'hd', source: 'hub', target: 'chore', tags: [] }
	],
	posByNodeId: {
		hub: { x: 0, y: 0 },
		leaf: { x: 10, y: 0 },
		far: { x: 20, y: 0 },
		chore: { x: 0, y: 10 },
		island: { x: 50, y: 50 }
	}
});

const nodeIds = (data: MultigraphData) => data.nodes.map((node) => node.id);
const edgeIds = (data: MultigraphData) => data.edges.map((edge) => edge.id);

function reduce(data: MultigraphData, queryText: string, exempt?: ReadonlySet<string>) {
	return withoutExcludedElements(
		data,
		excludedGraphElements(evaluateGraphQuery(data, queryText), exempt)
	);
}

/** A copy of `data` with every position nudged, the shape of one physics frame. */
function nextFrame(data: MultigraphData): MultigraphData {
	return {
		...data,
		posByNodeId: Object.fromEntries(
			Object.entries(data.posByNodeId).map(([id, pos]) => [id, { x: pos.x + 1, y: pos.y }])
		)
	};
}

describe('excludedGraphElements', () => {
	it('collects excluded nodes and every excluded edge, endpoint-driven included', () => {
		const excluded = excludedGraphElements(evaluateGraphQuery(graph, '-#hidden -@bridge'));

		expect(excluded.nodeIds).toEqual(new Set(['hub']));
		expect(excluded.edgeIds).toEqual(new Set(['ab', 'hd', 'bc']));
	});

	it('leaves an exempt node out of the excluded nodes but keeps its edges excluded', () => {
		const excluded = excludedGraphElements(evaluateGraphQuery(graph, '-#hidden'), new Set(['hub']));

		expect(excluded.nodeIds).toEqual(new Set());
		expect(excluded.edgeIds).toEqual(new Set(['ab', 'hd']));
	});

	it('returns one shared empty value when nothing is excluded', () => {
		const none = excludedGraphElements(evaluateGraphQuery(graph, '#core +@link'));

		expect(none).toBe(excludedGraphElements(evaluateGraphQuery(graph, '')));
		expect(none.nodeIds.size).toBe(0);
		expect(none.edgeIds.size).toBe(0);
	});
});

describe('withoutExcludedElements', () => {
	it('removes an excluded node and its incident edges', () => {
		const reduced = reduce(graph, '-#hidden');

		expect(nodeIds(reduced)).toEqual(['leaf', 'far', 'chore', 'island']);
		expect(edgeIds(reduced)).toEqual(['bc']);
	});

	it('removes only the edge an edge tag excludes and keeps both endpoints', () => {
		const reduced = reduce(graph, '-@bridge');

		expect(nodeIds(reduced)).toEqual(nodeIds(graph));
		expect(edgeIds(reduced)).toEqual(['ab', 'hd']);
	});

	it('treats an add-on exclusion like a node tag', () => {
		const reduced = reduce(graph, '-!task');

		expect(nodeIds(reduced)).toEqual(['hub', 'leaf', 'far', 'island']);
		expect(edgeIds(reduced)).toEqual(['ab', 'bc']);
	});

	it('removes a node matched by an excluded phrase', () => {
		const reduced = reduce(graph, '-"distant"');

		expect(nodeIds(reduced)).toEqual(['hub', 'leaf', 'chore', 'island']);
		expect(edgeIds(reduced)).toEqual(['ab', 'hd']);
	});

	it('drops an edge whose endpoint is excluded even when the exclusion names no edges', () => {
		const reduced = withoutExcludedElements(graph, {
			nodeIds: new Set(['leaf']),
			edgeIds: new Set()
		});

		expect(edgeIds(reduced)).toEqual(['hd']);
	});

	it('returns the graph itself when nothing is excluded', () => {
		expect(reduce(graph, '')).toBe(graph);
		expect(reduce(graph, '#core +@link "phrase"')).toBe(graph);
		expect(reduce(graph, '-#nowhere -@nothing')).toBe(graph);
	});

	it('returns the graph itself when the exclusion names nothing in it', () => {
		const elsewhere = { nodeIds: new Set(['ghost']), edgeIds: new Set(['phantom']) };

		expect(withoutExcludedElements(graph, elsewhere)).toBe(graph);
	});

	it('is idempotent: reducing an already-reduced graph returns it unchanged', () => {
		for (const query of ['-#hidden', '-@bridge', '-!task', '-#hidden -@bridge']) {
			const once = reduce(graph, query);
			expect(reduce(once, query)).toBe(once);
		}
		const exempt = new Set(['hub']);
		const onceExempt = reduce(graph, '-#hidden', exempt);
		expect(reduce(onceExempt, '-#hidden', exempt)).toBe(onceExempt);
	});

	it('never mutates its input and passes posByNodeId through by reference', () => {
		const before = structuredClone(graph);
		const reduced = reduce(graph, '-#hidden -@bridge');

		expect(graph).toEqual(before);
		expect(reduced.posByNodeId).toBe(graph.posByNodeId);
		expect(reduced.posByNodeId.hub).toEqual({ x: 0, y: 0 });
		expect(reduced.tagColorConfig).toBe(graph.tagColorConfig);
	});

	it('keeps an exempt node but leaves its incident edges excluded', () => {
		const reduced = reduce(graph, '-#hidden', new Set(['hub']));

		expect(nodeIds(reduced)).toEqual(nodeIds(graph));
		expect(edgeIds(reduced)).toEqual(['bc']);
	});
});

describe('createLayoutSourceReducer', () => {
	it('reduces the way the pure functions do', () => {
		const reduceLayoutSource = createLayoutSourceReducer();
		const reduced = reduceLayoutSource(graph, '-#hidden');

		expect(nodeIds(reduced)).toEqual(['leaf', 'far', 'chore', 'island']);
		expect(edgeIds(reduced)).toEqual(['bc']);
		expect(reduced.posByNodeId).toBe(graph.posByNodeId);
	});

	it('returns the input graph itself when nothing is excluded', () => {
		const reduceLayoutSource = createLayoutSourceReducer();

		expect(reduceLayoutSource(graph, '')).toBe(graph);
		expect(reduceLayoutSource(graph, '#core')).toBe(graph);
		expect(reduceLayoutSource(graph, '-#hidden', new Set(['hub', 'leaf']))).not.toBe(graph);
	});

	it('evaluates the query against the graph it is handed', () => {
		const reduceLayoutSource = createLayoutSourceReducer();
		reduceLayoutSource(graph, '-#hidden');
		const tagged = {
			...graph,
			nodes: graph.nodes.map((node) =>
				node.id === 'island' ? { ...node, tags: [...node.tags, 'hidden'] } : node
			)
		};

		expect(nodeIds(reduceLayoutSource(tagged, '-#hidden'))).toEqual(['leaf', 'far', 'chore']);
	});

	it('keeps the reduced arrays across graphs that differ only in posByNodeId', () => {
		const reduceLayoutSource = createLayoutSourceReducer();
		const first = reduceLayoutSource(graph, '-#hidden');
		const moved = nextFrame(graph);
		const second = reduceLayoutSource(moved, '-#hidden');

		expect(second.nodes).toBe(first.nodes);
		expect(second.edges).toBe(first.edges);
		expect(second.posByNodeId).toBe(moved.posByNodeId);
	});

	it('keeps the reduced arrays when the query changes but the excluded set does not', () => {
		const reduceLayoutSource = createLayoutSourceReducer();
		const first = reduceLayoutSource(graph, '-#hidden');
		const second = reduceLayoutSource(graph, '-#hidden +#other');

		expect(second.nodes).toBe(first.nodes);
		expect(second.edges).toBe(first.edges);
	});

	it('builds new arrays when the excluded set changes', () => {
		const reduceLayoutSource = createLayoutSourceReducer();
		const first = reduceLayoutSource(graph, '-#hidden');
		const second = reduceLayoutSource(graph, '-#hidden -!task');

		expect(second.nodes).not.toBe(first.nodes);
		expect(nodeIds(second)).toEqual(['leaf', 'far', 'island']);
	});

	it('holds identity while an already-reduced graph is fed back in between frames', () => {
		const reduceLayoutSource = createLayoutSourceReducer();
		const first = reduceLayoutSource(graph, '-#hidden');

		expect(reduceLayoutSource(first, '-#hidden')).toBe(first);

		const second = reduceLayoutSource(nextFrame(graph), '-#hidden');
		expect(second.nodes).toBe(first.nodes);
		expect(second.edges).toBe(first.edges);
	});

	it('memoizes on the exempt set by reference', () => {
		const reduceLayoutSource = createLayoutSourceReducer();
		const exempt = new Set(['hub']);
		const first = reduceLayoutSource(graph, '-#hidden', exempt);
		const second = reduceLayoutSource(nextFrame(graph), '-#hidden', exempt);

		expect(nodeIds(first)).toEqual(nodeIds(graph));
		expect(edgeIds(first)).toEqual(['bc']);
		expect(second.nodes).toBe(first.nodes);
		expect(second.edges).toBe(first.edges);

		const withoutExemption = reduceLayoutSource(graph, '-#hidden');
		expect(nodeIds(withoutExemption)).toEqual(['leaf', 'far', 'chore', 'island']);
	});
});

// Hovering a tag button not in the query previews its spotlight, so this is
// why that hover never reflows the graph. (Hovering a spotlit or excluded tag
// previews its exclusion or removal and reflows on purpose.)
describe('appending a spotlight token never changes the excluded set', () => {
	const exclusions = ['-#hidden', '-#other', '-@bridge', '-@link', '-!task', '-"distant"'];
	const previews = [
		...new Set(graph.nodes.flatMap((node) => node.tags.map((tag) => `+#${tag}`))),
		...new Set(graph.edges.flatMap((edge) => edge.tags.map((tag) => `+@${tag}`)))
	];

	it('covers +#hidden after -#hidden', () => {
		expect(previews).toContain('+#hidden');
	});

	for (const exclusion of exclusions) {
		it(`keeps ${exclusion} excluding the same elements under every +#/+@ preview`, () => {
			const committed = excludedGraphElements(evaluateGraphQuery(graph, exclusion));
			expect(committed.nodeIds.size + committed.edgeIds.size).toBeGreaterThan(0);

			for (const preview of previews) {
				const previewed = excludedGraphElements(
					evaluateGraphQuery(graph, `${exclusion} ${preview}`)
				);
				expect(previewed, `${exclusion} ${preview}`).toEqual(committed);
			}
		});

		it(`hands back the same reduced arrays for ${exclusion} under every preview`, () => {
			const reduceLayoutSource = createLayoutSourceReducer();
			const committed = reduceLayoutSource(graph, exclusion);

			for (const preview of previews) {
				const previewed = reduceLayoutSource(graph, `${exclusion} ${preview}`);
				expect(previewed.nodes, `${exclusion} ${preview}`).toBe(committed.nodes);
				expect(previewed.edges, `${exclusion} ${preview}`).toBe(committed.edges);
			}
		});
	}
});
