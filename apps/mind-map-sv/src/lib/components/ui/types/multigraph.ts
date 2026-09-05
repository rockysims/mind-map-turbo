import type { EdgeData } from './edge';
import type { NodeData } from './node';

export type Point = {
	x: number;
	y: number;
};

export interface TagColorConfig {
	nodeTags: Record<string, string>;
	edgeTags: Record<string, string>;
}

export type TagColorNamespace = keyof TagColorConfig;

export interface GraphAssetMetadata {
	id: string;
	/**
	 * What the asset is *for*, not what it is: the MIME type says PNG, the kind
	 * says whether the node renders it inline or offers it as a download. A PNG
	 * attached through Add file is `'file'` with an `image/png` MIME type.
	 */
	kind: 'image' | 'file';
	mimeType: string;
	name?: string;
	size: number;
	createdAt: number;
}

export interface MultigraphData {
	nodes: NodeData[];
	edges: EdgeData[];
	posByNodeId: Record<string, Point>;
	tagColorConfig: TagColorConfig;
	assets?: Record<string, GraphAssetMetadata>;
	/** Highest pin-recency stamp issued so far (see NodeData.lastPinnedSeq). */
	pinSequence?: number;
}
