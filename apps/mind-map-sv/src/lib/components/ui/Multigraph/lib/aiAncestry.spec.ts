import { describe, expect, it } from 'vitest';
import { buildAnalyseRequest, buildRefineRequest } from '$lib/ai/aiRequest';
import type { AiSettings } from '$lib/ai/aiSettings';
import type { GraphAssetMetadata, MultigraphData } from '../../types/multigraph';
import type { AiAddon, AiRun, AiRunStatus, NodeData } from '../../types/node';
import { collectAiAncestors, renderAncestorContext, type AiAncestor } from './aiAncestry';
import { collectAiInputs } from './aiInputs';
import { inheritedScript } from './aiNode';
import { makeGraph } from './testFixtures';

const settings: AiSettings = {
	model: 'claude-opus-5',
	previewRows: 5,
	sendPlots: true,
	rememberKey: true
};

function run(status: AiRunStatus, summary: string, id = `r-${status}`): AiRun {
	return {
		id,
		startedAt: 0,
		status,
		mode: 'analyse',
		runtime: '0.27.7',
		inputs: [],
		summary,
		outputs: [],
		toolCalls: 1
	};
}

function aiAddon(over: Partial<AiAddon> = {}): AiAddon {
	return { prompt: 'Clean it up.', runs: [], promoted: {}, ...over };
}

type NodeInput = Omit<NodeData, 'tags'> & Partial<Pick<NodeData, 'tags'>>;

function aiNode(id: string, title: string, ai: Partial<AiAddon> = {}): NodeInput {
	return { id, title, description: '', addons: { ai: aiAddon(ai) } };
}

function plainNode(id: string, title = id): NodeInput {
	return { id, title, description: 'plain prose' };
}

interface EdgeInput {
	id?: string;
	source: string;
	target: string;
	directed?: boolean;
	tags?: string[];
}

function graph(nodes: NodeInput[], edges: EdgeInput[]): MultigraphData {
	return makeGraph({ nodes, edges });
}

/** `id — hops` per ancestor, which is the whole of what "in order" means here. */
function shape(ancestors: AiAncestor[]): string[] {
	return ancestors.map((ancestor) => `${ancestor.nodeId}@${ancestor.hops}`);
}

