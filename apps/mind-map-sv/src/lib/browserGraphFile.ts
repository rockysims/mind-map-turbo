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

export function openHtmlTextInNewTab(html: string, urlSuffix = ''): boolean {
	const blob = new Blob([html], { type: 'text/html' });
	const url = URL.createObjectURL(blob);
	const opened = window.open(`${url}${urlSuffix}`, '_blank');
	if (opened === null) {
		URL.revokeObjectURL(url);
		return false;
	}
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
	return true;
}

export function openBlankHtmlTab(): Window | null {
	return window.open('about:blank', '_blank');
}

export function openHtmlFileInNewTab(file: File, opened = openBlankHtmlTab()): boolean {
	if (opened === null) {
		return false;
	}
	const reader = new FileReader();
	reader.onload = () => {
		opened.document.open();
		opened.document.write(String(reader.result ?? ''));
		opened.document.close();
	};
	reader.onerror = () => {
		opened.close();
	};
	reader.readAsText(file);
	return true;
}

export function openHtmlFilePickerInNewTab(): boolean {
	const opened = openBlankHtmlTab();
	if (opened === null) return false;
	opened.document.open();
	opened.document.write(filePickerTabHtml());
	opened.document.close();
	return true;
}

function filePickerTabHtml(): string {
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>Open graph file</title>
		<style>
			:root {
				color-scheme: light;
				font-family:
					Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
				background: #f8fafc;
				color: #0f172a;
			}

			body {
				min-height: 100vh;
				margin: 0;
				display: grid;
				place-items: center;
			}

			main {
				display: grid;
				gap: 1rem;
				justify-items: center;
				padding: 2rem;
				text-align: center;
			}

			h1,
			p {
				margin: 0;
			}

			h1 {
				font-size: 1.25rem;
			}

			button {
				min-height: 2.5rem;
				border: 0;
				border-radius: 999px;
				padding: 0.625rem 1rem;
				background: #0f172a;
				color: white;
				font: inherit;
				cursor: pointer;
			}

			input {
				position: absolute;
				width: 1px;
				height: 1px;
				padding: 0;
				margin: -1px;
				overflow: hidden;
				clip: rect(0, 0, 0, 0);
				white-space: nowrap;
				border: 0;
			}
		</style>
	</head>
	<body>
		<main>
			<h1>Open graph file</h1>
			<button type="button">Choose graph file</button>
			<input type="file" accept=".html,text/html" aria-label="Graph file" />
			<p role="status"></p>
		</main>
		<script>
			const button = document.querySelector('button');
			const input = document.querySelector('input');
			const status = document.querySelector('[role="status"]');

			button.addEventListener('click', () => {
				input.click();
			});

			input.addEventListener('change', () => {
				const file = input.files && input.files[0];
				if (!file) return;
				status.textContent = 'Opening graph file...';
				const reader = new FileReader();
				reader.onload = () => {
					document.open();
					document.write(String(reader.result || ''));
					document.close();
				};
				reader.onerror = () => {
					status.textContent = 'Unable to open that graph file.';
				};
				reader.readAsText(file);
			});
		${scriptCloseTag()}
	</body>
</html>`;
}

function scriptCloseTag(): string {
	return '</' + 'script>';
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
