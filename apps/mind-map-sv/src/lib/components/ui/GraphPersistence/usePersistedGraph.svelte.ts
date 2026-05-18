import type { MultigraphData } from '$lib/components/ui/types/multigraph';
import {
	GraphPersistenceController,
	statusToNotice,
	type GraphPersistenceControllerDeps
} from '$lib/graphPersistenceController';

export type PersistedGraph = {
	readonly graph: MultigraphData;
	readonly graphSummaries: ReturnType<GraphPersistenceController['getView']>['graphSummaries'];
	readonly loadedGraphId: string;
	readonly notice: string;
	load: GraphPersistenceController['load'];
	notifyGraphChanged: GraphPersistenceController['notifyGraphChanged'];
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
		get graphSummaries() {
			return view.graphSummaries;
		},
		get loadedGraphId() {
			return view.loadedGraphId;
		},
		get notice() {
			return statusToNotice(view.status);
		},
		load: controller.load.bind(controller),
		notifyGraphChanged: controller.notifyGraphChanged.bind(controller),
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
