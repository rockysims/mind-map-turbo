import { describe, it, expect } from 'vitest';
import { APP_CONFIG } from '../appConfig';
import {
	clampToSchema,
	clearOverride,
	clearSection,
	isConfigPath,
	readConfigDefault,
	resolveConfig,
	sanitizeOverrides,
	setOverride,
	type ConfigOverrides
} from './configOverrides';

describe('setOverride', () => {
	it('stores a value that differs from the shipped default', () => {
		const next = setOverride({}, 'multigraph.layout.scaleFalloff', 0.4);
		expect(next).toEqual({ 'multigraph.layout.scaleFalloff': 0.4 });
	});

	it('drops the key when the value equals the shipped default', () => {
		const withOverride = setOverride({}, 'multigraph.layout.baseRadius', 320);
		const backToDefault = setOverride(withOverride, 'multigraph.layout.baseRadius', 200);
		expect(APP_CONFIG.multigraph.layout.baseRadius).toBe(200);
		expect(backToDefault).toEqual({});
	});

	it('drops a select back to its default too', () => {
		const degree = setOverride({}, 'multigraph.borderWeight.source', 'degree');
		expect(degree).toEqual({ 'multigraph.borderWeight.source': 'degree' });
		expect(setOverride(degree, 'multigraph.borderWeight.source', 'size')).toEqual({});
	});

	it('drops a boolean back to its default too', () => {
		const off = setOverride({}, 'multigraph.layout.normalizeRelaxationRotation', false);
		expect(off).toEqual({ 'multigraph.layout.normalizeRelaxationRotation': false });
		expect(setOverride(off, 'multigraph.layout.normalizeRelaxationRotation', true)).toEqual({});
	});

	it('never mutates the map it was given', () => {
		const original: ConfigOverrides = { 'multigraph.layout.minScale': 0.2 };
		const added = setOverride(original, 'multigraph.zoom.maxScale', 8);
		const removed = setOverride(added, 'multigraph.layout.minScale', 0.1);
		expect(original).toEqual({ 'multigraph.layout.minScale': 0.2 });
		expect(added).not.toBe(original);
		expect(removed).toEqual({ 'multigraph.zoom.maxScale': 8 });
	});
});

describe('clearOverride and clearSection', () => {
	const overrides: ConfigOverrides = {
		'multigraph.layout.scaleFalloff': 0.4,
		'multigraph.layout.minScale': 0.2,
		'multigraph.zoom.maxScale': 8,
		'interaction.longPressMs': 400
	};

	it('clears one key immutably', () => {
		const next = clearOverride(overrides, 'multigraph.layout.minScale');
		expect(next['multigraph.layout.minScale']).toBeUndefined();
		expect(next['multigraph.layout.scaleFalloff']).toBe(0.4);
		expect(overrides['multigraph.layout.minScale']).toBe(0.2);
	});

	it('is a no-op for a key that was never overridden', () => {
		expect(clearOverride({}, 'multigraph.zoom.minScale')).toEqual({});
	});

	it('clears a section and nothing else', () => {
		const next = clearSection(overrides, 'multigraph.layout');
		expect(next).toEqual({
			'multigraph.zoom.maxScale': 8,
			'interaction.longPressMs': 400
		});
		expect(overrides['multigraph.layout.scaleFalloff']).toBe(0.4);
	});

	it('clears an exactly matching key as well as its descendants', () => {
		const flat: ConfigOverrides = { 'multigraph.zoom.maxScale': 8 };
		expect(clearSection(flat, 'multigraph.zoom.maxScale')).toEqual({});
	});

	it('only splits a prefix on a segment boundary', () => {
		expect(clearSection(overrides, 'multigraph.layout.min')).toEqual(overrides);
		expect(clearSection(overrides, 'multigraph.zoo')).toEqual(overrides);
	});
});

describe('resolveConfig', () => {
	it('reproduces APP_CONFIG when there are no overrides', () => {
		expect(resolveConfig({})).toEqual(APP_CONFIG);
	});

	it('changes exactly the overridden leaf', () => {
		const resolved = resolveConfig({ 'multigraph.layout.scaleFalloff': 0.4 });
		expect(resolved.multigraph.layout.scaleFalloff).toBe(0.4);
		expect(resolved.multigraph.layout.minScale).toBe(APP_CONFIG.multigraph.layout.minScale);
		expect(APP_CONFIG.multigraph.layout.scaleFalloff).toBe(0.7);
	});

	it('shares untouched branches with APP_CONFIG and clones the touched ones', () => {
		const resolved = resolveConfig({ 'multigraph.layout.scaleFalloff': 0.4 });
		expect(resolved.interaction).toBe(APP_CONFIG.interaction);
		expect(resolved.multigraph.dataflow).toBe(APP_CONFIG.multigraph.dataflow);
		expect(resolved.multigraph.zoom).toBe(APP_CONFIG.multigraph.zoom);
		expect(resolved.multigraph.layout).not.toBe(APP_CONFIG.multigraph.layout);
		expect(resolved.multigraph).not.toBe(APP_CONFIG.multigraph);
	});

	it('merges overrides across several branches at once', () => {
		const resolved = resolveConfig({
			'multigraph.layout.baseRadius': 320,
			'multigraph.zoom.maxScale': 8,
			'interaction.longPressMs': 400,
			'multigraph.layout.normalizeRelaxationRotation': false
		});
		expect(resolved.multigraph.layout.baseRadius).toBe(320);
		expect(resolved.multigraph.zoom.maxScale).toBe(8);
		expect(resolved.interaction.longPressMs).toBe(400);
		expect(resolved.multigraph.layout.normalizeRelaxationRotation).toBe(false);
		expect(resolved.math).toBe(APP_CONFIG.math);
	});

	it('ignores a key that names no leaf rather than inventing one', () => {
		const resolved = resolveConfig({ 'multigraph.nope': 1 } as ConfigOverrides);
		expect(resolved).toEqual(APP_CONFIG);
	});
});

