import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from './appConfig';
import { makeGraph } from './components/ui/Multigraph/lib/testFixtures';
import type { GraphAssetMetadata, MultigraphData } from './components/ui/types/multigraph';
import type { NodeContentBlock } from './components/ui/types/node';
import { exportSizeEstimateBytes, exportSizeNotice } from './exportSize';

const MB = 1024 * 1024;

function imageBlock(assetId: string): NodeContentBlock {
	return { type: 'image', assetId, alt: '' };
}

function fileBlock(assetId: string): NodeContentBlock {
	return { type: 'file', assetId, name: `${assetId}.csv` };
}

function metadata(
	id: string,
	size: number,
	kind: GraphAssetMetadata['kind'] = 'file'
): GraphAssetMetadata {
	return {
		id,
		kind,
		mimeType: kind === 'image' ? 'image/png' : 'text/csv',
		name: `${id}.${kind === 'image' ? 'png' : 'csv'}`,
		size,
		createdAt: 1
	};
}

/** A one-node graph carrying `blocks`, with `assets` holding every entry given. */
function graphWith(blocks: NodeContentBlock[], assets: GraphAssetMetadata[]): MultigraphData {
	const graph = makeGraph({
		nodes: [{ id: 'n0', title: 'Measurements', description: '', content: blocks }]
	});
	return {
		...graph,
		assets: Object.fromEntries(assets.map((asset) => [asset.id, asset]))
	};
}

describe('exportSizeEstimateBytes', () => {
	it('is zero for a graph with no assets at all', () => {
		expect(exportSizeEstimateBytes(makeGraph({ nodeCount: 2 }))).toBe(0);
	});

	it('grows an attachment by the base64 factor the HTML embeds it at', () => {
		const graph = graphWith([fileBlock('a1')], [metadata('a1', 3000)]);

		// Four characters per three bytes, so 3000 bytes of CSV cost 4000.
		expect(exportSizeEstimateBytes(graph)).toBe(4000);
	});

	it('counts images and files alike', () => {
		const graph = graphWith(
			[imageBlock('a1'), fileBlock('a2')],
			[metadata('a1', 300, 'image'), metadata('a2', 600)]
		);

		expect(exportSizeEstimateBytes(graph)).toBe(1200);
	});

	it('ignores an asset no content block references', () => {
		const graph = graphWith([fileBlock('a1')], [metadata('a1', 300), metadata('orphan', 90000)]);

		// The exporter writes referenced assets only, so an orphan is not download.
		expect(exportSizeEstimateBytes(graph)).toBe(400);
	});

	it('skips a referenced block whose metadata is missing or unmeasurable', () => {
		const graph = graphWith(
			[fileBlock('a1'), fileBlock('a2'), fileBlock('a3')],
			[metadata('a1', 300), { ...metadata('a3', Number.NaN) }]
		);

		expect(exportSizeEstimateBytes(graph)).toBe(400);
	});
});

describe('exportSizeNotice', () => {
	it('says nothing below the threshold', () => {
		expect(exportSizeNotice(24 * MB, 25 * MB)).toBeNull();
	});

	it('says nothing exactly at the threshold', () => {
		expect(exportSizeNotice(25 * MB, 25 * MB)).toBeNull();
	});

	it('reports a rounded size above the threshold', () => {
		expect(exportSizeNotice(31.4 * MB, 25 * MB)).toBe('Download will be about 31.4 MB.');
	});

	it('defaults its threshold to the configured total', () => {
		const { warnTotalBytes } = APP_CONFIG.multigraph.attachments;

		expect(exportSizeNotice(warnTotalBytes)).toBeNull();
		expect(exportSizeNotice(warnTotalBytes * 2)).toBe(
			`Download will be about ${(warnTotalBytes * 2) / MB} MB.`
		);
	});

	it('reads as one sentence the toolbar can stack under another', () => {
		const graph = graphWith([fileBlock('a1')], [metadata('a1', 24 * MB)]);

		// 24 MB of CSV is under the threshold on disk and over it once embedded:
		// the factor is the whole point of reporting the download rather than the
		// attachment total.
		expect(exportSizeNotice(exportSizeEstimateBytes(graph), 25 * MB)).toBe(
			'Download will be about 32 MB.'
		);
	});
});
