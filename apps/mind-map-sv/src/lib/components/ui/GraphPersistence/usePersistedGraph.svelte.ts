import type { MultigraphData } from '$lib/components/ui/types/multigraph';
import type { DocumentStatus } from '$lib/documentStatus';
import type { ViewState } from '$lib/migrations';
import {
	GraphPersistenceController,
	controllerNotice,
	type GraphPersistenceControllerDeps
} from '$lib/graphPersistenceController';

export type PersistedGraph = {
	readonly graph: MultigraphData;
	readonly viewState: ViewState;
	readonly graphGeneration: number;
	readonly graphSummaries: ReturnType<GraphPersistenceController['getView']>['graphSummaries'];
	readonly loadedGraphId: string;
	readonly documentStatus: DocumentStatus;
	readonly notice: string;
	load: GraphPersistenceController['load'];
	loadEmbeddedDocument: GraphPersistenceController['loadEmbeddedDocument'];
	notifyGraphChanged: (data: MultigraphData, options?: { syncView?: boolean }) => void;
	notifyViewStateChanged: (viewState: ViewState, options?: { syncView?: boolean }) => void;
	exportGraphDocument: GraphPersistenceController['exportGraphDocument'];
	importGraphDocument: GraphPersistenceController['importGraphDocument'];
	importGraphDocumentFromReader: GraphPersistenceController['importGraphDocumentFromReader'];
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
		get graphSummaries() {
			return view.graphSummaries;
		},
		get loadedGraphId() {
			return view.loadedGraphId;
		},
		get documentStatus() {
			return view.documentStatus;
		},
		get notice() {
			return controllerNotice(view);
		},
		load: controller.load.bind(controller),
		loadEmbeddedDocument: controller.loadEmbeddedDocument.bind(controller),
		notifyGraphChanged: controller.notifyGraphChanged.bind(controller),
		notifyViewStateChanged: controller.notifyViewStateChanged.bind(controller),
		exportGraphDocument: controller.exportGraphDocument.bind(controller),
		importGraphDocument: controller.importGraphDocument.bind(controller),
		importGraphDocumentFromReader: controller.importGraphDocumentFromReader.bind(controller),
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
