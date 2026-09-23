import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readBuildStamp } from '../../scripts/build-stamp.mjs';
import {
	AI_EXAMPLE_FILENAME,
	AI_EXAMPLE_GRAPH,
	AI_EXAMPLE_VIEW_STATE,
	EXAMPLE_HTML_DOCUMENT_VERSION,
	EXAMPLE_HTML_READER_VERSION,
	EXAMPLE_SCHEMA_VERSION,
	createAiExampleHtml
} from '../../scripts/example-save-file.mjs';
import {
	GRAPH_HTML_DOCUMENT_VERSION,
	GRAPH_HTML_PAYLOAD_SCRIPT_ID,
	GRAPH_HTML_READER_VERSION,
	parseGraphFileText
} from './graphFile';
import { CURRENT_SCHEMA_VERSION } from './migrations';

const offlineShell = readFileSync(
	new URL('../../static/offline-app-shell.html', import.meta.url),
	'utf8'
);
const exampleHtml = readFileSync(
	new URL(`../../examples/${AI_EXAMPLE_FILENAME}`, import.meta.url),
	'utf8'
);

describe('the AI-readable example save file', () => {
	it('copies every current format version explicitly', () => {
		expect(EXAMPLE_SCHEMA_VERSION).toBe(CURRENT_SCHEMA_VERSION);
		expect(EXAMPLE_HTML_DOCUMENT_VERSION).toBe(GRAPH_HTML_DOCUMENT_VERSION);
		expect(EXAMPLE_HTML_READER_VERSION).toBe(GRAPH_HTML_READER_VERSION);
	});

	it('is exactly the deterministic output of the current offline shell and tutorial graph', () => {
		expect(exampleHtml).toBe(createAiExampleHtml(offlineShell));
	});

	it('parses through the production reader as the canonical graph and opening camera', () => {
		const parsed = parseGraphFileText(exampleHtml);

		expect(parsed.data).toEqual(AI_EXAMPLE_GRAPH);
		expect(parsed.viewState).toEqual(AI_EXAMPLE_VIEW_STATE);
		expect(parsed.documentId).toBe('mind-map-ai-authoring-example');
		expect(parsed.appVersion).toBe(readBuildStamp(offlineShell) ?? undefined);
	});

	it('has one obvious payload edit target and no binary asset payloads', () => {
		expect(exampleHtml.match(new RegExp(`id="${GRAPH_HTML_PAYLOAD_SCRIPT_ID}"`, 'g'))).toHaveLength(
			1
		);
		expect(exampleHtml).toContain('AI AGENT QUICK START');
		expect(exampleHtml).toContain('Edit only the JSON text inside that element');
		expect(exampleHtml).toContain('Do not remove or rewrite the app shell after the payload');
		expect(
			exampleHtml.match(/<script\b(?=[^>]*\btype=(['"])application\/x-mind-map-asset\1)[^>]*>/gi)
		).toBeNull();
	});

	it('demonstrates the core stored fields and their visible meaning', () => {
		const guide = AI_EXAMPLE_GRAPH.nodes.find((node) => node.id === 'guide');
		const checklist = AI_EXAMPLE_GRAPH.nodes.find((node) => node.id === 'author-checklist');
		const directed = AI_EXAMPLE_GRAPH.edges.find((edge) => edge.id === 'web-app-calls-api-service');
		const undirected = AI_EXAMPLE_GRAPH.edges.find(
			(edge) => edge.id === 'web-app-related-to-shared-types'
		);

		expect(guide).toMatchObject({
			pinned: true,
			lastPinnedSeq: 1,
			tags: ['guide', 'start-here']
		});
		expect(checklist).toMatchObject({ addons: { task: { done: false } } });
		expect(directed).toMatchObject({ directed: true, tags: ['calls'] });
		expect(undirected).toMatchObject({ directed: false, tags: ['related'] });
		expect(AI_EXAMPLE_GRAPH.tagColorConfig.nodeTags.guide).toBe('#2563eb');
		expect(AI_EXAMPLE_GRAPH.tagColorConfig.edgeTags.calls).toBe('#ea580c');
		expect(Object.keys(AI_EXAMPLE_GRAPH.posByNodeId)).toHaveLength(AI_EXAMPLE_GRAPH.nodes.length);
		expect(AI_EXAMPLE_GRAPH.assets).toEqual({});
	});

	it('keeps every teaching node within the default three-hop pinned neighbourhood', () => {
		const hops = authoredHopsFromGuide();

		expect(hops.size).toBe(AI_EXAMPLE_GRAPH.nodes.length);
		expect(Math.max(...hops.values())).toBeLessThanOrEqual(3);
	});
});

function authoredHopsFromGuide(): Map<string, number> {
	const adjacency = new Map<string, Set<string>>();
	for (const node of AI_EXAMPLE_GRAPH.nodes) adjacency.set(node.id, new Set());
	for (const edge of AI_EXAMPLE_GRAPH.edges) {
		adjacency.get(edge.sourceNodeId)?.add(edge.targetNodeId);
		adjacency.get(edge.targetNodeId)?.add(edge.sourceNodeId);
	}

	const hops = new Map<string, number>([['guide', 0]]);
	const queue = ['guide'];
	for (let index = 0; index < queue.length; index += 1) {
		const nodeId = queue[index];
		if (nodeId === undefined) continue;
		const nextHop = (hops.get(nodeId) ?? 0) + 1;
		for (const neighbor of adjacency.get(nodeId) ?? []) {
			if (hops.has(neighbor)) continue;
			hops.set(neighbor, nextHop);
			queue.push(neighbor);
		}
	}
	return hops;
}
