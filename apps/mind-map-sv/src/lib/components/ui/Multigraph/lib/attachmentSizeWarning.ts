import { formatByteSize } from './byteSize';

/**
 * Why a big file is worth a question, in the one sentence every surface that
 * attaches one asks.
 *
 * The file is copied *into* the document rather than linked from it, and the
 * single-file export writes it as base64, which costs about a third again — so
 * the cost of a 40 MB video is not the 40 MB the reader is picturing. Shared
 * rather than copied because the edit sheet and the AI workbench both ask it,
 * and two copies of a sentence are how they come to disagree.
 */
export function attachmentSizeWarning(file: { name: string; size: number }): string {
	return `${file.name} is ${formatByteSize(file.size)}. It is stored inside this document and makes a saved file about a third larger again. Attach it anyway?`;
}