describe('collectAiAncestors', () => {
	it('reports nothing for a node with no ai neighbours', () => {
		const data = graph(
			[aiNode('child', '!ai Child'), plainNode('note')],
			[{ source: 'note', target: 'child', directed: true }]
		);
		expect(collectAiAncestors(data, 'child')).toEqual([]);
	});

	it('reports nothing for a node that is not in the graph', () => {
		expect(collectAiAncestors(graph([aiNode('a', 'A')], []), 'missing')).toEqual([]);
	});

	it('reports a direct parent with its title, prompt and latest done summary', () => {
		const data = graph(
			[
				aiNode('parent', 'Sweep A cleanup', {
					prompt: 'drop the first 200 samples',
					runs: [run('done', 'older', 'r1'), run('done', 'Three files, 41k rows each.', 'r2')]
				}),
				aiNode('child', '!ai Follow-up')
			],
			[{ source: 'parent', target: 'child', directed: true }]
		);

		expect(collectAiAncestors(data, 'child')).toEqual([
			{
				nodeId: 'parent',
				hops: 1,
				title: 'Sweep A cleanup',
				prompt: 'drop the first 200 samples',
				summary: 'Three files, 41k rows each.'
			}
		]);
	});

	it('reports a chain nearest first', () => {
		const data = graph(
			[aiNode('a', 'A'), aiNode('b', 'B'), aiNode('c', 'C')],
			[
				{ source: 'a', target: 'b', directed: true },
				{ source: 'b', target: 'c', directed: true }
			]
		);
		expect(shape(collectAiAncestors(data, 'c'))).toEqual(['b@1', 'a@2']);
	});

	it('stops at maxHops', () => {
		const data = graph(
			[aiNode('a', 'A'), aiNode('b', 'B'), aiNode('c', 'C'), aiNode('d', 'D')],
			[
				{ source: 'a', target: 'b', directed: true },
				{ source: 'b', target: 'c', directed: true },
				{ source: 'c', target: 'd', directed: true }
			]
		);
		expect(shape(collectAiAncestors(data, 'd', 3))).toEqual(['c@1', 'b@2', 'a@3']);
		expect(shape(collectAiAncestors(data, 'd', 2))).toEqual(['c@1', 'b@2']);
		expect(shape(collectAiAncestors(data, 'd', 0))).toEqual([]);
	});

	it('reaches an ai neighbour joined by an undirected edge on the same terms as a directed one', () => {
		const nodes = [aiNode('parent', 'Parent'), aiNode('child', 'Child')];
		const directed = graph(nodes, [{ source: 'parent', target: 'child', directed: true }]);
		const undirected = graph(nodes, [{ source: 'parent', target: 'child', directed: false }]);

		expect(collectAiAncestors(undirected, 'child')).toEqual(collectAiAncestors(directed, 'child'));
		expect(shape(collectAiAncestors(undirected, 'child'))).toEqual(['parent@1']);
	});

	it('lets two ai nodes joined by one undirected edge each report the other exactly once', () => {
		const data = graph(
			[aiNode('a', 'A'), aiNode('b', 'B')],
			[{ source: 'a', target: 'b', directed: false }]
		);
		expect(shape(collectAiAncestors(data, 'a'))).toEqual(['b@1']);
		expect(shape(collectAiAncestors(data, 'b'))).toEqual(['a@1']);
	});

	it('skips an outgoing directed neighbour, the way a promoted output is skipped', () => {
		const data = graph(
			[aiNode('child', 'Child'), aiNode('downstream', 'Downstream')],
			[{ source: 'child', target: 'downstream', directed: true }]
		);
		expect(collectAiAncestors(data, 'child')).toEqual([]);
	});

	it('ends a branch at a non-ai node rather than walking through it', () => {
		const data = graph(
			[aiNode('far', 'Far'), plainNode('middle'), aiNode('child', 'Child')],
			[
				{ source: 'far', target: 'middle', directed: true },
				{ source: 'middle', target: 'child', directed: true }
			]
		);
		expect(collectAiAncestors(data, 'child')).toEqual([]);
	});

	it('terminates on a two-node directed cycle, reporting the other node once', () => {
		const data = graph(
			[aiNode('a', 'A'), aiNode('b', 'B')],
			[
				{ id: 'ab', source: 'a', target: 'b', directed: true },
				{ id: 'ba', source: 'b', target: 'a', directed: true }
			]
		);
		expect(shape(collectAiAncestors(data, 'a'))).toEqual(['b@1']);
	});

	it('breaks ties in graph.nodes order, not edge order', () => {
		const nodes = [aiNode('first', 'First'), aiNode('second', 'Second'), aiNode('child', 'Child')];
		const data = graph(nodes, [
			{ id: 'e-second', source: 'second', target: 'child', directed: true },
			{ id: 'e-first', source: 'first', target: 'child', directed: true }
		]);
		expect(shape(collectAiAncestors(data, 'child'))).toEqual(['first@1', 'second@1']);
	});

	it('reports a node reachable two ways at its nearest distance, once', () => {
		const data = graph(
			[aiNode('root', 'Root'), aiNode('mid', 'Mid'), aiNode('child', 'Child')],
			[
				{ id: 'e1', source: 'root', target: 'child', directed: true },
				{ id: 'e2', source: 'root', target: 'mid', directed: true },
				{ id: 'e3', source: 'mid', target: 'child', directed: true }
			]
		);
		expect(shape(collectAiAncestors(data, 'child'))).toEqual(['root@1', 'mid@1']);
	});

	it('gives an ancestor with no done run its prompt and an empty summary', () => {
		const data = graph(
			[
				aiNode('parent', 'Parent', {
					prompt: 'plot it',
					runs: [run('done', 'the good one', 'r1'), run('error', 'the bad one', 'r2')]
				}),
				aiNode('errored', 'Errored', { prompt: 'try it', runs: [run('error', 'boom')] }),
				aiNode('child', 'Child')
			],
			[
				{ id: 'e1', source: 'parent', target: 'child', directed: true },
				{ id: 'e2', source: 'errored', target: 'child', directed: true }
			]
		);

		const [fromParent, fromErrored] = collectAiAncestors(data, 'child');
		// The latest *done* run, so a later failure does not erase the answer.
		expect(fromParent.summary).toBe('the good one');
		expect(fromErrored).toMatchObject({ prompt: 'try it', summary: '' });
	});

	it('carries a script on the direct parent only', () => {
		const data = graph(
			[
				aiNode('grand', 'Grand', { script: 'print("grand")' }),
				aiNode('parent', 'Parent', { script: 'print("parent")' }),
				aiNode('child', 'Child')
			],
			[
				{ id: 'e1', source: 'grand', target: 'parent', directed: true },
				{ id: 'e2', source: 'parent', target: 'child', directed: true }
			]
		);

		const ancestors = collectAiAncestors(data, 'child');
		expect(ancestors.map((ancestor) => ancestor.script)).toEqual(['print("parent")', undefined]);
	});

	it('resolves two parents with scripts the way inheritedScript does', () => {
		const data = graph(
			[
				aiNode('first', 'First', { script: 'print("first")' }),
				aiNode('second', 'Second', { script: 'print("second")' }),
				aiNode('child', 'Child')
			],
			[
				{ id: 'e1', source: 'first', target: 'child', directed: true },
				{ id: 'e2', source: 'second', target: 'child', directed: true }
			]
		);

		const scripted = collectAiAncestors(data, 'child').filter(
			(ancestor) => ancestor.script !== undefined
		);
		expect(scripted).toHaveLength(1);
		expect(scripted[0].script).toBe(inheritedScript(data, 'child'));
	});

	it('gives the script to the first parent that has one, skipping a parent with none', () => {
		const data = graph(
			[
				aiNode('first', 'First'),
				aiNode('second', 'Second', { script: 'print("second")' }),
				aiNode('child', 'Child')
			],
			[
				{ id: 'e1', source: 'first', target: 'child', directed: true },
				{ id: 'e2', source: 'second', target: 'child', directed: true }
			]
		);

		const ancestors = collectAiAncestors(data, 'child');
		expect(ancestors.map((ancestor) => ancestor.script)).toEqual([undefined, 'print("second")']);
		expect(ancestors[1].script).toBe(inheritedScript(data, 'child'));
	});
});

