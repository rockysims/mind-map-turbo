import { describe, expect, it } from 'vitest';
import { draftChangesNode, type NodeEditDraft } from './nodeEditDraft';
import type { NodeData } from '../../types/node';

const NODE: NodeData = {
	id: 'n',
	title: 'Kinematics',
	description: 'Plain prose.',
	tags: ['physics', 'urgent'],
	inputs: [{ base: 'a', subscript: null }],
	outputs: [{ base: 'v', subscript: '0' }],
	weight: 3
};

/** The draft an untouched sheet over `NODE` would hand the save. */
function untouched(overrides: Partial<NodeEditDraft> = {}): NodeEditDraft {
	return {
		title: 'Kinematics',
		description: 'Plain prose.',
		tags: ['physics', 'urgent'],
		inputs: [{ base: 'a', subscript: null }],
		outputs: [{ base: 'v', subscript: '0' }],
		weight: 3,
		...overrides
	};
}

/** `NODE` with no `weight` key at all, the way a node nobody weighed is stored. */
function unweighted(): NodeData {
	const copy = { ...NODE };
	delete copy.weight;
	return copy;
}

describe('draftChangesNode', () => {
	it('is false for the draft an untouched sheet produces', () => {
		expect(draftChangesNode(NODE, untouched())).toBe(false);
	});

	it('treats absent designations on the node as empty lists', () => {
		const bare: NodeData = { id: 'n', title: 'T', description: '', tags: [] };
		expect(
			draftChangesNode(bare, { title: 'T', description: '', tags: [], inputs: [], outputs: [] })
		).toBe(false);
	});

	it.each<[string, Partial<NodeEditDraft>]>([
		['title', { title: 'Dynamics' }],
		['description', { description: 'Other prose.' }],
		['a removed tag', { tags: ['physics'] }],
		['reordered tags', { tags: ['urgent', 'physics'] }],
		['an added input', { inputs: [...untouched().inputs, { base: 'b', subscript: null }] }],
		['an output subscript', { outputs: [{ base: 'v', subscript: '1' }] }],
		['a new weight', { weight: 4 }],
		['a removed weight', { weight: null }]
	])('is true when %s changes', (_label, overrides) => {
		expect(draftChangesNode(NODE, untouched(overrides))).toBe(true);
	});

	it('reads an unreadable weight (absent from the draft) as no change', () => {
		const withoutWeight = untouched();
		delete withoutWeight.weight;
		expect(draftChangesNode(NODE, withoutWeight)).toBe(false);
	});

	it('reads removing a weight the node never had as no change', () => {
		expect(draftChangesNode(unweighted(), untouched({ weight: null }))).toBe(false);
	});

	it('counts 0 as a real weight, different from none', () => {
		expect(draftChangesNode(unweighted(), untouched({ weight: 0 }))).toBe(true);
	});
});
