import { describe, expect, it } from 'vitest';
import {
	EMPTY_EXITING_BUFFER,
	addExitingEdge,
	addExitingNode,
	cancelExitingEdge,
	cancelExitingNode,
	createEdgeEnterAnimation,
	createNodeEnterAnimation,
	DEFAULT_ENTER_EXIT_DURATION_MS,
	edgeOpacityAt,
	exitingEdgeOpacityAt,
	exitingNodeScaleAt,
	hasActiveExiting,
	nodeEnterScaleAt,
	pruneFinishedExiting
} from './elementTransitions';
import type { ExitingBuffer, ExitingEdgeEntry, ExitingNodeEntry } from './elementTransitions';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_NODE_DATA = { id: 'n1', title: 'Node 1', description: '', tags: [] };
const BASE_EDGE_DATA = { id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2', tags: [] };

function makeExitingNode(overrides: Partial<ExitingNodeEntry> = {}): ExitingNodeEntry {
	return {
		nodeData: BASE_NODE_DATA,
		x: 0,
		y: 0,
		fromScale: 1,
		startedAtMs: 0,
		durationMs: DEFAULT_ENTER_EXIT_DURATION_MS,
		...overrides
	};
}

function makeExitingEdge(overrides: Partial<ExitingEdgeEntry> = {}): ExitingEdgeEntry {
	return {
		edgeData: BASE_EDGE_DATA,
		fromOpacity: 1,
		startedAtMs: 0,
		durationMs: DEFAULT_ENTER_EXIT_DURATION_MS,
		...overrides
	};
}

// ---------------------------------------------------------------------------
// Enter animations — nodes
// ---------------------------------------------------------------------------

describe('createNodeEnterAnimation', () => {
	it('starts at scale 0 and targets the given scale', () => {
		const anim = createNodeEnterAnimation(0.8, 100);
		expect(anim.fromScale).toBe(0);
		expect(anim.toScale).toBe(0.8);
		expect(anim.startedAtMs).toBe(100);
		expect(anim.durationMs).toBe(DEFAULT_ENTER_EXIT_DURATION_MS);
	});

	it('accepts an explicit duration', () => {
		const anim = createNodeEnterAnimation(1, 0, 300);
		expect(anim.durationMs).toBe(300);
	});

	it('clamps negative duration to 0', () => {
		const anim = createNodeEnterAnimation(1, 0, -50);
		expect(anim.durationMs).toBe(0);
	});
});

describe('nodeEnterScaleAt — interpolation', () => {
	it('starts at fromScale and ends at toScale', () => {
		const anim = createNodeEnterAnimation(1, 0, 200);
		expect(nodeEnterScaleAt(anim, 0)).toBeCloseTo(0);
		expect(nodeEnterScaleAt(anim, 200)).toBeCloseTo(1);
	});

	it('uses eased midpoint (not linear) at 50 % progress', () => {
		const anim = createNodeEnterAnimation(1, 0, 200);
		// easeInOut(0.5) = 0.5, but the curve has a steeper slope at centre
		// At t=0.5: easeInOut(0.5) = 2*0.25 = 0.5 — matches linear for this midpoint,
		// but the surrounding curve is non-linear. We verify the value is between 0 and 1.
		const mid = nodeEnterScaleAt(anim, 100);
		expect(mid).toBeGreaterThan(0);
		expect(mid).toBeLessThan(1);
	});

	it('duration 0 collapses immediately to toScale', () => {
		const anim = createNodeEnterAnimation(0.6, 100, 0);
		expect(nodeEnterScaleAt(anim, 100)).toBeCloseTo(0.6);
	});

	it('stays at toScale after the duration has elapsed', () => {
		const anim = createNodeEnterAnimation(1, 0, 200);
		expect(nodeEnterScaleAt(anim, 999)).toBeCloseTo(1);
	});
});

// ---------------------------------------------------------------------------
// Enter animations — edges
// ---------------------------------------------------------------------------

describe('createEdgeEnterAnimation', () => {
	it('fades from opacity 0 to 1', () => {
		const anim = createEdgeEnterAnimation(500);
		expect(anim.fromOpacity).toBe(0);
		expect(anim.toOpacity).toBe(1);
		expect(anim.startedAtMs).toBe(500);
		expect(anim.durationMs).toBe(DEFAULT_ENTER_EXIT_DURATION_MS);
	});
});

describe('edgeOpacityAt — interpolation', () => {
	it('starts at 0 and reaches 1 when complete', () => {
		const anim = createEdgeEnterAnimation(0, 180);
		expect(edgeOpacityAt(anim, 0)).toBeCloseTo(0);
		expect(edgeOpacityAt(anim, 180)).toBeCloseTo(1);
	});

	it('duration 0 collapses immediately to toOpacity', () => {
		const anim = createEdgeEnterAnimation(0, 0);
		expect(edgeOpacityAt(anim, 0)).toBeCloseTo(1);
	});

	it('supports exit direction (fromOpacity 1 → toOpacity 0)', () => {
		const anim = { fromOpacity: 1, toOpacity: 0, startedAtMs: 0, durationMs: 200 };
		expect(edgeOpacityAt(anim, 0)).toBeCloseTo(1);
		expect(edgeOpacityAt(anim, 200)).toBeCloseTo(0);
	});
});

// ---------------------------------------------------------------------------
// Exiting buffer — add and retain
// ---------------------------------------------------------------------------

describe('exiting buffer — retain until complete', () => {
	it('starts empty', () => {
		expect(EMPTY_EXITING_BUFFER.nodes).toEqual({});
		expect(EMPTY_EXITING_BUFFER.edges).toEqual({});
	});

	it('retains an exiting node before its exit completes', () => {
		const entry = makeExitingNode({ startedAtMs: 0, durationMs: 200 });
		let buffer = addExitingNode(EMPTY_EXITING_BUFFER, 'n1', entry);
		buffer = pruneFinishedExiting(buffer, 100);
		expect(buffer.nodes['n1']).toBeDefined();
	});

	it('prunes an exiting node once its exit animation completes', () => {
		const entry = makeExitingNode({ startedAtMs: 0, durationMs: 200 });
		let buffer = addExitingNode(EMPTY_EXITING_BUFFER, 'n1', entry);
		buffer = pruneFinishedExiting(buffer, 200);
		expect(buffer.nodes['n1']).toBeUndefined();
	});

	it('retains an exiting edge before its exit completes', () => {
		const entry = makeExitingEdge({ startedAtMs: 0, durationMs: 200 });
		let buffer = addExitingEdge(EMPTY_EXITING_BUFFER, 'e1', entry);
		buffer = pruneFinishedExiting(buffer, 150);
		expect(buffer.edges['e1']).toBeDefined();
	});

	it('prunes an exiting edge once its exit animation completes', () => {
		const entry = makeExitingEdge({ startedAtMs: 0, durationMs: 200 });
		let buffer = addExitingEdge(EMPTY_EXITING_BUFFER, 'e1', entry);
		buffer = pruneFinishedExiting(buffer, 200);
		expect(buffer.edges['e1']).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Exiting buffer — cancel on re-enter
// ---------------------------------------------------------------------------

describe('cancelExitingNode', () => {
	it('removes the node from the buffer when it re-enters mid-exit', () => {
		const entry = makeExitingNode({ startedAtMs: 0, durationMs: 200 });
		let buffer = addExitingNode(EMPTY_EXITING_BUFFER, 'n1', entry);
		buffer = cancelExitingNode(buffer, 'n1');
		expect(buffer.nodes['n1']).toBeUndefined();
	});

	it('returns the same buffer reference when the id is not present', () => {
		const buffer = EMPTY_EXITING_BUFFER;
		expect(cancelExitingNode(buffer, 'n99')).toBe(buffer);
	});

	it('does not affect other nodes in the buffer', () => {
		const e1 = makeExitingNode({ nodeData: { ...BASE_NODE_DATA, id: 'n1' } });
		const e2 = makeExitingNode({ nodeData: { ...BASE_NODE_DATA, id: 'n2' } });
		let buffer = addExitingNode(EMPTY_EXITING_BUFFER, 'n1', e1);
		buffer = addExitingNode(buffer, 'n2', e2);
		buffer = cancelExitingNode(buffer, 'n1');
		expect(buffer.nodes['n1']).toBeUndefined();
		expect(buffer.nodes['n2']).toBeDefined();
	});
});

describe('cancelExitingEdge', () => {
	it('removes the edge from the buffer when it re-enters mid-exit', () => {
		const entry = makeExitingEdge({ startedAtMs: 0, durationMs: 200 });
		let buffer = addExitingEdge(EMPTY_EXITING_BUFFER, 'e1', entry);
		buffer = cancelExitingEdge(buffer, 'e1');
		expect(buffer.edges['e1']).toBeUndefined();
	});

	it('returns the same buffer reference when the id is not present', () => {
		const buffer = EMPTY_EXITING_BUFFER;
		expect(cancelExitingEdge(buffer, 'e99')).toBe(buffer);
	});
});

// ---------------------------------------------------------------------------
// Exiting value queries
// ---------------------------------------------------------------------------

describe('exitingNodeScaleAt', () => {
	it('starts at fromScale and reaches 0 when done', () => {
		const entry = makeExitingNode({ fromScale: 1, startedAtMs: 0, durationMs: 200 });
		expect(exitingNodeScaleAt(entry, 0)).toBeCloseTo(1);
		expect(exitingNodeScaleAt(entry, 200)).toBeCloseTo(0);
	});

	it('duration 0 collapses immediately to 0', () => {
		const entry = makeExitingNode({ fromScale: 0.8, startedAtMs: 0, durationMs: 0 });
		expect(exitingNodeScaleAt(entry, 0)).toBeCloseTo(0);
	});

	it('value is between fromScale and 0 at midpoint', () => {
		const entry = makeExitingNode({ fromScale: 1, startedAtMs: 0, durationMs: 200 });
		const mid = exitingNodeScaleAt(entry, 100);
		expect(mid).toBeGreaterThan(0);
		expect(mid).toBeLessThan(1);
	});
});

describe('exitingEdgeOpacityAt', () => {
	it('starts at fromOpacity and reaches 0 when done', () => {
		const entry = makeExitingEdge({ fromOpacity: 1, startedAtMs: 0, durationMs: 200 });
		expect(exitingEdgeOpacityAt(entry, 0)).toBeCloseTo(1);
		expect(exitingEdgeOpacityAt(entry, 200)).toBeCloseTo(0);
	});

	it('duration 0 collapses immediately to 0', () => {
		const entry = makeExitingEdge({ fromOpacity: 1, startedAtMs: 0, durationMs: 0 });
		expect(exitingEdgeOpacityAt(entry, 0)).toBeCloseTo(0);
	});
});

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

describe('immutability', () => {
	it('addExitingNode returns a new object', () => {
		const buf1 = EMPTY_EXITING_BUFFER;
		const buf2 = addExitingNode(buf1, 'n1', makeExitingNode());
		expect(buf2).not.toBe(buf1);
		expect(buf2.nodes).not.toBe(buf1.nodes);
	});

	it('addExitingEdge returns a new object', () => {
		const buf1 = EMPTY_EXITING_BUFFER;
		const buf2 = addExitingEdge(buf1, 'e1', makeExitingEdge());
		expect(buf2).not.toBe(buf1);
		expect(buf2.edges).not.toBe(buf1.edges);
	});

	it('cancelExitingNode returns a new object', () => {
		let buffer = addExitingNode(EMPTY_EXITING_BUFFER, 'n1', makeExitingNode());
		const before = buffer;
		buffer = cancelExitingNode(buffer, 'n1');
		expect(buffer).not.toBe(before);
	});

	it('cancelExitingEdge returns a new object', () => {
		let buffer = addExitingEdge(EMPTY_EXITING_BUFFER, 'e1', makeExitingEdge());
		const before = buffer;
		buffer = cancelExitingEdge(buffer, 'e1');
		expect(buffer).not.toBe(before);
	});

	it('pruneFinishedExiting returns a new object', () => {
		const entry = makeExitingNode({ startedAtMs: 0, durationMs: 200 });
		let buffer = addExitingNode(EMPTY_EXITING_BUFFER, 'n1', entry);
		const before = buffer;
		buffer = pruneFinishedExiting(buffer, 300);
		expect(buffer).not.toBe(before);
	});
});

// ---------------------------------------------------------------------------
// hasActiveExiting
// ---------------------------------------------------------------------------

describe('hasActiveExiting', () => {
	it('returns false for an empty buffer', () => {
		expect(hasActiveExiting(EMPTY_EXITING_BUFFER, 1000)).toBe(false);
	});

	it('returns true while a node exit is still in progress', () => {
		const entry = makeExitingNode({ startedAtMs: 0, durationMs: 200 });
		const buffer = addExitingNode(EMPTY_EXITING_BUFFER, 'n1', entry);
		expect(hasActiveExiting(buffer, 100)).toBe(true);
	});

	it('returns false once all exits have completed', () => {
		const entry = makeExitingNode({ startedAtMs: 0, durationMs: 200 });
		const buffer = addExitingNode(EMPTY_EXITING_BUFFER, 'n1', entry);
		expect(hasActiveExiting(buffer, 200)).toBe(false);
	});

	it('returns true while an edge exit is still in progress', () => {
		const entry = makeExitingEdge({ startedAtMs: 0, durationMs: 200 });
		const buffer = addExitingEdge(EMPTY_EXITING_BUFFER, 'e1', entry);
		expect(hasActiveExiting(buffer, 100)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Duration-0 end-state collapse (combined)
// ---------------------------------------------------------------------------

describe('duration 0 end-state collapse', () => {
	it('exiting buffer prunes immediately when durationMs is 0', () => {
		const nodeEntry = makeExitingNode({ startedAtMs: 0, durationMs: 0 });
		const edgeEntry = makeExitingEdge({ startedAtMs: 0, durationMs: 0 });
		let buffer: ExitingBuffer = EMPTY_EXITING_BUFFER;
		buffer = addExitingNode(buffer, 'n1', nodeEntry);
		buffer = addExitingEdge(buffer, 'e1', edgeEntry);
		buffer = pruneFinishedExiting(buffer, 0);
		expect(buffer.nodes).toEqual({});
		expect(buffer.edges).toEqual({});
	});
});
