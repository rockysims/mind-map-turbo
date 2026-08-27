export interface NodeImageContent {
	type: 'image';
	assetId: string;
	alt: string;
	caption?: string;
}

export type NodeContentBlock = NodeImageContent;

export interface NodeData {
	id: string;
	title: string;
	description: string;
	tags: string[];
	pinned?: boolean;
	/** Pin-recency stamp from the graph-level pinSequence counter; higher = more recent. */
	lastPinnedSeq?: number;
	content?: NodeContentBlock[];
}
