import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../../../../appConfig';
import {
	DEFAULT_EDGE_OCCLUSION_CLEARANCE_PX,
	DEFAULT_EDGE_OCCLUSION_FADE_WIDTH_PX,
	DEFAULT_EDGE_OCCLUSION_MIN_OPACITY,
	DEFAULT_EDGE_OCCLUSION_ZOOM_SCALE_EXPONENT
} from './edgeOcclusion';
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

	it('pins the pure edge occlusion helper defaults independently from app tuning', () => {
		expect(DEFAULT_EDGE_OCCLUSION_CLEARANCE_PX).toBe(6);
		expect(DEFAULT_EDGE_OCCLUSION_FADE_WIDTH_PX).toBe(12);
		expect(DEFAULT_EDGE_OCCLUSION_ZOOM_SCALE_EXPONENT).toBe(0.5);
		expect(DEFAULT_EDGE_OCCLUSION_MIN_OPACITY).toBe(0.16);
	});
});
