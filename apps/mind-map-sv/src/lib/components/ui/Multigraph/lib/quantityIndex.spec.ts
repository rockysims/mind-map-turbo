import { describe, expect, it, vi } from 'vitest';
import {
	buildQuantityIndex,
	createQuantityIndexer,
	isTracked,
	trackedQuantities,
	type IndexableNode,
	type QuantityIndex
} from './quantityIndex';
import { nodeQuantities } from './nodeQuantities';
import { deriveDataflowEdges } from './derivedEdges';
import { symbolFor, type QuantitySymbol } from '../../MathText/lib/mathSymbols';
import type { QuantityDesignation } from '../../types/node';

function designationOf(symbol: QuantitySymbol): QuantityDesignation {
	return { base: symbol.base, subscript: symbol.subscript };
}

/**
 * A node whose designations say exactly what its text says, standing in for an
 * author who confirmed every suggestion the parser offered.
 *
 * Most fixtures here predate designations, when text alone drew edges. Running
 * them through this keeps what they were testing — chains, conflicts, ordering —
 * and states the confirmation the feature now requires in one place.
 */
function designated(node: IndexableNode): IndexableNode {
	const parsed = nodeQuantities(node);
	return {
		...node,
		inputs: parsed.references.map(designationOf),
		outputs: parsed.defines.map((definition) => designationOf(definition.symbol))
	};
}

function node(id: string, description: string, tags: string[] = []): IndexableNode {
	return designated({ id, description, tags });
}

/** The same text with nothing confirmed on it: suggestions only, no dataflow. */
function undesignated(id: string, description: string, tags: string[] = []): IndexableNode {
	return { id, description, tags };
}

function entryFor(index: QuantityIndex, label: string) {
	return [...index.entries.values()].find((candidate) => candidate.symbol.label === label);
}

function definersOf(index: QuantityIndex, label: string): string[] {
	return entryFor(index, label)?.definerNodeIds ?? [];
}

function consumersOf(index: QuantityIndex, label: string): string[] {
	return entryFor(index, label)?.consumerNodeIds ?? [];
}

const chain: IndexableNode[] = [
	node('a', '$$v_0 = 3$$'),
	node('b', '$$a = 9.8$$'),
	node('c', '$$v = v_0 + a t$$')
];

describe('buildQuantityIndex', () => {
	it('records which node defines a quantity', () => {
		expect(definersOf(buildQuantityIndex(chain), 'v_0')).toEqual(['a']);
	});

	it('records which nodes consume a quantity', () => {
		expect(consumersOf(buildQuantityIndex(chain), 'v_0')).toEqual(['c']);
	});

	it('records a quantity defined by one node and consumed by several', () => {
		const index = buildQuantityIndex([
			node('def', '$$g = 9.8$$'),
			node('one', '$$x = g$$'),
			node('two', '$$y = g$$')
		]);
		expect(consumersOf(index, 'g')).toEqual(['one', 'two']);
	});

	it('records several definers for a conflicting quantity', () => {
		const index = buildQuantityIndex([node('one', '$$g = 9.8$$'), node('two', '$$g = 10$$')]);
		expect(definersOf(index, 'g')).toEqual(['one', 'two']);
	});

	it('exposes what each node defines and references', () => {
		const index = buildQuantityIndex(chain);
		expect(index.byNodeId.get('c')?.defines.map((each) => each.symbol.label)).toEqual(['v']);
		expect(index.byNodeId.get('c')?.references.map((symbol) => symbol.label)).toEqual([
			'v_0',
			'a',
			't'
		]);
	});

	it('is independent of node order', () => {
		const forward = buildQuantityIndex(chain);
		const reversed = buildQuantityIndex([...chain].reverse());
		expect(definersOf(reversed, 'v_0')).toEqual(definersOf(forward, 'v_0'));
		expect(consumersOf(reversed, 'v_0')).toEqual(consumersOf(forward, 'v_0'));
		expect([...reversed.entries.keys()].sort()).toEqual([...forward.entries.keys()].sort());
	});

	it('yields an empty index for a graph with no nodes', () => {
		const index = buildQuantityIndex([]);
		expect(index.entries.size).toBe(0);
	});

	it('yields no entries for a graph with no math', () => {
		expect(buildQuantityIndex([node('a', 'Plain prose.')]).entries.size).toBe(0);
	});
});

/**
 * The rule the whole feature turns on: writing an equation proposes a quantity,
 * confirming it is what wires the graph together.
 */
