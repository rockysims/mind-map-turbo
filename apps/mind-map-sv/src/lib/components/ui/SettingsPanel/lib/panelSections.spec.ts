import { describe, expect, it } from 'vitest';
import { CONFIG_SCHEMA } from '$lib/config/configSchema';
import type { FieldSpec } from '$lib/config/configSchema';
import type { ConfigPath } from '$lib/config/configPaths';
import type { ConfigOverrides } from '$lib/config/configOverrides';
import {
	buildPanelSections,
	clearSectionOverrides,
	countOverridden,
	hasAnyOverride,
	humanizeSectionPrefix,
	isOverridden,
	sectionPrefixOf,
	type PanelSchema,
	type PanelSection
} from './panelSections';

const allSections = (): PanelSection[] => {
	const sections = buildPanelSections();
	return [...sections.basic, ...sections.advanced];
};

const allPaths = (): ConfigPath[] =>
	allSections().flatMap((section) => section.fields.map((f) => f.path));

const sectionById = (id: string): PanelSection => {
	const section = allSections().find((candidate) => candidate.id === id);
	if (!section) throw new Error(`No section ${id}`);
	return section;
};

describe('sectionPrefixOf', () => {
	it('groups a field under everything before its leaf segment', () => {
		expect(sectionPrefixOf('multigraph.layout.scaleFalloff')).toBe('multigraph.layout');
		expect(sectionPrefixOf('interaction.doubleClickMs')).toBe('interaction');
	});

	it('treats a bare leaf as its own section rather than dropping it', () => {
		expect(sectionPrefixOf('orphan')).toBe('orphan');
	});
});

describe('humanizeSectionPrefix', () => {
	it('splits the last segment on camel case', () => {
		expect(humanizeSectionPrefix('multigraph.edgeArrow')).toBe('Edge arrow');
		expect(humanizeSectionPrefix('multigraph.edgeStroke')).toBe('Edge stroke');
	});

	it('keeps a single-word prefix as a plain capitalized word', () => {
		expect(humanizeSectionPrefix('interaction')).toBe('Interaction');
		expect(humanizeSectionPrefix('multigraph.zoom')).toBe('Zoom');
	});
});

