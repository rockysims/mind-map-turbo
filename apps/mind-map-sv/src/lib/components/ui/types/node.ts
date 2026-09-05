export interface NodeImageContent {
	type: 'image';
	assetId: string;
	alt: string;
	caption?: string;
}

export type NodeContentBlock = NodeImageContent;

/**
 * Data the `!task` add-on carries. `doneAt` is an epoch-ms stamp of the moment
 * the task was marked done; it is absent while the task is not done.
 */
export interface TaskAddon {
	done: boolean;
	doneAt?: number;
}

/**
 * The add-ons a node carries, one optional field per entry in the closed
 * registry in `Multigraph/lib/nodeAddons.ts`. Add-ons are capabilities, not
 * labels: each is typed on its own rather than living as a string in `tags`.
 */
export interface NodeAddons {
	task?: TaskAddon;
}

/**
 * A quantity the user confirmed as this node's input or output, stored as the
 * structural identity (base + subscript) rather than the canonical symbol key —
 * the key embeds a NUL separator that has no business in a save file.
 */
export interface QuantityDesignation {
	base: string;
	subscript: string | null;
}

export interface NodeData {
	id: string;
	title: string;
	description: string;
	tags: string[];
	pinned?: boolean;
	/** Pin-recency stamp from the graph-level pinSequence counter; higher = more recent. */
	lastPinnedSeq?: number;
	content?: NodeContentBlock[];
	/** Registered add-ons this node carries. Absent means none. */
	addons?: NodeAddons;
	/** Quantities the user confirmed this node consumes. Absent means none. */
	inputs?: QuantityDesignation[];
	/** Quantities the user confirmed this node defines. Absent means none. */
	outputs?: QuantityDesignation[];
}
