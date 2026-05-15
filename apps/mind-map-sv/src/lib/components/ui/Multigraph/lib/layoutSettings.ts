export interface LayoutSettings {
	baseRadius: number;
	scaleFalloff: number;
	minScale: number;
	paddingPx: number;
	relaxIterations: number;
}

export const DEFAULT_LAYOUT_SETTINGS: LayoutSettings = {
	baseRadius: 200,
	scaleFalloff: 0.7,
	minScale: 0.1,
	paddingPx: 12,
	relaxIterations: 2
};

export function withDefaultLayoutSettings(settings: Partial<LayoutSettings> = {}): LayoutSettings {
	return {
		...DEFAULT_LAYOUT_SETTINGS,
		...settings
	};
}