/**
 * The rule for who is adjacent is one rule: whatever contributes files to a
 * run contributes prose to its context, and whatever contributes neither
 * contributes neither. Asserted against `collectAiInputs` itself rather than
 * against a remembered list of orientations, so the two can only agree.
 */
describe('the adjacency rule shared with input collection', () => {
	const asset: GraphAssetMetadata = {
		id: 'a-sweep',
		kind: 'file',
		mimeType: 'text/csv',
		name: 'sweep.csv',
		size: 1024,
		createdAt: 0
	};

	function orientedGraph(edge: EdgeInput): MultigraphData {
		return {
			...graph(
				[
					{
						...aiNode('parent', 'Parent'),
						content: [{ type: 'file', assetId: 'a-sweep', name: 'sweep.csv' }]
					},
					aiNode('child', 'Child')
				],
				[edge]
			),
			assets: { 'a-sweep': asset }
		};
	}

	it.each([
		['an incoming directed edge', { source: 'parent', target: 'child', directed: true }, true],
		['an undirected edge from the parent', { source: 'parent', target: 'child' }, true],
		['an undirected edge to the parent', { source: 'child', target: 'parent' }, true],
		['an outgoing directed edge', { source: 'child', target: 'parent', directed: true }, false]
	])('%s: files and prose agree', (_name, edge, expected) => {
		const data = orientedGraph(edge);

		const contributesFiles = collectAiInputs(data, 'child').some(
			(input) => input.kind === 'file' && input.nodeId === 'parent'
		);
		const contributesProse = collectAiAncestors(data, 'child').some(
			(ancestor) => ancestor.nodeId === 'parent'
		);

		expect(contributesFiles).toBe(expected);
		expect(contributesProse).toBe(contributesFiles);
	});
});

function ancestor(over: Partial<AiAncestor> = {}): AiAncestor {
	return {
		nodeId: 'parent',
		hops: 1,
		title: 'Sweep A cleanup',
		prompt: 'drop the first 200 samples from each file',
		summary: 'Three files, 41k rows each.',
		...over
	};
}

const NO_LIMITS = { maxChars: 100_000, ancestorSummaryMaxChars: 1000 };

