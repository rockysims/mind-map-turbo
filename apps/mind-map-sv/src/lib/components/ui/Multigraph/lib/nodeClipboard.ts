/**
 * What a node copy puts on the clipboard, and the clipboard it goes through.
 *
 * The payload is a graph file — the text a Download writes — so a copy is a
 * file the app can open, and a saved file's text is something it can paste.
 * Reading it back goes through `parseGraphFileText`, so a paste gets every
 * validation and migration a load does, and nothing here has a format of its
 * own to keep in step.
 */

import { blobToBase64 } from '../../../../assets/assetEncoding';
import type { GraphAssetStore } from '../../../../assets/assetStore';
import {
	parseGraphFileText,
	serializeGraphFile,
	serializeGraphHtmlFile,
	type GraphFileDocument,
	type GraphFileEmbeddedAsset
} from '../../../../graphFile';
import { NEUTRAL_VIEW_STATE } from '../../../../migrations';
import type { MultigraphData } from '../../types/multigraph';
import { referencedAssetIds } from './graph';

/**
 * The clipboard text for a copied subgraph and the attachment bytes it carries.
 *
 * The view state is neutral and there is no document id, settings or export
 * stamp: a paste discards all of them, and leaving them out makes the same
 * copy produce the same text.
 *
 * The JSON form of a graph file has never carried attachment bytes; only the
 * single-file HTML form embeds them. So a copy with attachments is written in
 * that form, and one without stays the JSON a `.json` export writes. The reader
 * never needs to know which it got.
 */
export function encodeNodeClipboard(
	subgraph: MultigraphData,
	embeddedAssets: GraphFileEmbeddedAsset[]
): string {
	const doc: GraphFileDocument = { data: subgraph, viewState: { ...NEUTRAL_VIEW_STATE } };
	if (embeddedAssets.length === 0) return serializeGraphFile(doc);
	return serializeGraphHtmlFile({ ...doc, embeddedAssets });
}

/**
 * The graph file in clipboard text, or `null` when the text is not one.
 *
 * Whatever the clipboard holds is someone else's text until proven otherwise —
 * a sentence, a URL, a graph from a newer app — and a paste of it does nothing
 * rather than failing, so every refusal from the parser reads as "not a graph".
 */
export function decodeNodeClipboard(text: string): GraphFileDocument | null {
	try {
		return parseGraphFileText(text);
	} catch {
		return null;
	}
}

/**
 * Every attachment `graph` references, read out of `store` as base64.
 *
 * Each asset is looked up in `scopes` in order and the first hit wins, because
 * a document's blobs can sit under either its document id or the graph id it
 * was loaded as. An asset found in no scope is left out rather than failing
 * the whole read. There is no size cap: the owner chose to warn on paste, not
 * to drop attachments on copy.
 */
export async function embeddedAssetsForGraph(
	graph: MultigraphData,
	store: GraphAssetStore,
	scopes: readonly string[]
): Promise<GraphFileEmbeddedAsset[]> {
	const uniqueScopes = [...new Set(scopes)];
	const embeddedAssets: GraphFileEmbeddedAsset[] = [];
	for (const assetId of referencedAssetIds(graph)) {
		let storedAsset: Awaited<ReturnType<GraphAssetStore['get']>> | null = null;
		for (const scope of uniqueScopes) {
			storedAsset = await store.get(scope, assetId);
			if (storedAsset.ok) break;
		}
		if (!storedAsset?.ok) continue;
		embeddedAssets.push({
			assetId,
			mimeType: storedAsset.value.mimeType,
			name: storedAsset.value.name,
			size: storedAsset.value.size,
			base64: await blobToBase64(storedAsset.value.blob)
		});
	}
	return embeddedAssets;
}

/**
 * The attachment bytes a paste of `doc` would add to a store already holding
 * `storedAssetIds`.
 *
 * An id already stored adds nothing, because a paste keeps the stored copy
 * rather than overwriting it — which is why a same-document paste never asks.
 * An id embedded twice is counted once for the same reason.
 */
export function newAttachmentBytes(
	doc: GraphFileDocument,
	storedAssetIds: ReadonlySet<string>
): number {
	const counted = new Set<string>();
	let total = 0;
	for (const asset of doc.embeddedAssets ?? []) {
		if (storedAssetIds.has(asset.assetId) || counted.has(asset.assetId)) continue;
		counted.add(asset.assetId);
		total += asset.size;
	}
	return total;
}

/**
 * Where a copy is written and a paste is read from. Injected so stories run on
 * a memory clipboard instead of the system one.
 */
interface ClipboardPort {
	/** Resolves `false` when the write was refused, so a copy can say it failed. */
	writeText(text: string): Promise<boolean>;
	/** The clipboard's text, or `null` when there is nothing this port can read. */
	readText(): Promise<string | null>;
}

/** A clipboard that lives in memory, with what it holds open for a story to read. */
export function memoryClipboard(
	initial: string | null = null
): ClipboardPort & { readonly text: string | null } {
	let text = initial;
	return {
		get text() {
			return text;
		},
		async writeText(next) {
			text = next;
			return true;
		},
		async readText() {
			return text;
		}
	};
}

/**
 * One mirror for the whole tab rather than one per port, because the canvas is
 * remounted on every graph switch and a paste into the next document has to
 * find what this one copied.
 */
const tabMirror = memoryClipboard();

/**
 * The system clipboard, with a memory mirror behind it.
 *
 * Every write the system accepts is mirrored, and a read the system refuses —
 * Firefox by default, Safari once its paste callout is dismissed — or answers
 * with nothing gets the mirror, so a paste in the tab that copied still works.
 * Where there is no async clipboard at all (no `navigator` during SSR, or a
 * page served over plain http, which is not a secure context) the mirror is
 * the clipboard, so copy and paste still work within the tab.
 *
 * The system call is the first thing each method does, before any `await`,
 * because browsers only honour it inside the click or key press that asked.
 */
export function systemClipboard(mirror: ClipboardPort = tabMirror): ClipboardPort {
	return {
		async writeText(text) {
			const system = asyncClipboard();
			if (!system) return mirror.writeText(text);
			try {
				await system.writeText(text);
			} catch {
				return false;
			}
			return mirror.writeText(text);
		},
		async readText() {
			const system = asyncClipboard();
			if (system) {
				try {
					const text = await system.readText();
					if (text !== '') return text;
				} catch {
					// Refused; the mirror is the best answer this tab has.
				}
			}
			return mirror.readText();
		}
	};
}

function asyncClipboard(): Clipboard | null {
	if (typeof navigator === 'undefined') return null;
	return navigator.clipboard ?? null;
}
