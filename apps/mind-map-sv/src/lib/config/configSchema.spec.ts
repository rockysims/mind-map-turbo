import { describe, it, expect } from 'vitest';
import { APP_CONFIG } from '../appConfig';
import { CONFIG_SCHEMA } from './configSchema';
import type { ConfigPath, LeafPaths } from './configPaths';

/** Walks the runtime object and returns a dotted path for every leaf. Arrays are leaves. */
const collectLeafPaths = (value: unknown, prefix = ''): string[] => {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return [prefix];
	return Object.entries(value).flatMap(([key, child]) =>
		collectLeafPaths(child, prefix ? `${prefix}.${key}` : key)
	);
};

const readAtPath = (path: string): unknown => {
	let current: unknown = APP_CONFIG;
	for (const key of path.split('.')) {
		if (typeof current !== 'object' || current === null) return undefined;
		// The runtime walk has no type-level knowledge of the path string.
		current = (current as Record<string, unknown>)[key];
	}
	return current;
};

const runtimeLeafPaths = collectLeafPaths(APP_CONFIG);
const schemaPaths = Object.keys(CONFIG_SCHEMA);

const HIDDEN_PATHS: ConfigPath[] = [
	'persistence.storageNamespace',
	'persistence.saveDebounceMs',
	'persistence.quotaBudgetBytes',
	'persistence.quotaWarningRatio',
	'multigraph.tagSyntax.nodeTagMarker',
	'multigraph.tagSyntax.edgeTagMarker',
	'multigraph.tagSyntax.addonMarker',
	'multigraph.nodeRadiusPx',
	'multigraph.attachments.warnBytesPerFile',
	'multigraph.attachments.warnTotalBytes',
	'history.retainedPointerCeiling',
	'history.persistedEntryCount',
	'history.persistedBudgetBytes',
	'ai.defaultModel',
	'ai.models',
	'ai.previewRows',
	'ai.previewRowChoices',
	'ai.sendPlots',
	'ai.rememberKey',
	'ai.historyLength',
	'ai.effort.analyse',
	'ai.effort.refine',
	'ai.maxToolCalls',
	'ai.scriptTimeoutMs',
	'ai.stdoutTailChars',
	'ai.maxImagesPerResult',
	'ai.maxImageBytes',
	'ai.summaryMaxChars',
	'ai.maxTokens',
	'ai.runtime.version',
	'ai.runtime.indexUrl',
	'ai.runtime.packages'
];

