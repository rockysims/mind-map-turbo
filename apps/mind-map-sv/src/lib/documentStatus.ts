import type { MultigraphData } from './components/ui/types/multigraph';

export type DocumentBaselineKind = 'new' | 'file' | 'saved-file';

export type DocumentBaseline = {
	kind: DocumentBaselineKind;
	graph: MultigraphData;
};

export type DocumentStatus =
	| 'new-clean'
	| 'new-dirty'
	| 'file-clean'
	| 'file-dirty'
	| 'file-recovered-draft'
	| 'saved-file-clean'
	| 'saved-file-dirty';

export function graphFingerprint(graph: MultigraphData): string {
	return JSON.stringify(graph);
}

export function graphDataEquals(left: MultigraphData, right: MultigraphData): boolean {
	return graphFingerprint(left) === graphFingerprint(right);
}

export function documentStatusForGraph(
	graph: MultigraphData,
	baseline: DocumentBaseline,
	options: { recoveredDraft?: boolean } = {}
): DocumentStatus {
	const clean = graphDataEquals(graph, baseline.graph);

	if (baseline.kind === 'new') {
		return clean ? 'new-clean' : 'new-dirty';
	}

	if (baseline.kind === 'saved-file') {
		return clean ? 'saved-file-clean' : 'saved-file-dirty';
	}

	if (clean) return 'file-clean';
	return options.recoveredDraft ? 'file-recovered-draft' : 'file-dirty';
}

/**
 * User-facing wording for a document status.
 *
 * `draftCached` must reflect whether the current graph actually reached the
 * browser's local cache: a dirty document whose draft has not been written is
 * never described as cached, because that is the message that costs people
 * their work. It defaults to true so status-only callers still read naturally.
 *
 * Every notice is written as short sentences the toolbar stacks one per line
 * (see `noticeLines`), so each sentence has to fit the toolbar's fixed notice
 * column on its own — roughly thirty characters — rather than stretching the
 * toolbar to fit the longest message.
 */
export function documentStatusNotice(
	status: DocumentStatus,
	options: { draftCached?: boolean } = {}
): string {
	const draftCached = options.draftCached ?? true;

	if (status === 'new-clean') return 'New graph.';
	if (status === 'file-clean') return 'Matches opened file.';
	if (status === 'saved-file-clean') return 'Matches saved file.';

	if (status === 'new-dirty') {
		return draftCached
			? 'Draft cached in this browser. Save to keep it.'
			: 'Draft not cached. Save now to keep your work.';
	}

	if (status === 'file-recovered-draft') {
		return draftCached
			? 'Recovered cached edits. Save to keep them.'
			: 'Recovered edits not cached. Save now to keep them.';
	}

	if (status === 'saved-file-dirty') {
		return draftCached
			? 'Differs from your saved file. Save to keep the changes.'
			: 'Differs from your saved file. Not cached — save now.';
	}

	return draftCached
		? 'Differs from the opened file. Save to keep the changes.'
		: 'Differs from the opened file. Not cached — save now.';
}

export function documentStatusHasUnsavedChanges(status: DocumentStatus): boolean {
	return (
		status === 'new-dirty' ||
		status === 'file-dirty' ||
		status === 'file-recovered-draft' ||
		status === 'saved-file-dirty'
	);
}