describe('designations, not text, decide dataflow', () => {
	const pair = [undesignated('def', '$$g = 9.8$$'), undesignated('use', '$$w = m g$$')];

	it('records the symbols an unconfirmed equation mentions', () => {
		const index = buildQuantityIndex(pair);
		expect([...index.entries.keys()].sort()).toEqual(['g', 'm', 'w']);
	});

	it('makes nobody a definer until an output is confirmed', () => {
		expect(definersOf(buildQuantityIndex(pair), 'g')).toEqual([]);
	});

	it('makes nobody a consumer until an input is confirmed', () => {
		expect(consumersOf(buildQuantityIndex(pair), 'g')).toEqual([]);
	});

	it('leaves an unconfirmed quantity untracked, so nothing draws it', () => {
		expect(trackedQuantities(buildQuantityIndex(pair))).toEqual([]);
	});

	it('records a definer for a confirmed output', () => {
		const index = buildQuantityIndex([
			{ ...undesignated('def', '$$g = 9.8$$'), outputs: [{ base: 'g', subscript: null }] }
		]);
		expect(definersOf(index, 'g')).toEqual(['def']);
	});

	it('records a consumer for a confirmed input', () => {
		const index = buildQuantityIndex([
			{ ...undesignated('use', '$$w = m g$$'), inputs: [{ base: 'g', subscript: null }] }
		]);
		expect(consumersOf(index, 'g')).toEqual(['use']);
	});

	it('confirms a subscripted quantity by its structural identity', () => {
		const index = buildQuantityIndex([
			{ ...undesignated('a', '$$v_0 = 3$$'), outputs: [{ base: 'v', subscript: '0' }] }
		]);
		expect(definersOf(index, 'v_0')).toEqual(['a']);
	});

	it('ignores a repeated designation rather than counting the node twice', () => {
		const index = buildQuantityIndex([
			{
				...undesignated('a', '$$g = 9.8$$'),
				outputs: [
					{ base: 'g', subscript: null },
					{ base: 'g', subscript: null }
				],
				inputs: [
					{ base: 'm', subscript: null },
					{ base: 'm', subscript: null }
				]
			}
		]);
		expect(definersOf(index, 'g')).toEqual(['a']);
		expect(consumersOf(index, 'm')).toEqual(['a']);
	});

	// The user said both. Dropping one would silently discard an edge they asked
	// for; the definer/consumer cross-product refuses the self-pair on its own.
	it('keeps both roles when a node designates one quantity as input and output', () => {
		const index = buildQuantityIndex([
			{
				...undesignated('a', '$$v = v + 1$$'),
				inputs: [{ base: 'v', subscript: null }],
				outputs: [{ base: 'v', subscript: null }]
			}
		]);
		expect(definersOf(index, 'v')).toEqual(['a']);
		expect(consumersOf(index, 'v')).toEqual(['a']);
	});
});

/**
 * A designation outliving the equation that suggested it is not an error. The
 * parser is a heuristic; dropping a confirmed edge because a rewording changed
 * extraction is exactly the flakiness confirmation exists to end.
 */
describe('stale designations', () => {
	const stale: IndexableNode = {
		id: 'a',
		description: 'Prose only, the equation was rewritten away.',
		tags: [],
		outputs: [{ base: 'g', subscript: null }]
	};

	it('keeps a definer whose text no longer contains the definition', () => {
		expect(definersOf(buildQuantityIndex([stale]), 'g')).toEqual(['a']);
	});

	it('reconstructs the symbol so identities still compare', () => {
		const entry = buildQuantityIndex([stale]).entries.get('g');
		expect(entry?.symbol).toEqual(symbolFor('g', null));
	});

	it('reconstructs a subscripted symbol with the label extraction would give it', () => {
		const index = buildQuantityIndex([
			{ id: 'a', description: 'prose', tags: [], outputs: [{ base: 'v', subscript: '0' }] }
		]);
		expect(index.entries.get(symbolFor('v', '0').key)?.symbol.label).toBe('v_0');
	});

	it('records no definition body, since there is no equation left to show', () => {
		expect(buildQuantityIndex([stale]).entries.get('g')?.definitions).toEqual([]);
	});

	it('still links a stale definer to a consumer', () => {
		const index = buildQuantityIndex([
			stale,
			{ ...undesignated('use', '$$w = g$$'), inputs: [{ base: 'g', subscript: null }] }
		]);
		expect(consumersOf(index, 'g')).toEqual(['use']);
		expect(definersOf(index, 'g')).toEqual(['a']);
	});
});

