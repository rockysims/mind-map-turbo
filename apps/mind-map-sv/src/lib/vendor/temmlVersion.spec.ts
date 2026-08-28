/**
 * `temml-local.css` is a copy of a file inside the temml package, so upgrading
 * temml does not update it. This pins the two together: bump the version here
 * only after diffing the upstream stylesheet and re-applying our deviations,
 * which the vendored file's header lists.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const VENDORED_FROM = '0.13.4';

const installedVersion = JSON.parse(
	readFileSync(
		fileURLToPath(new URL('../../../node_modules/temml/package.json', import.meta.url)),
		'utf8'
	)
).version;

const vendoredCss = readFileSync(
	fileURLToPath(new URL('./temml-local.css', import.meta.url)),
	'utf8'
);
const layoutCss = readFileSync(
	fileURLToPath(new URL('../../routes/layout.css', import.meta.url)),
	'utf8'
);

/**
 * Both files explain in comments what they deliberately do not declare, so the
 * assertions below have to look at declarations only.
 */
function withoutComments(css: string): string {
	return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('the vendored copy of Temml-Local.css', () => {
	it('was taken from the temml version that is installed', () => {
		expect(installedVersion).toBe(VENDORED_FROM);
	});

	it('records that version in its header', () => {
		expect(vendoredCss).toContain(`temml@${VENDORED_FROM}`);
	});

	it('asks for our own font family rather than the upstream one', () => {
		const declarations = withoutComments(vendoredCss);
		expect(declarations).toContain('MindMapScript');
		expect(declarations).not.toContain('Temml.woff2');
		expect(declarations).not.toMatch(/font-family:\s*["']?Temml["']?\s*;/);
	});

	it('leaves the @font-face to layout.css, whose relative paths survive bundling', () => {
		// Tailwind flattens the @import into layout.css and rebases url()s against
		// it, so a path written in the vendored file resolves from src/routes/.
		expect(withoutComments(vendoredCss)).not.toContain('@font-face');
		expect(withoutComments(layoutCss)).toMatch(
			/@font-face\s*\{[^}]*MindMapScript[^}]*\.\.\/lib\/fonts\/MindMapScript-Regular\.woff2/
		);
	});

	it('leaves no rule pointing at a family that our font does not provide', () => {
		// Our font has no prime glyphs, so a `font-family` on mo.tml-prime would
		// drop primes to the default document font instead of the math stack.
		expect(vendoredCss).not.toMatch(/mo\.tml-prime\s*\{[^}]*font-family/);
	});
});
