import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../../../../appConfig';
import { DEFAULT_LAYOUT_SETTINGS, withDefaultLayoutSettings } from './layoutSettings';

describe('layoutSettings', () => {
	it('uses app config as the default layout source of truth', () => {
		expect(DEFAULT_LAYOUT_SETTINGS).toEqual(APP_CONFIG.multigraph.layout);
	});

	it('allows callers to override individual app defaults', () => {
		expect(withDefaultLayoutSettings({ displayedLayers: 4, edgeSpringStrength: 1 })).toEqual({
			...APP_CONFIG.multigraph.layout,
			displayedLayers: 4,
			edgeSpringStrength: 1
		});
	});
});
