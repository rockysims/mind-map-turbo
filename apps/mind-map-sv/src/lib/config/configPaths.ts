import type { APP_CONFIG } from '../appConfig';

/** Every leaf of `APP_CONFIG` is one of these three primitives. */
export type ConfigValue = number | boolean | string;

/**
 * `APP_CONFIG` is declared `as const`, so its leaves carry literal types
 * (`0.7`, `true`, `'#'`). Overrides and controls deal in the widened primitive.
 */
export type WidenConfigValue<T> = T extends number
	? number
	: T extends boolean
		? boolean
		: T extends string
			? string
			: never;

/**
 * Union of dotted paths to every leaf of `T`, e.g. `'multigraph.layout.scaleFalloff'`.
 * A branch is any non-array object; anything else is a leaf and terminates the
 * path. An array is a leaf rather than a branch: walking into it would name
 * `.length` and each index as settings of their own, and the list is one value.
 */
export type LeafPaths<T> = {
	[K in keyof T & string]: T[K] extends ConfigValue | readonly unknown[]
		? K
		: `${K}.${LeafPaths<T[K]>}`;
}[keyof T & string];

/** The widened value type stored at dotted path `P` inside `T`. */
export type ValueAtPath<T, P extends string> = P extends `${infer Head}.${infer Rest}`
	? Head extends keyof T
		? ValueAtPath<T[Head], Rest>
		: never
	: P extends keyof T
		? WidenConfigValue<T[P]>
		: never;

/** Union of dotted leaf paths of `APP_CONFIG`. */
export type ConfigPath = LeafPaths<typeof APP_CONFIG>;

/** The widened value type of the `APP_CONFIG` leaf at `P`. */
export type ConfigValueAt<P extends ConfigPath> = ValueAtPath<typeof APP_CONFIG, P>;
