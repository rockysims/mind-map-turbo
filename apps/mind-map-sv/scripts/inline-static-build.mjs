import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(appRoot, 'build');
const indexPath = join(buildDir, 'index.html');

let html = await readFile(indexPath, 'utf8');

html = await inlineStylesheets(html);
html = await inlineModuleScripts(html);
html = await inlineIcons(html);
html = stripModulePreloads(html);

await writeFile(indexPath, html);
await removeSiblingArtifacts();

async function inlineStylesheets(input) {
	return replaceAsync(
		input,
		/<link\b(?=[^>]*\brel=(["'])stylesheet\1)(?=[^>]*\bhref=(["'])([^"']+)\2)[^>]*>/gi,
		async (tag, _relQuote, _hrefQuote, href) => {
			const css = await readBuildAsset(href);
			return `<style data-inline-href="${escapeAttribute(href)}">\n${css}\n</style>`;
		}
	);
}

async function inlineModuleScripts(input) {
	return replaceAsync(
		input,
		/<script\b(?=[^>]*\btype=(["'])module\1)(?=[^>]*\bsrc=(["'])([^"']+)\2)[^>]*><\/script>/gi,
		async (_tag, _typeQuote, _srcQuote, src) => {
			const js = await readBuildAsset(src);
			return `<script type="module" data-inline-src="${escapeAttribute(src)}">\n${js}\n</script>`;
		}
	);
}

async function inlineIcons(input) {
	return replaceAsync(
		input,
		/<link\b(?=[^>]*\brel=(["'])icon\1)(?=[^>]*\bhref=(["'])([^"']+)\2)[^>]*>/gi,
		async (tag, _relQuote, _hrefQuote, href) => {
			const asset = await readBuildAsset(href);
			const dataUrl = `data:image/svg+xml,${encodeURIComponent(asset)}`;
			return tag.replace(href, dataUrl);
		}
	);
}

function stripModulePreloads(input) {
	return input.replace(/<link\b(?=[^>]*\brel=(["'])modulepreload\1)[^>]*>/gi, '');
}

async function readBuildAsset(assetHref) {
	const normalized = assetHref.replace(/^\.\//, '').replace(/^\//, '');
	const filePath = join(buildDir, normalized);
	return readFile(filePath, 'utf8');
}

async function replaceAsync(input, pattern, replacer) {
	const matches = Array.from(input.matchAll(pattern));
	const replacements = await Promise.all(matches.map((match) => replacer(...match)));
	let output = input;
	for (let index = matches.length - 1; index >= 0; index -= 1) {
		const match = matches[index];
		const replacement = replacements[index];
		if (match.index === undefined) continue;
		output = `${output.slice(0, match.index)}${replacement}${output.slice(match.index + match[0].length)}`;
	}
	return output;
}

function escapeAttribute(value) {
	return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

async function removeSiblingArtifacts() {
	const files = await listFiles(buildDir);
	await Promise.all(
		files
			.filter((file) => file !== 'index.html')
			.map((file) => rm(join(buildDir, file), { recursive: true, force: true }))
	);
}

async function listFiles(dir, prefix = '') {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const name = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			files.push(name);
			continue;
		}
		files.push(name);
	}
	return files;
}
