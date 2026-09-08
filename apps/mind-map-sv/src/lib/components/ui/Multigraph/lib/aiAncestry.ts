/**
 * The conversation a follow-up node is part of, as prose its request can carry.
 *
 * A child asks its question against work that has already happened, and the
 * files alone do not say what was asked or what came back. This walks back up
 * the chain of `!ai` nodes and renders what each step asked and what it
 * reported, so the model reading the child's prompt knows the story it is
 * continuing.
 *
 * Two rules keep it predictable. The walk steps by **the same adjacency rule
 * input collection uses** (`feedingNodeIds`) — a reader who can predict which
 * files a node reads can predict which conversation it remembers — and it is
 * bounded twice, by hops and by rendered characters, because prose from three
 * steps back is paid for on every request the child ever makes.
 *
 * Pure throughout: a graph and two numbers in, a string out. Nothing here knows
 * about run modes, requests or the workbench — the caller decides whether the
 * parent's script belongs in the section, because only the caller knows whether
 * the request is about to carry it separately.
 */

import { APP_CONFIG } from '$lib/appConfig';
import type { MultigraphData } from '../../types/multigraph';
import type { AiAddon, NodeData } from '../../types/node';
import { feedingNodeIds } from './aiAdjacency';
import { latestDoneRun } from './aiNode';

/** One earlier step, as the context section states it. */
export interface AiAncestor {
	nodeId: string;
	/** Steps back from the node asking: 1 is a direct parent. */
	hops: number;
	title: string;
	/** The node's saved prompt — what that step was asked to do. */
	prompt: string;
	/**
	 * The latest done run's summary — what it reported. Empty when the node has
	 * no done run at all, which is the honest answer for a step that errored, was
	 * cancelled, or has not been run yet.
	 */
	summary: string;
	/**
	 * `analysis.py`, on the one direct parent a child would inherit it from.
	 *
	 * Only ever populated for `hops === 1`, and only on the first such parent in
	 * `graph.nodes` order that has a script — the same node `inheritedScript`
	 * picks, so the script the context offers and the script a Change run edits
	 * are never two different scripts. A grandparent's script is not what this
	 * node is about, and sending several would be sending the largest thing in
	 * the request more than once.
	 */
	script?: string;
}

/**
 * The `!ai` steps behind `nodeId`, nearest first.
 *
 * Breadth first, so the list is ordered by distance and a cap on `maxHops` cuts
 * the far end rather than an arbitrary branch. Within one distance, ties break
 * in `graph.nodes` order — not edge order, so drawing an unrelated edge does
 * not reshuffle what a request carries.
 *
 * A neighbour without the `ai` add-on **ends that branch**: its text is already
 * carried as a one-hop input, and walking through it would reach nodes that
 * have nothing to do with the analysis. The node itself is never in the result,
 * and the visited set is load-bearing rather than defensive — under this
 * adjacency rule an undirected pair of AI nodes is mutual ancestry in the
 * ordinary case, so without it the ordinary case would not terminate.
 */
export function collectAiAncestors(
	graph: MultigraphData,
	nodeId: string,
	maxHops: number = APP_CONFIG.ai.ancestorContext.maxHops
): AiAncestor[] {
	const self = graph.nodes.find((node) => node.id === nodeId);
	if (self === undefined) return [];

	const order = new Map(graph.nodes.map((node, index) => [node.id, index] as const));
	const byId = new Map(graph.nodes.map((node) => [node.id, node] as const));

	const visited = new Set<string>([nodeId]);
	const ancestors: AiAncestor[] = [];
	let frontier: string[] = [nodeId];

	for (let hops = 1; hops <= Math.trunc(maxHops) && frontier.length > 0; hops += 1) {
		const discovered = new Set<string>();
		for (const fromId of frontier) {
			for (const neighborId of feedingNodeIds(graph, fromId)) {
				if (visited.has(neighborId)) continue;
				visited.add(neighborId);
				discovered.add(neighborId);
			}
		}

		// Sorted rather than taken in discovery order: two nodes in the frontier can
		// each reach the same level, and the order they were expanded in is edge
		// order in disguise.
		const level = [...discovered].sort(
			(left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0)
		);

		const next: string[] = [];
		for (const id of level) {
			const node = byId.get(id);
			const ai = node?.addons?.ai;
			// A non-AI neighbour contributes nothing and is not stepped through.
			if (node === undefined || ai === undefined) continue;
			ancestors.push(ancestorOf(node, ai, hops));
			next.push(id);
		}
		frontier = next;
	}

	return withParentScript(ancestors, byId);
}

function ancestorOf(node: NodeData, ai: AiAddon, hops: number): AiAncestor {
	return {
		nodeId: node.id,
		hops,
		title: node.title,
		prompt: ai.prompt,
		summary: latestDoneRun(ai)?.summary ?? ''
	};
}

/**
 * The list with `script` set on the one direct parent that carries it, chosen
 * the way `inheritedScript` chooses it: the first parent in `graph.nodes` order
 * — which is the order the one-hop entries are already in — that has one. A
 * parent with no script does not veto a sibling that has one, and no entry
 * beyond one hop is ever given one.
 */
