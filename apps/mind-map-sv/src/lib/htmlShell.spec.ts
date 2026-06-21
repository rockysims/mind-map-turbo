import { describe, expect, it } from 'vitest';
import { isSelfContainedHtmlShell } from './htmlShell';

describe('HTML shell helpers', () => {
	it('accepts inline module scripts as self-contained', () => {
		expect(isSelfContainedHtmlShell('<script type="module">console.log("offline")</script>')).toBe(
			true
		);
	});

	it('rejects external module scripts from dev or split builds', () => {
		expect(
			isSelfContainedHtmlShell('<script type="module" src="/@fs/example/entry.js"></script>')
		).toBe(false);
		expect(
			isSelfContainedHtmlShell('<script src="/_app/immutable/bundle.js" type="module"></script>')
		).toBe(false);
	});
});
