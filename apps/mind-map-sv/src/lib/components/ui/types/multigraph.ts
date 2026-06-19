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

export interface MultigraphData {
	nodes: NodeData[];
	edges: EdgeData[];
	posByNodeId: Record<string, Point>;
	tagColorConfig: TagColorConfig;
}
