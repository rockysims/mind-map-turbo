/**
 * Canonical graph and generator for the save file we hand to an AI agent.
 *
 * The three format numbers below deliberately copy the production constants.
 * `exampleSaveFile.spec.ts` compares them to those constants, so the commit
 * that changes the format also has to make an explicit decision about this
 * example. Keeping this module plain JavaScript lets the build script generate
 * the example without adding a TypeScript runner to the production toolchain.
 */

export const EXAMPLE_SCHEMA_VERSION = 8;
export const EXAMPLE_HTML_DOCUMENT_VERSION = 1;
export const EXAMPLE_HTML_READER_VERSION = 4;
export const AI_EXAMPLE_FILENAME = 'ai-mind-map.html';

const GRAPH_PAYLOAD_ID = 'mind-map-embedded-graph';
const GUIDE_START = '<!-- mind-map-ai-authoring-guide:start';
const GUIDE_END = 'mind-map-ai-authoring-guide:end -->';

export const AI_EXAMPLE_GRAPH = {
	nodes: [
		{
			id: 'guide',
			title: 'AI mind-map authoring guide',
			description:
				'This is both a real mind map and the documentation for authoring one. If you are an AI agent, copy this entire HTML file so the offline app stays intact, then replace only the JSON inside the script whose id is mind-map-embedded-graph. Keep the format-version values already present. Replace data and viewState with the graph you want. The minified code after the payload is the app; do not interpret or rewrite it.',
			tags: ['guide', 'start-here'],
			pinned: true,
			lastPinnedSeq: 1,
			content: []
		},
		{
			id: 'quick-start',
			title: 'Safe creation recipe',
			description:
				'1. Copy the whole HTML file. 2. Find the one application/json script named mind-map-embedded-graph. 3. Keep schemaVersion, htmlDocumentVersion, and minReaderVersion from this template. 4. Replace data.nodes, data.edges, data.posByNodeId, data.tagColorConfig, data.assets, and viewState. 5. Use unique string ids and valid JSON: double quotes, no comments, no trailing commas. 6. Open the result in a browser. The file is the offline app and the save together.',
			tags: ['guide'],
			content: []
		},
		{
			id: 'format',
			title: 'Save payload anatomy',
			description:
				'The editable payload is a JSON object. schemaVersion selects the graph schema. data is the graph. viewState is the opening camera. documentId is optional identity. appVersion records which app wrote the file. htmlDocumentVersion and minReaderVersion protect the self-contained HTML container. exportedAt is optional epoch milliseconds. Unknown top-level keys are not documentation space; put human guidance in node descriptions instead.',
			tags: ['format'],
			content: []
		},
		{
			id: 'nodes',
			title: 'Nodes',
			description:
				'Every node requires id, title, description, and tags. Use content: [] for no attachments. pinned keeps an important node and its neighbourhood visible; pair a pinned node with lastPinnedSeq and keep graph.pinSequence at least that high. Optional addons can contain task or ai data. Optional inputs and outputs contain confirmed quantity designations shaped like {base, subscript}; those create derived dataflow arrows and are not ordinary stored edges. Optional sizeBytes is the size in bytes of the thing the node represents (a page, file, or download), a finite number of at least 0; the app records it and shows it in the node details but does not draw it as border thickness, and it is not the size of the attachments in content. Omit it when the size is unknown. The Database example node carries one. Optional weight is a finite number of at least 0 that ranks the node by whatever the importer measured (word count, importance, citations); 0 is a real value meaning it weighs nothing, so omit weight when it is unknown. The Web application and API service example nodes carry one. Which number the border shows is a per-graph setting in the app, not graph data: nothing (the default), node weight (linear), edge count (linear), attachment size (logarithmic: the total bytes of the assets its content blocks name), or description length (logarithmic).',
			tags: ['format'],
			content: []
		},
		{
			id: 'edges',
			title: 'Edges',
			description:
				'Every stored edge requires a unique id, sourceNodeId, targetNodeId, and tags. Both endpoint ids must name nodes. With directed: true, the arrow runs source to target. With directed: false (or omitted), the relationship is undirected. The first edge tag chooses the stroke colour. Do not store derived quantity/dataflow edges; the app computes those from node inputs and outputs.',
			tags: ['format'],
			content: []
		},
		{
			id: 'envelope',
			title: 'Required graph collections',
			description:
				'data.nodes and data.edges are arrays. data.posByNodeId maps every node id to a finite {x, y} seed position. data.tagColorConfig has nodeTags and edgeTags objects, even when both are empty. data.tagPhysicsConfig is optional: when present it has nodeTags and edgeTags objects mapping a tag name to a layout factor between 1 and 8, and a tag it omits (or the whole field omitted) means ×1. data.weightConfig is optional: {label, unit?} names what node weight means in this graph, and the details view reads label, value, then unit (for example Importance 3); omit it and the line reads Weight. data.assets is an object; use {} when there are no attachments. pinSequence is optional unless you provide lastPinnedSeq values. Keep JSON references internally consistent: unique ids, real endpoints, real position keys, and no dangling asset ids.',
			tags: ['format'],
			content: []
		},
		{
			id: 'visual-behavior',
			title: 'What the reader sees',
			description:
				'Pinned nodes are the readable anchors. By default the app shows three edge-hop layers around them and scales farther nodes down. Unpinned disconnected components elect a single beacon, so pin at least one useful hub in each component when you want its neighbourhood open immediately. Positions are starting coordinates, not rigid placement: the layout relaxes overlaps while pinned nodes stay anchored.',
			tags: ['behavior'],
			content: []
		},
		{
			id: 'tags',
			title: 'Tags colour the graph',
			description:
				'Node tags colour the node outline. One tag gives one colour; multiple tags split the outline into equal coloured segments, as the guide node demonstrates. Edge tags colour the edge from the first tag only. tagColorConfig.nodeTags and .edgeTags are separate name-to-hex-colour maps. A tag without an explicit entry still gets a deterministic fallback and appears in the legend. The optional tagPhysicsConfig tunes the layout per tag: an edge-tag factor scales the length of every edge carrying that tag, a node-tag factor scales the spacing kept around every node carrying it, and an element with several tuned tags uses the geometric mean of their factors. Tags are structured arrays in the save, not # or @ syntax.',
			tags: ['behavior', 'format'],
			content: []
		},
		{
			id: 'layout',
			title: 'Positions, pins, and camera',
			description:
				'Give every node a posByNodeId entry. Space conceptual groups apart so the first frame has useful intent; the physics will tidy it. Set pinned: true on the main hub or hubs. lastPinnedSeq records pin recency and graph.pinSequence is the highest issued value. viewState has panX, panY, and scale; {0, 0, 1} is a safe neutral camera, and the user can press F to fit the visible graph.',
			tags: ['behavior'],
			content: []
		},
		{
			id: 'advanced',
			title: 'Optional features and assets',
			description:
				'content blocks reference assets by id and therefore require both matching data.assets metadata and separate base64 asset script elements in the HTML. Never invent or copy a dangling assetId; use content: [] and assets: {} unless you are deliberately embedding bytes. addons.task is {done, doneAt?}. addons.ai has prompt, optional model/script, runs, and promoted. API keys and browser settings never belong in a graph file.',
			tags: ['format'],
			content: []
		},
		{
			id: 'codebase-example',
			title: 'Example codebase map',
			description:
				'This branch is a miniature example of the kind of graph an agent can create after inspecting a repository. Prefer meaningful domain nodes over one node per file. Use directed, tagged edges for calls, ownership, and dependencies; use undirected edges for symmetric relationships. Put evidence such as paths, responsibilities, entry points, and important constraints in descriptions.',
			tags: ['example'],
			content: []
		},
		{
			id: 'web-app',
			title: 'Web application',
			description:
				'Example module node. Entry point: apps/web/src/main.ts. Owns the browser UI and calls the API client. In a real codebase map, describe responsibilities and boundaries here instead of pasting large source files.',
			tags: ['example', 'module'],
			content: [],
			weight: 3
		},
		{
			id: 'api-service',
			title: 'API service',
			description:
				'Example module node. Entry point: services/api/src/server.ts. Validates requests, applies business rules, and owns database access. The incoming calls edge and outgoing depends-on edge make the dependency direction visible.',
			tags: ['example', 'module'],
			content: [],
			weight: 5
		},
		{
			id: 'database',
			title: 'Database',
			description:
				'Example storage boundary. Schema and migrations live under services/api/db. A tagged directed edge from API service says the service depends on this component.',
			tags: ['example', 'storage'],
			content: [],
			sizeBytes: 52428800
		},
		{
			id: 'shared-types',
			title: 'Shared types',
			description:
				'Example symmetric relationship. Both the web app and API use this package, so the stored edges are undirected and tagged related. Direction is a semantic choice, not a layout requirement.',
			tags: ['example', 'module'],
			content: []
		},
		{
			id: 'author-checklist',
			title: 'Author checklist',
			description:
				'Before handing over a generated map: validate JSON; keep the shell untouched; confirm ids, endpoints, positions, and asset references; pin the intended starting hub; use tags consistently; keep every important node within the visible hop budget; and open the HTML once. This node carries the task add-on, showing that add-ons are stored as structured node data rather than in the title.',
			tags: ['guide'],
			content: [],
			addons: { task: { done: false } }
		}
	],
	edges: [
		{
			id: 'guide-to-quick-start',
			sourceNodeId: 'guide',
			targetNodeId: 'quick-start',
			tags: ['read-first'],
			directed: true
		},
		{
			id: 'guide-to-format',
			sourceNodeId: 'guide',
			targetNodeId: 'format',
			tags: ['contains'],
			directed: true
		},
		{
			id: 'format-to-nodes',
			sourceNodeId: 'format',
			targetNodeId: 'nodes',
			tags: ['contains'],
			directed: true
		},
		{
			id: 'format-to-edges',
			sourceNodeId: 'format',
			targetNodeId: 'edges',
			tags: ['contains'],
			directed: true
		},
		{
			id: 'format-to-envelope',
			sourceNodeId: 'format',
			targetNodeId: 'envelope',
			tags: ['contains'],
			directed: true
		},
		{
			id: 'format-to-advanced',
			sourceNodeId: 'format',
			targetNodeId: 'advanced',
			tags: ['contains'],
			directed: true
		},
		{
			id: 'guide-to-visual-behavior',
			sourceNodeId: 'guide',
			targetNodeId: 'visual-behavior',
			tags: ['contains'],
			directed: true
		},
		{
			id: 'visual-behavior-to-tags',
			sourceNodeId: 'visual-behavior',
			targetNodeId: 'tags',
			tags: ['contains'],
			directed: true
		},
		{
			id: 'visual-behavior-to-layout',
			sourceNodeId: 'visual-behavior',
			targetNodeId: 'layout',
			tags: ['contains'],
			directed: true
		},
		{
			id: 'guide-to-codebase-example',
			sourceNodeId: 'guide',
			targetNodeId: 'codebase-example',
			tags: ['contains'],
			directed: true
		},
		{
			id: 'codebase-example-to-web-app',
			sourceNodeId: 'codebase-example',
			targetNodeId: 'web-app',
			tags: ['contains'],
			directed: true
		},
		{
			id: 'codebase-example-to-api-service',
			sourceNodeId: 'codebase-example',
			targetNodeId: 'api-service',
			tags: ['contains'],
			directed: true
		},
		{
			id: 'web-app-calls-api-service',
			sourceNodeId: 'web-app',
			targetNodeId: 'api-service',
			tags: ['calls'],
			directed: true
		},
		{
			id: 'api-service-depends-on-database',
			sourceNodeId: 'api-service',
			targetNodeId: 'database',
			tags: ['depends-on'],
			directed: true
		},
		{
			id: 'web-app-related-to-shared-types',
			sourceNodeId: 'web-app',
			targetNodeId: 'shared-types',
			tags: ['related'],
			directed: false
		},
		{
			id: 'api-service-related-to-shared-types',
			sourceNodeId: 'api-service',
			targetNodeId: 'shared-types',
			tags: ['related'],
			directed: false
		},
		{
			id: 'guide-to-author-checklist',
			sourceNodeId: 'guide',
			targetNodeId: 'author-checklist',
			tags: ['next'],
			directed: true
		}
	],
	posByNodeId: {
		guide: { x: 0, y: 0 },
		'quick-start': { x: -850, y: -500 },
		format: { x: 0, y: -850 },
		nodes: { x: -760, y: -1450 },
		edges: { x: -250, y: -1600 },
		envelope: { x: 300, y: -1600 },
		advanced: { x: 820, y: -1400 },
		'visual-behavior': { x: 850, y: -350 },
		tags: { x: 1450, y: -700 },
		layout: { x: 1550, y: -150 },
		'codebase-example': { x: 700, y: 650 },
		'web-app': { x: 1300, y: 900 },
		'api-service': { x: 700, y: 1350 },
		database: { x: 650, y: 2000 },
		'shared-types': { x: 1450, y: 1500 },
		'author-checklist': { x: -650, y: 650 }
	},
	tagColorConfig: {
		nodeTags: {
			guide: '#2563eb',
			'start-here': '#f59e0b',
			format: '#7c3aed',
			behavior: '#0f766e',
			example: '#16a34a',
			module: '#0284c7',
			storage: '#a16207'
		},
		edgeTags: {
			'read-first': '#dc2626',
			contains: '#64748b',
			calls: '#ea580c',
			'depends-on': '#9333ea',
			related: '#0f766e',
			next: '#16a34a'
		}
	},
	weightConfig: { label: 'Importance' },
	assets: {},
	pinSequence: 1
};

