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
		const tokenMatch = remaining.match(/^\S+/);
		const token = tokenMatch?.[0] ?? '';
		const marker = token[0];
		if (marker !== ':' && marker !== ';') break;

		const tagName = token.slice(1);
		if (!isValidTagName(tagName)) break;

		if (marker === ':') {
			nodeTags.push(tagName);
		} else {
			edgeTags.push(tagName);
		}
		remaining = remaining.slice(token.length).trimStart();
	}

	return {
		displayTitle: remaining.trim(),
		nodeTags,
		edgeTags,
		direction
	};
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
