import type { MultigraphData } from '$lib/components/ui/types/multigraph';
import type { DocumentStatus } from '$lib/documentStatus';
import type { ViewState } from '$lib/migrations';
import {
	GraphPersistenceController,
	controllerNotice,
	controllerNoticeSeverity,
	type GraphPersistenceControllerDeps,
	type SnapshotSummary
} from '$lib/graphPersistenceController';

export type PersistedGraph = {
	readonly graph: MultigraphData;
	readonly viewState: ViewState;
	readonly graphGeneration: number;
	/** Bumped when the loaded document is mutated in place; see `ControllerView`. */
	readonly graphRevision: number;
	readonly graphSummaries: ReturnType<GraphPersistenceController['getView']>['graphSummaries'];
	readonly loadedGraphId: string;
	readonly documentStatus: DocumentStatus;
	/** The revert offer standing over this graph, refreshed on load and by every revert path. */
	readonly snapshot: SnapshotSummary | null;
	readonly draftCached: boolean;
	readonly notice: string;
	readonly noticeSeverity: 'info' | 'warning';
	load: GraphPersistenceController['load'];
	loadEmbeddedDocument: GraphPersistenceController['loadEmbeddedDocument'];
	notifyGraphChanged: (data: MultigraphData, options?: { syncView?: boolean }) => void;
	notifyViewStateChanged: (viewState: ViewState, options?: { syncView?: boolean }) => void;
	exportGraphDocument: GraphPersistenceController['exportGraphDocument'];
	importGraphDocument: GraphPersistenceController['importGraphDocument'];
	importGraphDocumentFromReader: GraphPersistenceController['importGraphDocumentFromReader'];
	importGraphIntoCurrent: GraphPersistenceController['importGraphIntoCurrent'];
	importGraphIntoCurrentFromReader: GraphPersistenceController['importGraphIntoCurrentFromReader'];
	revertToSnapshot: GraphPersistenceController['revertToSnapshot'];
	dismissSnapshot: GraphPersistenceController['dismissSnapshot'];
	selectGraph: GraphPersistenceController['selectGraph'];
	createGraph: GraphPersistenceController['createGraph'];
	deleteGraph: GraphPersistenceController['deleteGraph'];
	handleStorageEvent: GraphPersistenceController['handleStorageEvent'];
	dispose: GraphPersistenceController['dispose'];
};

export function usePersistedGraph(deps: GraphPersistenceControllerDeps): PersistedGraph {
	const controller = new GraphPersistenceController(deps);
	let view = $state(controller.getView());

	const unsubscribe = controller.subscribe((nextView) => {
		view = nextView;
	});

	return {
		get graph() {
			return view.graph;
		},
		get viewState() {
			return view.viewState;
		},
		get graphGeneration() {
			return view.graphGeneration;
		},
		get graphRevision() {
			return view.graphRevision;
		},
		get graphSummaries() {
			return view.graphSummaries;
		},
		get loadedGraphId() {
			return view.loadedGraphId;
		},
		get documentStatus() {
			return view.documentStatus;
		},
		get snapshot() {
			return view.snapshot;
		},
		get draftCached() {
			return view.draftCached;
		},
		get notice() {
			return controllerNotice(view);
		},
		get noticeSeverity() {
			return controllerNoticeSeverity(view);
		},
		load: controller.load.bind(controller),
		loadEmbeddedDocument: controller.loadEmbeddedDocument.bind(controller),
		notifyGraphChanged: controller.notifyGraphChanged.bind(controller),
		notifyViewStateChanged: controller.notifyViewStateChanged.bind(controller),
		exportGraphDocument: controller.exportGraphDocument.bind(controller),
		importGraphDocument: controller.importGraphDocument.bind(controller),
		importGraphDocumentFromReader: controller.importGraphDocumentFromReader.bind(controller),
		importGraphIntoCurrent: controller.importGraphIntoCurrent.bind(controller),
		importGraphIntoCurrentFromReader: controller.importGraphIntoCurrentFromReader.bind(controller),
		revertToSnapshot: controller.revertToSnapshot.bind(controller),
		dismissSnapshot: controller.dismissSnapshot.bind(controller),
		selectGraph: controller.selectGraph.bind(controller),
		createGraph: controller.createGraph.bind(controller),
		deleteGraph: controller.deleteGraph.bind(controller),
		handleStorageEvent: controller.handleStorageEvent.bind(controller),
		dispose: () => {
			unsubscribe();
			controller.dispose();
		}
	};
}
