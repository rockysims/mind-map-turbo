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