/** What the index is for, end to end: an edge appears only once both ends agree. */
describe('edges follow from the index', () => {
	it('draws nothing for an equation nobody confirmed', () => {
		const edges = deriveDataflowEdges(
			buildQuantityIndex([undesignated('a', '$$g = 9.8$$'), undesignated('b', '$$w = m g$$')])
		);
		expect(edges).toEqual([]);
	});

	it('draws exactly one edge from a confirmed output to a confirmed input', () => {
		const edges = deriveDataflowEdges(
			buildQuantityIndex([
				{ ...undesignated('a', '$$g = 9.8$$'), outputs: [{ base: 'g', subscript: null }] },
				{ ...undesignated('b', '$$w = m g$$'), inputs: [{ base: 'g', subscript: null }] }
			])
		);
		expect(edges.map((edge) => `${edge.sourceNodeId}->${edge.targetNodeId}`)).toEqual(['a->b']);
	});

	it('draws nothing when only the output half is confirmed', () => {
		const edges = deriveDataflowEdges(
			buildQuantityIndex([
				{ ...undesignated('a', '$$g = 9.8$$'), outputs: [{ base: 'g', subscript: null }] },
				undesignated('b', '$$w = m g$$')
			])
		);
		expect(edges).toEqual([]);
	});

	it('draws no self edge for a node designating one quantity both ways', () => {
		const edges = deriveDataflowEdges(
			buildQuantityIndex([
				{
					...undesignated('a', '$$v = v + 1$$'),
					inputs: [{ base: 'v', subscript: null }],
					outputs: [{ base: 'v', subscript: null }]
				}
			])
		);
		expect(edges).toEqual([]);
	});
});

describe('definition records', () => {
	it('carries the source and display mode of a confirmed definition', () => {
		const index = buildQuantityIndex([node('a', '$$F = m a$$')]);
		expect(entryFor(index, 'F')?.definitions).toEqual([
			{ nodeId: 'a', bodyKey: 'ma', sourceTex: 'F = m a', displayMode: true }
		]);
	});

	it('marks an inline definition as not display mode', () => {
		const index = buildQuantityIndex([node('a', 'weight $w = m g$ here')]);
		expect(entryFor(index, 'w')?.definitions[0]).toMatchObject({
			sourceTex: 'w = m g',
			displayMode: false
		});
	});

	it('keeps both statements when a node defines a quantity two ways', () => {
		const index = buildQuantityIndex([node('a', '$$x = 1$$ but also $$x = 2$$')]);
		expect(entryFor(index, 'x')?.definitions.map((record) => record.sourceTex)).toEqual([
			'x = 1',
			'x = 2'
		]);
	});

	it('records one definition per definer, not per designation', () => {
		const index = buildQuantityIndex([node('one', '$$g = 9.8$$'), node('two', '$$g = 10$$')]);
		expect(entryFor(index, 'g')?.definitions.map((record) => record.nodeId)).toEqual([
			'one',
			'two'
		]);
	});

	it('records nothing for a symbol the node never defined in its text', () => {
		const index = buildQuantityIndex([
			{ ...undesignated('a', '$$g = 9.8$$'), outputs: [{ base: 'q', subscript: null }] }
		]);
		expect(entryFor(index, 'q')?.definitions).toEqual([]);
	});
});

/**
 * The state between "nobody writes this down" and "someone confirmed it". A
 * symbol whose only definers are unconfirmed used to read as undefined, which
 * invited the reader to write a second node saying what the first already said.
 */
