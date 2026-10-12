import {
	parseGraphQuery,
	tagNamesMatch,
	type GraphQueryToken,
	type GraphQueryTokenMode,
	type GraphQueryTokenTarget
} from './graphQuery';
import { DEFAULT_TAG_SYNTAX, type TagSyntaxConfig } from './titleSyntax';

type TagTokenTarget = Extract<GraphQueryTokenTarget, 'nodeTag' | 'edgeTag'>;

const MODE_PREFIX: Record<GraphQueryTokenMode, string> = {
	focus: '',
	spotlight: '+',
	exclude: '-'
};

/** The cycle a tag button walks: none → focus → spotlight → exclude → none. */
const NEXT_MODE: Record<GraphQueryTokenMode, GraphQueryTokenMode | null> = {
	focus: 'spotlight',
	spotlight: 'exclude',
	exclude: null
};

/**
 * The query token for a tag in a mode, as it would be typed: `#lab`, `+#lab`,
 * `-#lab` (or `@rel`, `+@rel`, `-@rel` for an edge tag). Both the button label
 * and the text `cycleTagToken` writes come from here, so they cannot drift.
 */
export function tagTokenText(
	mode: GraphQueryTokenMode,
	target: TagTokenTarget,
	tag: string,
	tagSyntax: TagSyntaxConfig = DEFAULT_TAG_SYNTAX
): string {
	const marker = target === 'nodeTag' ? tagSyntax.nodeTagMarker : tagSyntax.edgeTagMarker;
	return `${MODE_PREFIX[mode]}${marker}${tag}`;
}

/**
 * The tag's effective mode in the query, or null when no token names it.
 * Exclusion wins regardless of order, exactly as evaluation applies it;
 * otherwise the last matching token's mode counts.
 */
export function tagTokenMode(
	query: string,
	target: TagTokenTarget,
	tag: string,
	tagSyntax: TagSyntaxConfig = DEFAULT_TAG_SYNTAX
): GraphQueryTokenMode | null {
	return effectiveMode(matchingTokens(query, target, tag, tagSyntax));
}

/**
 * Advance the tag's token one step through none → focus → spotlight → exclude
 * → none, editing only the matching tokens' own text. Duplicates collapse to
 * one token written where the last one was; a tag with no token is appended
 * without trimming what the user typed. The written token uses `tag`'s
 * spelling, since that is what was clicked.
 */
export function cycleTagToken(
	query: string,
	target: TagTokenTarget,
	tag: string,
	tagSyntax: TagSyntaxConfig = DEFAULT_TAG_SYNTAX
): string {
	const matches = matchingTokens(query, target, tag, tagSyntax);
	const last = matches.at(-1);
	if (!last) {
		const token = tagTokenText('focus', target, tag, tagSyntax);
		return query === '' || isWhitespace(query.at(-1)) ? query + token : `${query} ${token}`;
	}

	const currentMode = effectiveMode(matches);
	const nextMode = currentMode ? NEXT_MODE[currentMode] : 'focus';
	// Ranges arrive in input order and edits run right to left, so every range
	// still to be edited sits before anything already changed and stays valid.
	let result =
		nextMode === null
			? removeRange(query, last.start, last.end)
			: query.slice(0, last.start) +
				tagTokenText(nextMode, target, tag, tagSyntax) +
				query.slice(last.end);
	for (const token of matches.slice(0, -1).reverse()) {
		result = removeRange(result, token.start, token.end);
	}
	return result;
}

function matchingTokens(
	query: string,
	target: TagTokenTarget,
	tag: string,
	tagSyntax: TagSyntaxConfig
): GraphQueryToken[] {
	return parseGraphQuery(query, tagSyntax).filter(
		(token) => token.target === target && tagNamesMatch(token.value, tag)
	);
}

function effectiveMode(matches: GraphQueryToken[]): GraphQueryTokenMode | null {
	if (matches.some((token) => token.mode === 'exclude')) return 'exclude';
	return matches.at(-1)?.mode ?? null;
}

/**
 * Splice out `[start, end)` and close only the gap it leaves: between
 * whitespace (or the start of input) and whitespace, the run after it goes; at
 * the very end of input, the run before it goes; touching another token,
 * nothing extra goes.
 */
function removeRange(input: string, start: number, end: number): string {
	const separatedBefore = start === 0 || isWhitespace(input[start - 1]);
	if (separatedBefore && isWhitespace(input[end])) {
		return input.slice(0, start) + input.slice(skipWhitespaceForward(input, end));
	}
	if (end === input.length) {
		return input.slice(0, skipWhitespaceBackward(input, start));
	}
	return input.slice(0, start) + input.slice(end);
}

function skipWhitespaceForward(input: string, index: number): number {
	let next = index;
	while (next < input.length && isWhitespace(input[next])) next += 1;
	return next;
}

function skipWhitespaceBackward(input: string, index: number): number {
	let previous = index;
	while (previous > 0 && isWhitespace(input[previous - 1])) previous -= 1;
	return previous;
}

/** The same whitespace set `parseGraphQuery` splits tokens on. */
function isWhitespace(value: string | undefined): boolean {
	return value === ' ' || value === '\n' || value === '\t' || value === '\r';
}
