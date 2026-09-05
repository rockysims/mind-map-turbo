import { describe, expect, it, vi } from 'vitest';
import { AiClientError, type AiRequest, type AiStreamEvent } from './aiClient';
import { createAnthropicClient } from './anthropicClient';

const request: AiRequest = {
	model: 'claude-opus-5',
	max_tokens: 32000,
	system: 'rules',
	messages: [{ role: 'user', content: 'Plot it.' }],
	stream: true
};

/** A body that hands out its chunks one read at a time, as the wire would. */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	let index = 0;
	return new ReadableStream<Uint8Array>({
		pull(controller) {
			if (index >= chunks.length) {
				controller.close();
				return;
			}
			controller.enqueue(encoder.encode(chunks[index++]));
		}
	});
}

function textTurnChunks(): string[] {
	return [
		'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message",' +
			'"role":"assistant","model":"claude-opus-5","content":[],"stop_reason":null,' +
			'"stop_details":null,"usage":{"input_tokens":11,"output_tokens":1}}}\n\n',
		'event: content_block_start\ndata: {"type":"content_block_start","index":0,' +
			'"content_block":{"type":"text","text":"","citations":null}}\n\n',
		'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,' +
			'"delta":{"type":"text_delta","text":"Done."}}\n\n',
		'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn",' +
			'"stop_sequence":null,"stop_details":null,"container":null},' +
			'"usage":{"input_tokens":11,"output_tokens":4}}\n\n',
		'event: message_stop\ndata: {"type":"message_stop"}\n\n'
	];
}

function okStream(chunks: string[] = textTurnChunks()): Response {
	return new Response(streamOf(chunks), { status: 200 });
}

function errorResponse(status: number, type?: string, message = 'nope'): Response {
	const body =
		type === undefined ? '' : JSON.stringify({ type: 'error', error: { type, message } });
	return new Response(body, { status });
}

/** The client under test, with a `fetch` that never reaches the network. */
function clientWith(
	responder: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>,
	options: { model?: string; baseUrl?: string; apiKey?: string } = {}
) {
	const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
		responder(input, init)
	);
	const client = createAnthropicClient({
		apiKey: options.apiKey ?? 'sk-ant-test',
		...(options.model === undefined ? {} : { model: options.model }),
		...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
		// `typeof fetch` carries the `preconnect` property Node's undici hangs off
		// it, which a mock cannot have and no caller here uses.
		fetch: fetchStub as unknown as typeof globalThis.fetch
	});
	return { client, fetchStub };
}

async function kindOf(call: Promise<unknown>): Promise<string> {
	try {
		await call;
	} catch (error) {
		if (error instanceof AiClientError) return error.kind;
		throw error;
	}
	throw new Error('the call was expected to fail');
}