describe('text definers', () => {
	function textDefinersOf(index: QuantityIndex, label: string): string[] {
		return entryFor(index, label)?.textDefinerNodeIds ?? [];
	}

	it('records a node whose text defines a quantity nobody confirmed', () => {
		const index = buildQuantityIndex([undesignated('a', '$$y = 1$$')]);
		expect(textDefinersOf(index, 'y')).toEqual(['a']);
	});

	it('carries the source and display mode, so the equation can be rendered', () => {
		const index = buildQuantityIndex([undesignated('a', '$$y = 1$$')]);
		expect(entryFor(index, 'y')?.textDefinitions).toEqual([
			{ nodeId: 'a', bodyKey: '1', sourceTex: 'y = 1', displayMode: true }
		]);
	});

	it('marks an inline text definition as not display mode', () => {
		const index = buildQuantityIndex([undesignated('a', 'the value $y = 1$ here')]);
		expect(entryFor(index, 'y')?.textDefinitions[0]).toMatchObject({
			sourceTex: 'y = 1',
			displayMode: false
		});
	});

	// Confirming is what the unconfirmed row offers, and the row has to move
	// rather than double: one node, one answer to "who defines this?".
	it('drops a node from the text list once its output is confirmed', () => {
		const index = buildQuantityIndex([node('a', '$$y = 1$$')]);
		expect(definersOf(index, 'y')).toEqual(['a']);
		expect(textDefinersOf(index, 'y')).toEqual([]);
		expect(entryFor(index, 'y')?.textDefinitions).toEqual([]);
	});

	it('sorts several unconfirmed definers by node id', () => {
		const index = buildQuantityIndex([
			undesignated('zeta', '$$y = 3$$'),
			undesignated('alpha', '$$y = 1$$'),
			undesignated('mu', '$$y = 2$$')
		]);
		expect(textDefinersOf(index, 'y')).toEqual(['alpha', 'mu', 'zeta']);
	});

	it('keeps both statements when one node writes the quantity two ways', () => {
		const index = buildQuantityIndex([undesignated('a', '$$y = 1$$ and also $$y = 2$$')]);
		expect(entryFor(index, 'y')?.textDefinitions.map((record) => record.sourceTex)).toEqual([
			'y = 1',
			'y = 2'
		]);
	});

	it('names that node once, however many statements it made', () => {
		const index = buildQuantityIndex([undesignated('a', '$$y = 1$$ and also $$y = 2$$')]);
		expect(textDefinersOf(index, 'y')).toEqual(['a']);
	});

	it('contributes nothing from an opted-out node', () => {
		const index = buildQuantityIndex([undesignated('a', '$$y = 1$$', ['no-dataflow'])]);
		expect(index.entries.size).toBe(0);
	});

	it('contributes nothing from a node opted out by a custom tag', () => {
		const index = buildQuantityIndex([undesignated('a', '$$y = 1$$', ['scratch'])], {
			optOutTag: 'scratch'
		});
		expect(index.entries.size).toBe(0);
	});

	it('records no text definition for a stale confirmed definer', () => {
		const index = buildQuantityIndex([
			{
				id: 'a',
				description: 'Prose only, the equation was rewritten away.',
				tags: [],
				outputs: [{ base: 'g', subscript: null }]
			}
		]);
		expect(definersOf(index, 'g')).toEqual(['a']);
		expect(entryFor(index, 'g')?.textDefinitions).toEqual([]);
		expect(textDefinersOf(index, 'g')).toEqual([]);
	});

	// The state the one-tap confirm has to be idempotent about: a node whose text
	// defines the symbol while the *input* column is what got confirmed. It is
	// still writing the definition down, so it is still a text definer.
	it('still names a node whose text defines a symbol it confirmed as an input', () => {
		const index = buildQuantityIndex([
			{ ...undesignated('a', '$$y = 1$$'), inputs: [{ base: 'y', subscript: null }] }
		]);
		expect(definersOf(index, 'y')).toEqual([]);
		expect(consumersOf(index, 'y')).toEqual(['a']);
		expect(textDefinersOf(index, 'y')).toEqual(['a']);
	});

	it('names exactly the distinct nodes its records mention', () => {
		const index = buildQuantityIndex([
			undesignated('b', '$$y = 1$$ and also $$y = 2$$'),
			undesignated('a', '$$y = 3$$'),
			node('c', '$$y = 4$$')
		]);
		const entry = entryFor(index, 'y');
		expect(entry?.textDefinerNodeIds).toEqual([
			...new Set(entry?.textDefinitions.map((record) => record.nodeId))
		]);
	});

	// Text-defined-only is not tracked: an equation nobody confirmed draws no
	// chip on the canvas and no edge, which is the rule the whole layer turns on.
	it('leaves a text-defined-only quantity untracked', () => {
		const index = buildQuantityIndex([undesignated('a', '$$y = 1$$')]);
		const y = entryFor(index, 'y');
		expect(y && isTracked(y)).toBe(false);
		expect(trackedQuantities(index)).toEqual([]);
	});

	it('draws no edge from a text definer to a confirmed consumer', () => {
		const edges = deriveDataflowEdges(
			buildQuantityIndex([
				undesignated('a', '$$g = 9.8$$'),
				{ ...undesignated('b', '$$w = m g$$'), inputs: [{ base: 'g', subscript: null }] }
			])
		);
		expect(edges).toEqual([]);
	});

	// The facet is a pure function of (extraction, confirmed outputs), both of
	// which the existing signatures already cover — so it must not cost a re-parse.
	it('does not re-extract when a designation confirms a text definer', () => {
		const extract = vi.fn((candidate: { description: string; tags: string[] }) =>
			nodeQuantities(candidate)
		);
		const build = createQuantityIndexer({ extract });
		const before = undesignated('a', '$$y = 1$$');
		build([before]);
		extract.mockClear();
		const after = build([{ ...before, outputs: [{ base: 'y', subscript: null }] }]);
		expect(extract).not.toHaveBeenCalled();
		expect(after.entries.get('y')?.textDefinerNodeIds).toEqual([]);
		expect(after.entries.get('y')?.definerNodeIds).toEqual(['a']);
	});

	it('returns the identical index when nothing about the text definer changed', () => {
		const build = createQuantityIndexer();
		const nodes = [undesignated('a', '$$y = 1$$')];
		expect(build(nodes)).toBe(build(nodes.map((each) => ({ ...each }))));
	});
});

