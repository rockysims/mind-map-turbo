/**
 * The closed registry of node add-ons.
 *
 * `#` and `@` name tags the user invents; `!` picks one entry from this
 * registry. An add-on is a capability rather than a label, so each entry owns a
 * typed shape on `NodeData.addons` and a default for the moment it is created.
 * Only names listed here are consumed as markers — an unregistered `!word`
 * stays in the title as plain text.
 */

import type { NodeAddons } from '../../types/node';

/** The name of a registered add-on — the word after the `!` marker. */
export type NodeAddonName = keyof NodeAddons;

interface NodeAddonEntry<Name extends NodeAddonName> {
	/** Human-readable name for the edit sheet's toggle. */
	label: string;
	/** Single-character badge glyph for the canvas. */
	glyph: string;
	/** The data a freshly created add-on starts with. */
	createDefault: () => NonNullable<NodeAddons[Name]>;
}

type NodeAddonRegistry = { [Name in NodeAddonName]: NodeAddonEntry<Name> };

export const NODE_ADDON_REGISTRY: NodeAddonRegistry = {
	task: {
		label: 'Task',
		glyph: '☐',
		createDefault: () => ({ done: false })
	},
	ai: {
		label: 'AI',
		// A four-pointed star rather than a robot or a sparkle emoji: it draws in
		// the same monochrome text weight as the task box, so a node carrying both
		// shows two glyphs of one family instead of a box beside a colour picture.
		glyph: '✦',
		createDefault: () => ({ prompt: '', runs: [], promoted: {} })
	}
};

/** True when `name` is an entry in the registry, narrowing it to that union. */
export function isRegisteredAddon(name: string): name is NodeAddonName {
	return Object.prototype.hasOwnProperty.call(NODE_ADDON_REGISTRY, name);
}

/**
 * The words Undo uses for an add-on toggle, e.g. "remove task add-on".
 *
 * Built from the registry label rather than written at the call site, so a new
 * entry names itself in the history list without the toggle knowing about it.
 */
export function addonIntentLabel(name: NodeAddonName, action: 'add' | 'remove'): string {
	return `${action} ${NODE_ADDON_REGISTRY[name].label.toLowerCase()} add-on`;
}

/**
 * Returns `addons` with `name` present at its registry default, leaving an
 * add-on that is already there untouched (its data outlives a re-typed marker).
 *
 * The switch is exhaustive on purpose: a new registry entry has to add its case
 * here, which is what keeps the per-add-on types honest without a cast.
 */
export function withNodeAddon(addons: NodeAddons | undefined, name: NodeAddonName): NodeAddons {
	switch (name) {
		case 'task':
			return { ...addons, task: addons?.task ?? NODE_ADDON_REGISTRY.task.createDefault() };
		case 'ai':
			return { ...addons, ai: addons?.ai ?? NODE_ADDON_REGISTRY.ai.createDefault() };
	}
}
