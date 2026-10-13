/**
 * The Tags dialog's opacity: a per-browser viewing preference the reader sets
 * from a slider in the dialog's header, so they can watch the graph react to a
 * layout slider through the dialog that holds it.
 *
 * Everything but the slider itself fades with the chosen value; the backdrop
 * fades twice as fast, so it is gone by the time the panel is at half. The value
 * lives in `localStorage` beside the settings seed, never in the graph or the
 * file: it describes this reader's screen, not the graph.
 *
 * Pure over an injected storage, like `config/settingsSeed.ts`, so it needs no
 * DOM to test.
 */

const DEFAULT_DIALOG_OPACITY = 1;

/** The two calls this preference makes, so a spec can pass a plain object. */
type OpacityStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * A usable opacity in `[0, 1]`. Anything that is not a finite number — a
 * corrupted stored value, an empty field — falls back to fully opaque, the
 * default, rather than to an invisible dialog. Zero is allowed: the slider
 * stays opaque at every value, so there is always a way back.
 */
export function clampDialogOpacity(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_DIALOG_OPACITY;
	return Math.min(1, Math.max(0, value));
}

/**
 * The backdrop's opacity factor for a panel at `opacity`: `max(0, 2·o − 1)`.
 * Twice the panel's rate, so at 50% the dimming is already gone and the reader
 * sees the graph at its true colours under a half-faded panel. Rounded to three
 * places so a `0.55` step reads `0.1`, not float noise, in the DOM.
 */
export function backdropOpacityFor(opacity: number): number {
	const factor = Math.max(0, 2 * clampDialogOpacity(opacity) - 1);
	return Math.round(factor * 1000) / 1000;
}

/** The slider's `aria-valuetext` and visible readout, as a whole percentage. */
export function formatDialogOpacity(opacity: number): string {
	return `${Math.round(clampDialogOpacity(opacity) * 100)}%`;
}

/**
 * Storage key for `namespace`'s dialog opacity, one level below the graph keys
 * (`${namespace}:graph:${id}`) like the settings seed, so the three can never
 * collide.
 */
export function dialogOpacityStorageKey(namespace: string): string {
	return `${namespace}:dialog-opacity`;
}

/**
 * The saved opacity, or the default. Storage can be missing (no window), refuse
 * (blocked site data throws on access), or hold anything another tab wrote, so
 * every one of those reads as "nothing saved".
 */
export function readDialogOpacity(storage: OpacityStorage | null, namespace: string): number {
	if (storage === null) return DEFAULT_DIALOG_OPACITY;
	try {
		const item = storage.getItem(dialogOpacityStorageKey(namespace));
		if (item === null || item.trim() === '') return DEFAULT_DIALOG_OPACITY;
		return clampDialogOpacity(Number(item));
	} catch {
		return DEFAULT_DIALOG_OPACITY;
	}
}

/**
 * Saves `opacity` for `namespace`. The default clears the key instead, so an
 * untouched browser carries no entry. A refused write (quota, blocked storage)
 * is swallowed: losing a viewing preference must never break the dialog.
 */
export function writeDialogOpacity(
	storage: OpacityStorage | null,
	namespace: string,
	opacity: number
): void {
	if (storage === null) return;
	const value = clampDialogOpacity(opacity);
	try {
		if (value === DEFAULT_DIALOG_OPACITY) {
			storage.removeItem(dialogOpacityStorageKey(namespace));
		} else {
			storage.setItem(dialogOpacityStorageKey(namespace), String(value));
		}
	} catch {
		// Nothing to do: the preference simply does not outlive this page.
	}
}
