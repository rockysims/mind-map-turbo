/**
 * Server-sent events in, one assembled turn out — with nothing that touches
 * the network, so every stream shape the API can produce is a fixture rather
 * than a live call.
 *
 * Two halves, kept apart because they fail differently. `parseSseChunks` is
 * about *bytes*: a chunk boundary can land mid-line, mid-event or between the
 * `event:` and `data:` of the same event, and the parser's whole job is to be
 * indifferent to where. `createStreamFolder` is about *meaning*: which content
 * block an index refers to, what a `partial_json` run adds up to, and which
 * stop reason ended the turn.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { AiClientError, type AiStreamEvent, type AiTurn } from './aiClient';

/** The `error` event, which is not part of the SDK's stream-event union. */
export interface AiSseErrorEvent {
	type: 'error';
	error: { type: string; message: string };
}

/**
 * One parsed SSE payload.
 *
 * The SDK's `RawMessageStreamEvent` covers the six message and content-block
 * events; `ping` and `error` are sent on the same stream and are not in it, so
 * they are named here.
 */
export type AiSseEvent = Anthropic.RawMessageStreamEvent | { type: 'ping' } | AiSseErrorEvent;

/** The event names this parser hands on. Anything else is dropped. */
const KNOWN_EVENT_TYPES = new Set([
	'message_start',
	'message_delta',
	'message_stop',
	'content_block_start',
	'content_block_delta',
	'content_block_stop',
	'ping',
	'error'
]);

/**
 * A stateful reader over decoded response text.
 *
 * `push` returns the events completed by that chunk, which may be none (the
 * chunk ended mid-event) or several (the chunk carried a backlog). `finish`
 * flushes an event whose trailing blank line never arrived, which is what a
 * stream cut short looks like; a half-written `data:` line simply parses as
 * junk and raises, because pretending a truncated event was complete would put
 * a half-parsed turn in front of the reader.
 */
export function parseSseChunks(): {
	push(chunk: string): AiSseEvent[];
	finish(): AiSseEvent[];
} {
	let buffer = '';
	let dataLines: string[] = [];

	const takeEvent = (): AiSseEvent | undefined => {
		if (dataLines.length === 0) return undefined;
		const payload = dataLines.join('\n');
		dataLines = [];
		return parsePayload(payload);
	};

	const consumeLine = (line: string, events: AiSseEvent[]): void => {
		// `\r\n` on the wire; the split above only removes the `\n`.
		const text = line.endsWith('\r') ? line.slice(0, -1) : line;

		if (text === '') {
			const event = takeEvent();
			if (event) events.push(event);
			return;
		}
		// A comment line, which is how some proxies keep a stream warm.
		if (text.startsWith(':')) return;

		const colon = text.indexOf(':');
		const field = colon === -1 ? text : text.slice(0, colon);
		if (field !== 'data') return;

		const raw = text.slice(colon + 1);
		dataLines.push(raw.startsWith(' ') ? raw.slice(1) : raw);
	};

	return {
		push(chunk: string): AiSseEvent[] {
			buffer += chunk;
			const events: AiSseEvent[] = [];

			let newline = buffer.indexOf('\n');
			while (newline !== -1) {
				consumeLine(buffer.slice(0, newline), events);
				buffer = buffer.slice(newline + 1);
				newline = buffer.indexOf('\n');
			}

			return events;
		},

		finish(): AiSseEvent[] {
			const events: AiSseEvent[] = [];
			if (buffer !== '') {
				consumeLine(buffer, events);
				buffer = '';
			}
			const event = takeEvent();
			if (event) events.push(event);
			return events;
		}
	};
}

function parsePayload(payload: string): AiSseEvent | undefined {
	// Not something the Messages API sends, but the SSE convention, and cheaper
	// to skip than to explain in a stack trace.
	if (payload === '[DONE]') return undefined;

	let parsed: unknown;
	try {
		parsed = JSON.parse(payload);
	} catch {
		throw new AiClientError('stream', 'The response stream carried an unreadable event.');
	}

	if (typeof parsed !== 'object' || parsed === null) {
		throw new AiClientError('stream', 'The response stream carried an unreadable event.');
	}
	// Reading one field off a checked non-null object; the value comes back as
	// `unknown` and is checked on the next line.
	const type = (parsed as { type?: unknown }).type;
	if (typeof type !== 'string' || !KNOWN_EVENT_TYPES.has(type)) return undefined;

	// The payloads are the SDK's own event types and `type` is their
	// discriminant; restating each one's fields as a runtime guard would be a
	// second copy of the API schema to keep in step. So the narrowing is
	// asserted once, here, behind the `type` check, and every reader below is
	// typed — with the folder still treating individual fields defensively.
	return parsed as AiSseEvent;
}