export const AI_EXAMPLE_VIEW_STATE = { panX: 0, panY: 0, scale: 0.55 };

/** @param {string | undefined} appVersion */
export function createAiExamplePayload(appVersion) {
	return {
		schemaVersion: EXAMPLE_SCHEMA_VERSION,
		data: AI_EXAMPLE_GRAPH,
		viewState: AI_EXAMPLE_VIEW_STATE,
		documentId: 'mind-map-ai-authoring-example',
		...(appVersion === undefined ? {} : { appVersion }),
		htmlDocumentVersion: EXAMPLE_HTML_DOCUMENT_VERSION,
		minReaderVersion: EXAMPLE_HTML_READER_VERSION
	};
}

/** @param {string} offlineShell */
export function createAiExampleHtml(offlineShell) {
	const cleanShell = removeExistingGuideAndPayload(offlineShell);
	const appVersion = readMetaContent(cleanShell, 'mind-map-build') ?? undefined;
	const json = JSON.stringify(createAiExamplePayload(appVersion), null, 2).replaceAll(
		'<',
		'\\u003c'
	);
	const payload = `${agentGuideComment()}\n<script id="${GRAPH_PAYLOAD_ID}" type="application/json">${json}</script>`;
	const bootScriptIndex = firstExecutableScriptIndex(cleanShell);

	if (bootScriptIndex === -1) {
		throw new Error('Offline shell has no executable script before which to place the example');
	}

	return `${cleanShell.slice(0, bootScriptIndex)}${payload}\n${cleanShell.slice(bootScriptIndex)}`;
}

