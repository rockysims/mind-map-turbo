export async function blobToBase64(blob: Blob): Promise<string> {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	if (typeof btoa === 'function') return btoa(binary);
	return Buffer.from(bytes).toString('base64');
}

export function base64ToBlob(base64: string, mimeType: string): Blob {
	const binary =
		typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return new Blob([bytes], { type: mimeType });
}
