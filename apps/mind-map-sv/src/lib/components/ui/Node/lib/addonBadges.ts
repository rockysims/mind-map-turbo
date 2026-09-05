/**
 * What a compact node shows on its border, beyond its title.
 *
 * A badge is a glyph and nothing else: it reports state the reader would
 * otherwise have to open the node to learn (this is a task, and it is done;
 * this node carries files). Deciding the list here rather than in the component
 * keeps the clutter budget in one specced place. Milestone 13's risk note capped
 * it at two glyphs and said to revisit placement if milestone 14's AI badge made
 * three: three it is, and the answer for now is order rather than a redesign —
 * the add-on state glyphs first in registry order, the attachment tally always
 * last, so the tally stays the rightmost thing and the next add-on lands beside
 * its own kind instead of after it.
 */

import type { NodeData } from '../../types/node';
import { NODE_ADDON_REGISTRY } from '../../Multigraph/lib/nodeAddons';

/**
 * The checked box, which the registry does not carry: an entry's `glyph` names
 * the add-on itself (what the edit sheet's toggle is for), and only `task` has
 * a second state to draw. A second registry field for it would be a field every
 * future add-on has to leave empty.
 */
const TASK_DONE_GLYPH = '☑';

/** The paperclip is the only glyph here that is not an add-on's own. */
const ATTACHMENT_GLYPH = '📎';

export type AddonBadgeKind = 'task' | 'ai' | 'attachments';

export interface AddonBadge {
	kind: AddonBadgeKind;
	glyph: string;
	/**
	 * What the glyph means, in words. The canvas node is labelled as a whole, so
	 * this is what a tooltip and a test read rather than what a screen reader
	 * announces walking the node's children.
	 */
	label: string;
	/**
	 * Drawn beside the glyph when the badge counts something. Absent on a badge
	 * that is a state rather than a tally — a task is done or it is not, and "☐1"
	 * would be nonsense.
	 */
	count?: number;
}

/**
 * The badges `node` shows, in a stable order: the task box, then the AI star,
 * then attachments, so a node that grows a file does not shuffle the glyph the
 * reader already knows the position of.
 *
 * Images are deliberately not counted. An image is already visible in the
 * details view the moment it opens, so a count beside it would be reporting
 * something the node shows anyway; a file has no other presence at all.
 */
export function addonBadges(node: NodeData): AddonBadge[] {
	const badges: AddonBadge[] = [];

	const task = node.addons?.task;
	if (task !== undefined) {
		badges.push({
			kind: 'task',
			glyph: task.done ? TASK_DONE_GLYPH : NODE_ADDON_REGISTRY.task.glyph,
			label: task.done ? 'Task, done' : 'Task, not done'
		});
	}

	// No count and no second state: an AI node either carries the add-on or does
	// not, and how many runs it holds is a number the workbench shows, not
	// something worth spending a glyph's worth of canvas on.
	if (node.addons?.ai !== undefined) {
		badges.push({ kind: 'ai', glyph: NODE_ADDON_REGISTRY.ai.glyph, label: 'AI node' });
	}

	const fileCount = (node.content ?? []).filter((block) => block.type === 'file').length;
	if (fileCount > 0) {
		badges.push({
			kind: 'attachments',
			glyph: ATTACHMENT_GLYPH,
			label: fileCount === 1 ? '1 attachment' : `${fileCount} attachments`,
			count: fileCount
		});
	}

	return badges;
}
