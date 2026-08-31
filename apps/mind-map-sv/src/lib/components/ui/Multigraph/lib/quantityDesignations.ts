/**
 * Turn one node's parsed math and confirmed designations into the chips the user
 * taps.
 *
 * Two sources meet here and stay distinguishable. What the user confirmed is the
 * truth — it is what draws edges — and what the parser noticed is only an offer.
 * A chip therefore says which of the two it came from (`role`) and, for the ones
 * that came from the parser, which column it would land in if accepted
 * (`suggestedRole`), so a ghost appears where the user would have put it anyway.
 *
 * A confirmed designation whose symbol the parser no longer finds is *stale*, not
 * gone. The parser is a heuristic over prose; rewording a sentence must not
 * silently delete an edge the user asked for. Stale chips keep their column, keep
 * their edge, and are flagged so the discrepancy is visible — and they come off
 * by the same tap that put them on.
 */

import { symbolFor, type QuantitySymbol } from '../../MathText/lib/mathSymbols';
import type { QuantityDesignation } from '../../types/node';
import type { NodeQuantities } from './nodeQuantities';

export type DesignationRole = 'input' | 'output' | 'suggestion';

export interface DesignationChip {
	symbol: QuantitySymbol;
	role: DesignationRole;
	/** Confirmed, but the node's text no longer mentions the symbol. */
	stale: boolean;
	/**
	 * Where the parser thinks this quantity belongs — a suggestion's column, and
	 * every chip's first stop around the assignment cycle. Absent when the parser
	 * no longer sees the symbol at all.
	 */
	suggestedRole?: 'input' | 'output';
}

export interface DesignationView {
	inputs: DesignationChip[];
	outputs: DesignationChip[];
	suggestions: DesignationChip[];
}

/** Confirmed designations for one node, as they are stored. */
interface NodeDesignations {
	inputs?: readonly QuantityDesignation[];
	outputs?: readonly QuantityDesignation[];
}

/** Anything carrying the structural identity of a quantity. */
type DesignatableSymbol = QuantitySymbol | QuantityDesignation;

function keyOf(symbol: DesignatableSymbol): string {
	return symbolFor(symbol.base, symbol.subscript).key;
}

function designationOf(symbol: DesignatableSymbol): QuantityDesignation {
	return { base: symbol.base, subscript: symbol.subscript };
}

/**
 * Every symbol the parser found, and which column its role implies.
 *
 * A symbol the node both defines and mentions is a definition that restates its
 * own quantity (`v = v + 1`), which `nodeQuantities` already filters out of the
 * references; defines are read first regardless, so the stronger claim wins.
 */
function parsedSymbols(
	parsed: NodeQuantities
): Map<string, { symbol: QuantitySymbol; role: 'input' | 'output' }> {
	const found = new Map<string, { symbol: QuantitySymbol; role: 'input' | 'output' }>();
	for (const definition of parsed.defines) {
		if (!found.has(definition.symbol.key)) {
			found.set(definition.symbol.key, { symbol: definition.symbol, role: 'output' });
		}
	}
	for (const symbol of parsed.references) {
		if (!found.has(symbol.key)) {
			found.set(symbol.key, { symbol, role: 'input' });
		}
	}
	return found;
}

function confirmedChips(
	designations: readonly QuantityDesignation[] | undefined,
	role: 'input' | 'output',
	parsed: ReadonlyMap<string, { symbol: QuantitySymbol; role: 'input' | 'output' }>
): DesignationChip[] {
	const seen = new Set<string>();
	const chips: DesignationChip[] = [];
	for (const designation of designations ?? []) {
		const key = keyOf(designation);
		if (seen.has(key)) continue;
		seen.add(key);
		const found = parsed.get(key);
		chips.push({
			// The parsed symbol when there is one: it was read off the author's math,
			// and a rebuilt one is only equal to it, never the same object.
			symbol: found?.symbol ?? symbolFor(designation.base, designation.subscript),
			role,
			stale: found === undefined,
			...(found === undefined ? {} : { suggestedRole: found.role })
		});
	}
	return chips;
}

/**
 * The chips for one node: confirmed inputs, confirmed outputs, and the parsed
 * symbols nobody has decided about yet.
 *
 * Suggestions come out in the order the parser reported them — definitions
 * before mentions, document order within each — so the ghosts sit where the
 * reading eye left them.
 */
