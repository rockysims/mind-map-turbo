import { afterEach, describe, expect, it, vi } from 'vitest';
import { base64ToBlob } from '../../../../assets/assetEncoding';
import { MemoryGraphAssetStore } from '../../../../assets/assetStore';
import { serializeGraphFile, type GraphFileEmbeddedAsset } from '../../../../graphFile';
import { NEUTRAL_VIEW_STATE } from '../../../../migrations';
import type { MultigraphData } from '../../types/multigraph';
import {
	decodeNodeClipboard,
	embeddedAssetsForGraph,
	encodeNodeClipboard,
	memoryClipboard,
	newAttachmentBytes,
	systemClipboard
} from './nodeClipboard';
import { makeGraph } from './testFixtures';

// Pinned so a decode compares like with like: a load seeds a pin into any
// component that has none (`withSeededComponentPins`).
const SUBGRAPH = makeGraph({
	nodeCount: 3,
	edges: [
		[0, 1],
		[1, 2]
	],
	pinned: [0],
	posByNodeId: { n0: { x: 0, y: 0 }, n1: { x: 120, y: -40 }, n2: { x: 260, y: 30 } }
});

/** A graph whose node `n0` references `image` and `n1` references `file`, with metadata for both. */
function graphWithAttachments(image: string, file: string): MultigraphData {
	const graph = makeGraph({ nodeCount: 3, edges: [[0, 1]], pinned: [0] });
	return {
		...graph,
		nodes: graph.nodes.map((node) => {
			if (node.id === 'n0') {
				return { ...node, content: [{ type: 'image' as const, assetId: image, alt: '' }] };
			}
			if (node.id === 'n1') {
				return {
					...node,
					content: [{ type: 'file' as const, assetId: file, name: `${file}.csv` }]
				};
			}
			return node;
		}),
		assets: {
			[image]: { id: image, kind: 'image', mimeType: 'image/png', size: 5, createdAt: 1 },
			[file]: { id: file, kind: 'file', mimeType: 'text/csv', size: 16, createdAt: 1 }
		}
	};
}

const IMAGE: GraphFileEmbeddedAsset = {
	assetId: 'photo',
	mimeType: 'image/png',
	name: 'photo.png',
	size: 5,
	base64: 'aGVsbG8='
};

const CSV: GraphFileEmbeddedAsset = {
	assetId: 'readings',
	mimeType: 'text/csv',
	name: 'readings.csv',
	size: 16,
	base64: 'dGltZSx2YWx1ZQoxLDIK'
};

async function putAsset(
	store: MemoryGraphAssetStore,
	scope: string,
	assetId: string,
	body: string,
	mimeType: string
): Promise<void> {
	const blob = new Blob([body], { type: mimeType });
	await store.put({
		scope,
		assetId,
		blob,
		mimeType,
		name: `${assetId}.bin`,
		size: blob.size,
		updatedAt: 1
	});
}

function decodedBody(asset: GraphFileEmbeddedAsset): Promise<string> {
	return base64ToBlob(asset.base64, asset.mimeType).text();
}

describe('encodeNodeClipboard / decodeNodeClipboard', () => {
	it('round-trips a subgraph with no attachments', () => {
		const decoded = decodeNodeClipboard(encodeNodeClipboard(SUBGRAPH, []));

		expect(decoded?.data).toEqual(SUBGRAPH);
		expect(decoded?.embeddedAssets).toBeUndefined();
	});

	it('round-trips a subgraph and the attachments it carries', () => {
		const subgraph = graphWithAttachments(IMAGE.assetId, CSV.assetId);
		const decoded = decodeNodeClipboard(encodeNodeClipboard(subgraph, [IMAGE, CSV]));

		expect(decoded?.data).toEqual(subgraph);
		expect(decoded?.embeddedAssets).toEqual([IMAGE, CSV]);
	});

	it('writes the plain graph-file JSON when there is nothing to embed', () => {
		const text = encodeNodeClipboard(SUBGRAPH, []);

		expect(JSON.parse(text)).toMatchObject({ data: SUBGRAPH, viewState: NEUTRAL_VIEW_STATE });
	});

	it('carries no document id, settings or export stamp, so one copy is one text', () => {
		const payload: Record<string, unknown> = JSON.parse(encodeNodeClipboard(SUBGRAPH, []));

		expect(Object.keys(payload).sort()).toEqual(['data', 'schemaVersion', 'viewState']);
		expect(encodeNodeClipboard(SUBGRAPH, [IMAGE])).toBe(encodeNodeClipboard(SUBGRAPH, [IMAGE]));
	});

	it('reads a saved graph file as a paste, view state and all', () => {
		const saved = serializeGraphFile({
			data: SUBGRAPH,
			viewState: { panX: 40, panY: -20, scale: 2 },
			documentId: 'doc-elsewhere'
		});

		const decoded = decodeNodeClipboard(saved);

		expect(decoded?.data).toEqual(SUBGRAPH);
		expect(decoded?.documentId).toBe('doc-elsewhere');
	});

	it('is null for text that is not JSON', () => {
		expect(decodeNodeClipboard('hello')).toBeNull();
	});

	it('is null for JSON that is not a graph file', () => {
		expect(decodeNodeClipboard('{"a":1}')).toBeNull();
	});

	it('is null for an empty clipboard', () => {
		expect(decodeNodeClipboard('')).toBeNull();
	});
});

