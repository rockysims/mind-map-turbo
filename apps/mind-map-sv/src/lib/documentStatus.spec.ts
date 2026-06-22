import { describe, expect, it } from 'vitest';
import { makeGraph } from './components/ui/Multigraph/lib/testFixtures';
import {
	documentStatusHasUndownloadedChanges,
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

	it('detects opened file drafts and recovered local edits', () => {
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

	it('tracks the just-downloaded graph as the clean baseline', () => {
		const downloaded = graphWithTitle('Downloaded');

		expect(documentStatusForGraph(downloaded, { kind: 'download', graph: downloaded })).toBe(
			'download-clean'
		);
		expect(
			documentStatusForGraph(graphWithTitle('Edited After Download'), {
				kind: 'download',
				graph: downloaded
			})
		).toBe('download-dirty');
	});

	it('maps statuses to concise user-facing notices', () => {
		const cases: Array<[DocumentStatus, string]> = [
			['new-clean', 'New graph.'],
			['new-dirty', 'Draft saved locally. Download needed.'],
			['file-clean', 'Matches opened file.'],
			['file-dirty', 'Draft differs from opened file. Download needed.'],
			['file-recovered-draft', 'Recovered local edits. Download needed.'],
			['download-clean', 'Matches downloaded file.'],
			['download-dirty', 'Draft differs from downloaded file. Download needed.']
		];

		for (const [status, notice] of cases) {
			expect(documentStatusNotice(status)).toBe(notice);
		}
	});

	it('prompts for New graph only when changes have not been downloaded', () => {
		expect(documentStatusHasUndownloadedChanges('new-clean')).toBe(false);
		expect(documentStatusHasUndownloadedChanges('file-clean')).toBe(false);
		expect(documentStatusHasUndownloadedChanges('download-clean')).toBe(false);
		expect(documentStatusHasUndownloadedChanges('new-dirty')).toBe(true);
		expect(documentStatusHasUndownloadedChanges('file-dirty')).toBe(true);
		expect(documentStatusHasUndownloadedChanges('file-recovered-draft')).toBe(true);
		expect(documentStatusHasUndownloadedChanges('download-dirty')).toBe(true);
	});
});
