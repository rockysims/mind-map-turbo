export type ParsedTitleDirection = 'parent-to-child' | 'child-to-parent' | 'undirected';

export interface ParsedTitleSyntax {
	displayTitle: string;
	nodeTags: string[];
	edgeTags: string[];
	direction: ParsedTitleDirection;
}

export function parseTitleSyntax(rawTitle: string): ParsedTitleSyntax {
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
		const marker = remaining[0];
		if (marker !== ':' && marker !== ';') break;

		const tagNameEnd = findTagNameEnd(remaining, 1);
		const tagName = remaining.slice(1, tagNameEnd);
		if (!isValidTagName(tagName)) break;

		if (marker === ':') {
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

function findTagNameEnd(input: string, startIndex: number): number {
	for (let index = startIndex; index < input.length; index += 1) {
		if (/[\s:;]/.test(input[index])) return index;
	}

	return input.length;
}

export function normalizeTagList(rawTags: string): string[] {
	return rawTags
		.split(/\s+/)
		.map((tag) => tag.trim())
		.filter(isValidTagName);
}

export function isValidTagName(tagName: string): boolean {
	return tagName.length > 0 && !/[\s:;]/.test(tagName);
}
