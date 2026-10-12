import { APP_CONFIG } from '../appConfig';
import { CONFIG_SCHEMA } from './configSchema';
import type { ConfigPath, ConfigValue, ConfigValueAt, WidenConfigValue } from './configPaths';

/**
 * A graph's settings, stored sparsely: only the leaves the user actually
 * changed appear. Deliberately flat and dotted rather than a nested partial —
 * flat keys make diffing, resetting one field, and round-tripping through a
 * saved file trivial, and they key straight into `CONFIG_SCHEMA`.
 */
export type ConfigOverrides = { [K in ConfigPath]?: ConfigValueAt<K> };

/**
 * The same map with its values widened to the shared union. Every leaf type is
 * a `ConfigValue`, so this is a supertype of `ConfigOverrides` that can be
 * written to with a path whose specific value type is not statically known.
 */
type LooseOverrides = Partial<Record<ConfigPath, ConfigValue>>;

/** `APP_CONFIG`'s shape with its `as const` literals widened to primitives. */
type WidenConfigBranch<T> = {
	// Homomorphic on purpose: `readonly` is preserved, because untouched
	// branches of a resolved config are shared with `APP_CONFIG` itself.
	[K in keyof T]: T[K] extends ConfigValue ? WidenConfigValue<T[K]> : WidenConfigBranch<T[K]>;
};

/** A complete config: `APP_CONFIG` with a graph's overrides merged in. */
export type ResolvedConfig = WidenConfigBranch<typeof APP_CONFIG>;

const CONFIG_PATHS: ReadonlySet<string> = new Set(Object.keys(CONFIG_SCHEMA));

/** Whether `key` names a leaf of `APP_CONFIG` that the schema knows about. */
export const isConfigPath = (key: string): key is ConfigPath => CONFIG_PATHS.has(key);

const isBranch = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

/** The shipped default at `path`, or `undefined` if the path has no leaf. */
export const readConfigDefault = (path: ConfigPath): ConfigValue | undefined => {
	let current: unknown = APP_CONFIG;
	for (const segment of path.split('.')) {
		if (!isBranch(current)) return undefined;
		current = current[segment];
	}
	if (typeof current === 'number' || typeof current === 'boolean' || typeof current === 'string') {
		return current;
	}
	return undefined;
};

const overrideEntries = (overrides: ConfigOverrides): [ConfigPath, ConfigValue][] => {
	const entries: [ConfigPath, ConfigValue][] = [];
	for (const [key, value] of Object.entries<ConfigValue | undefined>(overrides)) {
		if (value === undefined || !isConfigPath(key)) continue;
		entries.push([key, value]);
	}
	return entries;
};

/**
 * Returns a copy of `branch` with the leaf at `segments` replaced. Only the
 * objects along the path are copied; every sibling branch keeps its original
 * reference, so merging one override costs one clone per level, not a deep copy.
 */
const cloneWithLeaf = (
	branch: Record<string, unknown>,
	segments: string[],
	value: ConfigValue
): Record<string, unknown> => {
	const [head, ...rest] = segments;
	if (head === undefined) return branch;
	if (rest.length === 0) return { ...branch, [head]: value };
	const child = branch[head];
	if (!isBranch(child)) return branch;
	return { ...branch, [head]: cloneWithLeaf(child, rest, value) };
};

/**
 * Deep-merges sparse `overrides` into a full config shaped like `APP_CONFIG`.
 * `APP_CONFIG` is never mutated; branches with no override in them are shared
 * with it by reference.
 */
export const resolveConfig = (overrides: ConfigOverrides): ResolvedConfig => {
	let merged: Record<string, unknown> = { ...APP_CONFIG };
	for (const [path, value] of overrideEntries(overrides)) {
		if (readConfigDefault(path) === undefined) continue;
		merged = cloneWithLeaf(merged, path.split('.'), value);
	}
	// The walk only ever replaces a leaf of `APP_CONFIG` with a value of that
	// leaf's own type, which an untyped record walk cannot express.
	return merged as ResolvedConfig;
};

/**
 * Records `value` at `path`, immutably. A value equal to the shipped default
 * clears the key instead of storing it, so overrides never accumulate no-ops
 * and a graph never freezes today's defaults into its saved settings.
 */
export const setOverride = <P extends ConfigPath>(
	overrides: ConfigOverrides,
	path: P,
	value: ConfigValueAt<P>
): ConfigOverrides => {
	const next: LooseOverrides = { ...overrides };
	if (readConfigDefault(path) === value) {
		delete next[path];
	} else {
		// `value` is the leaf type at `path`; with `P` still generic TS cannot
		// see that it is one of the three `ConfigValue` primitives.
		next[path] = value as ConfigValue;
	}
	// Written as a matching key/value pair, which the widened view forgot.
	return next as ConfigOverrides;
};

