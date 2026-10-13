import { describe, expect, it } from 'vitest';
import {
	backdropOpacityFor,
	clampDialogOpacity,
	dialogOpacityStorageKey,
	formatDialogOpacity,
	readDialogOpacity,
	writeDialogOpacity
} from './dialogOpacity';

const NAMESPACE = 'mind-map';

type MemoryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & {
	store: Map<string, string>;
};

function makeStorage(initial: Record<string, string> = {}): MemoryStorage {
	const store = new Map(Object.entries(initial));
	return {
		store,
		getItem: (key) => store.get(key) ?? null,
		setItem: (key, value) => {
			store.set(key, value);
		},
		removeItem: (key) => {
			store.delete(key);
		}
	};
}

/** Storage the way a browser with blocked site data behaves: every call throws. */
function makeThrowingStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
	const refuse = () => {
		throw new DOMException('blocked', 'SecurityError');
	};
	return { getItem: refuse, setItem: refuse, removeItem: refuse };
}

describe('clampDialogOpacity', () => {
	it('keeps a value inside [0, 1], including both ends', () => {
		expect(clampDialogOpacity(0)).toBe(0);
		expect(clampDialogOpacity(0.4)).toBe(0.4);
		expect(clampDialogOpacity(1)).toBe(1);
	});

	it('clamps a value outside the range to the nearer end', () => {
		expect(clampDialogOpacity(-0.2)).toBe(0);
		expect(clampDialogOpacity(1.7)).toBe(1);
	});

	it('reads anything that is not a finite number as fully opaque, never invisible', () => {
		expect(clampDialogOpacity(Number.NaN)).toBe(1);
		expect(clampDialogOpacity(Number.POSITIVE_INFINITY)).toBe(1);
		expect(clampDialogOpacity('0.4')).toBe(1);
		expect(clampDialogOpacity(null)).toBe(1);
		expect(clampDialogOpacity(undefined)).toBe(1);
	});
});

describe('backdropOpacityFor', () => {
	it('fades twice as fast as the panel: max(0, 2·o − 1)', () => {
		expect(backdropOpacityFor(1)).toBe(1);
		expect(backdropOpacityFor(0.75)).toBe(0.5);
		expect(backdropOpacityFor(0.55)).toBe(0.1);
	});

	it('is gone by the time the panel is at half, and stays gone below it', () => {
		expect(backdropOpacityFor(0.5)).toBe(0);
		expect(backdropOpacityFor(0.4)).toBe(0);
		expect(backdropOpacityFor(0)).toBe(0);
	});

	it('clamps its input first', () => {
		expect(backdropOpacityFor(3)).toBe(1);
		expect(backdropOpacityFor(-1)).toBe(0);
	});
});

describe('formatDialogOpacity', () => {
	it('reads as a whole percentage', () => {
		expect(formatDialogOpacity(1)).toBe('100%');
		expect(formatDialogOpacity(0.4)).toBe('40%');
		expect(formatDialogOpacity(0.05)).toBe('5%');
		expect(formatDialogOpacity(0)).toBe('0%');
	});
});

describe('dialogOpacityStorageKey', () => {
	it('sits beside the settings seed, below the graph key prefix', () => {
		expect(dialogOpacityStorageKey(NAMESPACE)).toBe('mind-map:dialog-opacity');
	});
});

describe('readDialogOpacity', () => {
	it('defaults to fully opaque when nothing is saved or there is no storage', () => {
		expect(readDialogOpacity(makeStorage(), NAMESPACE)).toBe(1);
		expect(readDialogOpacity(null, NAMESPACE)).toBe(1);
	});

	it('reads a saved value', () => {
		const storage = makeStorage({ 'mind-map:dialog-opacity': '0.4' });
		expect(readDialogOpacity(storage, NAMESPACE)).toBe(0.4);
	});

	it('reads a saved zero as zero, not as the default', () => {
		const storage = makeStorage({ 'mind-map:dialog-opacity': '0' });
		expect(readDialogOpacity(storage, NAMESPACE)).toBe(0);
	});

	it('treats garbage and blanks as nothing saved, and clamps out-of-range values', () => {
		expect(readDialogOpacity(makeStorage({ 'mind-map:dialog-opacity': 'abc' }), NAMESPACE)).toBe(1);
		expect(readDialogOpacity(makeStorage({ 'mind-map:dialog-opacity': ' ' }), NAMESPACE)).toBe(1);
		expect(readDialogOpacity(makeStorage({ 'mind-map:dialog-opacity': '7' }), NAMESPACE)).toBe(1);
		expect(readDialogOpacity(makeStorage({ 'mind-map:dialog-opacity': '-2' }), NAMESPACE)).toBe(0);
	});

	it('reads the default when storage throws on access', () => {
		expect(readDialogOpacity(makeThrowingStorage(), NAMESPACE)).toBe(1);
	});
});

describe('writeDialogOpacity', () => {
	it('round-trips through read', () => {
		const storage = makeStorage();
		writeDialogOpacity(storage, NAMESPACE, 0.4);
		expect(storage.store.get('mind-map:dialog-opacity')).toBe('0.4');
		expect(readDialogOpacity(storage, NAMESPACE)).toBe(0.4);
	});

	it('clears the key at the default instead of storing it', () => {
		const storage = makeStorage({ 'mind-map:dialog-opacity': '0.4' });
		writeDialogOpacity(storage, NAMESPACE, 1);
		expect(storage.store.has('mind-map:dialog-opacity')).toBe(false);
	});

	it('clamps before writing', () => {
		const storage = makeStorage();
		writeDialogOpacity(storage, NAMESPACE, -1);
		expect(storage.store.get('mind-map:dialog-opacity')).toBe('0');
	});

	it('swallows a refused write and does nothing without storage', () => {
		expect(() => writeDialogOpacity(makeThrowingStorage(), NAMESPACE, 0.4)).not.toThrow();
		expect(() => writeDialogOpacity(null, NAMESPACE, 0.4)).not.toThrow();
	});
});
