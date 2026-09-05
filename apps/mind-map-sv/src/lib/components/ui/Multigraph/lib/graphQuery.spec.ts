import { describe, expect, it } from 'vitest';
import { evaluateGraphQuery, parseGraphQuery } from './graphQuery';
import { makeGraph } from './testFixtures';

describe('graphQuery', () => {
	const graph = makeGraph({
		nodes: [
			{
				id: 'a',
				title: 'Dialog root',
				description: 'Some words in title/description',
				tags: ['dialog', 'modal']
			},
			{ id: 'b', title: 'Nodal branch', description: 'Other text', tags: ['nodal'] },
			{ id: 'c', title: 'Plain topic', description: 'and a phrase in title/description', tags: [] },
			{ id: 'd', title: 'Remote island', description: '', tags: ['island'] }
		],
		edges: [
			{ id: 'ab', source: 'a', target: 'b', tags: ['link', 'edgy'] },
			{ id: 'bc', source: 'b', target: 'c', tags: ['edgo'] },
			{ id: 'cd', source: 'c', target: 'd', tags: ['reference'] }
		],
		tagColorConfig: {
			nodeTags: { dialog: '#111111', modal: '#222222', nodal: '#333333' },
			edgeTags: { link: '#444444', edgy: '#555555', edgo: '#666666' }
		}
	});

	it('parses node tags, edge tags, text, phrases, spotlight, and exclude tokens', () => {
		expect(
			parseGraphQuery('+@edgy +#nodal@link #dialog-#modal -@edgo Some words "and a phrase"')
		).toEqual([
			{ mode: 'spotlight', target: 'edgeTag', value: 'edgy' },
			{ mode: 'spotlight', target: 'nodeTag', value: 'nodal' },
			{ mode: 'focus', target: 'edgeTag', value: 'link' },
			{ mode: 'focus', target: 'nodeTag', value: 'dialog' },
			{ mode: 'exclude', target: 'nodeTag', value: 'modal' },
			{ mode: 'exclude', target: 'edgeTag', value: 'edgo' },
			{ mode: 'focus', target: 'text', value: 'Some' },
			{ mode: 'focus', target: 'text', value: 'words' },
			{ mode: 'focus', target: 'text', value: 'and a phrase' }
		]);
	});

	it('parses configured node and edge tag markers', () => {
		expect(
			parseGraphQuery('+:nodal;link :dialog-:modal -;edgo text', {
				nodeTagMarker: ':',
				edgeTagMarker: ';',
				// The query parser does not read this marker yet (milestone 13 T05).
				addonMarker: '!'
			})
		).toEqual([
			{ mode: 'spotlight', target: 'nodeTag', value: 'nodal' },
			{ mode: 'focus', target: 'edgeTag', value: 'link' },
			{ mode: 'focus', target: 'nodeTag', value: 'dialog' },
			{ mode: 'exclude', target: 'nodeTag', value: 'modal' },
			{ mode: 'exclude', target: 'edgeTag', value: 'edgo' },
			{ mode: 'focus', target: 'text', value: 'text' }
		]);
	});

	it('returns inactive state for empty queries', () => {
		expect(evaluateGraphQuery(graph, '   ')).toMatchObject({
			hasActiveQuery: false,
			dimsBackground: false,
			nodeStateById: {},
			edgeStateById: {},
			regions: []
		});
	});

	it('matches text against node titles and descriptions', () => {
		const result = evaluateGraphQuery(graph, '"and a phrase" Nodal');

		expect(result.nodeStateById.b.role).toBe('focus');
		expect(result.nodeStateById.c.role).toBe('focus');
		expect(result.nodeStateById.a.role).toBe('background');
	});

	describe('text matching against math', () => {
		// Two people search for the same node differently: whoever wrote `\alpha`
		// looks for "alpha", and whoever only ever saw the node on screen looks for
		// "α". Matching one form leaves the other hunting for a node in plain view.
		const mathGraph = makeGraph({
			nodes: [
				{ id: 'src', title: 'Growth rate $\\alpha$', description: '', tags: [] },
				{ id: 'body', title: 'Mass', description: 'Given $E = mc^2$ we get more.', tags: [] },
				{ id: 'other', title: 'Unrelated', description: 'Nothing here.', tags: [] }
			]
		});

		function rolesFor(query: string) {
			const result = evaluateGraphQuery(mathGraph, query);
			return Object.fromEntries(
				Object.entries(result.nodeStateById).map(([id, state]) => [id, state.role])
			);
		}

		it('matches a title by its LaTeX source', () => {
			expect(rolesFor('alpha').src).toBe('focus');
		});

		it('matches a title by the character it typesets to', () => {
			expect(rolesFor('α').src).toBe('focus');
		});

		it('matches a description by the typeset reading', () => {
			expect(rolesFor('E=mc').body).toBe('focus');
		});

		it('leaves unrelated nodes in the background', () => {
			expect(rolesFor('α').other).toBe('background');
		});

		it('does not match a symbol that appears nowhere', () => {
			expect(rolesFor('β').src).toBe('background');
		});
	});

	it('focuses node tags and preserves background for unrelated elements', () => {
		const result = evaluateGraphQuery(graph, '#dialog');

		expect(result.nodeStateById.a.role).toBe('focus');
		expect(result.nodeStateById.b.role).toBe('background');
		expect(result.edgeStateById.ab.role).toBe('background');
	});

	it('spotlights node tags with matched tag color and query-order precedence', () => {
		const result = evaluateGraphQuery(graph, '+#modal +#dialog');

		expect(result.nodeStateById.a).toEqual({
			role: 'spotlight',
			spotlightColor: '#222222'
		});
	});

	it('keeps endpoint nodes as dimmed context for edge tag focus', () => {
		const result = evaluateGraphQuery(graph, '@link');

		expect(result.edgeStateById.ab.role).toBe('focus');
		expect(result.nodeStateById.a.role).toBe('context');
		expect(result.nodeStateById.b.role).toBe('context');
		expect(result.nodeStateById.c.role).toBe('background');
	});

	it('spotlights edge tags with matched tag color and query-order precedence', () => {
		const result = evaluateGraphQuery(graph, '+@edgy +@link');

		expect(result.edgeStateById.ab).toEqual({
			role: 'spotlight',
			spotlightColor: '#555555'
		});
		expect(result.nodeStateById.a.role).toBe('context');
		expect(result.nodeStateById.b.role).toBe('context');
	});

	it('excludes node tags and incident edges from rendering', () => {
		const result = evaluateGraphQuery(graph, '#dialog -#nodal');

		expect(result.dimsBackground).toBe(true);
		expect(result.nodeStateById.b.role).toBe('excluded');
		expect(result.edgeStateById.ab.role).toBe('excluded');
		expect(result.edgeStateById.bc.role).toBe('excluded');
		expect(result.nodeStateById.a.role).toBe('focus');
	});

	it('does not dim remaining graph for exclude-only queries', () => {
		const result = evaluateGraphQuery(graph, '-#nodal -@reference');

		expect(result.hasActiveQuery).toBe(true);
		expect(result.dimsBackground).toBe(false);
		expect(result.nodeStateById.b.role).toBe('excluded');
		expect(result.edgeStateById.ab.role).toBe('excluded');
		expect(result.edgeStateById.bc.role).toBe('excluded');
		expect(result.edgeStateById.cd.role).toBe('excluded');
		expect(result.nodeStateById.a.role).toBe('background');
		expect(result.nodeStateById.c.role).toBe('background');
		expect(result.nodeStateById.d.role).toBe('background');
	});

	it('excludes only the matching edge for edge exclusions', () => {
		const result = evaluateGraphQuery(graph, '@link -@edgo');

		expect(result.edgeStateById.ab.role).toBe('focus');
		expect(result.edgeStateById.bc.role).toBe('excluded');
		expect(result.nodeStateById.b.role).toBe('context');
		expect(result.nodeStateById.c.role).toBe('background');
	});

	it('gives exclusion precedence over spotlight and focus', () => {
		const result = evaluateGraphQuery(graph, '+#dialog -#dialog +@link -@link');

		expect(result.nodeStateById.a.role).toBe('excluded');
		expect(result.edgeStateById.ab.role).toBe('excluded');
	});

	it('computes connected focused result regions', () => {
		const result = evaluateGraphQuery(graph, '#dialog #island @edgo');

		expect(result.regions).toEqual([
			{ id: 'region-0', nodeIds: ['a'], edgeIds: [] },
			{ id: 'region-1', nodeIds: ['d'], edgeIds: [] },
			{ id: 'region-2', nodeIds: ['b', 'c'], edgeIds: ['bc'] }
		]);
	});

	it('evaluates a 1000-node graph under the milestone perf budget', () => {
		const largeGraph = makeGraph({
			nodeCount: 1000,
			edges: Array.from({ length: 999 }, (_, index) => [index, index + 1]),
			nodes: Array.from({ length: 1000 }, (_, index) => ({
				id: `n${index}`,
				title: index === 997 ? 'needle topic' : `Node ${index}`,
				description: `Description ${index}`,
				tags: index % 10 === 0 ? ['tenth'] : []
			}))
		});

		const started = performance.now();
		const result = evaluateGraphQuery(largeGraph, '#tenth needle');
		const durationMs = performance.now() - started;

		expect(result.focusedNodeIds.length).toBeGreaterThan(100);
		expect(durationMs).toBeLessThan(50);
	});
});
