import { describe, it, expect } from 'vitest';
import { APP_CONFIG } from '../appConfig';
import { CONFIG_SCHEMA } from './configSchema';
import type { ConfigPath, LeafPaths } from './configPaths';

/** Walks the runtime object and returns a dotted path for every leaf. */
const collectLeafPaths = (value: unknown, prefix = ''): string[] => {
	if (typeof value !== 'object' || value === null) return [prefix];
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
	'multigraph.nodeRadiusPx'
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

	it('covers exactly the 76 shipped leaves', () => {
		expect(runtimeLeafPaths).toHaveLength(76);
		expect(schemaPaths).toHaveLength(76);
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

	it('uses toggle controls for exactly the boolean leaves', () => {
		const booleanPaths = runtimeLeafPaths.filter((path) => typeof readAtPath(path) === 'boolean');
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
type FixtureWithExtra = { top: number; group: { flag: boolean; label: string; added: number } };

type FixtureSchema = { [K in LeafPaths<Fixture>]: string };
type ExtendedSchema = { [K in LeafPaths<FixtureWithExtra>]: string };

describe('the mapped type', () => {
	it('accepts exactly the fixture leaf paths', () => {
		const complete: FixtureSchema = {
			top: 'a',
			'group.flag': 'b',
			'group.label': 'c'
		};
		expect(Object.keys(complete).sort()).toEqual(['group.flag', 'group.label', 'top']);
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