function agentGuideComment() {
	return `${GUIDE_START}

AI AGENT QUICK START

This is a complete, runnable Mind Map save file. The large minified section is
the offline app. Preserve it byte-for-byte when creating a new map.

1. Copy this entire file to a new .html file.
2. Find the single application/json script element whose id is
   mind-map-embedded-graph immediately below this comment.
3. Edit only the JSON text inside that element. Keep the schemaVersion,
   htmlDocumentVersion, and minReaderVersion values from this example.
4. Replace data and viewState. Use the visible guide graph as the field
   reference; its node descriptions explain how the user sees each feature.
5. Keep ids unique and references valid. Use assets: {} and content: [] unless
   you are also embedding real base64 asset script elements.
6. Produce strict JSON: double quotes, no comments, no trailing commas.
7. Do not remove or rewrite the app shell after the payload.

The most useful defaults for a new codebase map are one pinned root node,
meaningful descriptions with source paths and responsibilities, directed tagged
dependency edges, rough seed positions for every node, and explicit tag colours.

${GUIDE_END}`;
}

/** @param {string} html */
function removeExistingGuideAndPayload(html) {
	const guidePattern = new RegExp(
		`${escapeRegExp(GUIDE_START)}[\\s\\S]*?${escapeRegExp(GUIDE_END)}\\s*`,
		'i'
	);
	const payloadPattern = new RegExp(
		`<script\\b(?=[^>]*\\bid=(["'])${GRAPH_PAYLOAD_ID}\\1)(?=[^>]*\\btype=(["'])application/json\\2)[^>]*>[\\s\\S]*?<\\/script>\\s*`,
		'i'
	);
	return html.replace(guidePattern, '').replace(payloadPattern, '');
}

/** @param {string} html */
function firstExecutableScriptIndex(html) {
	const match = html.match(/<script\b(?![^>]*\btype=(["'])application\/json\1)[^>]*>/i);
	return match?.index ?? -1;
}

/**
 * @param {string} html
 * @param {string} name
 */
function readMetaContent(html, name) {
	const escapedName = escapeRegExp(name);
	const match = html.match(
		new RegExp(
			`<meta\\b(?=[^>]*\\bname=(["'])${escapedName}\\1)(?=[^>]*\\bcontent=(["'])([^"']+)\\2)[^>]*>`,
			'i'
		)
	);
	return match?.[3] ?? null;
}

/** @param {string} value */
function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
