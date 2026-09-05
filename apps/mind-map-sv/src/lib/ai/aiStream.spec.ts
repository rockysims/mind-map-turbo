import { describe, expect, it } from 'vitest';
import { AiClientError, type AiStreamEvent } from './aiClient';
import { foldStreamEvents, parseSseChunks, type AiSseEvent } from './aiStream';

/**
 * Fixtures are written the way the wire carries them — `event:` line, `data:`
 * line, blank line — and fed to the parser, so a spec that passes proves the
 * parser and the folder agree rather than only the folder.
 */
function sse(events: { event: string; data: unknown }[]): string {
	return events
		.map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
		.join('');
}

function messageStart(model = 'claude-opus-5', inputTokens = 1200) {
	return {
		event: 'message_start',
		data: {
			type: 'message_start',
			message: {
				id: 'msg_1',
				type: 'message',
				role: 'assistant',
				model,
				content: [],
				stop_reason: null,
				stop_details: null,
				usage: { input_tokens: inputTokens, output_tokens: 1 }
			}
		}
	};
}

function messageDelta(
	delta: { stop_reason: string | null; stop_details?: unknown },
	outputTokens = 340
) {
	return {
		event: 'message_delta',
		data: {
			type: 'message_delta',
			delta: { stop_sequence: null, container: null, stop_details: null, ...delta },
			usage: { input_tokens: 1200, output_tokens: outputTokens }
		}
	};
}

const messageStop = { event: 'message_stop', data: { type: 'message_stop' } };

function textBlockEvents(index: number, pieces: string[]) {
	return [
		{
			event: 'content_block_start',
			data: {
				type: 'content_block_start',
				index,
				content_block: { type: 'text', text: '', citations: null }
			}
		},
		...pieces.map((text) => ({
			event: 'content_block_delta',
			data: { type: 'content_block_delta', index, delta: { type: 'text_delta', text } }
		})),
		{ event: 'content_block_stop', data: { type: 'content_block_stop', index } }
	];
}

/** Feed a whole stream through the parser in chunks of `size` characters. */
function parseAll(stream: string, size = stream.length): AiSseEvent[] {
	const parser = parseSseChunks();
	const events: AiSseEvent[] = [];
	for (let index = 0; index < stream.length; index += size) {
		events.push(...parser.push(stream.slice(index, index + size)));
	}
	events.push(...parser.finish());
	return events;
}

describe('parseSseChunks', () => {
	it('reads the same events however the chunks fall', () => {
		const stream = sse([messageStart(), ...textBlockEvents(0, ['Hello ', 'world']), messageStop]);
		const whole = parseAll(stream);

		for (const size of [1, 3, 7, 40, 999]) {
			expect(parseAll(stream, size)).toEqual(whole);
		}
	});

	it('ignores ping payloads, comment lines and CRLF line endings', () => {
		const stream =
			': keep-alive\n\n' +
			'event: ping\r\ndata: {"type": "ping"}\r\n\r\n' +
			sse([...textBlockEvents(0, ['hi'])]);

		const events = parseAll(stream);
		expect(events.map((event) => event.type)).toEqual([
			'ping',
			'content_block_start',
			'content_block_delta',
			'content_block_stop'
		]);
	});

	it('drops event types it does not know rather than failing the stream', () => {
		const events = parseAll('event: future\ndata: {"type": "future_event"}\n\n');

		expect(events).toEqual([]);
	});

	it('flushes a final event whose blank line never arrived', () => {
		const events = parseAll('event: message_stop\ndata: {"type": "message_stop"}');

		expect(events).toEqual([{ type: 'message_stop' }]);
	});

	it('raises a stream error on a payload that is not JSON', () => {
		expect(() => parseAll('event: message_stop\ndata: {oh no\n\n')).toThrowError(
			expect.objectContaining({ name: 'AiClientError', kind: 'stream' })
		);
	});
});

