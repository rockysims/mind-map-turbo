/**
 * How big the single-file download of a document is going to be.
 *
 * A document-level fact, like its status: attachments live in IndexedDB while
 * the app is running and cost nothing on screen, but the save file carries
 * every one of them inline, so a graph that felt small can produce a download
 * that does not. The estimate is read entirely off `assets` metadata — no blob
 * is fetched to compute a line of status text.
 */

import { APP_CONFIG } from './appConfig';
import { formatByteSize } from './components/ui/Multigraph/lib/byteSize';
import { referencedAssetIds } from './components/ui/Multigraph/lib/graph';
import type { MultigraphData } from './components/ui/types/multigraph';

/**
 * Base64 spends four characters on every three bytes, so an embedded asset
 * costs a third more than the blob it came from. Padding, the JSON quoting and
 * the shell's own markup are rounding error beside a threshold measured in tens
 * of megabytes, and the notice says "about" for exactly that reason.
 */
const BASE64_SIZE_FACTOR = 4 / 3;

/**
 * The download's approximate size in bytes: every asset the graph still
 * references, at the size its metadata records, grown by the base64 factor.
 *
 * Referenced, not stored — an asset left in `assets` that no content block
 * points at is not written to the file (`referencedAssetIds` is what the
 * exporter and the garbage sweep both go by), so counting it would overstate
 * the download. Images and files count alike: both are embedded the same way.
 */
export function exportSizeEstimateBytes(graph: MultigraphData): number {
	const assets = graph.assets;
	if (assets === undefined) return 0;

	let total = 0;
	for (const assetId of referencedAssetIds(graph)) {
		const size = assets[assetId]?.size;
		// A block can outlive its metadata (a version 6 document, a partial
		// import); an unmeasurable asset is left out rather than counted as NaN.
		if (typeof size === 'number' && Number.isFinite(size) && size > 0) total += size;
	}

	return Math.round(total * BASE64_SIZE_FACTOR);
}

/**
 * One sentence saying roughly how large the download will be, or `null` when it
 * is small enough that saying so would be noise.
 *
 * The threshold is a parameter so tests can pin it; it defaults to the
 * configured total. Deliberately not a warning — a large document is a fact
 * about what the reader built, not a problem with it — so the caller shows it
 * at info severity alongside whatever else the status line is saying.
 */
export function exportSizeNotice(
	bytes: number,
	threshold: number = APP_CONFIG.multigraph.attachments.warnTotalBytes
): string | null {
	if (bytes <= threshold) return null;
	return `Download will be about ${formatByteSize(bytes)}.`;
}
