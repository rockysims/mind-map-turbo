import { describe, expect, it } from 'vitest';
import { symbolFor } from '../../MathText/lib/mathSymbols';
import {
	closeBranch,
	isBranchOpen,
	isLoop,
	openCascade,
	parsePath,
	serializePath,
	toggleBranch,
	type PeekPath,
	type PeekStep
} from './peekCascade';

function step(definerNodeId: string, key: string): PeekStep {
	return { definerNodeId, key };
}

function path(...steps: PeekStep[]): PeekPath {
	return steps;
}

describe('openCascade', () => {
	it('shows one quantity with nothing drilled', () => {
		const cascade = openCascade('g');

		expect(cascade.rootKey).toBe('g');
		expect(cascade.children).toEqual([]);
		// The root card is the cascade, so it is open for as long as one exists.
		expect(isBranchOpen(cascade, [])).toBe(true);
	});
});

describe('toggleBranch', () => {
	it('opens a branch and closes it again', () => {
		const drill = path(step('earth', 'm'));
		const opened = toggleBranch(openCascade('g'), drill);
		expect(isBranchOpen(opened, drill)).toBe(true);

		const closed = toggleBranch(opened, drill);
		expect(isBranchOpen(closed, drill)).toBe(false);
	});

	it('leaves the input cascade untouched', () => {
		const cascade = openCascade('g');
		toggleBranch(cascade, path(step('earth', 'm')));

		expect(cascade.children).toEqual([]);
	});

	it('drops descendants when an ancestor closes', () => {
		const shallow = path(step('earth', 'm'));
		const deep = path(step('earth', 'm'), step('mass', 'rho'));
		let cascade = toggleBranch(openCascade('g'), shallow);
		cascade = toggleBranch(cascade, deep);
		expect(isBranchOpen(cascade, deep)).toBe(true);

		// The reader closed the question those answers hang off, so keeping the
		// deeper cards would leave orphans on screen.
		cascade = toggleBranch(cascade, shallow);
		expect(isBranchOpen(cascade, shallow)).toBe(false);
		expect(isBranchOpen(cascade, deep)).toBe(false);

		// Re-opening starts clean rather than restoring what was dropped.
		cascade = toggleBranch(cascade, shallow);
		expect(isBranchOpen(cascade, deep)).toBe(false);
	});

	it('keeps sibling branches independent', () => {
		const earth = path(step('earth', 'm'));
		const moon = path(step('moon', 'r'));
		let cascade = toggleBranch(openCascade('g'), earth);
		cascade = toggleBranch(cascade, moon);

		cascade = toggleBranch(cascade, earth);
		expect(isBranchOpen(cascade, earth)).toBe(false);
		expect(isBranchOpen(cascade, moon)).toBe(true);
	});

	it('keeps the same quantity independent under two different rows', () => {
		// Two definers of g both consuming m is ordinary, not circular: the reader
		// opened two separate answers and closing one must not close the other.
		const underEarth = path(step('earth', 'm'));
		const underMoon = path(step('moon', 'm'));
		let cascade = toggleBranch(openCascade('g'), underEarth);
		cascade = toggleBranch(cascade, underMoon);

		expect(isBranchOpen(cascade, underEarth)).toBe(true);
		expect(isBranchOpen(cascade, underMoon)).toBe(true);

		cascade = toggleBranch(cascade, underMoon);
		expect(isBranchOpen(cascade, underEarth)).toBe(true);
		expect(isBranchOpen(cascade, underMoon)).toBe(false);
	});

	it('ignores a path whose parent is not open', () => {
		const cascade = openCascade('g');
		const orphan = path(step('earth', 'm'), step('mass', 'rho'));

		const next = toggleBranch(cascade, orphan);

		expect(next.children).toEqual([]);
		expect(isBranchOpen(next, orphan)).toBe(false);
	});

	it('ignores the root path — the cascade is closed, not the root card', () => {
		const cascade = toggleBranch(openCascade('g'), path(step('earth', 'm')));

		expect(toggleBranch(cascade, [])).toBe(cascade);
	});
});

