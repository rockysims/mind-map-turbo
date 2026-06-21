/**
 * Browser-specific adapter for graph file operations.
 *
 * Keeps all DOM globals (Blob, URL, anchor click, FileReader) in one place so
 * the rest of the app stays pure and tests can inject a fake adapter.
 */

export type BrowserFileArtifact = {
	content: string;
	filename: string;
	mimeType: string;
};

/** Trigger a file download with the given text content and suggested filename. */
export function downloadTextFile(
	content: string,
	filename: string,
	mimeType = 'application/json'
): void {
	const blob = new Blob([content], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	URL.revokeObjectURL(url);
}

export function downloadFileArtifact(artifact: BrowserFileArtifact): void {
	downloadTextFile(artifact.content, artifact.filename, artifact.mimeType);
}

export function openHtmlTextInNewTab(html: string): boolean {
	const blob = new Blob([html], { type: 'text/html' });
	const url = URL.createObjectURL(blob);
	const opened = window.open(url, '_blank', 'noopener,noreferrer');
	if (opened === null) {
		URL.revokeObjectURL(url);
		return false;
	}
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
	return true;
}

/**
 * Read the text content of a File object.
 *
 * Returns a promise that resolves to the file text, or rejects with an Error
 * if the read fails.
 */
export function readFileText(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
		reader.readAsText(file);
	});
}

/**
 * Reset a file input element so that selecting the same file again will fire
 * another `change` event.
 */
export function resetFileInput(input: HTMLInputElement): void {
	input.value = '';
}