describe('embeddedAssetsForGraph', () => {
	it('embeds every referenced asset as base64 and leaves an unreferenced one out', async () => {
		const store = new MemoryGraphAssetStore();
		await putAsset(store, 'doc', 'photo', 'tiny', 'image/png');
		await putAsset(store, 'doc', 'readings', 'time,value\n1,2\n3,4\n', 'text/csv');
		await putAsset(store, 'doc', 'orphan', 'nobody points here', 'image/png');

		const embedded = await embeddedAssetsForGraph(
			graphWithAttachments('photo', 'readings'),
			store,
			['doc']
		);

		expect(embedded.map(({ assetId, mimeType, size }) => ({ assetId, mimeType, size }))).toEqual([
			{ assetId: 'photo', mimeType: 'image/png', size: 4 },
			{ assetId: 'readings', mimeType: 'text/csv', size: 19 }
		]);
		expect(await Promise.all(embedded.map(decodedBody))).toEqual([
			'tiny',
			'time,value\n1,2\n3,4\n'
		]);
	});

	it('takes each asset from the first scope that holds it', async () => {
		const store = new MemoryGraphAssetStore();
		await putAsset(store, 'draft', 'photo', 'draft copy', 'image/png');
		await putAsset(store, 'loaded', 'photo', 'loaded copy', 'image/png');
		await putAsset(store, 'loaded', 'readings', 'only here', 'text/csv');

		const embedded = await embeddedAssetsForGraph(
			graphWithAttachments('photo', 'readings'),
			store,
			['draft', 'loaded', 'draft']
		);

		expect(await Promise.all(embedded.map(decodedBody))).toEqual(['draft copy', 'only here']);
	});

	it('skips a referenced asset no scope holds', async () => {
		const store = new MemoryGraphAssetStore();
		await putAsset(store, 'doc', 'photo', 'tiny', 'image/png');

		const embedded = await embeddedAssetsForGraph(
			graphWithAttachments('photo', 'readings'),
			store,
			['doc']
		);

		expect(embedded.map((asset) => asset.assetId)).toEqual(['photo']);
	});
});

describe('newAttachmentBytes', () => {
	const doc = { data: SUBGRAPH, viewState: NEUTRAL_VIEW_STATE, embeddedAssets: [IMAGE, CSV] };

	it('counts only the assets the store does not already hold', () => {
		expect(newAttachmentBytes(doc, new Set())).toBe(IMAGE.size + CSV.size);
		expect(newAttachmentBytes(doc, new Set(['photo']))).toBe(CSV.size);
		expect(newAttachmentBytes(doc, new Set(['photo', 'readings']))).toBe(0);
	});

	it('is zero for a document that embeds nothing', () => {
		expect(newAttachmentBytes({ data: SUBGRAPH, viewState: NEUTRAL_VIEW_STATE }, new Set())).toBe(
			0
		);
	});

	it('counts an asset embedded twice once', () => {
		expect(newAttachmentBytes({ ...doc, embeddedAssets: [CSV, CSV] }, new Set())).toBe(CSV.size);
	});
});

