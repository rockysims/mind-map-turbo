import { describe, expect, it } from 'vitest';
import { addonBadges } from './addonBadges';
import type { NodeContentBlock, NodeData } from '../../types/node';

function nodeWith(patch: Partial<NodeData> = {}): NodeData {
	return {
		id: 'node-1',
		title: 'Kinematics',
		description: '',
		tags: [],
		...patch
	};
}

function image(assetId: string): NodeContentBlock {
	return { type: 'image', assetId, alt: assetId };
}

function file(assetId: string): NodeContentBlock {
	return { type: 'file', assetId, name: `${assetId}.csv` };
}

describe('addonBadges', () => {
	it('shows nothing on a node with no add-ons and no files', () => {
		expect(addonBadges(nodeWith())).toEqual([]);
	});

	it('shows an unchecked box for a task that is not done', () => {
		expect(addonBadges(nodeWith({ addons: { task: { done: false } } }))).toEqual([
			{ kind: 'task', glyph: '☐', label: 'Task, not done' }
		]);
	});

	it('shows a checked box for a done task', () => {
		expect(addonBadges(nodeWith({ addons: { task: { done: true, doneAt: 5 } } }))).toEqual([
			{ kind: 'task', glyph: '☑', label: 'Task, done' }
		]);
	});

	it('counts file blocks on a node with no add-on', () => {
		const badges = addonBadges(nodeWith({ content: [file('a'), file('b')] }));
		expect(badges).toEqual([
			{ kind: 'attachments', glyph: '📎', label: '2 attachments', count: 2 }
		]);
	});

	it('says "1 attachment" rather than "1 attachments"', () => {
		expect(addonBadges(nodeWith({ content: [file('a')] }))[0].label).toBe('1 attachment');
	});

	it('puts the task badge before the attachment badge', () => {
		const badges = addonBadges(
			nodeWith({ addons: { task: { done: false } }, content: [file('a')] })
		);
		expect(badges.map((badge) => badge.kind)).toEqual(['task', 'attachments']);
	});

	it('does not count images, which have their own presence in the details view', () => {
		expect(addonBadges(nodeWith({ content: [image('a'), image('b')] }))).toEqual([]);
	});

	it('counts only the files on a node holding both kinds', () => {
		const badges = addonBadges(nodeWith({ content: [image('a'), file('b'), image('c')] }));
		expect(badges).toEqual([{ kind: 'attachments', glyph: '📎', label: '1 attachment', count: 1 }]);
	});
});
