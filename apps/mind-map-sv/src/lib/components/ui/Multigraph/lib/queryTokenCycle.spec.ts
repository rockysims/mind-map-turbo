import { describe, expect, it } from 'vitest';
import { parseGraphQuery, tagNamesMatch, type GraphQueryTokenMode } from './graphQuery';
import { cycleTagToken, tagTokenMode, tagTokenText } from './queryTokenCycle';
import type { TagSyntaxConfig } from './titleSyntax';

const configuredSyntax: TagSyntaxConfig = {
	nodeTagMarker: ':',
	edgeTagMarker: ';',
	addonMarker: '%'
};

/** Every query a tag's button walks through in one full cycle of three clicks, from `query`. */
function cycleThreeTimes(
	query: string,
	target: 'nodeTag' | 'edgeTag',
	tag: string,
	tagSyntax?: TagSyntaxConfig
): string[] {
	const steps: string[] = [];
	let current = query;
	for (let click = 0; click < 3; click += 1) {
		current = cycleTagToken(current, target, tag, tagSyntax);
		steps.push(current);
	}
	return steps;
}

describe('tagTokenText', () => {
	it('spells each mode with its prefix and the target marker', () => {
		expect(tagTokenText('focus', 'nodeTag', 'lab')).toBe('#lab');
		expect(tagTokenText('spotlight', 'nodeTag', 'lab')).toBe('+#lab');
		expect(tagTokenText('exclude', 'nodeTag', 'lab')).toBe('-#lab');
		expect(tagTokenText('focus', 'edgeTag', 'rel')).toBe('@rel');
		expect(tagTokenText('spotlight', 'edgeTag', 'rel')).toBe('+@rel');
		expect(tagTokenText('exclude', 'edgeTag', 'rel')).toBe('-@rel');
	});

	it('honours a configured tag syntax', () => {
		expect(tagTokenText('focus', 'nodeTag', 'lab', configuredSyntax)).toBe(':lab');
		expect(tagTokenText('spotlight', 'nodeTag', 'lab', configuredSyntax)).toBe('+:lab');
		expect(tagTokenText('exclude', 'edgeTag', 'rel', configuredSyntax)).toBe('-;rel');
	});
});

describe('tagTokenMode', () => {
	it('is null for a tag the query does not name', () => {
		expect(tagTokenMode('', 'nodeTag', 'lab')).toBeNull();
		expect(tagTokenMode('#other lab "#lab" !lab @lab', 'nodeTag', 'lab')).toBeNull();
		expect(tagTokenMode('#lab', 'edgeTag', 'lab')).toBeNull();
	});

	it('reads the mode of a single matching token', () => {
		expect(tagTokenMode('#lab', 'nodeTag', 'lab')).toBe('focus');
		expect(tagTokenMode('x +#lab y', 'nodeTag', 'lab')).toBe('spotlight');
		expect(tagTokenMode('-@rel', 'edgeTag', 'rel')).toBe('exclude');
	});

	it('is exclude when any matching token excludes, whatever the order', () => {
		expect(tagTokenMode('-#lab #b #lab', 'nodeTag', 'lab')).toBe('exclude');
		expect(tagTokenMode('#lab +#lab -#lab', 'nodeTag', 'lab')).toBe('exclude');
		expect(tagTokenMode('+#lab -#lab #lab', 'nodeTag', 'lab')).toBe('exclude');
	});

	it('is the last matching token mode when none excludes', () => {
		expect(tagTokenMode('#lab #b +#lab', 'nodeTag', 'lab')).toBe('spotlight');
		expect(tagTokenMode('+#lab #b #lab', 'nodeTag', 'lab')).toBe('focus');
	});

	it('reads a configured tag syntax', () => {
		expect(tagTokenMode('+:lab', 'nodeTag', 'lab', configuredSyntax)).toBe('spotlight');
		expect(tagTokenMode('#lab', 'nodeTag', 'lab', configuredSyntax)).toBeNull();
	});
});