describe('clampToSchema', () => {
	it('rounds an integer field', () => {
		expect(clampToSchema('multigraph.layout.relaxIterations', 12.7)).toBe(13);
		expect(clampToSchema('multigraph.layout.postDragSettleMaxFrames', 199.4)).toBe(199);
	});

	it('rejects non-finite numbers', () => {
		expect(clampToSchema('multigraph.layout.scaleFalloff', Number.NaN)).toBeUndefined();
		expect(
			clampToSchema('multigraph.layout.scaleFalloff', Number.POSITIVE_INFINITY)
		).toBeUndefined();
		expect(
			clampToSchema('multigraph.layout.relaxIterations', Number.NEGATIVE_INFINITY)
		).toBeUndefined();
	});

	it('treats number-control bounds as hard', () => {
		expect(clampToSchema('multigraph.layout.relaxIterations', -5)).toBe(0);
		expect(clampToSchema('math.maxExpand', 0)).toBe(1);
		expect(clampToSchema('multigraph.layout.maxRelaxationRotationPerFrameRad', 4)).toBe(Math.PI);
	});

	it('treats range-control bounds as soft, since the slider is a convenience', () => {
		expect(clampToSchema('multigraph.layout.scaleFalloff', 5)).toBe(5);
		expect(clampToSchema('multigraph.layout.scaleFalloff', -2)).toBe(-2);
		expect(clampToSchema('multigraph.zoom.maxScale', 500)).toBe(500);
	});

	it('drops values of the wrong primitive type', () => {
		expect(clampToSchema('multigraph.layout.scaleFalloff', '0.4')).toBeUndefined();
		expect(clampToSchema('multigraph.layout.scaleFalloff', true)).toBeUndefined();
		expect(clampToSchema('multigraph.layout.normalizeRelaxationRotation', 1)).toBeUndefined();
		expect(clampToSchema('multigraph.layout.scaleFalloff', null)).toBeUndefined();
	});

	it('keeps a valid value untouched', () => {
		expect(clampToSchema('multigraph.layout.scaleFalloff', 0.4)).toBe(0.4);
		expect(clampToSchema('multigraph.layout.normalizeRelaxationRotation', false)).toBe(false);
		expect(clampToSchema('multigraph.layout.relaxIterations', 20)).toBe(20);
	});

	it('keeps a select value only when it is one of the options', () => {
		expect(clampToSchema('multigraph.borderWeight.source', 'degree')).toBe('degree');
		expect(clampToSchema('multigraph.borderWeight.source', 'none')).toBe('none');
		expect(clampToSchema('multigraph.borderWeight.source', 'bogus')).toBeUndefined();
		expect(clampToSchema('multigraph.borderWeight.source', 'Degree')).toBeUndefined();
		expect(clampToSchema('multigraph.borderWeight.source', 3)).toBeUndefined();
		expect(clampToSchema('multigraph.borderWeight.source', true)).toBeUndefined();
		expect(clampToSchema('multigraph.borderWeight.source', null)).toBeUndefined();
	});

	it('drops hidden fields, which no panel can edit', () => {
		expect(clampToSchema('persistence.saveDebounceMs', 1000)).toBeUndefined();
		expect(clampToSchema('multigraph.tagSyntax.nodeTagMarker', '%')).toBeUndefined();
	});
});

