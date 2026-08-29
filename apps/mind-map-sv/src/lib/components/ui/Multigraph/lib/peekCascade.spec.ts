import { describe, expect, it } from 'vitest';
import { symbolFor } from '../../MathText/lib/mathSymbols';
import {
	cascadesInChipOrder,
	closeBranch,
	closeCascadeIn,
	closeNewestCascade,
	isBranchOpen,
	isLoop,
	openCascade,
	openCascadeIn,
	replaceCascade,
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
		const cascade = openCascade(1, 'g', 'upstream');

		expect(cascade.rootKey).toBe('g');
		expect(cascade.children).toEqual([]);
		// The root card is the cascade, so it is open for as long as one exists.
		expect(isBranchOpen(cascade, [])).toBe(true);
	});
});

describe('toggleBranch', () => {
	it('opens a branch and closes it again', () => {
		const drill = path(step('earth', 'm'));
		const opened = toggleBranch(openCascade(1, 'g', 'upstream'), drill);
		expect(isBranchOpen(opened, drill)).toBe(true);

		const closed = toggleBranch(opened, drill);
		expect(isBranchOpen(closed, drill)).toBe(false);
	});

	it('leaves the input cascade untouched', () => {
		const cascade = openCascade(1, 'g', 'upstream');
		toggleBranch(cascade, path(step('earth', 'm')));

		expect(cascade.children).toEqual([]);
	});

	it('drops descendants when an ancestor closes', () => {
		const shallow = path(step('earth', 'm'));
		const deep = path(step('earth', 'm'), step('mass', 'rho'));
		let cascade = toggleBranch(openCascade(1, 'g', 'upstream'), shallow);
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
		let cascade = toggleBranch(openCascade(1, 'g', 'upstream'), earth);
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
		let cascade = toggleBranch(openCascade(1, 'g', 'upstream'), underEarth);
		cascade = toggleBranch(cascade, underMoon);

		expect(isBranchOpen(cascade, underEarth)).toBe(true);
		expect(isBranchOpen(cascade, underMoon)).toBe(true);

		cascade = toggleBranch(cascade, underMoon);
		expect(isBranchOpen(cascade, underEarth)).toBe(true);
		expect(isBranchOpen(cascade, underMoon)).toBe(false);
	});

	it('ignores a path whose parent is not open', () => {
		const cascade = openCascade(1, 'g', 'upstream');
		const orphan = path(step('earth', 'm'), step('mass', 'rho'));

		const next = toggleBranch(cascade, orphan);

		expect(next.children).toEqual([]);
		expect(isBranchOpen(next, orphan)).toBe(false);
	});

	it('ignores the root path — the cascade is closed, not the root card', () => {
		const cascade = toggleBranch(openCascade(1, 'g', 'upstream'), path(step('earth', 'm')));

		expect(toggleBranch(cascade, [])).toBe(cascade);
	});
});

describe('closeBranch', () => {
	it('closes a branch and its descendants', () => {
		const shallow = path(step('earth', 'm'));
		const deep = path(step('earth', 'm'), step('mass', 'rho'));
		let cascade = toggleBranch(openCascade(1, 'g', 'upstream'), shallow);
		cascade = toggleBranch(cascade, deep);

		cascade = closeBranch(cascade, shallow);

		expect(isBranchOpen(cascade, shallow)).toBe(false);
		expect(isBranchOpen(cascade, deep)).toBe(false);
	});

	it('closes only the named level, leaving its ancestors open', () => {
		const shallow = path(step('earth', 'm'));
		const deep = path(step('earth', 'm'), step('mass', 'rho'));
		let cascade = toggleBranch(openCascade(1, 'g', 'upstream'), shallow);
		cascade = toggleBranch(cascade, deep);

		cascade = closeBranch(cascade, deep);

		expect(isBranchOpen(cascade, shallow)).toBe(true);
		expect(isBranchOpen(cascade, deep)).toBe(false);
	});

	it('returns the same cascade when there was nothing to close', () => {
		const cascade = toggleBranch(openCascade(1, 'g', 'upstream'), path(step('earth', 'm')));

		expect(closeBranch(cascade, path(step('moon', 'r')))).toBe(cascade);
		expect(closeBranch(cascade, [])).toBe(cascade);
	});
});

