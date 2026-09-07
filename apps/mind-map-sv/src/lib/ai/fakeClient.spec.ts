import { describe, expect, it } from 'vitest';
import { AiClientError, type AiRequest, type AiStreamEvent, type AiTurn } from './aiClient';
import { createFakeAiClient } from './fakeClient';

const request: AiRequest = {
	model: 'claude-opus-5',
	max_tokens: 32000,
	messages: [{ role: 'user', content: 'Plot it.' }],
	stream: true
};

function turn(over: Partial<AiTurn> = {}): AiTurn {
	return {
		content: [{ type: 'text', text: 'Here it is.', citations: null }],
		stopReason: 'end_turn',
		usage: { inputTokens: 10, outputTokens: 4 },
		model: 'claude-opus-5',
		...over
	};
}

const toolTurn = turn({
	content: [
		{ type: 'thinking', thinking: 'Read it.', signature: 'sig' },
		{ type: 'text', text: 'Running.', citations: null },
		{
			type: 'tool_use',
			id: 'toolu_1',
			name: 'run_analysis',
			input: { script: 'print(1)' },
			caller: { type: 'direct' }
		}
	],
	stopReason: 'tool_use'
});

describe('createFakeAiClient', () => {
	it('replays scripted turns in order and records every request', async () => {
		const first = turn({ model: 'one' });
		const second = turn({ model: 'two' });
		const client = createFakeAiClient([first, second]);

		expect(await client.send(request)).toBe(first);
		expect(await client.send({ ...request, max_tokens: 8 })).toBe(second);
		expect(client.requests).toEqual([request, { ...request, max_tokens: 8 }]);
	});

	it('answers per request when it is given a function', async () => {
		const client = createFakeAiClient((sent) =>
			turn({ model: `saw ${sent.messages.length} messages` })
		);

		expect((await client.send(request)).model).toBe('saw 1 messages');
	});

	it('fails loudly when the loop asks for a turn the fixture does not describe', async () => {
		const client = createFakeAiClient([turn()]);
		await client.send(request);

		await expect(client.send(request)).rejects.toBeInstanceOf(AiClientError);
	});

	it('emits the turn as the stream events a real client would have', async () => {
		const seen: AiStreamEvent[] = [];
		const client = createFakeAiClient([toolTurn]);

		await client.send(request, { onEvent: (event) => seen.push(event) });

		expect(seen).toEqual([
			{ type: 'thinking', text: 'Read it.' },
			{ type: 'text', text: 'Running.' },
			{ type: 'tool-call-start', name: 'run_analysis' },
			{ type: 'usage', inputTokens: 10, outputTokens: 4 }
		]);
	});

	it('breaks text into chunks so a story fills in visibly', async () => {
		const seen: AiStreamEvent[] = [];
		const client = createFakeAiClient([turn()], { chunkSize: 4 });

		await client.send(request, { onEvent: (event) => seen.push(event) });

		expect(seen.filter((event) => event.type === 'text')).toEqual([
			{ type: 'text', text: 'Here' },
			{ type: 'text', text: ' it ' },
			{ type: 'text', text: 'is.' }
		]);
	});

	it('refuses an already-aborted send the way the real client does', async () => {
		const client = createFakeAiClient([turn()]);

		await expect(client.send(request, { signal: AbortSignal.abort() })).rejects.toMatchObject({
			kind: 'aborted'
		});
		expect(client.requests).toHaveLength(1);
	});

	it('accepts every key by default and records the ones it was asked about', async () => {
		const client = createFakeAiClient([]);

		expect(await client.validateKey('sk-ant-a')).toEqual({ ok: true });
		expect(client.validatedKeys).toEqual(['sk-ant-a']);
	});

	it('refuses keys when the story wants the sheet to show an error', async () => {
		const client = createFakeAiClient([], {
			validation: { ok: false, message: 'That key was not accepted.' }
		});

		expect(await client.validateKey('sk-ant-bad')).toEqual({
			ok: false,
			message: 'That key was not accepted.'
		});
	});
});
