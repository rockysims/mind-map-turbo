import { APP_CONFIG } from '$lib/appConfig';
import { isRegisteredAddon, type NodeAddonName } from './nodeAddons';

export type ParsedTitleDirection = 'parent-to-child' | 'child-to-parent' | 'undirected';

export interface TagSyntaxConfig {
	nodeTagMarker: string;
	edgeTagMarker: string;
	addonMarker: string;
}

interface ParsedTitleSyntax {
	displayTitle: string;
	nodeTags: string[];
	edgeTags: string[];
	/** Registered add-on names, deduplicated, in the order they were typed. */
	addons: NodeAddonName[];
	direction: ParsedTitleDirection;
}

/**
 * What the edit sheet's title field reads out of a title: the node's own
 * markers and nothing else.
 *
 * No `direction` and no `edgeTags`, because the sheet edits an existing node
 * and has no created edge to apply either one to. Both stay in the title
 * exactly as typed instead — see `parseSheetTitleSyntax`.
 */
interface ParsedSheetTitleSyntax {
	displayTitle: string;
	nodeTags: string[];
	addons: NodeAddonName[];
}

interface MarkerRun {
	remaining: string;
	nodeTags: string[];
	edgeTags: string[];
	addons: NodeAddonName[];
}

export const DEFAULT_TAG_SYNTAX: TagSyntaxConfig = APP_CONFIG.multigraph.tagSyntax;

export function parseTitleSyntax(
	rawTitle: string,
	tagSyntax: TagSyntaxConfig = DEFAULT_TAG_SYNTAX
): ParsedTitleSyntax {
	let remaining = rawTitle.trimStart();
	let direction: ParsedTitleDirection = 'undirected';

	if (remaining.startsWith('>')) {
		direction = 'parent-to-child';
		remaining = remaining.slice(1).trimStart();
	} else if (remaining.startsWith('<')) {
		direction = 'child-to-parent';
		remaining = remaining.slice(1).trimStart();
	}

	const run = consumeMarkerRun(remaining, tagSyntax, true);

	return {
		displayTitle: run.remaining.trim(),
		nodeTags: run.nodeTags,
		edgeTags: run.edgeTags,
		addons: run.addons,
		direction
	};
}

/**
 * The same marker run as `parseTitleSyntax`, read the way the edit sheet needs
 * it: `#` and `!` are consumed, `@` and a leading `<`/`>` are not.
 *
 * A sheet title belongs to a node that already exists, with no edge created
 * alongside it, so an edge tag or a direction typed there names nothing. Rather
 * than swallow them into a value nobody applies, this ends the run at the first
 * one and leaves it — and everything after it — in the display title as typed,
 * the same way an unregistered `!word` ends the run.
 */
export function parseSheetTitleSyntax(
	rawTitle: string,
	tagSyntax: TagSyntaxConfig = DEFAULT_TAG_SYNTAX
): ParsedSheetTitleSyntax {
	const run = consumeMarkerRun(rawTitle.trimStart(), tagSyntax, false);

	return {
		displayTitle: run.remaining.trim(),
		nodeTags: run.nodeTags,
		addons: run.addons
	};
}

/**
 * Eat markers off the front of `input` until something that is not one.
 *
 * One loop for both readings so the splitting rule cannot drift between them:
 * markers may abut, may repeat, come in any order, and a name ends at
 * whitespace or the next marker.
 */
function consumeMarkerRun(
	input: string,
	tagSyntax: TagSyntaxConfig,
	consumesEdgeTags: boolean
): MarkerRun {
	let remaining = input;
	const nodeTags: string[] = [];
	const edgeTags: string[] = [];
	const addons: NodeAddonName[] = [];

	while (remaining.length > 0) {
		remaining = remaining.trimStart();
		const marker = leadingMarker(remaining, tagSyntax);
		if (!marker) break;
		if (marker === tagSyntax.edgeTagMarker && !consumesEdgeTags) break;

		const tagNameStart = marker.length;
		const tagNameEnd = findTagNameEnd(remaining, tagNameStart, tagSyntax);
		const tagName = remaining.slice(tagNameStart, tagNameEnd);
		if (!isValidTagName(tagName, tagSyntax)) break;

		if (marker === tagSyntax.addonMarker) {
			// The add-on registry is closed, so an unregistered `!word` is prose:
			// it ends the marker run and stays in the display title with the rest.
			if (!isRegisteredAddon(tagName)) break;
			if (!addons.includes(tagName)) addons.push(tagName);
		} else if (marker === tagSyntax.nodeTagMarker) {
			nodeTags.push(tagName);
		} else {
			edgeTags.push(tagName);
		}
		remaining = remaining.slice(tagNameEnd);
	}

	return { remaining, nodeTags, edgeTags, addons };
}

function leadingMarker(input: string, tagSyntax: TagSyntaxConfig): string | null {
	if (tagSyntax.nodeTagMarker && input.startsWith(tagSyntax.nodeTagMarker)) {
		return tagSyntax.nodeTagMarker;
	}
	if (tagSyntax.edgeTagMarker && input.startsWith(tagSyntax.edgeTagMarker)) {
		return tagSyntax.edgeTagMarker;
	}
	if (tagSyntax.addonMarker && input.startsWith(tagSyntax.addonMarker)) {
		return tagSyntax.addonMarker;
	}
	return null;
}

function findTagNameEnd(input: string, startIndex: number, tagSyntax: TagSyntaxConfig): number {
	for (let index = startIndex; index < input.length; index += 1) {
		if (/\s/.test(input[index]) || leadingMarker(input.slice(index), tagSyntax)) return index;
	}

	return input.length;
}

export function normalizeTagList(
	rawTags: string,
	tagSyntax: TagSyntaxConfig = DEFAULT_TAG_SYNTAX
): string[] {
	return rawTags
		.split(/\s+/)
		.map((tag) => tag.trim())
		.filter((tag) => isValidTagName(tag, tagSyntax));
}

function isValidTagName(tagName: string, tagSyntax: TagSyntaxConfig = DEFAULT_TAG_SYNTAX): boolean {
	return (
		tagName.length > 0 &&
		!/\s/.test(tagName) &&
		!tagName.includes(tagSyntax.nodeTagMarker) &&
		!tagName.includes(tagSyntax.edgeTagMarker) &&
		!tagName.includes(tagSyntax.addonMarker)
	);
}