function withParentScript(ancestors: AiAncestor[], byId: Map<string, NodeData>): AiAncestor[] {
	const index = ancestors.findIndex(
		(ancestor) => ancestor.hops === 1 && byId.get(ancestor.nodeId)?.addons?.ai?.script !== undefined
	);
	if (index === -1) return ancestors;

	const script = byId.get(ancestors[index].nodeId)?.addons?.ai?.script;
	if (script === undefined) return ancestors;

	const withScript = [...ancestors];
	withScript[index] = { ...withScript[index], script };
	return withScript;
}

/** How long the rendered section, and each summary inside it, may be. */
interface AncestorContextLimits {
	maxChars?: number;
	ancestorSummaryMaxChars?: number;
}

/**
 * Whether the direct parent's `analysis.py` belongs in the section.
 *
 * The caller's decision, not the renderer's: a Change request already appends
 * that script under `Previous analysis.py:`, so including it here too would
 * send the largest block in the request twice under two different labels. A
 * Write request has no such block, so the context is the only place the script
 * can come from.
 */
interface AncestorContextOptions {
	includeParentScript: boolean;
}

const HEADING = 'Conversation so far (nearest first):';

/** What an entry says when the step has produced no summary to report. */
const NO_RESULT = '(no result recorded)';

/**
 * The ancestors as the prose a request carries, or `''` when there are none.
 *
 * Shape, nearest first:
 *
 * ```text
 * Conversation so far (nearest first):
 *
 * 1 step back — Sweep A cleanup
 * Asked: drop the first 200 samples from each file
 * Result: Three files, 41k rows each. …
 *
 * Its analysis.py:
 * ```python
 * …
 * ```
 *
 * 2 steps back — Raw import
 * Asked: …
 * Result: …
 *
 * (1 earlier step omitted.)
 * ```
 *
 * Over `maxChars` it gives ground in a fixed order, so what survives is the
 * part nearest the question being asked: every summary is trimmed to
 * `ancestorSummaryMaxChars` first, then the farthest ancestor is dropped whole
 * and the count of what went is stated, and only when nothing else is left to
 * give does the parent's script go. The result never exceeds `maxChars` — a
 * single ancestor that cannot fit even alone is cut to length, because a
 * request that overruns its budget is worse than a sentence that stops mid-word.
 */
export function renderAncestorContext(
	ancestors: readonly AiAncestor[],
	limits: AncestorContextLimits,
	options: AncestorContextOptions
): string {
	const {
		maxChars = APP_CONFIG.ai.ancestorContext.maxChars,
		ancestorSummaryMaxChars = APP_CONFIG.ai.ancestorContext.ancestorSummaryMaxChars
	} = limits;
	if (ancestors.length === 0) return '';

	const total = ancestors.length;
	const full = render(ancestors, total, options.includeParentScript);
	if (full.length <= maxChars) return full;

	let kept = ancestors.map((ancestor) => ({
		...ancestor,
		summary: ancestor.summary.slice(0, Math.max(0, ancestorSummaryMaxChars))
	}));

	for (;;) {
		const text = render(kept, total, options.includeParentScript);
		if (text.length <= maxChars) return text;
		// One step is the floor: a context section with nothing in it is a heading
		// and a count, which is worse than the nearest step alone.
		if (kept.length <= 1) break;

		const fewer = withoutFarthest(kept, options.includeParentScript);
		if (fewer === undefined) break;
		kept = fewer;
	}

	// Everything droppable is gone, so the script is the last thing left to give.
	const withoutScript = render(kept, total, false);
	return withoutScript.length <= maxChars ? withoutScript : withoutScript.slice(0, maxChars);
}

/**
 * The same list without its farthest entry, or `undefined` when the only
 * entries left are ones that must not go.
 *
 * The script's own entry is protected while the script is being included, so
 * the ancestors' prose is always given up before it. It is protected by
 * carrying a script rather than by position, because two direct parents can be
 * one hop away and it is the second of them that may hold the script.
 */
function withoutFarthest(
	ancestors: readonly AiAncestor[],
	includeParentScript: boolean
): AiAncestor[] | undefined {
	for (let index = ancestors.length - 1; index >= 0; index -= 1) {
		if (includeParentScript && ancestors[index].script !== undefined) continue;
		return [...ancestors.slice(0, index), ...ancestors.slice(index + 1)];
	}
	return undefined;
}

function render(kept: readonly AiAncestor[], total: number, includeParentScript: boolean): string {
	const blocks = [HEADING, ...kept.map((ancestor) => renderEntry(ancestor, includeParentScript))];
	const omitted = total - kept.length;
	if (omitted > 0) {
		blocks.push(`(${omitted} earlier ${omitted === 1 ? 'step' : 'steps'} omitted.)`);
	}
	return blocks.join('\n\n');
}

function renderEntry(ancestor: AiAncestor, includeParentScript: boolean): string {
	const title = ancestor.title.trim();
	const step = `${ancestor.hops} ${ancestor.hops === 1 ? 'step' : 'steps'} back`;
	const lines = [title === '' ? step : `${step} — ${title}`];

	const prompt = ancestor.prompt.trim();
	// An absent question is nothing to say; an absent result is something to
	// say, because "this step has not answered yet" is what stops the model
	// treating silence as agreement.
	if (prompt !== '') lines.push(`Asked: ${prompt}`);
	const summary = ancestor.summary.trim();
	lines.push(`Result: ${summary === '' ? NO_RESULT : summary}`);

	const entry = lines.join('\n');
	if (!includeParentScript || ancestor.script === undefined) return entry;
	return `${entry}\n\nIts analysis.py:\n\`\`\`python\n${ancestor.script}\n\`\`\``;
}
