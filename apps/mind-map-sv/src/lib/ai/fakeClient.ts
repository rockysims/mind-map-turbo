/**
 * A scripted `AiClient` for stories and specs.
 *
 * Stories need a run that streams, shows thinking, calls the tool twice and
 * finishes — without a key, a network or a bill. Specs need to know what the
 * run controller actually sent. So this replays turns and records every
 * request, and the run loop above it cannot tell the difference.
 */

import {
	AiClientError,
	type AiClient,
	type AiRequest,
	type AiSendOptions,
	type AiStreamEvent,
	type AiTurn
} from './aiClient';
import type { AiKeyValidation } from './aiSettings';

interface FakeAiClientOptions {
	/** What `validateKey` answers. Defaults to accepting every key. */
	validation?: AiKeyValidation;
	/**
	 * Characters of text or thinking per emitted event. A story that wants the
	 * surface to fill in visibly sets a small number; the default emits each
	 * block in one event, which is what a spec wants.
	 */
	chunkSize?: number;
}

interface FakeAiClient extends AiClient {
	/** Every request `send` received, in order. */
	readonly requests: AiRequest[];
	/** Every key `validateKey` was asked about, in order. */
	readonly validatedKeys: string[];
}

/**
 * `turns` as an array replays one turn per call, in order, and throws once it
 * runs out — a loop that asks for more turns than the fixture describes is a
 * bug in the loop, not a reason to invent a reply. As a function it answers
 * per request, which is how a spec makes the second turn depend on the tool
 * result in the first.
 */
export function createFakeAiClient(
	turns: AiTurn[] | ((request: AiRequest) => AiTurn),
	options: FakeAiClientOptions = {}
): FakeAiClient {
	const { validation = { ok: true }, chunkSize } = options;
	const requests: AiRequest[] = [];
	const validatedKeys: string[] = [];
	let nextTurn = 0;

	return {
		requests,
		validatedKeys,

		async validateKey(key: string): Promise<AiKeyValidation> {
			validatedKeys.push(key);
			return validation;
		},

		async send(request: AiRequest, sendOptions: AiSendOptions = {}): Promise<AiTurn> {
			requests.push(request);
			const { onEvent, signal } = sendOptions;
			if (signal?.aborted) throw new AiClientError('aborted', 'The run was cancelled.');

			const turn = typeof turns === 'function' ? turns(request) : takeTurn(turns, nextTurn++);
			if (onEvent) emitTurn(turn, onEvent, chunkSize);
			return turn;
		}
	};
}

function takeTurn(turns: AiTurn[], index: number): AiTurn {
	const turn = turns[index];
	if (!turn) {
		throw new AiClientError(
			'other',
			`The fake client was scripted with ${turns.length} turns and asked for ${index + 1}.`
		);
	}
	return turn;
}

/** The turn's blocks as the stream events a real one would have produced. */
function emitTurn(
	turn: AiTurn,
	onEvent: (event: AiStreamEvent) => void,
	chunkSize: number | undefined
): void {
	for (const block of turn.content) {
		if (block.type === 'thinking') {
			for (const text of chunks(block.thinking, chunkSize)) onEvent({ type: 'thinking', text });
		} else if (block.type === 'text') {
			for (const text of chunks(block.text, chunkSize)) onEvent({ type: 'text', text });
		} else if (block.type === 'tool_use') {
			onEvent({ type: 'tool-call-start', name: block.name });
		}
	}
	onEvent({ type: 'usage', ...turn.usage });
}

function chunks(text: string, size: number | undefined): string[] {
	if (text === '') return [];
	if (size === undefined || size <= 0) return [text];

	const parts: string[] = [];
	for (let index = 0; index < text.length; index += size) {
		parts.push(text.slice(index, index + size));
	}
	return parts;
}
