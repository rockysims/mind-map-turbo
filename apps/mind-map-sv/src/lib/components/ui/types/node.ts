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
	content?: NodeContentBlock[];
}