export function designationView(
	parsed: NodeQuantities,
	inputs: readonly QuantityDesignation[] | undefined,
	outputs: readonly QuantityDesignation[] | undefined
): DesignationView {
	const found = parsedSymbols(parsed);
	const inputChips = confirmedChips(inputs, 'input', found);
	const outputChips = confirmedChips(outputs, 'output', found);

	const decided = new Set<string>([
		...inputChips.map((chip) => chip.symbol.key),
		...outputChips.map((chip) => chip.symbol.key)
	]);

	const suggestions: DesignationChip[] = [];
	for (const [key, { symbol, role }] of found) {
		if (decided.has(key)) continue;
		suggestions.push({ symbol, role: 'suggestion', stale: false, suggestedRole: role });
	}

	return { inputs: inputChips, outputs: outputChips, suggestions };
}

function withoutKey(
	designations: readonly QuantityDesignation[] | undefined,
	key: string
): QuantityDesignation[] {
	return (designations ?? []).filter((designation) => keyOf(designation) !== key);
}

/**
 * Put one quantity in a named column and leave it there, whatever it was before.
 *
 * Deliberately not the cycle. The cycle's job is a three-state toggle under a
 * repeated tap, so its terminal state is *unassigned* — which means asking it to
 * "make this an output" on a quantity currently confirmed as an input takes the
 * designation away instead. That state is two taps from any ghost chip, so a
 * one-tap "confirm this node as the definer" built on the cycle would sometimes
 * unconfirm what the reader pointed at, and would look like a bug in the button
 * rather than in the state it started from.
 *
 * Idempotent by construction: both columns lose the key before the target gains
 * it, so pressing twice says the same thing twice. Entries the call did not name
 * keep their order, since that order is the user's and is what gets persisted.
 */
export function designateAs(
	io: NodeDesignations,
	symbol: DesignatableSymbol,
	role: 'input' | 'output'
): { inputs: QuantityDesignation[]; outputs: QuantityDesignation[] } {
	const key = keyOf(symbol);
	const assigned = [designationOf(symbol)];
	return {
		inputs: [...withoutKey(io.inputs, key), ...(role === 'input' ? assigned : [])],
		outputs: [...withoutKey(io.outputs, key), ...(role === 'output' ? assigned : [])]
	};
}

/**
 * Advance one quantity around the assignment cycle: unassigned → suggested role
 * → the other role → unassigned. With no suggestion the cycle enters at input.
 *
 * Entering at the suggested role is what makes the common case one tap: a ghost
 * chip sits in the column the parser guessed, and tapping it must confirm it
 * there — landing it in the opposite column would contradict what the tap
 * visibly pointed at. One tap, one surface, three states, and reversible in at
 * most two taps, which is what makes tapping the wrong chip harmless. Entries
 * the tap did not name keep their order, since that order is the user's and is
 * what gets persisted.
 */
export function cycleDesignation(
	io: NodeDesignations,
	symbol: DesignatableSymbol,
	suggestedRole: 'input' | 'output' = 'input'
): { inputs: QuantityDesignation[]; outputs: QuantityDesignation[] } {
	const key = keyOf(symbol);
	const wasInput = (io.inputs ?? []).some((designation) => keyOf(designation) === key);
	const wasOutput = (io.outputs ?? []).some((designation) => keyOf(designation) === key);
	const second = suggestedRole === 'input' ? 'output' : 'input';

	// A quantity designated both ways at once — the index honours that, and the
	// data model allows it — resolves to unassigned: whatever the cycle's order,
	// its state before unassigned is one of the two, so releasing both is next.
	const inSecond = second === 'output' ? wasOutput : wasInput;
	if (inSecond) {
		return { inputs: withoutKey(io.inputs, key), outputs: withoutKey(io.outputs, key) };
	}

	const assignTo = wasInput || wasOutput ? second : suggestedRole;
	const assigned = [designationOf(symbol)];
	return {
		inputs: [...withoutKey(io.inputs, key), ...(assignTo === 'input' ? assigned : [])],
		outputs: [...withoutKey(io.outputs, key), ...(assignTo === 'output' ? assigned : [])]
	};
}
