/**
 * The one place this app touches the network, and the only endpoint it knows:
 * `POST /v1/messages`.
 *
 * A raw `fetch` rather than the SDK, because the SDK's runtime is 188 KB
 * minified against a 599 KB offline shell however little of it is imported —
 * so the types come from it and the transport does not. What remains here is
 * genuinely small: four headers, a body someone else built, an abort signal,
 * a status-to-kind table, and a decoder loop that hands text to
 * `parseSseChunks`.
 */

import { APP_CONFIG } from '$lib/appConfig';
import {
	AiClientError,
	type AiClient,
	type AiClientErrorKind,
	type AiRequest,
	type AiSendOptions,
	type AiTurn
} from './aiClient';
import type { AiKeyValidation } from './aiSettings';
import { createStreamFolder, parseSseChunks } from './aiStream';

/** What the official SDK sends when it is told a browser is allowed to call. */
const BROWSER_ACCESS_HEADER = 'anthropic-dangerous-direct-browser-access';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';

interface AnthropicClientOptions {
	apiKey: string;
	/**
	 * The model `validateKey` checks against. `send` uses the model in the
	 * request body; only the validation call has to invent one, and it should be
	 * the model the reader is about to run, so a key without access to it is
	 * refused at Connect rather than on the first run.
	 */
	model?: string;
	/** Injected so a spec never reaches the network. */
	fetch?: typeof globalThis.fetch;
	baseUrl?: string;
}

export function createAnthropicClient(options: AnthropicClientOptions): AiClient {
	const {
		apiKey,
		model = APP_CONFIG.ai.defaultModel,
		fetch: doFetch = globalThis.fetch,
		baseUrl = DEFAULT_BASE_URL
	} = options;

	const endpoint = `${baseUrl.replace(/\/+$/, '')}/v1/messages`;

	const post = async (key: string, body: unknown, signal?: AbortSignal): Promise<Response> => {
		let response: Response;
		try {
			response = await doFetch(endpoint, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-api-key': key,
					'anthropic-version': ANTHROPIC_VERSION,
					[BROWSER_ACCESS_HEADER]: 'true'
				},
				body: JSON.stringify(body),
				...(signal ? { signal } : {})
			});
		} catch (error) {
			throw toClientError(error, signal);
		}

		if (!response.ok) throw await errorFromResponse(response);
		return response;
	};

	return {
		async send(request: AiRequest, sendOptions: AiSendOptions = {}): Promise<AiTurn> {
			const { onEvent, signal } = sendOptions;
			if (signal?.aborted) throw new AiClientError('aborted', 'The run was cancelled.');

			const response = await post(apiKey, request, signal);
			const body = response.body;
			if (!body) throw new AiClientError('stream', 'The API answered with no response body.');

			const reader = body.getReader();
			const decoder = new TextDecoder();
			const parser = parseSseChunks();
			const folder = createStreamFolder(onEvent);

			try {
				for (;;) {
					// Checked before every read as well as by `fetch`: a signal aborted
					// between chunks must end the run even where the body stream is not
					// wired to it.
					if (signal?.aborted) throw new AiClientError('aborted', 'The run was cancelled.');

					let chunk: ReadableStreamReadResult<Uint8Array>;
					try {
						chunk = await reader.read();
					} catch (error) {
						throw toClientError(error, signal);
					}

					if (chunk.done) break;
					for (const event of parser.push(decoder.decode(chunk.value, { stream: true }))) {
						folder.push(event);
					}
				}

				for (const event of parser.push(decoder.decode())) folder.push(event);
				for (const event of parser.finish()) folder.push(event);
			} finally {
				// Releases the connection whether the loop ended, threw or was
				// cancelled; a still-locked reader keeps the socket open.
				await reader.cancel().catch(() => undefined);
			}

			return folder.finish();
		},

		async validateKey(key: string): Promise<AiKeyValidation> {
			// The cheapest reachable check there is: the models endpoint refuses
			// browsers, so one output token on the model the reader will actually
			// run is what a Connect costs. No tools, no thinking, no stream — the
			// answer is the status code.
			try {
				const response = await post(key, {
					model,
					max_tokens: 1,
					messages: [{ role: 'user', content: 'Hi' }]
				});
				// Nothing here wants the message, but an unread body keeps the
				// connection open until the browser gives up on it.
				await response.text().catch(() => undefined);
				return { ok: true };
			} catch (error) {
				if (error instanceof AiClientError) return { ok: false, message: validationMessage(error) };
				throw error;
			}
		}
	};
}

