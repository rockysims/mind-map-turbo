import { describe, expect, it } from 'vitest';
import { normalizeTagList, parseSheetTitleSyntax, parseTitleSyntax } from './titleSyntax';

describe('parseTitleSyntax', () => {
	it('returns an undirected plain title when no syntax is present', () => {
		expect(parseTitleSyntax('Plain title')).toEqual({
			displayTitle: 'Plain title',
			nodeTags: [],
			edgeTags: [],
			addons: [],
			direction: 'undirected'
		});
	});

	it('leaves a seeded equation title untouched', () => {
		// The Define flow seeds `$k = $` and hands the author the caret. Nothing in
		// that string is syntax here — `$` and `=` are plain text, and the trailing
		// `$` must survive so the author is typing inside the math, not after it.
		expect(parseTitleSyntax('$k = $')).toEqual({
			displayTitle: '$k = $',
			nodeTags: [],
			edgeTags: [],
			addons: [],
			direction: 'undirected'
		});
	});

	it('leaves a subscripted seeded equation title untouched', () => {
		expect(parseTitleSyntax('$v_0 = $')).toMatchObject({
			displayTitle: '$v_0 = $',
			direction: 'undirected'
		});
	});

	it('maps > to parent-to-child direction', () => {
		expect(parseTitleSyntax('> Child title')).toMatchObject({
			displayTitle: 'Child title',
			direction: 'parent-to-child'
		});
	});

	it('maps < to child-to-parent direction', () => {
		expect(parseTitleSyntax('< Parent title')).toMatchObject({
			displayTitle: 'Parent title',
			direction: 'child-to-parent'
		});
	});

	it('parses multiple leading node tags', () => {
		expect(parseTitleSyntax('#alpha #beta#gamma Tagged title')).toEqual({
			displayTitle: 'Tagged title',
			nodeTags: ['alpha', 'beta', 'gamma'],
			edgeTags: [],
			addons: [],
			direction: 'undirected'
		});
	});

	it('parses leading edge tags', () => {
		expect(parseTitleSyntax('@rel @strong Connected title')).toEqual({
			displayTitle: 'Connected title',
			nodeTags: [],
			edgeTags: ['rel', 'strong'],
			addons: [],
			direction: 'undirected'
		});
	});

	it('parses mixed node and edge tags after a direction marker', () => {
		expect(parseTitleSyntax('>#abc@rel#urgent The displayed title')).toEqual({
			displayTitle: 'The displayed title',
			nodeTags: ['abc', 'urgent'],
			edgeTags: ['rel'],
			addons: [],
			direction: 'parent-to-child'
		});
	});

	it('parses compact edge and node tags after a child-to-parent marker', () => {
		expect(parseTitleSyntax('<@e#n Test')).toEqual({
			displayTitle: 'Test',
			nodeTags: ['n'],
			edgeTags: ['e'],
			addons: [],
			direction: 'child-to-parent'
		});
	});

	it('stops parsing when a malformed tag-like token appears', () => {
		expect(parseTitleSyntax('#good # Title')).toEqual({
			displayTitle: '# Title',
			nodeTags: ['good'],
			edgeTags: [],
			addons: [],
			direction: 'undirected'
		});
	});

	it('returns an empty display title when syntax consumes the whole input', () => {
		expect(parseTitleSyntax('  < #child @rel  ')).toEqual({
			displayTitle: '',
			nodeTags: ['child'],
			edgeTags: ['rel'],
			addons: [],
			direction: 'child-to-parent'
		});
	});

	it('trims whitespace around markers, tags, and display title', () => {
		expect(parseTitleSyntax('  >   #alpha   @rel   Display title   ')).toEqual({
			displayTitle: 'Display title',
			nodeTags: ['alpha'],
			edgeTags: ['rel'],
			addons: [],
			direction: 'parent-to-child'
		});
	});

	it('supports configured tag markers', () => {
		expect(
			parseTitleSyntax('>:alpha;rel:urgent Custom markers', {
				nodeTagMarker: ':',
				edgeTagMarker: ';',
				addonMarker: '!'
			})
		).toEqual({
			displayTitle: 'Custom markers',
			nodeTags: ['alpha', 'urgent'],
			edgeTags: ['rel'],
			addons: [],
			direction: 'parent-to-child'
		});
	});

	describe('the ! add-on marker', () => {
		// The rule the user settled on: the direction prefix and all three markers
		// are consumed from the front in any order and any count, markers may abut,
		// and a name ends at whitespace or the next marker. The registry is closed,
		// so an unregistered `!word` ends the run and stays in the title.
		const cases: Array<{
			raw: string;
			displayTitle: string;
			nodeTags: string[];
			edgeTags: string[];
			addons: string[];
			direction: string;
		}> = [
			{
				raw: '!task Title',
				displayTitle: 'Title',
				nodeTags: [],
				edgeTags: [],
				addons: ['task'],
				direction: 'undirected'
			},
			{
				raw: '#lab !task Title',
				displayTitle: 'Title',
				nodeTags: ['lab'],
				edgeTags: [],
				addons: ['task'],
				direction: 'undirected'
			},
			{
				raw: '!task #lab Title',
				displayTitle: 'Title',
				nodeTags: ['lab'],
				edgeTags: [],
				addons: ['task'],
				direction: 'undirected'
			},
			{
				raw: '!task #nodish @edgish Title',
				displayTitle: 'Title',
				nodeTags: ['nodish'],
				edgeTags: ['edgish'],
				addons: ['task'],
				direction: 'undirected'
			},
			{
				raw: '#a!task Title',
				displayTitle: 'Title',
				nodeTags: ['a'],
				edgeTags: [],
				addons: ['task'],
				direction: 'undirected'
			},
			{
				raw: '!important Title',
				displayTitle: '!important Title',
				nodeTags: [],
				edgeTags: [],
				addons: [],
				direction: 'undirected'
			},
			{
				raw: '!important #lab Title',
				displayTitle: '!important #lab Title',
				nodeTags: [],
				edgeTags: [],
				addons: [],
				direction: 'undirected'
			},
			{
				raw: '!task!task Title',
				displayTitle: 'Title',
				nodeTags: [],
				edgeTags: [],
				addons: ['task'],
				direction: 'undirected'
			},
			{
				raw: '! Title',
				displayTitle: '! Title',
				nodeTags: [],
				edgeTags: [],
				addons: [],
				direction: 'undirected'
			},
			{
				raw: '#wow! Title',
				displayTitle: '! Title',
				nodeTags: ['wow'],
				edgeTags: [],
				addons: [],
				direction: 'undirected'
			},
			{
				raw: '> !task #lab Title',
				displayTitle: 'Title',
				nodeTags: ['lab'],
				edgeTags: [],
				addons: ['task'],
				direction: 'parent-to-child'
			}
		];

		for (const testCase of cases) {
			it(`parses ${JSON.stringify(testCase.raw)}`, () => {
				expect(parseTitleSyntax(testCase.raw)).toEqual({
					displayTitle: testCase.displayTitle,
					nodeTags: testCase.nodeTags,
					edgeTags: testCase.edgeTags,
					addons: testCase.addons,
					direction: testCase.direction
				});
			});
		}

		it('leaves a bare marker in the title exactly as a bare # is left', () => {
			// `! Title` and `# Title` are the same shape of input and behave alike:
			// an empty name is not a valid marker name, so the run ends there.
			expect(parseTitleSyntax('# Title').displayTitle).toBe('# Title');
			expect(parseTitleSyntax('! Title').displayTitle).toBe('! Title');
		});

		it('supports a configured add-on marker', () => {
			expect(
				parseTitleSyntax('%task Custom marker', {
					nodeTagMarker: '#',
					edgeTagMarker: '@',
					addonMarker: '%'
				})
			).toMatchObject({ displayTitle: 'Custom marker', addons: ['task'] });
		});
	});
});

