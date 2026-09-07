import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '$lib/appConfig';
import { estimateNamespaceUsageBytes, type StorageLike } from '$lib/persistence';
import { MemoryStorage } from '$lib/storageAvailability';
import {
	AI_SETTINGS_STORAGE_KEY,
	defaultAiSettings,
	forgetAiKey,
	loadAiSettings,
	saveAiSettings
} from './aiSettings';

const GRAPH_NAMESPACE = APP_CONFIG.persistence.storageNamespace;

/** A store that answers reads and refuses writes, or the other way round. */
function brokenStorage(broken: 'get' | 'set'): StorageLike {
	const storage = new MemoryStorage();
	if (broken === 'get') {
		storage.getItem = () => {
			throw new Error('site data is blocked');
		};
	} else {
		storage.setItem = () => {
			throw new Error('site data is blocked');
		};
	}
	return storage;
}

describe('loadAiSettings', () => {
	it('answers with the configured defaults and no key when nothing is stored', () => {
		const resolution = loadAiSettings(new MemoryStorage());

		expect(resolution).toEqual({
			settings: {
				model: APP_CONFIG.ai.defaultModel,
				previewRows: APP_CONFIG.ai.previewRows,
				sendPlots: APP_CONFIG.ai.sendPlots,
				rememberKey: APP_CONFIG.ai.rememberKey
			},
			durability: 'durable'
		});
		expect(resolution.settings.apiKey).toBeUndefined();
	});

	it('falls back to the defaults without throwing when reading throws', () => {
		const resolution = loadAiSettings(brokenStorage('get'));

		expect(resolution.settings).toEqual(defaultAiSettings());
		expect(resolution.durability).toBe('memory-only');
		expect(resolution.reason).toBe('site data is blocked');
	});

	it('falls back to the defaults when the stored entry is not JSON', () => {
		const storage = new MemoryStorage();
		storage.setItem(AI_SETTINGS_STORAGE_KEY, 'not json {');

		const resolution = loadAiSettings(storage);

		expect(resolution.settings).toEqual(defaultAiSettings());
		// The store answered; it just held junk. That is not a broken browser.
		expect(resolution.durability).toBe('durable');
	});

	it('replaces a model or preview depth that is no longer offered', () => {
		const storage = new MemoryStorage();
		storage.setItem(
			AI_SETTINGS_STORAGE_KEY,
			JSON.stringify({ model: 'claude-retired-3', previewRows: 7, sendPlots: false })
		);

		const { settings } = loadAiSettings(storage);

		expect(settings.model).toBe(APP_CONFIG.ai.defaultModel);
		expect(settings.previewRows).toBe(APP_CONFIG.ai.previewRows);
		// A value that is still valid survives the same pass.
		expect(settings.sendPlots).toBe(false);
	});
});

describe('saveAiSettings', () => {
	it('round trips every setting including the key', () => {
		const storage = new MemoryStorage();
		const settings = {
			apiKey: 'sk-ant-round-trip',
			model: 'claude-sonnet-5',
			previewRows: 20,
			sendPlots: false,
			rememberKey: true
		};

		expect(saveAiSettings(storage, settings)).toEqual({ durability: 'durable' });
		expect(loadAiSettings(storage).settings).toEqual(settings);
	});

	it('saves everything but the key when the key is not to be remembered', () => {
		const storage = new MemoryStorage();

		saveAiSettings(storage, {
			apiKey: 'sk-ant-forget-me',
			model: 'claude-sonnet-5',
			previewRows: 0,
			sendPlots: false,
			rememberKey: false
		});

		expect(loadAiSettings(storage).settings).toEqual({
			model: 'claude-sonnet-5',
			previewRows: 0,
			sendPlots: false,
			rememberKey: false
		});
		expect(storage.getItem(AI_SETTINGS_STORAGE_KEY)).not.toContain('sk-ant-forget-me');
	});

	it('drops the key already stored when remembering is turned off', () => {
		const storage = new MemoryStorage();
		const settings = { ...defaultAiSettings(), apiKey: 'sk-ant-was-remembered' };
		saveAiSettings(storage, settings);

		saveAiSettings(storage, { ...settings, rememberKey: false });

		expect(loadAiSettings(storage).settings.apiKey).toBeUndefined();
		expect(storage.getItem(AI_SETTINGS_STORAGE_KEY)).not.toContain('sk-ant-was-remembered');
	});

	it('drops the write without throwing when storage refuses it', () => {
		const write = saveAiSettings(brokenStorage('set'), {
			...defaultAiSettings(),
			apiKey: 'sk-ant-nowhere'
		});

		expect(write).toEqual({ durability: 'memory-only', reason: 'site data is blocked' });
	});
});

describe('forgetAiKey', () => {
	it('clears the key and leaves every other setting alone', () => {
		const storage = new MemoryStorage();
		saveAiSettings(storage, {
			apiKey: 'sk-ant-to-forget',
			model: 'claude-sonnet-5',
			previewRows: 20,
			sendPlots: false,
			rememberKey: true
		});

		expect(forgetAiKey(storage)).toEqual({ durability: 'durable' });

		expect(loadAiSettings(storage).settings).toEqual({
			model: 'claude-sonnet-5',
			previewRows: 20,
			sendPlots: false,
			rememberKey: true
		});
		expect(storage.getItem(AI_SETTINGS_STORAGE_KEY)).not.toContain('sk-ant-to-forget');
	});

	it('reports memory-only rather than throwing when storage is blocked', () => {
		expect(forgetAiKey(brokenStorage('get'))).toEqual({
			durability: 'memory-only',
			reason: 'site data is blocked'
		});
	});
});

describe('the settings storage key', () => {
	it('is one app-wide entry, so every graph and every ai node share it', () => {
		const storage = new MemoryStorage();

		saveAiSettings(storage, { ...defaultAiSettings(), apiKey: 'sk-ant-shared' });
		saveAiSettings(storage, { ...defaultAiSettings(), apiKey: 'sk-ant-shared' });

		// No graph id reaches these functions, and the proof is that repeated
		// writes leave exactly one entry behind.
		expect(storage.length).toBe(1);
		expect(storage.key(0)).toBe(AI_SETTINGS_STORAGE_KEY);
	});

	it('sits outside the graph namespace, so the quota estimate ignores it', () => {
		const storage = new MemoryStorage();
		saveAiSettings(storage, { ...defaultAiSettings(), apiKey: 'sk-ant-not-counted' });

		expect(AI_SETTINGS_STORAGE_KEY.startsWith(`${GRAPH_NAMESPACE}:`)).toBe(false);
		expect(estimateNamespaceUsageBytes(storage, GRAPH_NAMESPACE)).toBe(0);

		// And a graph entry beside it is still counted, so the zero above is the
		// prefix doing its job rather than an empty store.
		storage.setItem(`${GRAPH_NAMESPACE}:graph:demo`, '{}');
		expect(estimateNamespaceUsageBytes(storage, GRAPH_NAMESPACE)).toBeGreaterThan(0);
	});

	it('never appears in a graph-persistence module', () => {
		// A grep gate, not a style note: the key naming a graph write is how it
		// would end up in a draft, an export, or a quota sweep.
		for (const module of ['graphFile.ts', 'graphPersistenceController.ts']) {
			const source = readFileSync(new URL(`../${module}`, import.meta.url), 'utf8');
			expect(source).not.toContain(AI_SETTINGS_STORAGE_KEY);
		}
	});
});