describe('closeBranch', () => {
	it('closes a branch and its descendants', () => {
		const shallow = path(step('earth', 'm'));
		const deep = path(step('earth', 'm'), step('mass', 'rho'));
		let cascade = toggleBranch(openCascade('g'), shallow);
		cascade = toggleBranch(cascade, deep);

		cascade = closeBranch(cascade, shallow);

		expect(isBranchOpen(cascade, shallow)).toBe(false);
		expect(isBranchOpen(cascade, deep)).toBe(false);
	});

	it('closes only the named level, leaving its ancestors open', () => {
		const shallow = path(step('earth', 'm'));
		const deep = path(step('earth', 'm'), step('mass', 'rho'));
		let cascade = toggleBranch(openCascade('g'), shallow);
		cascade = toggleBranch(cascade, deep);

		cascade = closeBranch(cascade, deep);

		expect(isBranchOpen(cascade, shallow)).toBe(true);
		expect(isBranchOpen(cascade, deep)).toBe(false);
	});

	it('returns the same cascade when there was nothing to close', () => {
		const cascade = toggleBranch(openCascade('g'), path(step('earth', 'm')));

		expect(closeBranch(cascade, path(step('moon', 'r')))).toBe(cascade);
		expect(closeBranch(cascade, [])).toBe(cascade);
	});
});

describe('isLoop', () => {
	it('fires on the root key at any depth', () => {
		const cascade = openCascade('g');

		expect(isLoop(cascade, [], 'g')).toBe(true);
		expect(isLoop(cascade, path(step('earth', 'm')), 'g')).toBe(true);
	});

	it('fires on an intermediate key already on the same path', () => {
		const cascade = openCascade('g');
		const deep = path(step('earth', 'm'), step('mass', 'rho'));

		expect(isLoop(cascade, deep, 'm')).toBe(true);
		expect(isLoop(cascade, deep, 'rho')).toBe(true);
	});

	it('does not fire across siblings', () => {
		// The repeat has to be on the chip's own ancestry. A sibling row consuming
		// the same quantity is the comparison the card exists to show.
		const cascade = toggleBranch(openCascade('g'), path(step('moon', 'm')));

		expect(isLoop(cascade, path(step('earth', 'r')), 'm')).toBe(false);
	});

	it('does not fire on a quantity nothing above has asked about', () => {
		expect(isLoop(openCascade('g'), path(step('earth', 'm')), 'rho')).toBe(false);
	});
});

describe('serializePath', () => {
	it('round-trips the root path as the empty string', () => {
		expect(serializePath([])).toBe('');
		expect(parsePath('')).toEqual([]);
	});

	it('round-trips a subscripted quantity key', () => {
		// `v_0`'s key embeds a NUL between base and subscript, which is illegal raw
		// in the attribute selectors that address a card.
		const key = symbolFor('v', '0').key;
		expect(key).toContain('\u0000');
		const original = path(step('earth', key));

		const serialized = serializePath(original);

		expect(serialized).not.toContain('\u0000');
		expect(parsePath(serialized)).toEqual(original);
	});

	it('round-trips hostile node ids and keys', () => {
		const original = path(
			step('node/with:separators', symbolFor('a', 'b').key),
			step('quote"and\'apostrophe', '%2F'),
			step('unicode \u2603 id', '\u03ba')
		);

		const serialized = serializePath(original);

		expect(serialized).not.toContain('"');
		expect(serialized).not.toContain('\u0000');
		expect(parsePath(serialized)).toEqual(original);
	});

	it('distinguishes the same key under two different rows', () => {
		expect(serializePath(path(step('earth', 'm')))).not.toBe(
			serializePath(path(step('moon', 'm')))
		);
	});

	it('nests one segment per step', () => {
		const serialized = serializePath(path(step('earth', 'm'), step('mass', 'rho')));

		expect(serialized.split('/')).toHaveLength(2);
		expect(parsePath(serialized)).toHaveLength(2);
	});
});