describe('promotion rule', () => {
	it('does not track a symbol nobody defines', () => {
		const index = buildQuantityIndex([node('solo', '$$E = m c^2$$')]);
		expect(trackedQuantities(index).map((entry) => entry.symbol.label)).toEqual(['E']);
	});

	it('still records the undefined symbols so diagnostics can offer them', () => {
		// The canvas stays quiet, but focus mode needs to know m and c exist.
		const index = buildQuantityIndex([node('solo', '$$E = m c^2$$')]);
		expect(consumersOf(index, 'm')).toEqual(['solo']);
		expect(consumersOf(index, 'c')).toEqual(['solo']);
	});

	it('marks an undefined symbol as untracked', () => {
		const index = buildQuantityIndex([node('solo', '$$E = m c^2$$')]);
		const m = [...index.entries.values()].find((entry) => entry.symbol.label === 'm');
		expect(m && isTracked(m)).toBe(false);
	});

	it('promotes a symbol once another node defines it', () => {
		const index = buildQuantityIndex([node('solo', '$$E = m c^2$$'), node('mass', '$$m = 5$$')]);
		expect(
			trackedQuantities(index)
				.map((entry) => entry.symbol.label)
				.sort()
		).toEqual(['E', 'm']);
	});
});

describe('opt-out', () => {
	it('excludes an opted-out node from the index', () => {
		const index = buildQuantityIndex([node('a', '$$g = 9.8$$', ['no-dataflow'])]);
		expect(index.entries.size).toBe(0);
	});

	it('leaves a quantity untracked when only the opted-out node defined it', () => {
		const index = buildQuantityIndex([
			node('def', '$$g = 9.8$$', ['no-dataflow']),
			node('use', '$$x = g$$')
		]);
		expect(trackedQuantities(index).map((entry) => entry.symbol.label)).toEqual(['x']);
	});

	// One tag, one meaning. A node tagged out of the dataflow layer is out of it,
	// including designations someone confirmed before tagging it.
	it('suppresses a confirmed output on an opted-out node', () => {
		const index = buildQuantityIndex([
			{
				...undesignated('a', '$$g = 9.8$$', ['no-dataflow']),
				outputs: [{ base: 'g', subscript: null }]
			}
		]);
		expect(index.entries.size).toBe(0);
	});

	it('suppresses a confirmed input on an opted-out node', () => {
		const index = buildQuantityIndex([
			node('def', '$$g = 9.8$$'),
			{
				...undesignated('use', '$$x = g$$', ['no-dataflow']),
				inputs: [{ base: 'g', subscript: null }]
			}
		]);
		expect(consumersOf(index, 'g')).toEqual([]);
	});

	it('suppresses a stale designation on an opted-out node too', () => {
		const index = buildQuantityIndex([
			{
				id: 'a',
				description: 'prose',
				tags: ['no-dataflow'],
				outputs: [{ base: 'g', subscript: null }]
			}
		]);
		expect(index.entries.size).toBe(0);
	});

	it('honours a custom opt-out tag for designations', () => {
		const index = buildQuantityIndex(
			[
				{
					...undesignated('a', '$$g = 9.8$$', ['scratch']),
					outputs: [{ base: 'g', subscript: null }]
				}
			],
			{ optOutTag: 'scratch' }
		);
		expect(index.entries.size).toBe(0);
	});
});