describe('buildPanelSections', () => {
	it('renders every non-hidden schema path exactly once', () => {
		const expected = Object.entries(CONFIG_SCHEMA)
			.filter(([, spec]) => spec.control !== 'hidden')
			.map(([path]) => path)
			.sort();

		expect([...allPaths()].sort()).toEqual(expected);
	});

	it('never emits a hidden path', () => {
		const rendered = new Set<string>(allPaths());
		const hidden = Object.entries(CONFIG_SCHEMA)
			.filter(([, spec]) => spec.control === 'hidden')
			.map(([path]) => path);

		expect(hidden.length).toBeGreaterThan(0);
		for (const path of hidden) expect(rendered.has(path)).toBe(false);
	});

	it('keeps the fields of each tier inside that tier', () => {
		const sections = buildPanelSections();
		for (const section of sections.basic) {
			for (const field of section.fields) expect(field.spec.tier).toBe('basic');
		}
		for (const section of sections.advanced) {
			for (const field of section.fields) expect(field.spec.tier).toBe('advanced');
		}
	});

	it('gives every section a unique id even when a prefix spans both tiers', () => {
		const ids = allSections().map((section) => section.id);
		const prefixes = allSections().map((section) => section.prefix);

		expect(new Set(ids).size).toBe(ids.length);
		// `multigraph.layout` really does appear in both tiers, which is why the
		// id carries the tier.
		expect(prefixes.filter((prefix) => prefix === 'multigraph.layout')).toHaveLength(2);
	});

	it('groups every field under the prefix its section names', () => {
		for (const section of allSections()) {
			for (const field of section.fields) {
				expect(sectionPrefixOf(field.path)).toBe(section.prefix);
			}
		}
	});

	it('keeps sections in schema declaration order', () => {
		const sections = buildPanelSections();
		const firstPathOf = (section: PanelSection) => section.fields[0].path;
		const declared = Object.keys(CONFIG_SCHEMA);
		const indexOf = (section: PanelSection) => declared.indexOf(firstPathOf(section));

		const basicOrder = sections.basic.map(indexOf);
		const advancedOrder = sections.advanced.map(indexOf);

		expect(basicOrder).toEqual([...basicOrder].sort((a, b) => a - b));
		expect(advancedOrder).toEqual([...advancedOrder].sort((a, b) => a - b));
	});

	it('flags a section whose fields are all preview-less', () => {
		// Both zoom fields are `gesture`: correct immediately, invisible until the
		// user zooms.
		expect(sectionById('basic:multigraph.zoom').hasLivePreview).toBe(false);
		expect(sectionById('advanced:interaction').hasLivePreview).toBe(false);
		expect(sectionById('advanced:math').hasLivePreview).toBe(false);
	});

	it('does not flag a section holding one live field among preview-less ones', () => {
		// `focus` mixes `gesture` timings with `instant` details chrome.
		expect(sectionById('advanced:multigraph.focus').hasLivePreview).toBe(true);
		expect(sectionById('basic:multigraph.layout').hasLivePreview).toBe(true);
	});

	it('builds from a supplied schema fixture, so a new key needs no code here', () => {
		const fixture: PanelSchema = {
			'multigraph.zoom.minScale': {
				control: 'range',
				label: 'Minimum zoom',
				tier: 'basic',
				preview: 'none',
				min: 0,
				max: 1,
				step: 0.1
			},
			'multigraph.nodeRadiusPx': { control: 'hidden', reason: 'test' } satisfies FieldSpec
		};

		const sections = buildPanelSections(fixture);

		expect(sections.advanced).toEqual([]);
		expect(sections.basic).toHaveLength(1);
		expect(sections.basic[0].title).toBe('Zoom');
		expect(sections.basic[0].hasLivePreview).toBe(false);
		expect(sections.basic[0].fields.map((field) => field.path)).toEqual([
			'multigraph.zoom.minScale'
		]);
	});
});

describe('override bookkeeping', () => {
	const overrides: ConfigOverrides = {
		'multigraph.zoom.minScale': 0.2,
		'multigraph.zoom.maxScale': 8,
		'multigraph.layout.scaleFalloff': 0.4
	};

	it('reports a path as overridden only when it carries a value', () => {
		expect(isOverridden(overrides, 'multigraph.zoom.minScale')).toBe(true);
		expect(isOverridden(overrides, 'multigraph.layout.baseRadius')).toBe(false);
	});

	it('counts only the overridden fields a section owns', () => {
		const zoom = sectionById('basic:multigraph.zoom');
		const layout = sectionById('basic:multigraph.layout');

		expect(countOverridden(zoom.fields, overrides)).toBe(2);
		expect(countOverridden(layout.fields, overrides)).toBe(1);
	});

	it('reports whether anything at all is overridden', () => {
		expect(hasAnyOverride(overrides)).toBe(true);
		expect(hasAnyOverride({})).toBe(false);
	});
});

describe('clearSectionOverrides', () => {
	it('clears the fields of one section and leaves the others alone', () => {
		const overrides: ConfigOverrides = {
			'multigraph.zoom.minScale': 0.2,
			'multigraph.zoom.maxScale': 8,
			'multigraph.layout.scaleFalloff': 0.4
		};

		const next = clearSectionOverrides(overrides, sectionById('basic:multigraph.zoom').fields);

		expect(next).toEqual({ 'multigraph.layout.scaleFalloff': 0.4 });
		// Immutable: the caller's map is untouched.
		expect(Object.keys(overrides)).toHaveLength(3);
	});

	it('leaves fields of the other tier under the same prefix alone', () => {
		const overrides: ConfigOverrides = {
			'multigraph.layout.scaleFalloff': 0.4,
			'multigraph.layout.relaxIterations': 30
		};

		const next = clearSectionOverrides(overrides, sectionById('basic:multigraph.layout').fields);

		expect(next).toEqual({ 'multigraph.layout.relaxIterations': 30 });
	});
});