describe('CONFIG_SCHEMA', () => {
	it('classifies every leaf of APP_CONFIG', () => {
		const missing = runtimeLeafPaths.filter((path) => !schemaPaths.includes(path));
		expect(missing).toEqual([]);
	});

	it('names no path that does not exist in APP_CONFIG', () => {
		const unknown = schemaPaths.filter((path) => !runtimeLeafPaths.includes(path));
		expect(unknown).toEqual([]);
	});

	it('covers exactly the 101 shipped leaves', () => {
		expect(runtimeLeafPaths).toHaveLength(101);
		expect(schemaPaths).toHaveLength(101);
	});

	it('keeps every range default inside its own slider bounds', () => {
		const outOfRange = Object.entries(CONFIG_SCHEMA)
			.filter(([, spec]) => spec.control === 'range')
			.filter(([path, spec]) => {
				if (spec.control !== 'range') return false;
				const value = readAtPath(path);
				return typeof value !== 'number' || value < spec.min || value > spec.max;
			})
			.map(([path]) => path);
		expect(outOfRange).toEqual([]);
	});

	it('gives every range a positive step', () => {
		const badStep = Object.entries(CONFIG_SCHEMA)
			.filter(([, spec]) => spec.control === 'range' && !(spec.step > 0))
			.map(([path]) => path);
		expect(badStep).toEqual([]);
	});

	it('keeps every bounded number default inside its bounds', () => {
		const outOfRange = Object.entries(CONFIG_SCHEMA)
			.filter(([path, spec]) => {
				if (spec.control !== 'number') return false;
				const value = readAtPath(path);
				if (typeof value !== 'number') return true;
				if (spec.min !== undefined && value < spec.min) return true;
				return spec.max !== undefined && value > spec.max;
			})
			.map(([path]) => path);
		expect(outOfRange).toEqual([]);
	});

	it('marks integer number fields whose default is an integer', () => {
		const inconsistent = Object.entries(CONFIG_SCHEMA)
			.filter(([path, spec]) => {
				if (spec.control !== 'number' || spec.integer !== true) return false;
				const value = readAtPath(path);
				return typeof value !== 'number' || !Number.isInteger(value);
			})
			.map(([path]) => path);
		expect(inconsistent).toEqual([]);
	});

	it('hides exactly the excluded keys', () => {
		const hidden = Object.entries(CONFIG_SCHEMA)
			.filter(([, spec]) => spec.control === 'hidden')
			.map(([path]) => path);
		expect(hidden.sort()).toEqual([...HIDDEN_PATHS].sort());
	});

	it('gives every hidden field a reason and every exposed field a label', () => {
		const unexplained = Object.entries(CONFIG_SCHEMA)
			.filter(([, spec]) =>
				spec.control === 'hidden' ? spec.reason.length === 0 : spec.label.length === 0
			)
			.map(([path]) => path);
		expect(unexplained).toEqual([]);
	});

	it('uses toggle controls for exactly the exposed boolean leaves', () => {
		// Hidden booleans (the AI sheet's own preferences) have no control at all.
		const booleanPaths = runtimeLeafPaths.filter(
			(path) => typeof readAtPath(path) === 'boolean' && !(HIDDEN_PATHS as string[]).includes(path)
		);
		const togglePaths = Object.entries(CONFIG_SCHEMA)
			.filter(([, spec]) => spec.control === 'toggle')
			.map(([path]) => path);
		expect(togglePaths.sort()).toEqual(booleanPaths.sort());
	});

	it('never exposes a string leaf to a numeric control', () => {
		const exposedStrings = Object.entries(CONFIG_SCHEMA)
			.filter(([path, spec]) => spec.control !== 'hidden' && typeof readAtPath(path) === 'string')
			.map(([path]) => path);
		expect(exposedStrings).toEqual([]);
	});
});

// A miniature stand-in for the shape of APP_CONFIG, so the mapped type can be
// exercised without touching the real config.
type Fixture = { top: number; group: { flag: boolean; label: string } };
type FixtureWithList = { top: number; list: readonly ['a', 'b'] };
type FixtureWithExtra = { top: number; group: { flag: boolean; label: string; added: number } };

type FixtureSchema = { [K in LeafPaths<Fixture>]: string };
type ExtendedSchema = { [K in LeafPaths<FixtureWithExtra>]: string };
type ListSchema = { [K in LeafPaths<FixtureWithList>]: string };

describe('the mapped type', () => {
	it('accepts exactly the fixture leaf paths', () => {
		const complete: FixtureSchema = {
			top: 'a',
			'group.flag': 'b',
			'group.label': 'c'
		};
		expect(Object.keys(complete).sort()).toEqual(['group.flag', 'group.label', 'top']);
	});

	it('treats an array as one leaf rather than a branch of indices', () => {
		const withList: ListSchema = {
			top: 'a',
			list: 'b',
			// @ts-expect-error an array index is not a leaf path of its own
			'list.0': 'c'
		};
		expect(Object.keys(withList)).toContain('list');
	});

	it('rejects a schema entry that names no leaf', () => {
		const withStrayKey: FixtureSchema = {
			top: 'a',
			'group.flag': 'b',
			'group.label': 'c',
			// @ts-expect-error 'group.missing' is not a leaf path of the fixture
			'group.missing': 'd'
		};
		expect(Object.keys(withStrayKey)).toContain('group.missing');
	});

	it('rejects a schema that has not caught up with a new config key', () => {
		// @ts-expect-error 'group.added' is a leaf of the extended fixture and has no entry
		const stale: ExtendedSchema = {
			top: 'a',
			'group.flag': 'b',
			'group.label': 'c'
		};
		expect(Object.keys(stale)).not.toContain('group.added');
	});
});
