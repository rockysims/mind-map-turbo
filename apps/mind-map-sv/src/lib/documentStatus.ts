import type { MultigraphData } from './components/ui/types/multigraph';

export type DocumentBaselineKind = 'new' | 'file' | 'download';

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
	| 'download-clean'
	| 'download-dirty';

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

	if (baseline.kind === 'download') {
		return clean ? 'download-clean' : 'download-dirty';
	}

	if (clean) return 'file-clean';
	return options.recoveredDraft ? 'file-recovered-draft' : 'file-dirty';
}

/**
 * User-facing wording for a document status.
 *
 * `draftSaved` must reflect whether the current graph actually reached storage:
 * a dirty document whose draft has not been written is never described as
 * saved, because that is the message that costs people their work. It defaults
 * to true so status-only callers still read naturally.
 */
export function documentStatusNotice(
	status: DocumentStatus,
	options: { draftSaved?: boolean } = {}
): string {
	const draftSaved = options.draftSaved ?? true;

	if (status === 'new-clean') return 'New graph.';
	if (status === 'file-clean') return 'Matches opened file.';
	if (status === 'download-clean') return 'Matches downloaded file.';

	if (status === 'new-dirty') {
		return draftSaved
			? 'Draft saved in this browser. Download needed.'
			: 'Not saved in this browser. Download to keep your work.';
	}

	if (status === 'file-recovered-draft') {
		return draftSaved
			? 'Recovered local edits. Download needed.'
			: 'Recovered local edits. Not saved in this browser — download to keep your work.';
	}

	if (status === 'download-dirty') {
		return draftSaved
			? 'Draft differs from downloaded file. Download needed.'
			: 'Draft differs from downloaded file. Not saved in this browser — download to keep your work.';
	}

	return draftSaved
		? 'Draft differs from opened file. Download needed.'
		: 'Draft differs from opened file. Not saved in this browser — download to keep your work.';
}

export function documentStatusHasUndownloadedChanges(status: DocumentStatus): boolean {
	return (
		status === 'new-dirty' ||
		status === 'file-dirty' ||
		status === 'file-recovered-draft' ||
		status === 'download-dirty'
	);
}
