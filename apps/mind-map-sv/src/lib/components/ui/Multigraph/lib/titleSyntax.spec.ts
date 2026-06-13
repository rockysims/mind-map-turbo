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
		expect(parseTitleSyntax(':alpha :beta Tagged title')).toEqual({
			displayTitle: 'Tagged title',
			nodeTags: ['alpha', 'beta'],
			edgeTags: [],
			direction: 'undirected'
		});
	});

	it('parses leading edge tags', () => {
		expect(parseTitleSyntax(';rel ;strong Connected title')).toEqual({
			displayTitle: 'Connected title',
			nodeTags: [],
			edgeTags: ['rel', 'strong'],
			direction: 'undirected'
		});
	});

	it('parses mixed node and edge tags after a direction marker', () => {
		expect(parseTitleSyntax('>:abc ;rel :urgent The displayed title')).toEqual({
			displayTitle: 'The displayed title',
			nodeTags: ['abc', 'urgent'],
			edgeTags: ['rel'],
			direction: 'parent-to-child'
		});
	});

	it('stops parsing when a malformed tag-like token appears', () => {
		expect(parseTitleSyntax(':good :bad:name Title')).toEqual({
			displayTitle: ':bad:name Title',
			nodeTags: ['good'],
			edgeTags: [],
			direction: 'undirected'
		});
	});

	it('returns an empty display title when syntax consumes the whole input', () => {
		expect(parseTitleSyntax('  < :child ;rel  ')).toEqual({
			displayTitle: '',
			nodeTags: ['child'],
			edgeTags: ['rel'],
			direction: 'child-to-parent'
		});
	});

	it('trims whitespace around markers, tags, and display title', () => {
		expect(parseTitleSyntax('  >   :alpha   ;rel   Display title   ')).toEqual({
			displayTitle: 'Display title',
			nodeTags: ['alpha'],
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
		expect(normalizeTagList('ok bad:name ;edge :node also-ok')).toEqual(['ok', 'also-ok']);
	});
});
