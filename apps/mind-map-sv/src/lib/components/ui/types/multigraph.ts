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
	kind: 'image';
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