describe('foldStreamEvents', () => {
	it('folds a text-only turn and reports its text and usage', () => {
		const seen: AiStreamEvent[] = [];
		const turn = foldStreamEvents(
			parseAll(
				sse([
					messageStart(),
					...textBlockEvents(0, ['Here is ', 'the plot.']),
					messageDelta({ stop_reason: 'end_turn' }),
					messageStop
				])
			),
			(event) => seen.push(event)
		);

		expect(turn).toEqual({
			content: [{ type: 'text', text: 'Here is the plot.', citations: null }],
			stopReason: 'end_turn',
			usage: { inputTokens: 1200, outputTokens: 340 },
			model: 'claude-opus-5'
		});
		expect(seen).toEqual([
			{ type: 'text', text: 'Here is ' },
			{ type: 'text', text: 'the plot.' },
			{ type: 'usage', inputTokens: 1200, outputTokens: 340 }
		]);
	});

	it('folds thinking, text and a tool call whose arguments arrive in three pieces', () => {
		const seen: AiStreamEvent[] = [];
		const turn = foldStreamEvents(
			parseAll(
				sse([
					messageStart(),
					{
						event: 'content_block_start',
						data: {
							type: 'content_block_start',
							index: 0,
							content_block: { type: 'thinking', thinking: '', signature: '' }
						}
					},
					{
						event: 'content_block_delta',
						data: {
							type: 'content_block_delta',
							index: 0,
							delta: { type: 'thinking_delta', thinking: 'Read the CSV, ' }
						}
					},
					{
						event: 'content_block_delta',
						data: {
							type: 'content_block_delta',
							index: 0,
							delta: { type: 'thinking_delta', thinking: 'then plot it.' }
						}
					},
					{
						event: 'content_block_delta',
						data: {
							type: 'content_block_delta',
							index: 0,
							delta: { type: 'signature_delta', signature: 'sig-abc' }
						}
					},
					{ event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
					...textBlockEvents(1, ['Running it.']),
					{
						event: 'content_block_start',
						data: {
							type: 'content_block_start',
							index: 2,
							content_block: {
								type: 'tool_use',
								id: 'toolu_1',
								name: 'run_analysis',
								input: {},
								caller: { type: 'direct' }
							}
						}
					},
					...['{"script": "impo', 'rt pandas as pd\\npr', 'int(1)"}'].map((partial_json) => ({
						event: 'content_block_delta',
						data: {
							type: 'content_block_delta',
							index: 2,
							delta: { type: 'input_json_delta', partial_json }
						}
					})),
					{ event: 'content_block_stop', data: { type: 'content_block_stop', index: 2 } },
					messageDelta({ stop_reason: 'tool_use' }),
					messageStop
				])
			),
			(event) => seen.push(event)
		);

		expect(turn.content).toEqual([
			{ type: 'thinking', thinking: 'Read the CSV, then plot it.', signature: 'sig-abc' },
			{ type: 'text', text: 'Running it.', citations: null },
			{
				type: 'tool_use',
				id: 'toolu_1',
				name: 'run_analysis',
				caller: { type: 'direct' },
				input: { script: 'import pandas as pd\nprint(1)' }
			}
		]);
		expect(turn.stopReason).toBe('tool_use');
		expect(seen).toEqual([
			{ type: 'thinking', text: 'Read the CSV, ' },
			{ type: 'thinking', text: 'then plot it.' },
			{ type: 'text', text: 'Running it.' },
			{ type: 'tool-call-start', name: 'run_analysis' },
			{ type: 'usage', inputTokens: 1200, outputTokens: 340 }
		]);
	});

	it('carries a refusal through with its category and explanation', () => {
		const turn = foldStreamEvents(
			parseAll(
				sse([
					messageStart(),
					...textBlockEvents(0, ['I cannot help with that.']),
					messageDelta({
						stop_reason: 'refusal',
						stop_details: {
							type: 'refusal',
							category: 'cyber',
							explanation: 'This looks like exploit development.'
						}
					}),
					messageStop
				])
			)
		);

		expect(turn.stopReason).toBe('refusal');
		expect(turn.stopDetails).toEqual({
			type: 'refusal',
			category: 'cyber',
			explanation: 'This looks like exploit development.'
		});
	});

	it('reports max_tokens and pause_turn as the stop reasons they are, with no stop details', () => {
		for (const stopReason of ['max_tokens', 'pause_turn'] as const) {
			const turn = foldStreamEvents(
				parseAll(
					sse([
						messageStart(),
						...textBlockEvents(0, ['half a scr']),
						messageDelta({ stop_reason: stopReason }),
						messageStop
					])
				)
			);

			expect(turn.stopReason).toBe(stopReason);
			expect(turn.stopDetails).toBeUndefined();
		}
	});

	it('raises a stream error when the API sends one mid-stream', () => {
		const events = parseAll(
			sse([
				messageStart(),
				...textBlockEvents(0, ['Starting']),
				{
					event: 'error',
					data: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }
				}
			])
		);

		expect(() => foldStreamEvents(events)).toThrowError(
			expect.objectContaining({ name: 'AiClientError', kind: 'stream', message: 'Overloaded' })
		);
	});

	it('raises a stream error when a tool call loses part of its arguments', () => {
		const events = parseAll(
			sse([
				messageStart(),
				{
					event: 'content_block_start',
					data: {
						type: 'content_block_start',
						index: 0,
						content_block: {
							type: 'tool_use',
							id: 'toolu_1',
							name: 'run_analysis',
							input: {},
							caller: { type: 'direct' }
						}
					}
				},
				{
					event: 'content_block_delta',
					data: {
						type: 'content_block_delta',
						index: 0,
						delta: { type: 'input_json_delta', partial_json: '{"script": "pri' }
					}
				},
				messageDelta({ stop_reason: 'tool_use' })
			])
		);

		let thrown: unknown;
		try {
			foldStreamEvents(events);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(AiClientError);
		expect(thrown).toMatchObject({ kind: 'stream' });
	});

	it('keeps blocks in index order even when their deltas interleave', () => {
		const turn = foldStreamEvents(
			parseAll(
				sse([
					messageStart(),
					{
						event: 'content_block_start',
						data: {
							type: 'content_block_start',
							index: 0,
							content_block: { type: 'text', text: '', citations: null }
						}
					},
					{
						event: 'content_block_start',
						data: {
							type: 'content_block_start',
							index: 1,
							content_block: { type: 'text', text: '', citations: null }
						}
					},
					{
						event: 'content_block_delta',
						data: {
							type: 'content_block_delta',
							index: 1,
							delta: { type: 'text_delta', text: 'second' }
						}
					},
					{
						event: 'content_block_delta',
						data: {
							type: 'content_block_delta',
							index: 0,
							delta: { type: 'text_delta', text: 'first' }
						}
					},
					messageDelta({ stop_reason: 'end_turn' })
				])
			)
		);

		expect(turn.content.map((block) => (block.type === 'text' ? block.text : ''))).toEqual([
			'first',
			'second'
		]);
	});

	it('reports a stream that ended before any message_delta as an unknown stop', () => {
		const turn = foldStreamEvents(parseAll(sse([messageStart(), ...textBlockEvents(0, ['hi'])])));

		expect(turn.stopReason).toBeNull();
		expect(turn.usage).toEqual({ inputTokens: 1200, outputTokens: 0 });
	});
});
