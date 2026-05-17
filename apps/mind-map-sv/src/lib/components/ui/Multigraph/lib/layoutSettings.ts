export interface LayoutSettings {
	baseRadius: number;
	scaleFalloff: number;
	minScale: number;
	paddingPx: number;
	relaxIterations: number;
	edgeGapMinPx: number;
	edgeGapMaxPx: number;
	edgeSpringStrength: number;
}

export const DEFAULT_LAYOUT_SETTINGS: LayoutSettings = {
	baseRadius: 200,
	scaleFalloff: 0.7,
	minScale: 0.1,
	paddingPx: 12,
	relaxIterations: 2,
	edgeGapMinPx: 80,
	edgeGapMaxPx: 320,
	edgeSpringStrength: 0.25
};

export function withDefaultLayoutSettings(settings: Partial<LayoutSettings> = {}): LayoutSettings {
	return {
		...DEFAULT_LAYOUT_SETTINGS,
		...settings
	};
}
