/**
 * Pure grouping logic for the settings panel.
 *
 * The panel shows 69 fields, so the only maintainable grouping is one derived
 * from the schema itself: a field's section is the dotted prefix of its path
 * (`multigraph.layout.scaleFalloff` → `multigraph.layout`), and a section's
 * title is that prefix's last segment, humanized. Adding a key to `APP_CONFIG`
 * therefore lands in the right section — or opens a new one — with no list here
 * to keep in step.
 *
 * Sections keep the schema's declaration order, which follows `APP_CONFIG`'s own
 * structure, so the panel reads in the same order as the config file.
 */

import { clearOverride } from '$lib/config/configOverrides';
import type { ConfigOverrides } from '$lib/config/configOverrides';
import type { ConfigPath } from '$lib/config/configPaths';
import { CONFIG_SCHEMA } from '$lib/config/configSchema';
import type { FieldSpec, Preview, Tier } from '$lib/config/configSchema';

/** A `FieldSpec` the panel can actually render — everything but `hidden`. */
type VisibleFieldSpec = Exclude<FieldSpec, { control: 'hidden' }>;

/** One rendered row: the path it edits and the spec that describes it. */
export type PanelField = {
	path: ConfigPath;
	spec: VisibleFieldSpec;
};

/** One titled group of fields, within one tier. */
export type PanelSection = {
	/** Unique within the panel: a prefix can appear in both tiers. */
	id: string;
	/** The dotted path prefix every field in the section shares. */
	prefix: string;
	title: string;
	tier: Tier;
	fields: PanelField[];
	/** False when nothing in the section can be seen changing as it changes. */
	hasLivePreview: boolean;
};

/** The panel's two groups: `basic` is always shown, `advanced` is collapsed. */
type PanelSections = {
	basic: PanelSection[];
	advanced: PanelSection[];
};

/**
 * A schema the panel can be built from. Deliberately partial so specs can pin a
 * small fixture; `CONFIG_SCHEMA` itself is exhaustive by its own mapped type.
 */
export type PanelSchema = Readonly<Partial<Record<ConfigPath, FieldSpec>>>;

/**
 * Previews the user cannot observe by changing the field alone: `none` shows
 * nothing at all, and `gesture` shows nothing until they pin, drag, focus or
 * zoom. A section made entirely of these is worth flagging, so nobody concludes
 * the panel is broken.
 */
const PREVIEWLESS: ReadonlySet<Preview> = new Set<Preview>(['none', 'gesture']);

/** The dotted prefix a path is grouped under — everything before its leaf. */
export function sectionPrefixOf(path: string): string {
	const lastDot = path.lastIndexOf('.');
	return lastDot === -1 ? path : path.slice(0, lastDot);
}

/**
 * A section prefix as a heading: the last segment, camel case split into words.
 * `multigraph.edgeArrow` → `Edge arrow`.
 */
export function humanizeSectionPrefix(prefix: string): string {
	const segment = prefix.slice(prefix.lastIndexOf('.') + 1);
	const spaced = segment.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Whether the section holds at least one field with a visible live effect. */
function sectionHasLivePreview(fields: PanelField[]): boolean {
	return fields.some((field) => !PREVIEWLESS.has(field.spec.preview));
}

function toSections(tier: Tier, grouped: Map<string, PanelField[]>): PanelSection[] {
	return [...grouped].map(([prefix, fields]) => ({
		id: `${tier}:${prefix}`,
		prefix,
		title: humanizeSectionPrefix(prefix),
		tier,
		fields,
		hasLivePreview: sectionHasLivePreview(fields)
	}));
}

/**
 * Groups every non-hidden field into `basic` and `advanced` sections. Hidden
 * fields are dropped here rather than in the template, so the panel never emits
 * an element for a path it must not expose.
 */
export function buildPanelSections(schema: PanelSchema = CONFIG_SCHEMA): PanelSections {
	const grouped: Record<Tier, Map<string, PanelField[]>> = {
		basic: new Map(),
		advanced: new Map()
	};

	// `Object.entries` widens the key to `string`; every key of a schema map is a
	// `ConfigPath` by the map's own type.
	for (const [path, spec] of Object.entries(schema) as [ConfigPath, FieldSpec | undefined][]) {
		if (spec === undefined || spec.control === 'hidden') continue;
		const prefix = sectionPrefixOf(path);
		const sections = grouped[spec.tier];
		const existing = sections.get(prefix);
		if (existing) existing.push({ path, spec });
		else sections.set(prefix, [{ path, spec }]);
	}

	return {
		basic: toSections('basic', grouped.basic),
		advanced: toSections('advanced', grouped.advanced)
	};
}

/** Whether `path` currently carries an override. */
export function isOverridden(overrides: ConfigOverrides, path: ConfigPath): boolean {
	return overrides[path] !== undefined;
}

/** How many of `fields` are overridden — drives the section's reset button. */
export function countOverridden(fields: PanelField[], overrides: ConfigOverrides): number {
	return fields.reduce((total, field) => total + (isOverridden(overrides, field.path) ? 1 : 0), 0);
}

/** Whether anything at all is overridden — drives the global reset button. */
export function hasAnyOverride(overrides: ConfigOverrides): boolean {
	return Object.values(overrides).some((value) => value !== undefined);
}

/**
 * Clears exactly the fields the section renders, immutably.
 *
 * Deliberately not `clearSection(overrides, prefix)`: a prefix can appear in
 * both tiers (`multigraph.layout` has basic and advanced fields), and resetting
 * the visible basic group must not silently wipe advanced overrides the user
 * cannot even see while Advanced is collapsed.
 */
export function clearSectionOverrides(
	overrides: ConfigOverrides,
	fields: PanelField[]
): ConfigOverrides {
	let next = overrides;
	for (const field of fields) next = clearOverride(next, field.path);
	return next;
}