describe('memoization', () => {
	function countingIndexer() {
		const extract = vi.fn((candidate: { description: string; tags: string[] }) =>
			nodeQuantities(candidate)
		);
		return { extract, build: createQuantityIndexer({ extract }) };
	}

	it('extracts each node once on a first pass', () => {
		const { extract, build } = countingIndexer();
		build(chain);
		expect(extract).toHaveBeenCalledTimes(3);
	});

	it('extracts nothing again when nothing changed', () => {
		const { extract, build } = countingIndexer();
		build(chain);
		extract.mockClear();
		build(chain);
		expect(extract).not.toHaveBeenCalled();
	});

	it('re-extracts exactly the node whose description changed', () => {
		const { extract, build } = countingIndexer();
		build(chain);
		extract.mockClear();
		build([chain[0], chain[1], node('c', '$$v = a t$$')]);
		expect(extract).toHaveBeenCalledTimes(1);
		expect(extract.mock.calls[0][0].description).toBe('$$v = a t$$');
	});

	it('re-extracts a node whose tags changed, since the opt-out is a tag', () => {
		const { extract, build } = countingIndexer();
		build(chain);
		extract.mockClear();
		build([chain[0], chain[1], node('c', '$$v = v_0 + a t$$', ['no-dataflow'])]);
		expect(extract).toHaveBeenCalledTimes(1);
	});

	it('extracts only the added node when a graph grows', () => {
		const { extract, build } = countingIndexer();
		build(chain);
		extract.mockClear();
		build([...chain, node('d', '$$p = m v$$')]);
		expect(extract).toHaveBeenCalledTimes(1);
	});

	it('reflects an edit in the rebuilt index', () => {
		const { build } = countingIndexer();
		build(chain);
		const after = build([chain[0], chain[1], node('c', '$$v = a t$$')]);
		expect(consumersOf(after, 'v_0')).toEqual([]);
	});

	it('re-extracts a removed and re-added node rather than serving a stale entry', () => {
		const { extract, build } = countingIndexer();
		build(chain);
		build([chain[0], chain[1]]);
		extract.mockClear();
		build(chain);
		expect(extract).toHaveBeenCalledTimes(1);
	});

	// A title left out of the signature yields a graph that is correct after a
	// reload and wrong until then, which is the hardest kind of bug to notice.
	it('re-extracts a node whose title changed', () => {
		const { extract, build } = countingIndexer();
		const before = [{ id: 'a', title: '$x = 1$', description: '', tags: [] }];
		const after = [{ id: 'a', title: '$x = 2$', description: '', tags: [] }];
		build(before);
		extract.mockClear();
		build(after);
		expect(extract).toHaveBeenCalledTimes(1);
	});

	it('reflects a title edit that introduces a definition', () => {
		const { build } = countingIndexer();
		build([designated({ id: 'a', title: 'Untitled', description: '', tags: [] })]);
		const after = build([designated({ id: 'a', title: '$x = 1$', description: '', tags: [] })]);
		expect(definersOf(after, 'x')).toEqual(['a']);
	});

	// A conflict means two nodes disagree about a quantity. One node saying the
	// same thing twice is not a disagreement, and reporting it as one would make
	// the warning fire on the most ordinary way to write a node.
	it('records one definer when a node defines the same quantity in its title and description', () => {
		const { build } = countingIndexer();
		const index = build([
			designated({ id: 'a', title: '$x = 1$', description: 'Restated: $x = 1$', tags: [] })
		]);
		expect(definersOf(index, 'x')).toEqual(['a']);
	});

	it('reflects a title edit that removes a definition', () => {
		const { build } = countingIndexer();
		build([designated({ id: 'a', title: '$x = 1$', description: '', tags: [] })]);
		const after = build([designated({ id: 'a', title: 'Untitled', description: '', tags: [] })]);
		expect(definersOf(after, 'x')).toEqual([]);
	});

	// The whole reason the two signatures are separate: confirming a chip must not
	// re-render every equation in the node it was tapped on.
	it('does not re-extract when only a designation changed', () => {
		const { extract, build } = countingIndexer();
		const before = undesignated('a', '$$g = 9.8$$');
		build([before]);
		extract.mockClear();
		build([{ ...before, outputs: [{ base: 'g', subscript: null }] }]);
		expect(extract).not.toHaveBeenCalled();
	});

	it('still reflects the designation it did not re-extract for', () => {
		const { build } = countingIndexer();
		const before = undesignated('a', '$$g = 9.8$$');
		build([before]);
		const after = build([{ ...before, outputs: [{ base: 'g', subscript: null }] }]);
		expect(definersOf(after, 'g')).toEqual(['a']);
	});

	it('re-extracts when the text changes under an unchanged designation', () => {
		const { extract, build } = countingIndexer();
		const designation = { outputs: [{ base: 'g', subscript: null }] };
		build([{ ...undesignated('a', '$$g = 9.8$$'), ...designation }]);
		extract.mockClear();
		build([{ ...undesignated('a', '$$g = 10$$'), ...designation }]);
		expect(extract).toHaveBeenCalledTimes(1);
	});
});

