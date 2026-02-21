import type { EdgeData } from "./edge";
import type { NodeData } from "./node";

export type Point = {
	x: number;
	y: number;
};

export interface MultigraphData {
	nodes: NodeData[],
	edges: EdgeData[],
	posByNodeId: Record<string, Point>
};
