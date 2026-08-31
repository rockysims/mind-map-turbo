/**
 * What a graph commit says about itself, so the history can record it.
 *
 * Required, not optional: a new commit path added later should be a type error
 * at the call site rather than an unlabelled entry discovered in the UI.
 */
export type GraphCommitIntent = {
	/**
	 * What the undo control and the status notice name — 'delete node', read as
	 * 'Undo delete node' and 'Undid "delete node".'. Lowercase, no trailing stop:
	 * the surfaces around it supply the sentence.
	 */
	label: string;
	/**
	 * The canvas-local state a restore has to put back beside the graph, captured
	 * as of *after* this commit. `MultigraphData` holds neither, and both change
	 * what is on screen: the primary node anchors the layout, and the beacon hint
	 * steers which node an orphaned component is held on screen by.
	 */
	primaryNodeId: string;
	severedBeaconPreference: string[];
	/**
	 * Marks this commit as part of a run that should land as one entry — a colour
	 * swatch scrubbing through `oninput`. Consecutive commits sharing a key
	 * replace the run's newest state instead of pushing beside it, so the entry
	 * keeps the before-state the run started from.
	 */
	coalesceKey?: string;
	/**
	 * Closes the run named by `coalesceKey`, so a later commit with the same key
	 * starts a fresh entry rather than folding into this one. The colour swatch's
	 * `change` event is the only thing that sends it: without it, two separate
	 * scrubs of the same tag minutes apart would collapse into a single undo.
	 */
	endsCoalesceRun?: boolean;
};