describe('renderAncestorContext', () => {
	it('is empty when there are no ancestors', () => {
		expect(renderAncestorContext([], NO_LIMITS, { includeParentScript: true })).toBe('');
	});

	it('renders the heading, the step, what was asked and what came back', () => {
		const text = renderAncestorContext([ancestor()], NO_LIMITS, { includeParentScript: false });
		expect(text).toBe(
			'Conversation so far (nearest first):\n\n' +
				'1 step back — Sweep A cleanup\n' +
				'Asked: drop the first 200 samples from each file\n' +
				'Result: Three files, 41k rows each.'
		);
	});

	it('pluralises the step count and keeps the nearest first', () => {
		const text = renderAncestorContext(
			[ancestor(), ancestor({ nodeId: 'grand', hops: 2, title: 'Raw import' })],
			NO_LIMITS,
			{ includeParentScript: false }
		);
		expect(text).toContain('1 step back — Sweep A cleanup');
		expect(text).toContain('2 steps back — Raw import');
		expect(text.indexOf('1 step back')).toBeLessThan(text.indexOf('2 steps back'));
	});

	it('says so when a step has no result to report', () => {
		const text = renderAncestorContext([ancestor({ summary: '   ' })], NO_LIMITS, {
			includeParentScript: false
		});
		expect(text).toContain('Result: (no result recorded)');
	});

	it('drops the Asked line for an ancestor with no prompt', () => {
		const text = renderAncestorContext([ancestor({ prompt: '  ' })], NO_LIMITS, {
			includeParentScript: false
		});
		expect(text).not.toContain('Asked:');
		expect(text).toContain('Result: Three files, 41k rows each.');
	});

	it('renders the parent script in a fenced block only when it is included', () => {
		const ancestors = [ancestor({ script: 'print("hello")' })];
		const withScript = renderAncestorContext(ancestors, NO_LIMITS, { includeParentScript: true });
		const without = renderAncestorContext(ancestors, NO_LIMITS, { includeParentScript: false });

		expect(withScript).toContain('Its analysis.py:\n```python\nprint("hello")\n```');
		expect(without).not.toContain('analysis.py');
		expect(without).not.toContain('print("hello")');
	});

	it('trims summaries before it drops anything', () => {
		const ancestors = [
			ancestor({ summary: 'x'.repeat(2000) }),
			ancestor({ nodeId: 'grand', hops: 2, title: 'Raw import', summary: 'y'.repeat(2000) })
		];
		const text = renderAncestorContext(
			ancestors,
			{ maxChars: 1200, ancestorSummaryMaxChars: 300 },
			{ includeParentScript: false }
		);

		expect(text.length).toBeLessThanOrEqual(1200);
		expect(text).toContain('Raw import');
		expect(text).not.toContain('omitted');
		expect(text).toContain(`Result: ${'x'.repeat(300)}\n`);
		expect(text).not.toContain('x'.repeat(301));
	});

	it('then drops the farthest ancestor whole and says how many went', () => {
		const ancestors = [1, 2, 3].map((hops) =>
			ancestor({ nodeId: `n${hops}`, hops, title: `Step ${hops}`, summary: 'z'.repeat(400) })
		);
		const text = renderAncestorContext(
			ancestors,
			{ maxChars: 620, ancestorSummaryMaxChars: 400 },
			{ includeParentScript: false }
		);

		expect(text.length).toBeLessThanOrEqual(620);
		expect(text).toContain('Step 1');
		expect(text).not.toContain('Step 3');
		expect(text).toContain('(2 earlier steps omitted.)');
	});

	it('says "step" in the singular when exactly one was dropped', () => {
		const ancestors = [1, 2].map((hops) =>
			ancestor({ nodeId: `n${hops}`, hops, title: `Step ${hops}`, summary: 'z'.repeat(400) })
		);
		const text = renderAncestorContext(
			ancestors,
			{ maxChars: 620, ancestorSummaryMaxChars: 400 },
			{ includeParentScript: false }
		);
		expect(text).toContain('(1 earlier step omitted.)');
	});

	it('keeps the parent script when the ancestors around it are being dropped', () => {
		const ancestors = [
			ancestor({ nodeId: 'n1', hops: 1, title: 'Step 1', script: 'print("keep me")' }),
			ancestor({ nodeId: 'n2', hops: 2, title: 'Step 2', summary: 'z'.repeat(3000) }),
			ancestor({ nodeId: 'n3', hops: 3, title: 'Step 3', summary: 'z'.repeat(3000) })
		];
		const text = renderAncestorContext(
			ancestors,
			{ maxChars: 1000, ancestorSummaryMaxChars: 600 },
			{ includeParentScript: true }
		);

		expect(text.length).toBeLessThanOrEqual(1000);
		expect(text).toContain('print("keep me")');
		expect(text).toContain('earlier step');
	});

	it('protects the script even when a nearer parent sits before it', () => {
		const ancestors = [
			ancestor({ nodeId: 'n1', hops: 1, title: 'Step 1', summary: 'z'.repeat(3000) }),
			ancestor({ nodeId: 'n2', hops: 1, title: 'Step 2', script: 'print("keep me")' })
		];
		const text = renderAncestorContext(
			ancestors,
			{ maxChars: 400, ancestorSummaryMaxChars: 600 },
			{ includeParentScript: true }
		);

		expect(text.length).toBeLessThanOrEqual(400);
		expect(text).toContain('print("keep me")');
		expect(text).not.toContain('Step 1');
	});

	it('gives up the script last, and never exceeds maxChars even then', () => {
		const ancestors = [ancestor({ script: 'print("x")\n'.repeat(200) })];
		const text = renderAncestorContext(
			ancestors,
			{ maxChars: 300, ancestorSummaryMaxChars: 100 },
			{ includeParentScript: true }
		);

		expect(text.length).toBeLessThanOrEqual(300);
		expect(text).not.toContain('analysis.py');
	});

	it('cuts to length when even one ancestor cannot fit', () => {
		const text = renderAncestorContext(
			[ancestor({ summary: 'q'.repeat(5000) })],
			{ maxChars: 60, ancestorSummaryMaxChars: 4000 },
			{ includeParentScript: false }
		);
		expect(text).toHaveLength(60);
	});
});