// Callers rebuild the index from the whole graph, which gets a new identity on
// every frame of a drag. Reusing the extraction is not enough: a fresh index
// object invalidates everything derived from it just as thoroughly as changed
// math would.
describe('index identity', () => {
	function countingIndexer() {
		const extract = vi.fn((candidate: { description: string; tags: string[] }) =>
			nodeQuantities(candidate)
		);
		return { extract, build: createQuantityIndexer({ extract }) };
	}

	it('returns the identical index when every node still matches its memo', () => {
		const { build } = countingIndexer();
		expect(build(chain)).toBe(build(chain));
	});

	it('returns the identical index for equal nodes in fresh objects', () => {
		// The graph hands over rebuilt node objects, not the ones it was given.
		const { build } = countingIndexer();
		const first = build(chain);
		const second = build(chain.map((each) => ({ ...each })));
		expect(second).toBe(first);
	});

	it('returns the identical index when designations are restated as fresh objects', () => {
		const { build } = countingIndexer();
		const first = build(chain);
		const second = build(
			chain.map((each) => ({
				...each,
				inputs: each.inputs?.map((designation) => ({ ...designation })),
				outputs: each.outputs?.map((designation) => ({ ...designation }))
			}))
		);
		expect(second).toBe(first);
	});

	it('returns a fresh index when one node changed', () => {
		const { build } = countingIndexer();
		const first = build(chain);
		expect(build([chain[0], chain[1], node('c', '$$v = a t$$')])).not.toBe(first);
	});

	it('returns a fresh index when a node is removed', () => {
		const { build } = countingIndexer();
		const first = build(chain);
		expect(build([chain[0], chain[1]])).not.toBe(first);
	});

	it('returns a fresh index when a node is added', () => {
		const { build } = countingIndexer();
		const first = build(chain);
		expect(build([...chain, node('d', '$$p = m v$$')])).not.toBe(first);
	});

	it('settles back onto one identity after an edit', () => {
		const { build } = countingIndexer();
		build(chain);
		const edited = [chain[0], chain[1], node('c', '$$v = a t$$')];
		const after = build(edited);
		expect(build(edited)).toBe(after);
	});

	// Same id set, same content, but a node swapped in for one of the same id and
	// content: the identity return must not paper over a removal by counting.
	it('returns a fresh index when one node is swapped for a different one', () => {
		const { build } = countingIndexer();
		const first = build(chain);
		expect(build([chain[0], chain[1], node('d', '$$p = m v$$')])).not.toBe(first);
	});

	// The other half of the dual-signature contract: designations are not in the
	// extraction memo, so the identity return is the only thing that can notice
	// them changing. Missing this leaves stale chips and missing edges on screen.
	it('returns a fresh index when only a designation was added', () => {
		const { build } = countingIndexer();
		const before = undesignated('a', '$$g = 9.8$$');
		const first = build([before]);
		expect(build([{ ...before, outputs: [{ base: 'g', subscript: null }] }])).not.toBe(first);
	});

	it('returns a fresh index when a designation moves from input to output', () => {
		const { build } = countingIndexer();
		const before = undesignated('a', '$$g = 9.8$$');
		const first = build([{ ...before, inputs: [{ base: 'g', subscript: null }] }]);
		expect(build([{ ...before, outputs: [{ base: 'g', subscript: null }] }])).not.toBe(first);
	});

	it('settles back onto one identity after a designation change', () => {
		const { build } = countingIndexer();
		const before = undesignated('a', '$$g = 9.8$$');
		build([before]);
		const confirmed = [{ ...before, outputs: [{ base: 'g', subscript: null }] }];
		const after = build(confirmed);
		expect(build(confirmed.map((each) => ({ ...each })))).toBe(after);
	});
});