describe('memoryClipboard', () => {
	it('reads back what was written, and nothing before that', async () => {
		const clipboard = memoryClipboard();

		expect(await clipboard.readText()).toBeNull();
		expect(await clipboard.writeText('copied')).toBe(true);
		expect(await clipboard.readText()).toBe('copied');
		expect(clipboard.text).toBe('copied');
	});

	it('records a mirrored copy as what it holds', async () => {
		const clipboard = memoryClipboard('earlier copy');

		clipboard.mirror('copied by the browser');

		expect(clipboard.text).toBe('copied by the browser');
		expect(await clipboard.readText()).toBe('copied by the browser');
	});
});

describe('systemClipboard', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	/** Stands in for `navigator.clipboard`, recording writes and answering reads with `read`. */
	function stubSystemClipboard(
		read: () => Promise<string>,
		write: (text: string) => Promise<void> = () => Promise.resolve()
	) {
		const writeText = vi.fn(write);
		vi.stubGlobal('navigator', { clipboard: { readText: vi.fn(read), writeText } });
		return { writeText };
	}

	it('writes through to the system clipboard', async () => {
		const { writeText } = stubSystemClipboard(async () => 'system text');
		const clipboard = systemClipboard(memoryClipboard());

		expect(await clipboard.writeText('copied')).toBe(true);
		expect(writeText).toHaveBeenCalledWith('copied');
		expect(await clipboard.readText()).toBe('system text');
	});

	it('falls back to the last written text when readText is refused', async () => {
		stubSystemClipboard(() => Promise.reject(new DOMException('Denied', 'NotAllowedError')));
		const clipboard = systemClipboard(memoryClipboard());

		await clipboard.writeText('copied');

		expect(await clipboard.readText()).toBe('copied');
	});

	it('falls back to the last written text when the system clipboard reads empty', async () => {
		stubSystemClipboard(async () => '');
		const clipboard = systemClipboard(memoryClipboard());

		await clipboard.writeText('copied');

		expect(await clipboard.readText()).toBe('copied');
	});

	it('reads null when the system refuses and this tab never copied', async () => {
		stubSystemClipboard(() => Promise.reject(new DOMException('Denied', 'NotAllowedError')));

		expect(await systemClipboard(memoryClipboard()).readText()).toBeNull();
	});

	it('reports a refused write and keeps the mirror as it was', async () => {
		const mirror = memoryClipboard('earlier copy');
		stubSystemClipboard(
			() => Promise.reject(new DOMException('Denied', 'NotAllowedError')),
			() => Promise.reject(new DOMException('Denied', 'NotAllowedError'))
		);
		const clipboard = systemClipboard(mirror);

		expect(await clipboard.writeText('copied')).toBe(false);
		expect(await clipboard.readText()).toBe('earlier copy');
	});

	it('copies and pastes within the tab where there is no async clipboard', async () => {
		vi.stubGlobal('navigator', {});
		const clipboard = systemClipboard(memoryClipboard());

		expect(await clipboard.writeText('copied')).toBe(true);
		expect(await clipboard.readText()).toBe('copied');
	});

	it('copies and pastes within the tab where there is no navigator at all', async () => {
		vi.stubGlobal('navigator', undefined);
		const clipboard = systemClipboard(memoryClipboard());

		expect(await clipboard.writeText('copied')).toBe(true);
		expect(await clipboard.readText()).toBe('copied');
	});

	it('mirrors a copy the browser already made without writing the system clipboard again', async () => {
		const { writeText } = stubSystemClipboard(() =>
			Promise.reject(new DOMException('Denied', 'NotAllowedError'))
		);
		const mirror = memoryClipboard();
		const clipboard = systemClipboard(mirror);

		clipboard.mirror('copied by the browser');

		expect(writeText).not.toHaveBeenCalled();
		expect(mirror.text).toBe('copied by the browser');
		// A read the system refuses still finds it.
		expect(await clipboard.readText()).toBe('copied by the browser');
	});

	it('shares one mirror across ports by default, so a remounted canvas still pastes', async () => {
		vi.stubGlobal('navigator', {});

		await systemClipboard().writeText('copied before the remount');

		expect(await systemClipboard().readText()).toBe('copied before the remount');
	});
});