/** One content block being assembled, before its deltas are folded in. */
interface BlockAccumulator {
	start: Anthropic.ContentBlock;
	text: string;
	thinking: string;
	signature: string;
	json: string;
}

/**
 * Assembles a turn as events arrive, reporting progress through `onEvent`.
 *
 * Incremental rather than a fold over a finished array because the workbench
 * has to show the first token, not the last: the client pushes each event as
 * it is decoded and calls `finish` once the body ends.
 */
interface StreamFolder {
	push(event: AiSseEvent): void;
	finish(): AiTurn;
}

export function createStreamFolder(onEvent?: (event: AiStreamEvent) => void): StreamFolder {
	const blocks = new Map<number, BlockAccumulator>();
	let model = '';
	let inputTokens = 0;
	let outputTokens = 0;
	let stopReason: Anthropic.StopReason | null = null;
	let stopDetails: Anthropic.RefusalStopDetails | undefined;

	return {
		push(event: AiSseEvent): void {
			switch (event.type) {
				case 'ping':
				case 'message_stop':
				case 'content_block_stop':
					return;

				case 'error':
					// Kind `stream` rather than a status-shaped kind: the request was
					// accepted, the turn was already partly on screen, and the caller has
					// a half-finished run to record either way.
					throw new AiClientError('stream', event.error.message || 'The response stream failed.');

				case 'message_start':
					model = event.message.model;
					inputTokens = event.message.usage.input_tokens;
					return;

				case 'content_block_start':
					blocks.set(event.index, {
						start: event.content_block,
						text: '',
						thinking: '',
						signature: '',
						json: ''
					});
					if (event.content_block.type === 'tool_use') {
						onEvent?.({ type: 'tool-call-start', name: event.content_block.name });
					}
					return;

				case 'content_block_delta': {
					const block = blocks.get(event.index);
					if (!block) return;
					applyDelta(block, event.delta, onEvent);
					return;
				}

				case 'message_delta':
					stopReason = event.delta.stop_reason;
					stopDetails = event.delta.stop_details ?? undefined;
					// Cumulative on the wire, so the last one wins rather than summing.
					if (event.usage.input_tokens !== null) inputTokens = event.usage.input_tokens;
					outputTokens = event.usage.output_tokens;
					onEvent?.({ type: 'usage', inputTokens, outputTokens });
					return;
			}
		},

		finish(): AiTurn {
			// Index order, not arrival order: a block's deltas can interleave with
			// another's, and the API numbers them in the order they belong.
			const ordered = [...blocks.entries()].sort(([left], [right]) => left - right);
			return {
				content: ordered.map(([, block]) => finishBlock(block)),
				stopReason,
				...(stopDetails === undefined ? {} : { stopDetails }),
				usage: { inputTokens, outputTokens },
				model
			};
		}
	};
}

/** The whole fold in one call, for specs and any caller holding a finished stream. */
export function foldStreamEvents(
	events: AiSseEvent[],
	onEvent?: (event: AiStreamEvent) => void
): AiTurn {
	const folder = createStreamFolder(onEvent);
	for (const event of events) folder.push(event);
	return folder.finish();
}

function applyDelta(
	block: BlockAccumulator,
	delta: Anthropic.RawContentBlockDelta,
	onEvent?: (event: AiStreamEvent) => void
): void {
	switch (delta.type) {
		case 'text_delta':
			block.text += delta.text;
			onEvent?.({ type: 'text', text: delta.text });
			return;
		case 'thinking_delta':
			block.thinking += delta.thinking;
			onEvent?.({ type: 'thinking', text: delta.thinking });
			return;
		case 'signature_delta':
			block.signature += delta.signature;
			return;
		case 'input_json_delta':
			block.json += delta.partial_json;
			return;
		// `citations_delta` needs no handling: nothing here sends documents, so
		// no block can cite one.
		default:
			return;
	}
}

function finishBlock(block: BlockAccumulator): Anthropic.ContentBlock {
	const { start } = block;

	if (start.type === 'text') return { ...start, text: start.text + block.text };

	if (start.type === 'thinking') {
		return {
			...start,
			thinking: start.thinking + block.thinking,
			signature: start.signature + block.signature
		};
	}

	if (start.type === 'tool_use') return { ...start, input: parseToolInput(block.json) };

	// `redacted_thinking` and the server-tool blocks carry no deltas we send
	// tools for; passing the start block through keeps them intact for the echo.
	return start;
}

/**
 * The accumulated `partial_json` as the tool's input.
 *
 * An empty run means a tool with no arguments, which is `{}` and not an error.
 * Anything else that will not parse is the stream having lost a delta, and a
 * script assembled from half its characters is worse than a failed run.
 */
function parseToolInput(json: string): unknown {
	if (json.trim() === '') return {};
	try {
		return JSON.parse(json);
	} catch {
		throw new AiClientError('stream', "A tool call's arguments arrived incomplete.");
	}
}