// `derivedMath` is a fourth thing extraction reads, so it has to be a fourth
// thing the extraction memo watches. Leaving it out gives a graph that is right
// after a reload and wrong until then — the bug the title comment above warns
// about, one field along.
describe('derived math', () => {
	function countingIndexer() {
		const extract = vi.fn((candidate: { description: string; tags: string[] }) =>
			nodeQuantities(candidate)
		);
		return { extract, build: createQuantityIndexer({ extract }) };
	}

	/** The one `RESULT` line the fixture's run reported, rendered. */
	const REPORTED = 'R_{th} = 12.3';

	const reported: IndexableNode = {
		id: 'ai',
		title: 'Analysis',
		description: '',
		tags: [],
		derivedMath: [REPORTED],
		outputs: [{ base: 'R', subscript: 'th' }]
	};

	it('records a definer for a confirmed quantity a derived entry states', () => {
		expect(definersOf(buildQuantityIndex([reported]), 'R_th')).toEqual(['ai']);
	});

	it('records an unconfirmed derived definition as a text definer', () => {
		const { derivedMath, id, title, description, tags } = reported;
		const index = buildQuantityIndex([{ id, title, description, tags, derivedMath }]);
		expect(entryFor(index, 'R_th')?.textDefinerNodeIds).toEqual(['ai']);
	});

	it('joins a derived definer to a node that consumes the quantity', () => {
		const index = buildQuantityIndex([
			reported,
			{
				id: 'use',
				title: 'Budget',
				description: '$$T = R_{th} P$$',
				tags: [],
				inputs: [{ base: 'R', subscript: 'th' }]
			}
		]);
		expect(consumersOf(index, 'R_th')).toEqual(['use']);
	});

	it('extracts each node once on a first pass', () => {
		const { extract, build } = countingIndexer();
		build([reported]);
		expect(extract).toHaveBeenCalledTimes(1);
	});

	it('re-extracts a node whose run reported a new result', () => {
		const { extract, build } = countingIndexer();
		build([reported]);
		extract.mockClear();
		build([{ ...reported, derivedMath: ['R_{th} = 14.1'] }]);
		expect(extract).toHaveBeenCalledTimes(1);
	});

	it('reflects the new result rather than serving the memoized definition', () => {
		const { build } = countingIndexer();
		build([reported]);
		const after = build([{ ...reported, derivedMath: ['R_{th} = 14.1'] }]);
		expect(entryFor(after, 'R_th')?.definitions.map((record) => record.sourceTex)).toEqual([
			'R_{th} = 14.1'
		]);
	});

	it('re-extracts a node whose results were evicted with their run', () => {
		const { extract, build } = countingIndexer();
		build([reported]);
		extract.mockClear();
		build([{ ...reported, derivedMath: [] }]);
		expect(extract).toHaveBeenCalledTimes(1);
	});

	// The load-bearing half: the graph hands the index rebuilt node objects on
	// every frame of a drag, and the signature is a string precisely so an
	// unchanged run hashes to what it hashed to before.
	it('does not re-extract when the same results arrive in a fresh array', () => {
		const { extract, build } = countingIndexer();
		build([reported]);
		extract.mockClear();
		build([{ ...reported, derivedMath: [REPORTED] }]);
		expect(extract).not.toHaveBeenCalled();
	});

	it('returns the identical index when the same results arrive in a fresh array', () => {
		const { build } = countingIndexer();
		const first = build([reported]);
		expect(build([{ ...reported, derivedMath: [REPORTED] }])).toBe(first);
	});

	it('returns a fresh index when a run reported a new result', () => {
		const { build } = countingIndexer();
		const first = build([reported]);
		expect(build([{ ...reported, derivedMath: ['R_{th} = 14.1'] }])).not.toBe(first);
	});

	// Absent and empty are the same claim — no results — so they must hash the
	// same, or a node acquires a rebuild by being handed its own emptiness twice.
	it('treats no derived math and an empty list as one signature', () => {
		const { extract, build } = countingIndexer();
		const bare: IndexableNode = { id: 'ai', title: 'Analysis', description: '', tags: [] };
		build([bare]);
		extract.mockClear();
		build([{ ...bare, derivedMath: [] }]);
		expect(extract).not.toHaveBeenCalled();
	});

	// A separator below the one that divides the fields would let a result run
	// into the tag list, so two different nodes could hash the same.
	it('tells a result apart from a tag spelled the same way', () => {
		const { build } = countingIndexer();
		const first = build([{ id: 'a', title: '', description: '', tags: ['x = 1'] }]);
		expect(
			build([{ id: 'a', title: '', description: '', tags: [], derivedMath: ['x = 1'] }])
		).not.toBe(first);
	});
});
