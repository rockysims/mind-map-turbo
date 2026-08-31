import { describe, expect, it } from 'vitest';
import {
	BUILD_STAMP_META_NAME as SCRIPT_META_NAME,
	resolveBuildStamp,
	withBuildStamp
} from '../../scripts/build-stamp.mjs';
import {
	BUILD_STAMP_META_NAME,
	compareBuildStamps,
	formatBuildStamp,
	parseBuildStamp
} from './buildInfo';

const COMMIT_STAMP = '2026-08-30T21:41:32-07:00 efa2bbc';
const CLOCK_STAMP = '2026-08-30T12:00:00Z';

describe('parseBuildStamp', () => {
	it('reads an instant and a short sha', () => {
		expect(parseBuildStamp(COMMIT_STAMP)).toEqual({
			iso: '2026-08-30T21:41:32-07:00',
			commit: 'efa2bbc',
			dirty: false
		});
	});

	it('reads the dirty marker off the sha', () => {
		expect(parseBuildStamp(`${COMMIT_STAMP}-dirty`)).toEqual({
			iso: '2026-08-30T21:41:32-07:00',
			commit: 'efa2bbc',
			dirty: true
		});
	});

	it('accepts an instant with no sha, which is what a build without git emits', () => {
		expect(parseBuildStamp(CLOCK_STAMP)).toEqual({
			iso: '2026-08-30T12:00:00Z',
			commit: null,
			dirty: false
		});
	});

	it('tolerates surrounding and repeated whitespace', () => {
		expect(parseBuildStamp('  2026-08-30T12:00:00Z   efa2bbc  ')?.commit).toBe('efa2bbc');
	});

	it.each([
		['null', null],
		['undefined', undefined],
		['empty', ''],
		['prose', 'not a version'],
		['a date with no time', '2026-08-30'],
		['an instant with no offset', '2026-08-30T12:00:00'],
		['a sha that is too short', '2026-08-30T12:00:00Z abc'],
		['a non-hex sha', '2026-08-30T12:00:00Z zzzzzzz'],
		['an unknown suffix', '2026-08-30T12:00:00Z efa2bbc-wip'],
		['a third token', '2026-08-30T12:00:00Z efa2bbc extra']
	])('returns null for %s', (_label, content) => {
		expect(parseBuildStamp(content)).toBeNull();
	});

	it('rejects an impossible instant that matches the shape', () => {
		expect(parseBuildStamp('2026-13-45T99:00:00Z')).toBeNull();
	});
});

describe('formatBuildStamp', () => {
	it('renders the date, the time, and the sha', () => {
		expect(formatBuildStamp(parseBuildStamp(COMMIT_STAMP))).toBe('2026-08-30 21:41 · efa2bbc');
	});

	it('carries the dirty marker into the display', () => {
		expect(formatBuildStamp(parseBuildStamp(`${COMMIT_STAMP}-dirty`))).toBe(
			'2026-08-30 21:41 · efa2bbc-dirty'
		);
	});

	it('drops the separator when there is no sha', () => {
		expect(formatBuildStamp(parseBuildStamp(CLOCK_STAMP))).toBe('2026-08-30 12:00');
	});

	it('reads dev when there is no stamp, which is what the dev server serves', () => {
		expect(formatBuildStamp(null)).toBe('dev');
	});

	it('shows the wall clock the build recorded rather than converting it', () => {
		// The same instant, written from two zones. Converting either one to a
		// single zone would move one of them onto a different date, so the value
		// on screen would stop matching the value `grep` finds in the file.
		expect(formatBuildStamp(parseBuildStamp('2026-08-30T21:41:00-07:00 efa2bbc'))).toBe(
			'2026-08-30 21:41 · efa2bbc'
		);
		expect(formatBuildStamp(parseBuildStamp('2026-08-31T04:41:00Z efa2bbc'))).toBe(
			'2026-08-31 04:41 · efa2bbc'
		);
	});
});

describe('compareBuildStamps', () => {
	it('orders an older build before a newer one', () => {
		expect(
			compareBuildStamps(
				parseBuildStamp('2026-08-29T12:47:26-07:00 0785c93'),
				parseBuildStamp(COMMIT_STAMP)
			)
		).toBe(-1);
	});

	it('orders a newer build after an older one', () => {
		expect(
			compareBuildStamps(
				parseBuildStamp(COMMIT_STAMP),
				parseBuildStamp('2026-08-29T12:47:26-07:00 0785c93')
			)
		).toBe(1);
	});

	it('treats the same instant as equal even when the shas differ', () => {
		expect(
			compareBuildStamps(
				parseBuildStamp('2026-08-30T12:00:00Z efa2bbc'),
				parseBuildStamp('2026-08-30T12:00:00Z 0785c93-dirty')
			)
		).toBe(0);
	});

	it('compares by absolute instant across offsets, not by the text', () => {
		// 21:41-07:00 and 04:41Z are the same moment written two ways.
		expect(
			compareBuildStamps(
				parseBuildStamp('2026-08-30T21:41:00-07:00 efa2bbc'),
				parseBuildStamp('2026-08-31T04:41:00Z 0785c93')
			)
		).toBe(0);
	});

	it.each([
		['the left side is unknown', null, parseBuildStamp(COMMIT_STAMP)],
		['the right side is unknown', parseBuildStamp(COMMIT_STAMP), null],
		['both sides are unknown', null, null]
	])('refuses to order when %s', (_label, left, right) => {
		expect(compareBuildStamps(left, right)).toBeNull();
	});
});

describe('the meta name shared with the build script', () => {
	it('matches the name the build script injects', () => {
		// The build script is plain .mjs run by node before the app exists, so it
		// cannot import this module. Pinning the two here is what stops a rename
		// on one side from silently leaving the reader looking for a tag that is
		// no longer written.
		expect(BUILD_STAMP_META_NAME).toBe(SCRIPT_META_NAME);
	});

	it('parses a stamp the build script actually produced', () => {
		// Guards the whole round trip: whatever resolveBuildStamp emits in this
		// repo — with or without git, clean or dirty — has to survive parsing.
		const injected = withBuildStamp('<html><head></head><body></body></html>', resolveBuildStamp());
		const content = new RegExp(`content="([^"]+)"`).exec(injected)?.[1] ?? null;

		expect(parseBuildStamp(content)).not.toBeNull();
	});
});
