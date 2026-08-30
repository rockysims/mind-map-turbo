import { APP_CONFIG } from '$lib/appConfig';

export type ParsedTitleDirection = 'parent-to-child' | 'child-to-parent' | 'undirected';

export interface TagSyntaxConfig {
	nodeTagMarker: string;
	edgeTagMarker: string;
}

interface ParsedTitleSyntax {
	displayTitle: string;
	nodeTags: string[];
	edgeTags: string[];
	direction: ParsedTitleDirection;
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

	const nodeTags: string[] = [];
	const edgeTags: string[] = [];

	while (remaining.length > 0) {
		remaining = remaining.trimStart();
		const marker = leadingTagMarker(remaining, tagSyntax);
		if (!marker) break;

		const tagNameStart = marker.length;
		const tagNameEnd = findTagNameEnd(remaining, tagNameStart, tagSyntax);
		const tagName = remaining.slice(tagNameStart, tagNameEnd);
		if (!isValidTagName(tagName, tagSyntax)) break;

		if (marker === tagSyntax.nodeTagMarker) {
			nodeTags.push(tagName);
		} else {
			edgeTags.push(tagName);
		}
		remaining = remaining.slice(tagNameEnd);
	}

	return {
		displayTitle: remaining.trim(),
		nodeTags,
		edgeTags,
		direction
	};
}

function leadingTagMarker(input: string, tagSyntax: TagSyntaxConfig): string | null {
	if (tagSyntax.nodeTagMarker && input.startsWith(tagSyntax.nodeTagMarker)) {
		return tagSyntax.nodeTagMarker;
	}
	if (tagSyntax.edgeTagMarker && input.startsWith(tagSyntax.edgeTagMarker)) {
		return tagSyntax.edgeTagMarker;
	}
	return null;
}

function findTagNameEnd(input: string, startIndex: number, tagSyntax: TagSyntaxConfig): number {
	for (let index = startIndex; index < input.length; index += 1) {
		if (/\s/.test(input[index]) || leadingTagMarker(input.slice(index), tagSyntax)) return index;
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
		!tagName.includes(tagSyntax.edgeTagMarker)
	);
}
