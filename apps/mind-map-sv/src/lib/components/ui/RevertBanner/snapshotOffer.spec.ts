import { describe, expect, it } from 'vitest';
import { formatSnapshotAge, snapshotOfferHeadline } from './snapshotOffer';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatSnapshotAge', () => {
	it('reads as moments ago under a minute', () => {
		expect(formatSnapshotAge(1_000, 1_000)).toBe('moments ago');
		expect(formatSnapshotAge(0, MINUTE - 1)).toBe('moments ago');
	});

	it('counts whole minutes, singular at one', () => {
		expect(formatSnapshotAge(0, MINUTE)).toBe('1 minute ago');
		expect(formatSnapshotAge(0, 5 * MINUTE + 59_000)).toBe('5 minutes ago');
	});

	it('counts whole hours once past an hour', () => {
		expect(formatSnapshotAge(0, HOUR)).toBe('1 hour ago');
		expect(formatSnapshotAge(0, 2 * HOUR + 30 * MINUTE)).toBe('2 hours ago');
	});

	it('counts whole days once past a day', () => {
		expect(formatSnapshotAge(0, DAY)).toBe('1 day ago');
		expect(formatSnapshotAge(0, 9 * DAY)).toBe('9 days ago');
	});

	it('does not say a snapshot is from the future', () => {
		expect(formatSnapshotAge(10 * MINUTE, 0)).toBe('moments ago');
	});

	it('survives a nonsense clock', () => {
		expect(formatSnapshotAge(Number.NaN, 0)).toBe('moments ago');
	});
});

describe('snapshotOfferHeadline', () => {
	it('names how many nodes an import added', () => {
		expect(snapshotOfferHeadline('import', 3, 17)).toBe('Imported 14 nodes');
	});

	it('is singular for a one-node import', () => {
		expect(snapshotOfferHeadline('import', 3, 4)).toBe('Imported 1 node');
	});

	it('stays vague when the graph shrank since the snapshot', () => {
		expect(snapshotOfferHeadline('import', 8, 5)).toBe('Graph changed');
	});

	it('stays vague when nothing was added', () => {
		expect(snapshotOfferHeadline('import', 5, 5)).toBe('Graph changed');
	});

	it('stays vague for an operation it has no words for', () => {
		expect(snapshotOfferHeadline('merge', 3, 17)).toBe('Graph changed');
	});
});
