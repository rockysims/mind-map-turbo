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
	}
};

/** True when `name` is an entry in the registry, narrowing it to that union. */
export function isRegisteredAddon(name: string): name is NodeAddonName {
	return Object.prototype.hasOwnProperty.call(NODE_ADDON_REGISTRY, name);
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
	}
}