describe('createAnthropicClient.send', () => {
	it('posts to /v1/messages with exactly the four headers the API needs', async () => {
		const { client, fetchStub } = clientWith(() => okStream());
		await client.send(request);

		const [url, init] = fetchStub.mock.calls[0];
		expect(url).toBe('https://api.anthropic.com/v1/messages');
		expect(init?.method).toBe('POST');
		expect(init?.headers).toEqual({
			'content-type': 'application/json',
			'x-api-key': 'sk-ant-test',
			'anthropic-version': '2023-06-01',
			'anthropic-dangerous-direct-browser-access': 'true'
		});
		expect(JSON.parse(String(init?.body))).toEqual(request);
	});

	it('honours a base URL without doubling the slash', async () => {
		const { client, fetchStub } = clientWith(() => okStream(), { baseUrl: 'http://localhost:9/' });
		await client.send(request);

		expect(fetchStub.mock.calls[0][0]).toBe('http://localhost:9/v1/messages');
	});

	it('folds the streamed body into a turn and reports its events', async () => {
		const { client } = clientWith(() => okStream());
		const seen: AiStreamEvent[] = [];

		const turn = await client.send(request, { onEvent: (event) => seen.push(event) });

		expect(turn).toEqual({
			content: [{ type: 'text', text: 'Done.', citations: null }],
			stopReason: 'end_turn',
			usage: { inputTokens: 11, outputTokens: 4 },
			model: 'claude-opus-5'
		});
		expect(seen).toContainEqual({ type: 'text', text: 'Done.' });
	});

	it('reads events split across chunk boundaries', async () => {
		// One long string cut every seven characters: line breaks, `data:` fields
		// and JSON all land mid-token.
		const whole = textTurnChunks().join('');
		const chopped = Array.from({ length: Math.ceil(whole.length / 7) }, (_, index) =>
			whole.slice(index * 7, index * 7 + 7)
		);
		const { client } = clientWith(() => okStream(chopped));

		await expect(client.send(request)).resolves.toMatchObject({ stopReason: 'end_turn' });
	});

	it('rejects with `aborted` when the signal is already aborted', async () => {
		const { client, fetchStub } = clientWith(() => okStream());

		expect(await kindOf(client.send(request, { signal: AbortSignal.abort() }))).toBe('aborted');
		expect(fetchStub).not.toHaveBeenCalled();
	});

	it('rejects with `aborted` when the signal fires mid-stream', async () => {
		const controller = new AbortController();
		const { client } = clientWith(() => okStream());

		const kind = await kindOf(
			client.send(request, {
				signal: controller.signal,
				// Cancel on the first thing the reader sees, which is what the
				// workbench's Cancel button does.
				onEvent: (event) => {
					if (event.type === 'text') controller.abort();
				}
			})
		);
		expect(kind).toBe('aborted');
	});

	it('rejects with `aborted` when fetch itself throws an AbortError', async () => {
		const { client } = clientWith(() => {
			throw new DOMException('The operation was aborted.', 'AbortError');
		});

		expect(await kindOf(client.send(request))).toBe('aborted');
	});

	it('maps each HTTP failure the milestone named to its kind', async () => {
		const cases: [number, string | undefined, string][] = [
			[401, 'authentication_error', 'invalid-key'],
			[400, 'invalid_request_error', 'invalid-request'],
			[429, 'rate_limit_error', 'rate-limit'],
			[529, 'overloaded_error', 'overloaded'],
			[500, 'api_error', 'other'],
			// No body to read: the status alone decides.
			[401, undefined, 'invalid-key'],
			[429, undefined, 'rate-limit'],
			[529, undefined, 'overloaded'],
			[500, undefined, 'other']
		];

		for (const [status, type, kind] of cases) {
			const { client } = clientWith(() => errorResponse(status, type));
			expect(await kindOf(client.send(request))).toBe(kind);
		}
	});

	it("trusts the body's error type over a status a gateway rewrote", async () => {
		const { client } = clientWith(() => errorResponse(400, 'authentication_error'));

		expect(await kindOf(client.send(request))).toBe('invalid-key');
	});

	it('keeps the status and the API message on the error', async () => {
		const { client } = clientWith(() => errorResponse(429, 'rate_limit_error', 'Slow down'));

		try {
			await client.send(request);
			expect.unreachable('the call should have failed');
		} catch (error) {
			expect(error).toBeInstanceOf(AiClientError);
			expect(error).toMatchObject({ kind: 'rate-limit', status: 429, message: 'Slow down' });
		}
	});

	it("maps fetch's TypeError — the request that never left — to `network`", async () => {
		const { client } = clientWith(() => {
			throw new TypeError('Failed to fetch');
		});

		expect(await kindOf(client.send(request))).toBe('network');
	});

	it('reports a 200 with no body as a stream failure', async () => {
		const { client } = clientWith(() => new Response(null, { status: 204 }));

		expect(await kindOf(client.send(request))).toBe('stream');
	});
});

describe('createAnthropicClient.validateKey', () => {
	it('sends the cheapest legal request there is, with the key being checked', async () => {
		const { client, fetchStub } = clientWith(() => new Response('{}', { status: 200 }), {
			model: 'claude-sonnet-5',
			apiKey: 'sk-ant-old'
		});

		await expect(client.validateKey('sk-ant-new')).resolves.toEqual({ ok: true });

		const init = fetchStub.mock.calls[0][1];
		expect(JSON.parse(String(init?.body))).toEqual({
			model: 'claude-sonnet-5',
			max_tokens: 1,
			messages: [{ role: 'user', content: 'Hi' }]
		});
		// The typed key, not the one the client was constructed with.
		expect((init?.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-new');
	});

	it('answers with a reader-facing sentence per failure kind', async () => {
		const cases: [number, string | undefined, string][] = [
			[401, 'authentication_error', 'That key was not accepted.'],
			[429, 'rate_limit_error', 'Rate limited; try again in a moment.'],
			[529, 'overloaded_error', 'The API is busy right now; try again in a moment.'],
			[
				400,
				'invalid_request_error',
				'The API rejected the check; this key may not have access to the model.'
			]
		];

		for (const [status, type, message] of cases) {
			const { client } = clientWith(() => errorResponse(status, type));
			await expect(client.validateKey('sk-ant-test')).resolves.toEqual({ ok: false, message });
		}
	});

	it('says the API was unreachable rather than that the key was refused', async () => {
		const { client } = clientWith(() => {
			throw new TypeError('Failed to fetch');
		});

		await expect(client.validateKey('sk-ant-test')).resolves.toEqual({
			ok: false,
			message: 'Could not reach the API. Check your connection and try again.'
		});
	});

	it('passes the underlying message through for a failure with no name of its own', async () => {
		const { client } = clientWith(() => errorResponse(500, 'api_error', 'Internal server error'));

		await expect(client.validateKey('sk-ant-test')).resolves.toEqual({
			ok: false,
			message: 'The key could not be checked: Internal server error'
		});
	});
});