describe('parseSheetTitleSyntax', () => {
	it('reads node tags and add-ons the way the full parser does', () => {
		expect(parseSheetTitleSyntax('#lab !task Buy filters')).toEqual({
			displayTitle: 'Buy filters',
			nodeTags: ['lab'],
			addons: ['task']
		});
		expect(parseSheetTitleSyntax('!task#lab Buy filters')).toEqual({
			displayTitle: 'Buy filters',
			nodeTags: ['lab'],
			addons: ['task']
		});
	});

	it('leaves an edge tag in the title instead of consuming it', () => {
		expect(parseSheetTitleSyntax('@bench Buy filters')).toEqual({
			displayTitle: '@bench Buy filters',
			nodeTags: [],
			addons: []
		});
	});

	it('ends the run at an edge tag, so later markers stay in the title too', () => {
		expect(parseSheetTitleSyntax('#lab @bench !task Go')).toEqual({
			displayTitle: '@bench !task Go',
			nodeTags: ['lab'],
			addons: []
		});
	});

	it('leaves a direction prefix in the title', () => {
		expect(parseSheetTitleSyntax('> Title').displayTitle).toBe('> Title');
		expect(parseSheetTitleSyntax('< Title').displayTitle).toBe('< Title');
		// Nor does the prefix let the markers behind it through.
		expect(parseSheetTitleSyntax('>#lab Title')).toEqual({
			displayTitle: '>#lab Title',
			nodeTags: [],
			addons: []
		});
	});

	it('keeps an unregistered add-on name as prose, run and all', () => {
		expect(parseSheetTitleSyntax('!important #lab Read this')).toEqual({
			displayTitle: '!important #lab Read this',
			nodeTags: [],
			addons: []
		});
	});

	it('returns a plain title unchanged', () => {
		expect(parseSheetTitleSyntax('Buy filters')).toEqual({
			displayTitle: 'Buy filters',
			nodeTags: [],
			addons: []
		});
	});
});

describe('normalizeTagList', () => {
	it('drops empty whitespace tokens', () => {
		expect(normalizeTagList(' alpha   beta\n\ngamma ')).toEqual(['alpha', 'beta', 'gamma']);
	});

	it('ignores invalid tag names consistently with parser rules', () => {
		expect(normalizeTagList('ok bad#name @edge #node also-ok')).toEqual(['ok', 'also-ok']);
	});

	it('rejects a name containing the add-on marker, as it rejects the other two', () => {
		expect(normalizeTagList('ok bad!name !task also-ok')).toEqual(['ok', 'also-ok']);
	});
});