/** How many times `needle` appears in `text`. */
function occurrences(text: string, needle: string): number {
	return text.split(needle).length - 1;
}

/** A parent with a script and a done run, and the child that follows it up. */
function chain(): MultigraphData {
	return graph(
		[
			aiNode('parent', 'Sweep A cleanup', {
				prompt: 'drop the first 200 samples',
				script: 'import pandas as pd\nprint("the parent script")',
				runs: [run('done', 'Wrote clean_a.csv.')]
			}),
			aiNode('child', '!ai Follow-up', { prompt: 'now fit a line to it' })
		],
		[{ source: 'parent', target: 'child', directed: true }]
	);
}

describe('the parent script in a built request', () => {
	const PARENT_SCRIPT = 'import pandas as pd\nprint("the parent script")';

	it('appears exactly once in a Change request, under Previous analysis.py', () => {
		const data = chain();
		const ancestorContext = renderAncestorContext(
			collectAiAncestors(data, 'child'),
			{},
			// Change mode already carries the script; the context must not repeat it.
			{ includeParentScript: false }
		);
		const request = buildRefineRequest({
			prompt: 'now fit a line to it',
			inputs: [],
			digests: [],
			settings,
			ancestorContext,
			previousScript: inheritedScript(data, 'child') ?? ''
		});

		const text = request.messages[0].content;
		if (typeof text !== 'string') throw new Error('the user message should be plain text');
		expect(occurrences(text, PARENT_SCRIPT)).toBe(1);
		expect(text).toContain(`Previous analysis.py:\n\`\`\`python\n${PARENT_SCRIPT}\n\`\`\``);
		expect(text).toContain('Conversation so far (nearest first):');
	});

	it('appears exactly once in a Write request, inside the context section', () => {
		const data = chain();
		const ancestorContext = renderAncestorContext(
			collectAiAncestors(data, 'child'),
			{},
			// A Write request has no `previousScript`, so this is the only way the
			// script can reach the model at all.
			{ includeParentScript: true }
		);
		const request = buildAnalyseRequest({
			prompt: 'now fit a line to it',
			inputs: [],
			digests: [],
			settings,
			ancestorContext
		});

		const text = request.messages[0].content;
		if (typeof text !== 'string') throw new Error('the user message should be plain text');
		expect(occurrences(text, PARENT_SCRIPT)).toBe(1);
		expect(text).toContain('Its analysis.py:');
		expect(text).not.toContain('Previous analysis.py:');
	});
});
