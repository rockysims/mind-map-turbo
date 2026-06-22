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

export function documentStatusNotice(status: DocumentStatus): string {
	if (status === 'new-clean') return 'New graph.';
	if (status === 'new-dirty') return 'Draft saved locally. Download needed.';
	if (status === 'file-clean') return 'Matches opened file.';
	if (status === 'file-recovered-draft') return 'Recovered local edits. Download needed.';
	if (status === 'download-clean') return 'Matches downloaded file.';
	if (status === 'download-dirty') return 'Draft differs from downloaded file. Download needed.';
	return 'Draft differs from opened file. Download needed.';
}
