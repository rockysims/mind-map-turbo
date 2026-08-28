export interface NodeImageContent {
	type: 'image';
	assetId: string;
	alt: string;
	caption?: string;
}

export type NodeContentBlock = NodeImageContent;

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
	/** Quantities the user confirmed this node consumes. Absent means none. */
	inputs?: QuantityDesignation[];
	/** Quantities the user confirmed this node defines. Absent means none. */
	outputs?: QuantityDesignation[];
}
