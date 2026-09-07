import { formatByteSize } from './byteSize';

/**
 * Why a big file is worth a question, in the one sentence every surface that
 * attaches one asks.
 *
 * The file is copied *into* the document rather than linked from it, and the
 * single-file export writes it as base64 — four characters per three bytes. The
 * sentence names that cost as a size, because the earlier wording ("makes a
 * saved file about a third larger again") described a ratio to a total the
 * reader cannot see: a third larger than what, when 30 MB of video is landing
 * beside a document of a few hundred kilobytes? Shared rather than copied
 * because the edit sheet and the AI workbench both ask it, and two copies of a
 * sentence are how they come to disagree.
 */
export function attachmentSizeWarning(file: { name: string; size: number }): string {
	// Rounded up, as base64 pads its last group out to four characters.
	const encoded = formatByteSize(Math.ceil((file.size * 4) / 3));
	return `${file.name} — this file adds about ${encoded} to every saved copy of this document. Attach it anyway?`;
}