/** A reader-facing sentence per failure kind, for the Connect button. */
function validationMessage(error: AiClientError): string {
	switch (error.kind) {
		case 'invalid-key':
			return 'That key was not accepted.';
		case 'rate-limit':
			return 'Rate limited; try again in a moment.';
		case 'overloaded':
			return 'The API is busy right now; try again in a moment.';
		case 'invalid-request':
			return 'The API rejected the check; this key may not have access to the model.';
		case 'network':
			return 'Could not reach the API. Check your connection and try again.';
		case 'aborted':
			return 'The check was cancelled.';
		case 'stream':
			return 'The API answered, but the reply could not be read.';
		case 'other':
			return `The key could not be checked: ${error.message}`;
	}
}

/**
 * A thrown `fetch` or reader failure, classified.
 *
 * An abort arrives as a `DOMException` named `AbortError` in a browser and as
 * an `AbortError`-named error in Node, and a request that never left arrives
 * as a `TypeError` — those are the only two shapes worth naming, and anything
 * else is honestly `other`.
 */
function toClientError(error: unknown, signal?: AbortSignal): AiClientError {
	if (error instanceof AiClientError) return error;
	if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
		return new AiClientError('aborted', 'The run was cancelled.');
	}
	if (error instanceof TypeError) {
		return new AiClientError('network', 'Could not reach the API.');
	}
	return new AiClientError('other', error instanceof Error ? error.message : String(error));
}

/**
 * A non-2xx response, classified.
 *
 * The body's `error.type` decides where it can be read, because it is the
 * API's own name for what went wrong and survives a status the transport
 * rewrote; the status is the fallback for a gateway that answered instead.
 */
async function errorFromResponse(response: Response): Promise<AiClientError> {
	const body = await response.text().catch(() => '');
	const parsed = parseErrorBody(body);
	const kind = parsed?.type ? kindFromErrorType(parsed.type) : undefined;
	return new AiClientError(
		kind ?? kindFromStatus(response.status),
		parsed?.message ?? `The API answered ${response.status}.`,
		response.status
	);
}

function parseErrorBody(body: string): { type?: string; message?: string } | undefined {
	if (body === '') return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return undefined;
	}
	if (typeof parsed !== 'object' || parsed === null) return undefined;

	// Every non-null object indexes by string at runtime; TS keeps `unknown`
	// opaque until something says so, and the guard above is that. Both fields
	// are read back as `unknown` and checked below.
	const error = (parsed as { error?: unknown }).error;
	if (typeof error !== 'object' || error === null) return undefined;

	const { type, message } = error as { type?: unknown; message?: unknown };
	return {
		...(typeof type === 'string' ? { type } : {}),
		...(typeof message === 'string' ? { message } : {})
	};
}

function kindFromErrorType(type: string): AiClientErrorKind | undefined {
	switch (type) {
		case 'authentication_error':
			return 'invalid-key';
		case 'invalid_request_error':
			return 'invalid-request';
		case 'rate_limit_error':
			return 'rate-limit';
		case 'overloaded_error':
			return 'overloaded';
		default:
			return undefined;
	}
}

function kindFromStatus(status: number): AiClientErrorKind {
	if (status === 401 || status === 403) return 'invalid-key';
	if (status === 429) return 'rate-limit';
	if (status === 529) return 'overloaded';
	if (status >= 400 && status < 500) return 'invalid-request';
	return 'other';
}
