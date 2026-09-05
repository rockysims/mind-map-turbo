/**
 * The one place the Anthropic API key and the AI run preferences live.
 *
 * Deliberately outside the graph namespace and outside graph data: the key is
 * app-level (entered once per browser, used by every `!ai` node in every
 * graph), it must never travel in an export, and
 * `estimateNamespaceUsageBytes` must not count it against the graph quota.
 * Both properties come from the storage key alone, which is why it is pinned
 * by a spec rather than left to a convention.
 */
import { APP_CONFIG } from '$lib/appConfig';
import type { StorageLike } from '$lib/persistence';
import type { StorageDurability } from '$lib/storageAvailability';

/**
 * One app-wide entry. The `mind-map-ai:` prefix is not the graph namespace
 * (`mind-map:`), so the graph quota estimate walks straight past it and no
 * graph-scoped sweep can reach it.
 */
export const AI_SETTINGS_STORAGE_KEY = 'mind-map-ai:settings';

export type AiSettings = {
	/** Absent when no key has been entered, or when it is not remembered here. */
	apiKey?: string;
	model: string;
	/** Rows of each input file a request may carry. */
	previewRows: number;
	/** Whether rendered plots go back to Claude for checking. */
	sendPlots: boolean;
	/** Whether the key is written to this browser's storage at all. */
	rememberKey: boolean;
};

/** What a Connect attempt came back with. The real validator arrives in T03. */
export type AiKeyValidation = { ok: true } | { ok: false; message: string };

type AiSettingsResolution = {
	settings: AiSettings;
	durability: StorageDurability;
	/** Why storage was not usable; undefined when it was. */
	reason?: string;
};

type AiSettingsWrite = {
	durability: StorageDurability;
	reason?: string;
};

export function defaultAiSettings(): AiSettings {
	return {
		model: APP_CONFIG.ai.defaultModel,
		previewRows: APP_CONFIG.ai.previewRows,
		sendPlots: APP_CONFIG.ai.sendPlots,
		rememberKey: APP_CONFIG.ai.rememberKey
	};
}

/**
 * Read the settings, never throwing.
 *
 * A browser configured to block site data throws from `getItem` itself, and a
 * half-written or hand-edited entry parses to anything at all. Both end the
 * same way — the defaults — and the caller learns which through `durability`,
 * the same word `resolveGraphStorage` reports the graph store with.
 */
export function loadAiSettings(storage: StorageLike): AiSettingsResolution {
	let raw: string | null;
	try {
		raw = storage.getItem(AI_SETTINGS_STORAGE_KEY);
	} catch (error) {
		return { settings: defaultAiSettings(), durability: 'memory-only', reason: reasonFor(error) };
	}

	if (raw === null) return { settings: defaultAiSettings(), durability: 'durable' };

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		// Unreadable, not unavailable: the store answered, it just held junk.
		return { settings: defaultAiSettings(), durability: 'durable' };
	}

	return { settings: readSettings(parsed), durability: 'durable' };
}

/**
 * Write the settings, never throwing, and never writing the key unless the
 * reader asked for it to be remembered. The whole record is replaced on every
 * write, so turning "Remember on this browser" off is also what removes a key
 * that was written while it was on.
 */
export function saveAiSettings(storage: StorageLike, settings: AiSettings): AiSettingsWrite {
	const persisted = {
		model: settings.model,
		previewRows: settings.previewRows,
		sendPlots: settings.sendPlots,
		rememberKey: settings.rememberKey,
		...(settings.rememberKey && settings.apiKey !== undefined && settings.apiKey !== ''
			? { apiKey: settings.apiKey }
			: {})
	};

	try {
		storage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(persisted));
	} catch (error) {
		// Dropping the write is the whole fallback: the settings the caller holds
		// stay live for this tab, they just do not outlast it.
		return { durability: 'memory-only', reason: reasonFor(error) };
	}

	return { durability: 'durable' };
}

/**
 * Drop the stored key and keep everything else. Reads the record back rather
 * than taking the caller's copy, so a Forget from one tab cannot resurrect
 * settings another tab has since changed.
 */
export function forgetAiKey(storage: StorageLike): AiSettingsWrite {
	const { settings, durability, reason } = loadAiSettings(storage);
	if (durability === 'memory-only') return { durability, reason };
	return saveAiSettings(storage, { ...settings, apiKey: undefined });
}

function readSettings(parsed: unknown): AiSettings {
	const defaults = defaultAiSettings();
	if (typeof parsed !== 'object' || parsed === null) return defaults;

	const record = parsed as Record<string, unknown>;
	const apiKey = record.apiKey;
	const model = record.model;
	const previewRows = record.previewRows;
	const sendPlots = record.sendPlots;
	const rememberKey = record.rememberKey;

	return {
		// Unknown choices fall back rather than reaching the sheet's selects,
		// where an option that is not in the list reads as an empty control.
		model:
			typeof model === 'string' && (APP_CONFIG.ai.models as readonly string[]).includes(model)
				? model
				: defaults.model,
		previewRows:
			typeof previewRows === 'number' &&
			(APP_CONFIG.ai.previewRowChoices as readonly number[]).includes(previewRows)
				? previewRows
				: defaults.previewRows,
		sendPlots: typeof sendPlots === 'boolean' ? sendPlots : defaults.sendPlots,
		rememberKey: typeof rememberKey === 'boolean' ? rememberKey : defaults.rememberKey,
		...(typeof apiKey === 'string' && apiKey !== '' ? { apiKey } : {})
	};
}

function reasonFor(error: unknown): string {
	return error instanceof Error ? error.message : 'Local storage is unavailable.';
}
