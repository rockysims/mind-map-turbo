/**
 * The single place Temml is imported.
 *
 * Keeping every call behind this boundary means swapping engines later is a
 * one-module change, and it gives the dataflow layer one shape to consume.
 *
 * Renders through `__renderToMathMLTree` rather than `renderToString` so callers
 * get a walkable tree as well as markup. The tree is plain objects, so symbol
 * extraction can stay a pure function tested under Node, where no DOM exists.
 */

import temml from 'temml';
import { APP_CONFIG } from '../../../../appConfig';

/**
 * The subset of Temml's MathML node that consumers walk. Temml ships this as
 * `any`, so this interface is the contract we hold it to.
 */
export interface MathNode {
	/** `'math'` on a successful root; absent on Temml's error node. */
	readonly type?: string;
	readonly attributes?: Readonly<Record<string, string>>;
	readonly children?: readonly MathNode[];
	/** Present on leaf text nodes only. */
	readonly text?: string;
	toMarkup(): string;
}

type MathRenderResult =
	| { ok: true; markup: string; tree: MathNode }
	| { ok: false; markup: string; message: string };

interface MathRenderOptions {
	displayMode?: boolean;
	maxSizeEm?: number;
	maxSizePt?: number;
	maxExpand?: number;
	cacheMaxEntries?: number;
}

const cache = new Map<string, MathRenderResult>();

/** Collect the text of a node and its descendants, in document order. */
function collectText(node: MathNode): string {
	if (typeof node.text === 'string') {
		return node.text;
	}
	return (node.children ?? []).map(collectText).join('');
}

/**
 * Temml's error node carries a single text child shaped as
 * `${source}\n\n${parse message}`. Strip the echoed source so callers can show
 * the message alone, falling back to the whole text if that shape ever changes.
 */
function errorMessageFrom(node: MathNode, expression: string): string {
	const text = collectText(node);
	const echoedSource = `${expression}\n\n`;
	const message = text.startsWith(echoedSource) ? text.slice(echoedSource.length) : text;
	return message.trim();
}

function evict(maxEntries: number): void {
	while (cache.size > maxEntries) {
		const oldest = cache.keys().next();
		if (oldest.done) {
			return;
		}
		cache.delete(oldest.value);
	}
}

/**
 * Render one LaTeX expression to MathML.
 *
 * Never throws: invalid input returns the error branch carrying Temml's own
 * error markup and the parse message, because descriptions are author-controlled
 * text that is routinely invalid mid-keystroke.
 */
export function renderMath(expression: string, options: MathRenderOptions = {}): MathRenderResult {
	const {
		displayMode = false,
		maxSizeEm = APP_CONFIG.math.maxSizeEm,
		maxSizePt = APP_CONFIG.math.maxSizePt,
		maxExpand = APP_CONFIG.math.maxExpand,
		cacheMaxEntries = APP_CONFIG.math.renderCacheMaxEntries
	} = options;

	const key = `${displayMode}|${maxSizeEm}|${maxSizePt}|${maxExpand}|${expression}`;
	const cached = cache.get(key);
	if (cached !== undefined) {
		return cached;
	}

	let result: MathRenderResult;
	try {
		// Temml types __renderToMathMLTree as `any`; MathNode is the shape we rely on.
		const rendered = temml.__renderToMathMLTree(expression, {
			displayMode,
			throwOnError: false,
			trust: false,
			maxSize: [maxSizeEm, maxSizePt],
			maxExpand
		}) as MathNode;

		result =
			rendered.type === 'math'
				? { ok: true, markup: rendered.toMarkup(), tree: rendered }
				: {
						ok: false,
						markup: rendered.toMarkup(),
						message: errorMessageFrom(rendered, expression)
					};
	} catch (error) {
		// throwOnError:false covers parse errors, but a cap like maxExpand can still
		// surface as a throw. Callers must never have to guard a render.
		result = {
			ok: false,
			markup: '',
			message: error instanceof Error ? error.message.trim() : String(error)
		};
	}

	cache.set(key, result);
	evict(cacheMaxEntries);
	return result;
}

export function clearMathRenderCache(): void {
	cache.clear();
}

/** Current cache occupancy. Exposed so specs can assert eviction. */
export function mathRenderCacheSize(): number {
	return cache.size;
}