describe('isLoop', () => {
	it('fires on the root key at any depth', () => {
		const cascade = openCascade(1, 'g', 'upstream');

		expect(isLoop(cascade, [], 'g')).toBe(true);
		expect(isLoop(cascade, path(step('earth', 'm')), 'g')).toBe(true);
	});

	it('fires on an intermediate key already on the same path', () => {
		const cascade = openCascade(1, 'g', 'upstream');
		const deep = path(step('earth', 'm'), step('mass', 'rho'));

		expect(isLoop(cascade, deep, 'm')).toBe(true);
		expect(isLoop(cascade, deep, 'rho')).toBe(true);
	});

	it('does not fire across siblings', () => {
		// The repeat has to be on the chip's own ancestry. A sibling row consuming
		// the same quantity is the comparison the card exists to show.
		const cascade = toggleBranch(openCascade(1, 'g', 'upstream'), path(step('moon', 'm')));

		expect(isLoop(cascade, path(step('earth', 'r')), 'm')).toBe(false);
	});

	it('does not fire on a quantity nothing above has asked about', () => {
		expect(isLoop(openCascade(1, 'g', 'upstream'), path(step('earth', 'm')), 'rho')).toBe(false);
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

describe('cascade collections', () => {
	const upstream = 'upstream' as const;
	const downstream = 'downstream' as const;

	it('opens one cascade per quantity per direction', () => {
		let open = openCascadeIn([], 1, 'v', upstream);
		open = openCascadeIn(open, 2, 'v', upstream);
		expect(open).toHaveLength(1);

		// The same quantity asked the other way is a different question, so it gets
		// its own card rather than closing the first.
		open = openCascadeIn(open, 3, 'v', downstream);
		expect(open.map((c) => c.direction)).toEqual([upstream, downstream]);
	});

	it('closes by id, and ignores an id that is not open', () => {
		const open = openCascadeIn(openCascadeIn([], 1, 'v', upstream), 2, 'w', upstream);
		expect(closeCascadeIn(open, 1).map((c) => c.rootKey)).toEqual(['w']);
		expect(closeCascadeIn(open, 99)).toBe(open);
	});

	it('closes the most recently opened first', () => {
		let open = openCascadeIn([], 1, 'v', upstream);
		open = openCascadeIn(open, 2, 'w', downstream);
		open = openCascadeIn(open, 3, 'g', upstream);

		open = closeNewestCascade(open);
		expect(open.map((c) => c.rootKey)).toEqual(['v', 'w']);
		open = closeNewestCascade(open);
		expect(open.map((c) => c.rootKey)).toEqual(['v']);
		expect(closeNewestCascade([])).toEqual([]);
	});

	it('orders cascades to match the chips above them', () => {
		let open = openCascadeIn([], 1, 'g', upstream);
		open = openCascadeIn(open, 2, 'm', upstream);
		open = openCascadeIn(open, 3, 'w', downstream);

		// Chip order, not open order: cards sit under the chips they came from.
		expect(cascadesInChipOrder(open, upstream, ['m', 'g']).map((c) => c.rootKey)).toEqual([
			'm',
			'g'
		]);
		// And only this direction's cascades — the other column renders its own.
		expect(cascadesInChipOrder(open, downstream, ['w']).map((c) => c.rootKey)).toEqual(['w']);
	});

	it('keeps a cascade whose quantity is no longer a chip', () => {
		// The reader asked the question; a designation cycled off elsewhere is not
		// them withdrawing it, so the card stays and sorts after the live chips.
		let open = openCascadeIn([], 1, 'gone', upstream);
		open = openCascadeIn(open, 2, 'm', upstream);
		expect(cascadesInChipOrder(open, upstream, ['m']).map((c) => c.rootKey)).toEqual(['m', 'gone']);
	});

	it('replaces one cascade without disturbing the others', () => {
		let open = openCascadeIn([], 1, 'v', upstream);
		open = openCascadeIn(open, 2, 'w', upstream);
		const drilled = toggleBranch(open[0], [{ definerNodeId: 'n1', key: 'm' }]);

		const next = replaceCascade(open, drilled);
		expect(next[0].children.map((child) => child.key)).toEqual(['m']);
		expect(next[1]).toBe(open[1]);
	});

	it('treats the same quantity in two directions as unrelated for loops', () => {
		const up = openCascade(1, 'v', upstream);
		const down = openCascade(2, 'v', downstream);
		// Each cascade's own root is a loop within it, and says nothing about the other.
		expect(isLoop(up, [], 'v')).toBe(true);
		expect(isLoop(down, [], 'w')).toBe(false);
	});
});