describe('sanitizeOverrides', () => {
	it('returns nothing but a warning for non-object input', () => {
		for (const raw of [null, undefined, 42, 'settings', ['a']]) {
			const result = sanitizeOverrides(raw);
			expect(result.overrides).toEqual({});
			expect(result.warnings).toHaveLength(1);
		}
	});

	it('drops unknown paths and names each one, without throwing', () => {
		const { overrides, warnings } = sanitizeOverrides({
			'multigraph.layout.scaleFalloff': 0.4,
			'multigraph.layout.gravitationalConstant': 9.8,
			nonsense: 'hello'
		});
		expect(overrides).toEqual({ 'multigraph.layout.scaleFalloff': 0.4 });
		expect(warnings).toHaveLength(2);
		expect(warnings.join('\n')).toContain('multigraph.layout.gravitationalConstant');
		expect(warnings.join('\n')).toContain('nonsense');
	});

	it('names the allowed options when it drops a select value', () => {
		const { overrides, warnings } = sanitizeOverrides({
			'multigraph.borderWeight.source': 'bogus'
		});
		expect(overrides).toEqual({});
		expect(warnings).toEqual([
			'Setting "multigraph.borderWeight.source" was dropped: expected one of: none, size, weight, degree, attachments, descriptionLength.'
		]);
	});

	// The size-only border group was renamed to `borderWeight` a day after it
	// landed and never reached main, so its overrides are dropped, not migrated.
	it('drops a retired multigraph.sizeBorder override as an unknown setting', () => {
		const { overrides, warnings } = sanitizeOverrides({
			'multigraph.sizeBorder.widthPerDoubling': 0.25,
			'multigraph.borderWeight.widthPerDoubling': 0.3
		});
		expect(overrides).toEqual({ 'multigraph.borderWeight.widthPerDoubling': 0.3 });
		expect(warnings).toEqual([
			'Unknown setting "multigraph.sizeBorder.widthPerDoubling" was dropped.'
		]);
	});

	// Pinned nodes share `nodeBorderWidthPx` since 2026-10-12, so a saved
	// pinned-width override is dropped rather than migrated onto it.
	it('drops a retired multigraph.pinnedNodeBorderWidthPx override as an unknown setting', () => {
		const { overrides, warnings } = sanitizeOverrides({
			'multigraph.pinnedNodeBorderWidthPx': 12,
			'multigraph.nodeBorderWidthPx': 10
		});
		expect(overrides).toEqual({ 'multigraph.nodeBorderWidthPx': 10 });
		expect(warnings).toEqual(['Unknown setting "multigraph.pinnedNodeBorderWidthPx" was dropped.']);
	});

	it('drops wrong-typed values and names them', () => {
		const { overrides, warnings } = sanitizeOverrides({
			'multigraph.layout.scaleFalloff': 'quite a lot',
			'multigraph.layout.normalizeRelaxationRotation': 'yes',
			'multigraph.zoom.maxScale': 8
		});
		expect(overrides).toEqual({ 'multigraph.zoom.maxScale': 8 });
		expect(warnings).toHaveLength(2);
		expect(warnings.join('\n')).toContain('multigraph.layout.scaleFalloff');
		expect(warnings.join('\n')).toContain('multigraph.layout.normalizeRelaxationRotation');
	});

	it('reports values it adjusted rather than dropped', () => {
		const { overrides, warnings } = sanitizeOverrides({
			'multigraph.layout.relaxIterations': -3.6
		});
		expect(overrides).toEqual({ 'multigraph.layout.relaxIterations': 0 });
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain('multigraph.layout.relaxIterations');
	});

	it('leaves a config of valid shape after resolving a hostile blob', () => {
		const { overrides } = sanitizeOverrides({
			'multigraph.layout.scaleFalloff': 0.4,
			'multigraph.layout.relaxIterations': 8.6,
			'multigraph.layout.minScale': 'small',
			'persistence.storageNamespace': 'hijack',
			'not.a.path': 1
		});
		const resolved = resolveConfig(overrides);
		expect(resolved).toEqual({
			...APP_CONFIG,
			multigraph: {
				...APP_CONFIG.multigraph,
				layout: {
					...APP_CONFIG.multigraph.layout,
					scaleFalloff: 0.4,
					relaxIterations: 9
				}
			}
		});
		expect(resolved.persistence.storageNamespace).toBe(APP_CONFIG.persistence.storageNamespace);
		for (const [path, value] of Object.entries(overrides)) {
			expect(isConfigPath(path)).toBe(true);
			if (!isConfigPath(path)) continue;
			expect(typeof value).toBe(typeof readConfigDefault(path));
		}
	});

	it('is idempotent', () => {
		const raw = {
			'multigraph.layout.scaleFalloff': 0.4,
			'multigraph.layout.relaxIterations': 8.6,
			'multigraph.layout.minScale': 'small',
			'multigraph.zoom.maxScale': 500,
			'persistence.saveDebounceMs': 900,
			'not.a.path': 1
		};
		const first = sanitizeOverrides(raw);
		expect(first.warnings.length).toBeGreaterThan(0);

		const second = sanitizeOverrides(first.overrides);
		expect(second.overrides).toEqual(first.overrides);
		expect(second.warnings).toEqual([]);

		const third = sanitizeOverrides(second.overrides);
		expect(third.overrides).toEqual(first.overrides);
		expect(third.warnings).toEqual([]);
	});

	it('keeps a value that happens to equal the shipped default', () => {
		const { overrides, warnings } = sanitizeOverrides({
			'multigraph.layout.scaleFalloff': APP_CONFIG.multigraph.layout.scaleFalloff
		});
		expect(overrides).toEqual({ 'multigraph.layout.scaleFalloff': 0.7 });
		expect(warnings).toEqual([]);
	});
});
