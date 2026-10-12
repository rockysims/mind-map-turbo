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

/**
 * Per-tag layout factors, keyed exactly like `TagColorConfig`. An edge tag's
 * factor scales the rest length of every edge that carries it; a node tag's
 * scales the clearance hop repulsion holds open around every node that carries
 * it. Sparse: only factors other than 1 are stored, and `Multigraph/lib/tagPhysics.ts`
 * owns their range and how several tags on one element combine.
 */
export interface TagPhysicsConfig {
	nodeTags: Record<string, number>;
	edgeTags: Record<string, number>;
}

export interface GraphAssetMetadata {
	id: string;
	/**
	 * What the asset is *for*, not what it is: the MIME type says PNG, the kind
	 * says whether the node renders it inline or offers it as a download. The
	 * MIME type decides, not the button that added it, so a PNG picked through
	 * Add file is still `'image'`; `'file'` is what everything else becomes.
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
	/**
	 * Absent until a factor is set, and removed again once both maps are empty,
	 * so a graph that never touched a slider serialises exactly as before.
	 */
	tagPhysicsConfig?: TagPhysicsConfig;
	assets?: Record<string, GraphAssetMetadata>;
	/** Highest pin-recency stamp issued so far (see NodeData.lastPinnedSeq). */
	pinSequence?: number;
}
