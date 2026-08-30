import { describe, expect, it } from 'vitest';
import { makeGraph } from './components/ui/Multigraph/lib/testFixtures';
import {
	documentStatusHasUnsavedChanges,
	documentStatusForGraph,
	documentStatusNotice,
	graphDataEquals,
	graphFingerprint,
	type DocumentStatus
} from './documentStatus';

function graphWithTitle(title: string) {
	const graph = makeGraph({ nodeCount: 1 });
	return {
		...graph,
		nodes: [{ ...graph.nodes[0], title }]
	};
}

describe('documentStatus', () => {
	it('fingerprints graph data without autosave metadata', () => {
		const graph = graphWithTitle('Same Graph');

		expect(graphFingerprint(graph)).toBe(graphFingerprint(JSON.parse(JSON.stringify(graph))));
		expect(graphFingerprint(graph)).not.toContain('updatedAt');
	});

	it('compares graph data only', () => {
		expect(graphDataEquals(graphWithTitle('A'), graphWithTitle('A'))).toBe(true);
		expect(graphDataEquals(graphWithTitle('A'), graphWithTitle('B'))).toBe(false);
	});

	it('treats the default new graph as clean until graph data changes', () => {
		const baseline = graphWithTitle('Node 0');

		expect(documentStatusForGraph(baseline, { kind: 'new', graph: baseline })).toBe('new-clean');
		expect(documentStatusForGraph(graphWithTitle('Edited'), { kind: 'new', graph: baseline })).toBe(
			'new-dirty'
		);
	});

	it('detects opened file drafts and recovered cached edits', () => {
		const fileGraph = graphWithTitle('File Version');
		const draftGraph = graphWithTitle('Draft Version');

		expect(documentStatusForGraph(fileGraph, { kind: 'file', graph: fileGraph })).toBe(
			'file-clean'
		);
		expect(documentStatusForGraph(draftGraph, { kind: 'file', graph: fileGraph })).toBe(
			'file-dirty'
		);
		expect(
			documentStatusForGraph(
				draftGraph,
				{ kind: 'file', graph: fileGraph },
				{ recoveredDraft: true }
			)
		).toBe('file-recovered-draft');
	});

	it('tracks the just-saved file as the clean baseline', () => {
		const savedFile = graphWithTitle('Saved File');

		expect(documentStatusForGraph(savedFile, { kind: 'saved-file', graph: savedFile })).toBe(
			'saved-file-clean'
		);
		expect(
			documentStatusForGraph(graphWithTitle('Edited After Save'), {
				kind: 'saved-file',
				graph: savedFile
			})
		).toBe('saved-file-dirty');
	});

	it('maps statuses to concise user-facing notices when the draft is cached', () => {
		const cases: Array<[DocumentStatus, string]> = [
			['new-clean', 'New graph.'],
			['new-dirty', 'Draft cached in this browser. Save to keep it.'],
			['file-clean', 'Matches opened file.'],
			['file-dirty', 'Draft differs from the opened file. Save to keep the changes.'],
			['file-recovered-draft', 'Recovered cached edits. Save to keep them.'],
			['saved-file-clean', 'Matches saved file.'],
			['saved-file-dirty', 'Draft differs from your saved file. Save to keep the changes.']
		];

		for (const [status, notice] of cases) {
			expect(documentStatusNotice(status)).toBe(notice);
			expect(documentStatusNotice(status, { draftCached: true })).toBe(notice);
		}
	});

	it('never claims a draft is cached when nothing reached storage', () => {
		const cases: Array<[DocumentStatus, string]> = [
			['new-dirty', 'Draft not cached. Save now to keep your work.'],
			[
				'file-dirty',
				'Draft differs from the opened file and is not cached. Save now to keep the changes.'
			],
			['file-recovered-draft', 'Recovered edits are not cached. Save now to keep them.'],
			[
				'saved-file-dirty',
				'Draft differs from your saved file and is not cached. Save now to keep the changes.'
			]
		];

		for (const [status, notice] of cases) {
			expect(documentStatusNotice(status, { draftCached: false })).toBe(notice);
		}
	});

	it('leaves clean statuses unchanged when nothing is pending a cache write', () => {
		for (const status of ['new-clean', 'file-clean', 'saved-file-clean'] as const) {
			expect(documentStatusNotice(status, { draftCached: false })).toBe(
				documentStatusNotice(status, { draftCached: true })
			);
		}
	});

	it('prompts for New graph only when changes have not been saved to a file', () => {
		expect(documentStatusHasUnsavedChanges('new-clean')).toBe(false);
		expect(documentStatusHasUnsavedChanges('file-clean')).toBe(false);
		expect(documentStatusHasUnsavedChanges('saved-file-clean')).toBe(false);
		expect(documentStatusHasUnsavedChanges('new-dirty')).toBe(true);
		expect(documentStatusHasUnsavedChanges('file-dirty')).toBe(true);
		expect(documentStatusHasUnsavedChanges('file-recovered-draft')).toBe(true);
		expect(documentStatusHasUnsavedChanges('saved-file-dirty')).toBe(true);
	});
});
