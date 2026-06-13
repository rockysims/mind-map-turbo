export interface EdgeData {
	id: string;
	sourceNodeId: string;
	targetNodeId: string;
	color: string;
	tags: string[];
	directed?: boolean;
}