/** Drops the override at `path`, immutably. */
export const clearOverride = (overrides: ConfigOverrides, path: ConfigPath): ConfigOverrides => {
	const next: LooseOverrides = { ...overrides };
	delete next[path];
	// Only keys were removed, so every surviving pair still matches.
	return next as ConfigOverrides;
};

/**
 * Drops every override at `prefix` or below it — `'multigraph.layout'` clears
 * `multigraph.layout.*` but leaves `multigraph.layoutish.*` alone. Immutable.
 * Keys that name no leaf are dropped along the way, as they are in `resolveConfig`.
 */
export const clearSection = (overrides: ConfigOverrides, prefix: string): ConfigOverrides => {
	const next: LooseOverrides = {};
	for (const [path, value] of overrideEntries(overrides)) {
		if (path === prefix || path.startsWith(`${prefix}.`)) continue;
		next[path] = value;
	}
	// Entries are copied across unchanged, so each key keeps its own value type.
	return next as ConfigOverrides;
};

type Coerced =
	| { kind: 'kept'; value: ConfigValue }
	| { kind: 'adjusted'; value: ConfigValue; note: string }
	| { kind: 'dropped'; reason: string };

/**
 * Coerces a raw value to what the field at `path` accepts.
 *
 * Bounds are deliberately asymmetric between the two numeric controls:
 *
 * - **`range` min/max are soft.** They are slider ergonomics, not legality —
 *   `scaleFalloff` is drawn on `0..1` but any number is meaningful, and T06's
 *   paired numeric input exists precisely so the slider is a convenience rather
 *   than a cage. Out-of-range values pass through untouched.
 * - **`number` min/max are hard.** They are only declared where the value out
 *   of bounds is nonsense: a negative `relaxIterations`, a zero `maxExpand`, a
 *   per-frame rotation cap beyond a half turn. Those are clamped.
 *
 * Non-finite numbers are rejected by both, and `integer` fields are rounded.
 */
const coerceToSchema = (path: ConfigPath, value: unknown): Coerced => {
	const spec = CONFIG_SCHEMA[path];
	if (spec.control === 'hidden') {
		return { kind: 'dropped', reason: 'it is not user-configurable' };
	}
	if (spec.control === 'toggle') {
		if (typeof value !== 'boolean') return { kind: 'dropped', reason: 'expected a boolean' };
		return { kind: 'kept', value };
	}
	if (typeof value !== 'number') return { kind: 'dropped', reason: 'expected a number' };
	if (!Number.isFinite(value)) return { kind: 'dropped', reason: 'expected a finite number' };

	let next = value;
	if (spec.control === 'number') {
		if (spec.integer === true) next = Math.round(next);
		if (spec.min !== undefined) next = Math.max(next, spec.min);
		if (spec.max !== undefined) next = Math.min(next, spec.max);
	}
	if (next === value) return { kind: 'kept', value };
	return { kind: 'adjusted', value: next, note: `${value} was adjusted to ${next}` };
};

/**
 * Coerces and bounds a raw value per the `FieldSpec` at `path`, returning
 * `undefined` when it cannot be used at all. See `coerceToSchema` for why range
 * bounds are soft and number bounds are hard.
 */
export const clampToSchema = (path: ConfigPath, value: unknown): ConfigValue | undefined => {
	const coerced = coerceToSchema(path, value);
	return coerced.kind === 'dropped' ? undefined : coerced.value;
};

/**
 * The trust boundary for overrides arriving from a graph file, `localStorage`,
 * or a hand edit. Nothing throws: unusable input is dropped and named in
 * `warnings`, so a graph saved by a future version — or wrecked by a text
 * editor — can never wedge the app.
 *
 * Values equal to the shipped default are kept rather than pruned; sanitizing
 * validates, it does not renormalize. `setOverride` is what keeps the map free
 * of no-ops as the user edits.
 *
 * Idempotent: sanitizing its own output drops nothing and warns about nothing.
 */
export const sanitizeOverrides = (
	raw: unknown
): { overrides: ConfigOverrides; warnings: string[] } => {
	const warnings: string[] = [];
	if (!isBranch(raw) || Array.isArray(raw)) {
		warnings.push('Settings were ignored: expected an object keyed by setting path.');
		return { overrides: {}, warnings };
	}

	const overrides: LooseOverrides = {};
	for (const [key, value] of Object.entries(raw)) {
		if (value === undefined) continue;
		if (!isConfigPath(key)) {
			warnings.push(`Unknown setting "${key}" was dropped.`);
			continue;
		}
		const coerced = coerceToSchema(key, value);
		if (coerced.kind === 'dropped') {
			warnings.push(`Setting "${key}" was dropped: ${coerced.reason}.`);
			continue;
		}
		if (coerced.kind === 'adjusted') {
			warnings.push(`Setting "${key}": ${coerced.note}.`);
		}
		overrides[key] = coerced.value;
	}
	// Each value came from `coerceToSchema` for its own key, so it is the type
	// that key stores — a link the widened view cannot carry.
	return { overrides: overrides as ConfigOverrides, warnings };
};
