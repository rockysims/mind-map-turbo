import { describe, expect, it } from 'vitest';
import { normalizeTagList, parseTitleSyntax } from './titleSyntax';

describe('parseTitleSyntax', () => {
	it('returns an undirected plain title when no syntax is present', () => {
		expect(parseTitleSyntax('Plain title')).toEqual({
			displayTitle: 'Plain title',
			nodeTags: [],
			edgeTags: [],
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
			direction: 'undirected'
		});
	});

	it('parses leading edge tags', () => {
		expect(parseTitleSyntax('@rel @strong Connected title')).toEqual({
			displayTitle: 'Connected title',
			nodeTags: [],
			edgeTags: ['rel', 'strong'],
			direction: 'undirected'
		});
	});

	it('parses mixed node and edge tags after a direction marker', () => {
		expect(parseTitleSyntax('>#abc@rel#urgent The displayed title')).toEqual({
			displayTitle: 'The displayed title',
			nodeTags: ['abc', 'urgent'],
			edgeTags: ['rel'],
			direction: 'parent-to-child'
		});
	});

	it('parses compact edge and node tags after a child-to-parent marker', () => {
		expect(parseTitleSyntax('<@e#n Test')).toEqual({
			displayTitle: 'Test',
			nodeTags: ['n'],
			edgeTags: ['e'],
			direction: 'child-to-parent'
		});
	});

	it('stops parsing when a malformed tag-like token appears', () => {
		expect(parseTitleSyntax('#good # Title')).toEqual({
			displayTitle: '# Title',
			nodeTags: ['good'],
			edgeTags: [],
			direction: 'undirected'
		});
	});

	it('returns an empty display title when syntax consumes the whole input', () => {
		expect(parseTitleSyntax('  < #child @rel  ')).toEqual({
			displayTitle: '',
			nodeTags: ['child'],
			edgeTags: ['rel'],
			direction: 'child-to-parent'
		});
	});

	it('trims whitespace around markers, tags, and display title', () => {
		expect(parseTitleSyntax('  >   #alpha   @rel   Display title   ')).toEqual({
			displayTitle: 'Display title',
			nodeTags: ['alpha'],
			edgeTags: ['rel'],
			direction: 'parent-to-child'
		});
	});

	it('supports configured tag markers', () => {
		expect(
			parseTitleSyntax('>:alpha;rel:urgent Custom markers', {
				nodeTagMarker: ':',
				edgeTagMarker: ';'
			})
		).toEqual({
			displayTitle: 'Custom markers',
			nodeTags: ['alpha', 'urgent'],
			edgeTags: ['rel'],
			direction: 'parent-to-child'
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
});
