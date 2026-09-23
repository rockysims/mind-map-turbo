import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBuildStamp, withBuildStamp } from './build-stamp.mjs';
import { AI_EXAMPLE_FILENAME, createAiExampleHtml } from './example-save-file.mjs';
import {
	offlineShellSourceFingerprint,
	withOfflineShellFingerprint
} from './offline-shell-fingerprint.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(appRoot, '../..');
const buildDir = join(appRoot, 'build');
const indexPath = join(buildDir, 'index.html');
const staticOfflineShellPath = join(appRoot, 'static', 'offline-app-shell.html');
const examplesDir = join(appRoot, 'examples');
const aiExamplePath = join(examplesDir, AI_EXAMPLE_FILENAME);
const exportHtmlShellWindowKey = '__MIND_MAP_EXPORT_HTML_SHELL__';

let html = await readFile(indexPath, 'utf8');

html = await inlineStylesheets(html);
html = await inlineModuleScripts(html);
html = escapeInlineScriptContents(html);
html = await inlineIcons(html);
html = stripModulePreloads(html);
html = injectExportShellCapture(html);
html = withOfflineShellFingerprint(html, await offlineShellSourceFingerprint({ appRoot }));
html = withBuildStamp(html, resolveBuildStamp({ repoRoot }));

await writeFile(indexPath, html);
await writeFile(staticOfflineShellPath, html);
await mkdir(examplesDir, { recursive: true });
await writeFile(aiExamplePath, createAiExampleHtml(html));
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
			return `<script type="module" data-inline-src="${escapeAttribute(src)}">\n${escapeScriptContent(js)}\n</script>`;
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

function injectExportShellCapture(input) {
	if (input.includes(exportHtmlShellWindowKey)) return input;

	const startCall = /\b__sveltekit_[A-Za-z0-9_]+\.app\.start\(element\);/;
	const match = startCall.exec(input);
	if (!match || match.index === undefined) {
		throw new Error('Unable to find SvelteKit app.start call for export shell capture');
	}

	const captureScript = `window[${JSON.stringify(exportHtmlShellWindowKey)}] = '<!doctype html>\\n' + document.documentElement.outerHTML;\n\t\t\t\t\t`;
	return `${input.slice(0, match.index)}${captureScript}${input.slice(match.index)}`;
}

function escapeInlineScriptContents(input) {
	const openMatch = /<script\b(?![^>]*\bsrc=)(?![^>]*\btype=(["'])application\/json\1)[^>]*>/i.exec(
		input
	);
	if (!openMatch || openMatch.index === undefined) return input;

	const openEnd = openMatch.index + openMatch[0].length;
	const closeStart = input.toLowerCase().lastIndexOf('</script>');
	if (closeStart <= openEnd) return input;

	return `${input.slice(0, openEnd)}${escapeScriptContent(input.slice(openEnd, closeStart))}${input.slice(closeStart)}`;
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

function escapeScriptContent(value) {
	return value.replace(/<(?=\/?script\b)/gi, '\\x3C');
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
