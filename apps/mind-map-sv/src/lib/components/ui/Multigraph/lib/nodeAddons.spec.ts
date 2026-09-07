import { describe, expect, it } from 'vitest';
import {
	NODE_ADDON_REGISTRY,
	addonIntentLabel,
	isRegisteredAddon,
	withNodeAddon
} from './nodeAddons';

describe('node add-on registry', () => {
	it('registers task with a label, a glyph, and an undone default', () => {
		expect(NODE_ADDON_REGISTRY.task.label).toBe('Task');
		expect(NODE_ADDON_REGISTRY.task.glyph.length).toBeGreaterThan(0);
		expect(NODE_ADDON_REGISTRY.task.createDefault()).toEqual({ done: false });
	});

	it('registers ai with a label, a glyph, and an empty prompt default', () => {
		expect(NODE_ADDON_REGISTRY.ai.label).toBe('AI');
		expect(NODE_ADDON_REGISTRY.ai.glyph).toBe('\u2726');
		expect(NODE_ADDON_REGISTRY.ai.createDefault()).toEqual({
			prompt: '',
			runs: [],
			promoted: {}
		});
	});

	it('hands out a fresh default each time, so two nodes never share one object', () => {
		expect(NODE_ADDON_REGISTRY.task.createDefault()).not.toBe(
			NODE_ADDON_REGISTRY.task.createDefault()
		);
		expect(NODE_ADDON_REGISTRY.ai.createDefault()).not.toBe(NODE_ADDON_REGISTRY.ai.createDefault());
	});
});

describe('isRegisteredAddon', () => {
	it('accepts a registered name', () => {
		expect(isRegisteredAddon('task')).toBe(true);
	});

	it('accepts ai, which schema 8 added', () => {
		expect(isRegisteredAddon('ai')).toBe(true);
	});

	it('rejects an unregistered name', () => {
		expect(isRegisteredAddon('important')).toBe(false);
	});

	it('rejects inherited object properties', () => {
		expect(isRegisteredAddon('toString')).toBe(false);
		expect(isRegisteredAddon('constructor')).toBe(false);
	});
});

describe('addonIntentLabel', () => {
	it('names the toggle in the words Undo shows', () => {
		expect(addonIntentLabel('task', 'add')).toBe('add task add-on');
		expect(addonIntentLabel('task', 'remove')).toBe('remove task add-on');
		expect(addonIntentLabel('ai', 'add')).toBe('add ai add-on');
		expect(addonIntentLabel('ai', 'remove')).toBe('remove ai add-on');
	});
});

describe('withNodeAddon', () => {
	it('creates the add-on at its default when absent', () => {
		expect(withNodeAddon(undefined, 'task')).toEqual({ task: { done: false } });
	});

	it('creates the ai add-on at its default when absent', () => {
		expect(withNodeAddon(undefined, 'ai')).toEqual({
			ai: { prompt: '', runs: [], promoted: {} }
		});
	});

	it('keeps a task add-on when the ai add-on is added beside it', () => {
		const existing = { task: { done: false } };
		const next = withNodeAddon(existing, 'ai');

		expect(next.task).toBe(existing.task);
		expect(next.ai).toEqual({ prompt: '', runs: [], promoted: {} });
	});

	it('leaves an existing ai prompt and history alone', () => {
		const existing = { ai: { prompt: 'plot channel 2', runs: [], promoted: {} } };

		expect(withNodeAddon(existing, 'ai').ai).toBe(existing.ai);
	});

	it('leaves existing add-on data alone', () => {
		const existing = { task: { done: true, doneAt: 1_700_000_000_000 } };

		expect(withNodeAddon(existing, 'task').task).toBe(existing.task);
	});

	it('does not mutate the add-ons it was handed', () => {
		const existing = {};

		expect(withNodeAddon(existing, 'task')).not.toBe(existing);
		expect(existing).toEqual({});
	});
});
