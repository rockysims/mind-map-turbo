/**
 * The one shape the rest of the app knows the Messages API by.
 *
 * Everything above this file — the run controller, the workbench, the settings
 * sheet — talks to an `AiClient`, so a story can hand down `fakeClient.ts` and
 * a browser hands down `anthropicClient.ts` with no other difference. The
 * milestone's rollback plan leans on that: if the API ever stops answering a
 * browser page, a relay changes `anthropicClient.ts` and nothing else.
 *
 * Types come from `@anthropic-ai/sdk` through `import type` only. The SDK's
 * runtime is 188 KB minified against a 599 KB offline shell no matter how
 * little of it is imported, which is why the client is a raw `fetch` and the
 * package is a devDependency. Every import of it in this directory must be
 * `import type`; a runtime import would join the shell silently.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { AiKeyValidation } from './aiSettings';

/**
 * The exact JSON body posted to `POST /v1/messages`.
 *
 * Deliberately the SDK's own streaming-params type rather than a structural
 * subset: everything this milestone sends — `model`, `max_tokens`, `system`,
 * `messages`, `tools`, `stream`, `thinking`, `output_config` and the top-level
 * `cache_control` — is already a field on it, so the alias buys exact
 * field-name checking (a typo'd `output_config` is a compile error) for the
 * price of one type import. What it does *not* do is force us to send
 * everything it allows: `temperature`, `budget_tokens` and assistant prefills
 * are all expressible here and none of them are built by `aiRequest.ts`.
 */
export type AiRequest = Anthropic.MessageCreateParamsStreaming;

/** The thinking effort levels `output_config.effort` accepts. */
export type AiEffort = NonNullable<NonNullable<Anthropic.OutputConfig['effort']>>;

/**
 * One assistant turn, assembled from the stream.
 *
 * `content` is the model's blocks exactly as they arrived — text, thinking
 * (with its signature intact) and `tool_use` with its input already parsed —
 * because the next request in the loop has to echo the whole turn back
 * unchanged before the tool result, and a modified thinking block is a 400.
 */
export interface AiTurn {
	content: Anthropic.ContentBlock[];
	/** `null` only when the stream ended without a `message_delta`. */
	stopReason: Anthropic.StopReason | null;
	/** Present on a `refusal`: the policy category and the explanation. */
	stopDetails?: Anthropic.RefusalStopDetails;
	usage: { inputTokens: number; outputTokens: number };
	/** What actually answered, which is what the run record stores. */
	model: string;
}

/**
 * What the workbench is told while a turn streams.
 *
 * Deliberately not the raw SSE events: the surface wants "more text", "more
 * thinking", "a script is about to run" and "this is what it cost", and
 * nothing else in this milestone. Blocks are assembled by the folder, so a
 * consumer of these events never has to track indices.
 */
export type AiStreamEvent =
	| { type: 'text'; text: string }
	| { type: 'thinking'; text: string }
	| { type: 'tool-call-start'; name: string }
	| { type: 'usage'; inputTokens: number; outputTokens: number };

/**
 * Optional because a spec that only wants the turn should not have to write
 * `{}`; every real caller passes at least a signal.
 */
export interface AiSendOptions {
	onEvent?: (event: AiStreamEvent) => void;
	signal?: AbortSignal;
}

export interface AiClient {
	/**
	 * Check a key the reader just typed. Takes the key rather than using the
	 * client's own, because the settings sheet validates before it saves.
	 */
	validateKey(key: string): Promise<AiKeyValidation>;
	send(request: AiRequest, options?: AiSendOptions): Promise<AiTurn>;
}

/**
 * Why a call did not produce a turn.
 *
 * One named value per state the milestone promised a sentence for, plus the
 * three that are about the wire rather than the API: `network` (the request
 * never arrived), `aborted` (Cancel) and `stream` (the response started and
 * then broke). `other` exists so no failure is silently reclassified as one of
 * the named ones.
 */
export type AiClientErrorKind =
	| 'invalid-key'
	| 'rate-limit'
	| 'overloaded'
	| 'invalid-request'
	| 'network'
	| 'aborted'
	| 'stream'
	| 'other';

/** A failed Messages call, classified. */
export class AiClientError extends Error {
	readonly kind: AiClientErrorKind;
	/** The HTTP status, when the failure was an HTTP response at all. */
	readonly status?: number;

	constructor(kind: AiClientErrorKind, message: string, status?: number) {
		super(message);
		// `Error` sets `name` to "Error"; without this an unhandled rejection in a
		// console reads as a plain error and hides which of the eight it was.
		this.name = 'AiClientError';
		this.kind = kind;
		if (status !== undefined) this.status = status;
	}
}