describe('cycleTagToken', () => {
	it('cycles a node tag from an empty query through spotlight and exclude and back', () => {
		expect(cycleThreeTimes('', 'nodeTag', 'lab')).toEqual(['+#lab', '-#lab', '']);
	});

	it('cycles an edge tag with the edge marker', () => {
		expect(cycleThreeTimes('', 'edgeTag', 'rel')).toEqual(['+@rel', '-@rel', '']);
	});

	it('cycles with a configured tag syntax', () => {
		expect(cycleThreeTimes('', 'nodeTag', 'lab', configuredSyntax)).toEqual(['+:lab', '-:lab', '']);
		expect(cycleThreeTimes('', 'edgeTag', 'rel', configuredSyntax)).toEqual(['+;rel', '-;rel', '']);
	});

	it('never writes a plain focus token', () => {
		for (const step of cycleThreeTimes('#a', 'nodeTag', 'lab')) {
			expect(tagTokenMode(step, 'nodeTag', 'lab')).not.toBe('focus');
		}
	});

	it('steps a typed focus token on to spotlight, then exclude, then out', () => {
		expect(cycleThreeTimes('#lab', 'nodeTag', 'lab')).toEqual(['+#lab', '-#lab', '']);
		expect(cycleTagToken('#a #lab x', 'nodeTag', 'lab')).toBe('#a +#lab x');
	});

	it('steps a typed spotlight on to exclude', () => {
		expect(cycleTagToken('#a +#lab', 'nodeTag', 'lab')).toBe('#a -#lab');
	});

	it('edits only the tag token inside a longer typed query', () => {
		const spotlit = '"lab notes" #a +#lab x';
		const excluded = cycleTagToken(spotlit, 'nodeTag', 'lab');
		expect(excluded).toBe('"lab notes" #a -#lab x');
		expect(cycleTagToken(excluded, 'nodeTag', 'lab')).toBe('"lab notes" #a x');
	});

	it('removes every token when the effective mode is exclude', () => {
		expect(cycleTagToken('-#lab #b #lab', 'nodeTag', 'lab')).toBe('#b');
	});

	it('collapses duplicates into one token where the last one was', () => {
		expect(cycleTagToken('#lab #b +#lab', 'nodeTag', 'lab')).toBe('#b -#lab');
		expect(cycleTagToken('#lab #b #lab x', 'nodeTag', 'lab')).toBe('#b +#lab x');
	});

	describe('appending a tag the query does not name', () => {
		it('adds one space before the token unless the query already ends in whitespace', () => {
			expect(cycleTagToken('#a', 'nodeTag', 'lab')).toBe('#a +#lab');
			expect(cycleTagToken('#a ', 'nodeTag', 'lab')).toBe('#a +#lab');
			expect(cycleTagToken('#a\n', 'nodeTag', 'lab')).toBe('#a\n+#lab');
		});

		it('never trims the text the user typed', () => {
			expect(cycleTagToken('  x  y', 'nodeTag', 'lab')).toBe('  x  y +#lab');
			expect(cycleTagToken('   ', 'nodeTag', 'lab')).toBe('   +#lab');
		});
	});

	describe('whitespace when a token is removed', () => {
		it.each([
			['#a -#lab #b', '#a #b'],
			['#a  -#lab  #b', '#a  #b'],
			['#a -#lab', '#a'],
			['-#lab #a', '#a'],
			['#a-#lab #b', '#a #b'],
			['hello-#lab', 'hello'],
			['-#lab', ''],
			['-#lab ', ''],
			['#a -#lab ', '#a ']
		])('removing the excluded token from %j gives %j', (query, expected) => {
			expect(cycleTagToken(query, 'nodeTag', 'lab')).toBe(expected);
		});

		it.each([
			['#a #lab #b -#lab', '#a #b'],
			['#a  #lab  #b -#lab', '#a  #b'],
			['#a #lab -#lab', '#a'],
			['#lab #a -#lab', '#a'],
			['#a#lab #b -#lab', '#a #b'],
			['hello#lab -#lab', 'hello'],
			['#lab -#lab', '']
		])('removing an unexcluded duplicate from %j gives %j', (query, expected) => {
			expect(cycleTagToken(query, 'nodeTag', 'lab')).toBe(expected);
		});
	});

	describe('case-insensitive matching', () => {
		it('finds a differently cased token and rewrites it in the button spelling', () => {
			expect(tagTokenMode('#LAB', 'nodeTag', 'lab')).toBe('focus');
			expect(cycleTagToken('#LAB', 'nodeTag', 'lab')).toBe('+#lab');
		});

		it('shows the same mode to every legend spelling of one tag', () => {
			const query = 'x +#lab';
			expect(tagTokenMode(query, 'nodeTag', 'lab')).toBe('spotlight');
			expect(tagTokenMode(query, 'nodeTag', 'Lab')).toBe('spotlight');
			expect(cycleTagToken(query, 'nodeTag', 'Lab')).toBe('x -#Lab');
		});

		it('agrees with the tag comparison evaluation uses', () => {
			expect(tagNamesMatch('Lab', 'lab')).toBe(true);
			expect(tagNamesMatch('lab', 'labs')).toBe(false);
		});
	});

	it('leaves a quoted tag, a bare word, an add-on and an edge tag of the same name untouched', () => {
		const neighbours = '"#lab" lab !lab @lab';
		const steps = cycleThreeTimes(neighbours, 'nodeTag', 'lab');
		expect(steps).toEqual([`${neighbours} +#lab`, `${neighbours} -#lab`, neighbours]);
	});

	it('leaves node tags untouched when cycling the edge tag of the same name', () => {
		expect(cycleThreeTimes('#rel', 'edgeTag', 'rel')).toEqual(['#rel +@rel', '#rel -@rel', '#rel']);
	});

	describe('round trip', () => {
		/** The cycle as a table, kept apart from the module's own: no token and focus both step to spotlight. */
		function expectedNext(mode: GraphQueryTokenMode | null): GraphQueryTokenMode | null {
			if (mode === 'spotlight') return 'exclude';
			if (mode === 'exclude') return null;
			return 'spotlight';
		}

		it.each([
			[''],
			['"lab notes" #a x'],
			['#lab'],
			['#LAB +#lab'],
			['-#lab #b #lab'],
			['#a#lab#b'],
			['hello#lab'],
			['"#lab" lab !lab @lab']
		])('parses every cycle output of %j to at most one token for the tag', (start) => {
			let expected = tagTokenMode(start, 'nodeTag', 'lab');
			let current = start;
			for (let click = 0; click < 4; click += 1) {
				current = cycleTagToken(current, 'nodeTag', 'lab');
				expected = expectedNext(expected);
				const matches = parseGraphQuery(current).filter(
					(token) => token.target === 'nodeTag' && tagNamesMatch(token.value, 'lab')
				);
				if (expected === null) {
					expect(matches).toEqual([]);
				} else {
					expect(matches).toHaveLength(1);
					expect(matches[0].mode).toBe(expected);
				}
			}
		});
	});
});
