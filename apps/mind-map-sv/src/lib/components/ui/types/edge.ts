export interface EdgeData {
	id: string;
	sourceNodeId: string;
	targetNodeId: string;
	tags: string[];
	directed?: boolean;
}
