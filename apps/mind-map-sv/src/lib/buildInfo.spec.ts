import { describe, expect, it } from 'vitest';
import {
	BUILD_STAMP_META_NAME as SCRIPT_META_NAME,
	hasSourceChanges,
	resolveBuildStamp,
	withBuildStamp
} from '../../scripts/build-stamp.mjs';
import {
	BUILD_STAMP_META_NAME,
	compareBuildStamps,
	formatBuildStamp,
	newerAppNotice,
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

describe('newerAppNotice', () => {
	const APP = '2026-08-30T21:41:32-07:00 efa2bbc';

	it('warns when the document came from a newer app', () => {
		expect(newerAppNotice('2026-09-15T10:02:00-07:00 abc1234', APP)).toBe(
			'Saved by a newer app (2026-09-15 10:02).'
		);
	});

	it('leaves out the sha, which would not fit the toolbar on a phone', () => {
		expect(newerAppNotice('2026-09-15T10:02:00-07:00 abc1234', APP)).not.toContain('abc1234');
	});

	it('says "newer", which is how controllerNotice knows to outrank the status', () => {
		expect(newerAppNotice('2026-09-15T10:02:00-07:00 abc1234', APP)).toContain('newer');
	});

	it('says nothing about an older document, which is the ordinary upgrade path', () => {
		expect(newerAppNotice('2026-05-07T09:00:00-07:00 0000001', APP)).toBeNull();
	});

	it('says nothing when the document is this same build', () => {
		expect(newerAppNotice(APP, APP)).toBeNull();
	});

	it.each([
		['the document predates the stamp', undefined, APP],
		['the document stamp is unreadable', 'sometime last week', APP],
		['the app is a dev build', '2026-09-15T10:02:00-07:00 abc1234', null],
		['neither side is known', null, null]
	])('says nothing when %s', (_label, documentVersion, appVersion) => {
		expect(newerAppNotice(documentVersion, appVersion)).toBeNull();
	});

	it('compares the moment rather than the text, across offsets', () => {
		// 2026-08-31T04:41Z is the same moment as the app's 2026-08-30T21:41-07:00.
		expect(newerAppNotice('2026-08-31T04:41:32Z abc1234', APP)).toBeNull();
		expect(newerAppNotice('2026-08-31T04:41:33Z abc1234', APP)).not.toBeNull();
	});
});

describe('the build script dirty check', () => {
	const SHELL = 'apps/mind-map-sv/static/offline-app-shell.html';

	it('ignores the regenerated shell, which every build rewrites', () => {
		// Building writes the shell, so the next build would otherwise see a dirty
		// tree caused by its own output and stamp -dirty over nothing.
		expect(hasSourceChanges(` M ${SHELL}\n`)).toBe(false);
	});

	it('reports a clean tree', () => {
		expect(hasSourceChanges('')).toBe(false);
	});

	it('reports a modified source file', () => {
		expect(hasSourceChanges(' M apps/mind-map-sv/src/lib/buildInfo.ts\n')).toBe(true);
	});

	it('reports an untracked source file', () => {
		expect(hasSourceChanges('?? apps/mind-map-sv/src/lib/newThing.ts\n')).toBe(true);
	});

	it('reports source changes alongside the shell', () => {
		expect(hasSourceChanges(` M ${SHELL}\n M apps/mind-map-sv/src/lib/buildInfo.ts\n`)).toBe(true);
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
