<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import type { EdgeData } from '../types/edge';
	import type { GraphAssetMetadata, WeightConfig } from '../types/multigraph';
	import type {
		NodeContentBlock,
		NodeData,
		NodeFileContent,
		NodeImageContent,
		QuantityDesignation
	} from '../types/node';
	import { APP_CONFIG } from '$lib/appConfig';
	import { prefersReducedMotion } from '$lib/reducedMotion';
	import MathText from '../MathText/MathText.svelte';
	import { hasMath } from '../MathText/lib/mathSegments';
	import { mathPlainText } from '../MathText/lib/mathPlainText';
	import type { QuantitySymbol } from '../MathText/lib/mathSymbols';
	import { normalizeNodeTitle, type EdgePatch } from './lib/graph';
	import { attachmentSizeWarning } from './lib/attachmentSizeWarning';
	import { formatByteSize } from './lib/byteSize';
	import { weightFromDraft, weightName } from './lib/nodeWeight';
	import { draftChangesNode, type NodeEditDraft } from './lib/nodeEditDraft';
	import { isRegisteredAddon, NODE_ADDON_REGISTRY, type NodeAddonName } from './lib/nodeAddons';
	import { normalizeTagList } from './lib/titleSyntax';
	import { nodeQuantities } from './lib/nodeQuantities';
	import { cycleDesignation, designateAs, designationView } from './lib/quantityDesignations';
	import {
		applyInsertion,
		insertionFor,
		serializeSymbol,
		type TextSelection
	} from './lib/quantityTextInsertion';
	import { symbolFor } from '../MathText/lib/mathSymbols';
	import QuantityDesignationChips from './QuantityDesignationChips.svelte';

	type ActiveTab = 'node' | 'edges';
	type DirectionChoice = 'undirected' | 'outgoing' | 'incoming';

	let {
		node,
		nodes,
		edges,
		assets = {},
		weightConfig,
		onSave,
		onAddAttachment,
		onSaveImage,
		onSaveFile,
		onMoveAttachment,
		onDeleteAttachment,
		onToggleAddon,
		onSaveEdge,
		onCancel,
		onTogglePinned,
		onDelete,
		confirmAttachment = (message: string) => window.confirm(message),
		warnBytesPerFile = APP_CONFIG.multigraph.attachments.warnBytesPerFile,
		chipInsertHoldMs = APP_CONFIG.multigraph.dataflow.chipInsertLongPressMs
	}: {
		node: NodeData;
		nodes: NodeData[];
		edges: EdgeData[];
		assets?: Record<string, GraphAssetMetadata>;
		/** How the graph names its nodes' weight; absent labels the field "Weight". */
		weightConfig?: WeightConfig;
		onSave: (content: NodeEditDraft) => void;
		/**
		 * Store one picked file. The MIME type decides what it becomes, so both
		 * upload buttons hand the file to the same callback and a PNG picked
		 * through Add file is still an image.
		 */
		onAddAttachment?: (file: File) => Promise<'added' | 'store-failed'>;
		onSaveImage?: (assetId: string, details: { alt: string; caption?: string }) => void;
		onSaveFile?: (assetId: string, details: { caption?: string }) => void;
		/** Indices are into the node's whole content list, not the images in it. */
		onMoveAttachment?: (fromIndex: number, direction: -1 | 1) => void;
		onDeleteAttachment?: (assetId: string) => void;
		onToggleAddon?: (name: NodeAddonName, enabled: boolean) => void;
		onSaveEdge: (edgeId: string, patch: EdgePatch) => void;
		onCancel: () => void;
		onTogglePinned: () => void;
		onDelete: () => void;
		/**
		 * Asks before attaching a file over the per-file size threshold. Injectable
		 * so a story can answer it; a size warning rather than a destructive
		 * confirm, which is why it stays after milestone 12 made undo the safety
		 * net for the destructive ones.
		 */
		confirmAttachment?: (message: string) => boolean;
		/** File size over which `confirmAttachment` is asked. A test pins it. */
		warnBytesPerFile?: number;
		/**
		 * How long a hold on a quantity chip has to last before its symbol is
		 * written into the text. Handed down from the graph's resolved config rather
		 * than read here, so the setting reaches the gesture; the default is the
		 * shipped constant, for the stories that pass nothing.
		 */
		chipInsertHoldMs?: number;
	} = $props();

	let activeTab = $state<ActiveTab>('node');
	let title = $state('');
	let description = $state('');
	let nodeTags = $state('');
	let draftInputs = $state<QuantityDesignation[]>([]);
	let draftOutputs = $state<QuantityDesignation[]>([]);
	/**
	 * The weight field as typed, kept as text rather than bound as a number: a
	 * number binding reads blank and unreadable alike as `null`, and the save
	 * has to tell "cleared" (remove the weight) from "could not read" (keep it).
	 */
	let weightText = $state('');
	let weightBadInput = $state(false);
	let edgeTagTextById = $state<Record<string, string>>({});
	let attachmentDraftByAssetId = $state<Record<string, { alt: string; caption: string }>>({});
	let attachmentStatus = $state('');
	let titleInput = $state<HTMLInputElement | null>(null);
	let descriptionInput = $state<HTMLTextAreaElement | null>(null);
	let insertStatus = $state('');

	type TextField = 'title' | 'description';

	/**
	 * Where a written quantity goes: the field the author last had a cursor in, and
	 * where in it. One record, not one per field — an insertion only ever targets
	 * the last active field, so remembering both would be storing an answer nobody
	 * asks for.
	 *
	 * Starts at the end of the title because that is where the sheet puts focus on
	 * open, so a session that touches neither field still has a real target rather
	 * than a guess.
	 */
	let caret = $state<{ field: TextField; selection: TextSelection }>({
		field: 'title',
		selection: { start: 0, end: 0 }
	});

	/**
	 * The quantities whose role this authoring session has already settled, by
	 * inferring one or by the author cycling the chip themselves.
	 *
	 * Nothing renders from it, so its reactivity is incidental — `SvelteSet` is
	 * here because the house rule bans a mutable plain `Set` in a component, and
	 * being reactive costs nothing when no template reads it. Not saved either: one
	 * edit-sheet opening is one session, so unmounting discards it and Save,
	 * Cancel, Close, and a node change all start fresh with no reset callback.
	 */
	let roleSettled = new SvelteSet<string>();
	let reduceMotion = $derived(prefersReducedMotion());
	const weightField = $derived(weightName(weightConfig));
	// Only surface the preview once the draft actually contains math, so nodes
	// without any keep the compact form the sheet has today.
	const descriptionHasMath = $derived(hasMath(description));

	/**
	 * Suggestions come off the *draft*, not the saved node, so a quantity can be
	 * confirmed in the same pass that introduces it. Re-parsing on every keystroke
	 * is affordable because the math render cache absorbs the repeats — the same
	 * reason the preview above can re-render as you type.
	 */
	const draftQuantities = $derived(
		nodeQuantities({
			title: normalizeNodeTitle(title),
			description,
			tags: normalizeTagList(nodeTags)
		})
	);
	const designations = $derived(designationView(draftQuantities, draftInputs, draftOutputs));

	const incidentEdges = $derived(
		edges.filter((edge) => edge.sourceNodeId === node.id || edge.targetNodeId === node.id)
	);
	/**
	 * Every attachment in one list, in the order the node stores them.
	 *
	 * Images and files share the list rather than getting one each, because the
	 * reorder buttons move a block within `node.content` — so the index a row
	 * hands back has to be its index there. Two filtered lists would each count
	 * from zero and move the wrong block as soon as a node carried both kinds.
	 */
	const attachmentBlocks = $derived(node.content ?? []);

	const addonEntries = Object.keys(NODE_ADDON_REGISTRY)
		// A type guard rather than a cast: `Object.keys` widens to `string[]`, and
		// the registry's own membership test narrows each key back to its union.
		.filter(isRegisteredAddon)
		.map((name) => ({ name, label: NODE_ADDON_REGISTRY[name].label }));

	$effect(() => {
		title = node.title;
		description = node.description;
		nodeTags = node.tags.join(' ');
		draftInputs = node.inputs ?? [];
		draftOutputs = node.outputs ?? [];
		weightText = node.weight === undefined ? '' : String(node.weight);
		weightBadInput = false;
		// `node.title`, never the `title` draft this effect just wrote: reading the
		// draft would make the effect depend on it, so every keystroke would re-run
		// the reset and throw the edit away.
		const end = node.title.length;
		caret = { field: 'title', selection: { start: end, end } };
		roleSettled = new SvelteSet();
		insertStatus = '';
		requestAnimationFrame(() => {
			// Placed, not assumed, and in both places it is recorded. Focusing fires
			// the handler that reads the cursor back, which overwrites the assignment
			// above with wherever the browser chose to put it — the end of the value
			// in Chromium, but that is a default rather than a promise, and
			// `setSelectionRange` fires no event to correct the record. Setting the
			// selection and then restating it is what makes "a session that touches
			// neither field appends to the title" true rather than lucky.
			const field = titleInput;
			if (field === null) return;
			field.focus();
			field.setSelectionRange(end, end);
			caret = { field: 'title', selection: { start: end, end } };
		});
	});

	$effect(() => {
		const currentTagText = untrack(() => edgeTagTextById);
		edgeTagTextById = Object.fromEntries(
			incidentEdges.map((edge) => [edge.id, currentTagText[edge.id] ?? edge.tags.join(' ')])
		);
	});

	$effect(() => {
		const currentDrafts = untrack(() => attachmentDraftByAssetId);
		attachmentDraftByAssetId = Object.fromEntries(
			attachmentBlocks.map((block) => [
				block.assetId,
				currentDrafts[block.assetId] ?? {
					alt: block.type === 'image' ? block.alt : '',
					caption: block.caption ?? ''
				}
			])
		);
	});

	/** The drafted fields as Save stores them. */
	function draftContent(): NodeEditDraft {
		const weight = weightFromDraft(weightText, weightBadInput);
		return {
			title: normalizeNodeTitle(title),
			description,
			tags: normalizeTagList(nodeTags),
			inputs: draftInputs,
			outputs: draftOutputs,
			// Left out, not passed as `undefined`, when the field could not be read:
			// the save then keeps the stored weight.
			...(weight === undefined ? {} : { weight })
		};
	}

	function save() {
		onSave(draftContent());
	}

	/**
	 * Clicking away saves, the way the inline title commits on blur — the owner's
	 * 2026-10-12 ruling. It is Save's own save, with Save's rules (an empty title
	 * becomes the fallback title, an unreadable weight keeps the stored one), so
	 * the two can never disagree about what a draft means.
	 *
	 * An untouched sheet only closes. Saving it would commit a copy of the node
	 * that the undo history then has to recognise and drop, and would kick a
	 * layout relax for an edit nobody made; not committing at all is simpler
	 * than relying on that. Escape, Close and Cancel still discard.
	 */
	function saveOnClickAway() {
		const draft = draftContent();
		if (draftChangesNode(node, draft)) onSave(draft);
		else onCancel();
	}

	function editWeight(event: Event & { currentTarget: HTMLInputElement }) {
		weightBadInput = event.currentTarget.validity.badInput;
		// Unreadable text reports its value as `''`. Writing that back to the state
		// the field's `value` follows would wipe what the reader is still typing
		// ("1e" on the way to "1e3"), so the last readable text is kept instead.
		if (!weightBadInput) weightText = event.currentTarget.value;
	}

	function cycle(symbol: QuantitySymbol, suggestedRole?: 'input' | 'output') {
		// The author has stated a preference, so nothing inferred later may argue
		// with it. Recorded before the change, since what matters is that they acted
		// on this quantity at all, not where the cycle happened to land it.
		roleSettled.add(symbol.key);
		const next = cycleDesignation(
			{ inputs: draftInputs, outputs: draftOutputs },
			symbol,
			suggestedRole
		);
		draftInputs = next.inputs;
		draftOutputs = next.outputs;
	}

	function fieldElement(field: TextField): HTMLInputElement | HTMLTextAreaElement | null {
		return field === 'title' ? titleInput : descriptionInput;
	}

	/**
	 * Say something in the live region, even when it is what was just said.
	 *
	 * A live region announces changes, not assignments, so writing the same
	 * sentence twice reaches the reader once — and writing one symbol repeatedly is
	 * how an equation gets built, so the repeat is the common case rather than the
	 * odd one. Clearing first and letting that reach the DOM makes the second
	 * insertion a change again. Focus is already in the field by then, so this
	 * region is the only thing that reports the insertion at all.
	 */
	function announce(message: string) {
		insertStatus = '';
		// Deliberately not awaited by the caller: the insertion is finished either
		// way, and the announcement is allowed to land a frame later.
		tick().then(() => {
			insertStatus = message;
		});
	}

	/** Where this field's cursor is now, so a later insertion can go back to it. */
	function rememberCaret(field: TextField, event: Event) {
		// Bound to the field itself, so `currentTarget` is that control; TS only
		// knows it as an EventTarget.
		const element = event.currentTarget as HTMLInputElement | HTMLTextAreaElement;
		caret = {
			field,
			selection: {
				start: element.selectionStart ?? element.value.length,
				end: element.selectionEnd ?? element.value.length
			}
		};
	}

	/**
	 * Every event that can move a cursor without going through the others. `focus`
	 * covers arriving, `select` a drag or a select-all, `keyup` the arrow keys, and
	 * `pointerup` a click that places the caret mid-word.
	 */
	function caretHandlers(field: TextField) {
		const remember = (event: Event) => rememberCaret(field, event);
		return {
			onfocus: remember,
			onselect: remember,
			oninput: remember,
			onkeyup: remember,
			onpointerup: remember
		};
	}

	function keyOf(designation: QuantityDesignation): string {
		return symbolFor(designation.base, designation.subscript).key;
	}

	/**
	 * The role the parser would now give this quantity, having just been handed the
	 * insertion.
	 *
	 * Deliberately the same question `designationView` asks to place a ghost, and
	 * the same one a tap enters the cycle at — asked of the whole draft rather than
	 * of the equation the symbol landed in. A second reading of "which side of the
	 * equals is it on" could disagree with the chip the author is looking at, and
	 * an automatic decision that contradicts the visible suggestion is worse than
	 * no decision at all.
	 */
	function roleAfterInsertion(
		symbol: QuantitySymbol,
		nextTitle: string,
		nextDescription: string
	): 'input' | 'output' | null {
		const parsed = nodeQuantities({
			title: normalizeNodeTitle(nextTitle),
			description: nextDescription,
			tags: normalizeTagList(nodeTags)
		});
		if (parsed.defines.some((definition) => definition.symbol.key === symbol.key)) return 'output';
		if (parsed.references.some((reference) => reference.key === symbol.key)) return 'input';
		return null;
	}

	/**
	 * Accept the parser's suggestion for a quantity nobody has decided about yet.
	 *
	 * Three conditions, and the middle one is the important one: a symbol already
	 * sitting in either column has been confirmed, and re-deciding it would let
	 * "write this symbol" quietly move a designation the author asked for — taking
	 * its dataflow edge with it. A stale chip needs no help here anyway, since the
	 * insertion alone puts its symbol back in the text and clears the flag.
	 */
	function settleRole(symbol: QuantitySymbol, nextTitle: string, nextDescription: string) {
		if (roleSettled.has(symbol.key)) return;
		const decided = [...draftInputs, ...draftOutputs].some(
			(designation) => keyOf(designation) === symbol.key
		);
		if (decided) return;
		const role = roleAfterInsertion(symbol, nextTitle, nextDescription);
		// No role means nothing was learned, so the opportunity is not spent: the
		// next insertion of this symbol into a real equation still gets its chance.
		if (role === null) return;
		const next = designateAs({ inputs: draftInputs, outputs: draftOutputs }, symbol, role);
		draftInputs = next.inputs;
		draftOutputs = next.outputs;
		roleSettled.add(symbol.key);
	}

	/**
	 * Write one quantity into the field the author last had a cursor in.
	 *
	 * Through the field's own editing command rather than by assigning the bound
	 * state: an assignment wipes that control's native undo stack, so Cmd/Ctrl+Z
	 * after an insertion would do nothing or jump back to a much older value, and
	 * the author's only recovery would be deleting it by hand or cancelling the
	 * whole edit. `insertText` also places the caret for us and fires the `input`
	 * event the binding listens for.
	 */
	function insertQuantity(symbol: QuantitySymbol) {
		const source = serializeSymbol(symbol);
		if (source === null) {
			// Better to decline than to write source the parser reads back as a
			// different quantity, which the author has no way of noticing.
			announce(`${symbol.label} cannot be written as text.`);
			return;
		}

		const field = caret.field;
		const element = fieldElement(field);
		if (element === null) return;

		const text = element.value;
		const selection = {
			start: Math.min(caret.selection.start, text.length),
			end: Math.min(caret.selection.end, text.length)
		};
		const { insert } = insertionFor(text, selection, source);

		const expected = applyInsertion(text, selection, insert);
		element.focus();
		element.setSelectionRange(selection.start, selection.end);
		try {
			document.execCommand('insertText', false, insert);
		} catch {
			// Fall through to the check below, which is the real test either way.
		}
		// The return value is not trustworthy: the command reports success and then
		// does nothing when the browsing context is not the focused one, which is
		// the norm in a headless test run and happens in a background tab. So the
		// text itself is what decides whether the fallback is needed.
		if (element.value !== expected.text) {
			// Undo is lost on this path, which is the whole reason it is the fallback.
			element.value = expected.text;
			element.dispatchEvent(new Event('input', { bubbles: true }));
			element.setSelectionRange(expected.caret, expected.caret);
		}

		caret = {
			field,
			selection: {
				start: element.selectionStart ?? element.value.length,
				end: element.selectionEnd ?? element.value.length
			}
		};

		// Read off the element rather than the bound state: this is the value that
		// definitely reflects the insertion, whatever the binding has done yet.
		settleRole(
			symbol,
			field === 'title' ? element.value : title,
			field === 'description' ? element.value : description
		);

		announce(`Wrote ${symbol.label} into the ${field}.`);
	}

	function saveEdgeTags(edge: EdgeData) {
		onSaveEdge(edge.id, { tags: normalizeTagList(edgeTagTextById[edge.id] ?? '') });
	}

	/**
	 * Both upload buttons land here. The file's own type decides what it becomes,
	 * so the only difference between them is the `accept` filter — which is what
	 * keeps Add image offering a phone's camera.
	 */
	async function addSelectedAttachment(event: Event) {
		// Svelte types currentTarget broadly, but this handler is attached to the file input.
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || !onAddAttachment) return;
		attachmentStatus = '';

		if (file.size > warnBytesPerFile && !confirmAttachment(attachmentSizeWarning(file))) {
			attachmentStatus = 'Attachment cancelled.';
			input.value = '';
			return;
		}

		const result = await onAddAttachment(file);
		attachmentStatus = result === 'added' ? 'Attachment added.' : 'Unable to store attachment.';
		input.value = '';
	}

	function draftFor(block: NodeContentBlock): { alt: string; caption: string } {
		return (
			attachmentDraftByAssetId[block.assetId] ?? {
				alt: block.type === 'image' ? block.alt : '',
				caption: block.caption ?? ''
			}
		);
	}

	function editDraft(assetId: string, patch: Partial<{ alt: string; caption: string }>) {
		const current = attachmentDraftByAssetId[assetId] ?? { alt: '', caption: '' };
		attachmentDraftByAssetId = {
			...attachmentDraftByAssetId,
			[assetId]: { ...current, ...patch }
		};
	}

	/** An empty caption is absent rather than blank, so it never reaches a save file. */
	function captionOf(draft: { caption: string }): string | undefined {
		return draft.caption.trim() ? draft.caption : undefined;
	}

	function saveImage(image: NodeImageContent) {
		const draft = draftFor(image);
		onSaveImage?.(image.assetId, { alt: draft.alt, caption: captionOf(draft) });
	}

	function saveFile(file: NodeFileContent) {
		onSaveFile?.(file.assetId, { caption: captionOf(draftFor(file)) });
	}

	/**
	 * Applied straight away, the way Pin and the attachment controls are, rather
	 * than waiting for Save: an add-on is a capability the node either has or
	 * does not, not text being drafted. No confirm on the way off — milestone
	 * 12's undo is the safety net, and the commit says which add-on it removed.
	 */
	function toggleAddon(name: NodeAddonName, enabled: boolean) {
		onToggleAddon?.(name, enabled);
	}

	function labelFor(block: NodeContentBlock): string {
		if (block.type === 'file') return block.name;
		return assets[block.assetId]?.name ?? block.assetId;
	}

	function edgeTagsFor(edge: EdgeData): string[] {
		return normalizeTagList(edgeTagTextById[edge.id] ?? '');
	}

	function moveEdgeTag(edge: EdgeData, index: number, direction: -1 | 1) {
		const tags = edgeTagsFor(edge);
		const nextIndex = index + direction;
		if (nextIndex < 0 || nextIndex >= tags.length) return;

		const reordered = [...tags];
		[reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
		edgeTagTextById = {
			...edgeTagTextById,
			[edge.id]: reordered.join(' ')
		};
		onSaveEdge(edge.id, { tags: reordered });
	}

	function saveEdgeDirection(edge: EdgeData, direction: DirectionChoice) {
		const neighborId = otherEndpoint(edge);
		if (!neighborId) return;

		if (direction === 'undirected') {
			onSaveEdge(edge.id, { directed: false });
			return;
		}

		onSaveEdge(edge.id, {
			sourceNodeId: direction === 'outgoing' ? node.id : neighborId,
			targetNodeId: direction === 'outgoing' ? neighborId : node.id,
			directed: true
		});
	}

	function directionFor(edge: EdgeData): DirectionChoice {
		if (edge.directed !== true) return 'undirected';
		return edge.sourceNodeId === node.id ? 'outgoing' : 'incoming';
	}

	function parseDirectionChoice(value: string): DirectionChoice {
		if (value === 'outgoing' || value === 'incoming') return value;
		return 'undirected';
	}

	function otherEndpoint(edge: EdgeData): string | null {
		if (edge.sourceNodeId === node.id) return edge.targetNodeId;
		if (edge.targetNodeId === node.id) return edge.sourceNodeId;
		return null;
	}

	/**
	 * Projected: every use of this is a label naming which edge a control acts on,
	 * both on screen and in the accessible name. None of them is an editing
	 * surface, so none of them wants LaTeX source.
	 */
	function neighborTitle(edge: EdgeData): string {
		const neighborId = otherEndpoint(edge);
		const title = nodes.find((candidate) => candidate.id === neighborId)?.title;
		return title === undefined ? 'Unknown node' : mathPlainText(title);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onCancel();
	}
</script>

<div class="sheet-layer" role="presentation" onkeydown={handleKeydown}>
	<button
		class="sheet-backdrop"
		type="button"
		aria-label="Save and close"
		data-sheet-backdrop
		onclick={saveOnClickAway}
	></button>
	<div
		class="node-edit-sheet"
		class:reduced-motion={reduceMotion}
		role="dialog"
		aria-modal="true"
		aria-labelledby="node-edit-sheet-title"
	>
		<header>
			<div>
				<p class="eyebrow">Editing node</p>
				<h2 id="node-edit-sheet-title" aria-label={mathPlainText(node.title)}>
					<MathText text={node.title} singleLine />
				</h2>
			</div>
			<button type="button" class="secondary" onclick={onCancel}>Close</button>
		</header>

		<div class="tabs" role="tablist" aria-label="Edit node and edges">
			<button
				type="button"
				role="tab"
				aria-selected={activeTab === 'node'}
				aria-controls="node-edit-tabpanel"
				id="node-edit-tab"
				class:active={activeTab === 'node'}
				onclick={() => (activeTab = 'node')}
			>
				Node
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={activeTab === 'edges'}
				aria-controls="edge-edit-tabpanel"
				id="edge-edit-tab"
				class:active={activeTab === 'edges'}
				onclick={() => (activeTab = 'edges')}
			>
				Edges
			</button>
		</div>

		{#if activeTab === 'node'}
			<div
				id="node-edit-tabpanel"
				role="tabpanel"
				aria-labelledby="node-edit-tab"
				class="tabpanel"
				tabindex="0"
			>
				<label>
					Title
					<input
						bind:this={titleInput}
						bind:value={title}
						name="title"
						{...caretHandlers('title')}
					/>
				</label>

				<label>
					Description
					<textarea
						bind:this={descriptionInput}
						bind:value={description}
						name="description"
						rows="6"
						{...caretHandlers('description')}
					></textarea>
				</label>

				{#if descriptionHasMath}
					<section class="math-preview" aria-label="Math preview" data-math-preview>
						<h3>Preview</h3>
						<div class="math-preview-body"><MathText text={description} /></div>
					</section>
				{/if}

				<QuantityDesignationChips
					mode="edit"
					view={designations}
					onCycle={cycle}
					onInsert={insertQuantity}
					insertHoldMs={chipInsertHoldMs}
				/>

				<!--
					Focus has just moved into the text field, so a screen reader that only
					announces the newly focused control would say nothing about what was
					written or where.
				-->
				<p class="visually-hidden" role="status" data-insert-status>{insertStatus}</p>

				<label>
					Node tags
					<input bind:value={nodeTags} name="node-tags" placeholder="abc urgent" />
				</label>

				<!--
					Last of the fields Save saves, so the drafted ones stay together above
					the add-ons and attachments, which apply the moment they are touched.
					The unit sits outside the label so the field's name is the graph's
					label alone; it is read out as part of the description instead.
				-->
				<div class="weight-field" data-weight-field>
					<label for="node-edit-weight">{weightField.label}</label>
					<div class="weight-row">
						<input
							id="node-edit-weight"
							name="weight"
							type="number"
							min="0"
							step="any"
							inputmode="decimal"
							value={weightText}
							oninput={editWeight}
							aria-describedby={weightField.unit === undefined
								? 'node-edit-weight-hint'
								: 'node-edit-weight-unit node-edit-weight-hint'}
						/>
						{#if weightField.unit !== undefined}
							<span id="node-edit-weight-unit" class="weight-unit" data-weight-unit
								>{weightField.unit}</span
							>
						{/if}
					</div>
					<p id="node-edit-weight-hint" class="field-hint">
						Drawn as border thickness when the graph's border source is Node weight.
					</p>
				</div>

				<fieldset class="addons-group" data-addons-group>
					<legend>Add-ons</legend>
					{#each addonEntries as entry (entry.name)}
						<label class="addon-toggle">
							<input
								type="checkbox"
								name={`addon-${entry.name}`}
								checked={node.addons?.[entry.name] !== undefined}
								onchange={(event) => toggleAddon(entry.name, event.currentTarget.checked)}
							/>
							{entry.label}
						</label>
					{/each}
				</fieldset>

				<section class="attachments-panel" aria-label="Attachments">
					<div class="attachments-header">
						<h3>Attachments</h3>
						<div class="attachment-uploads">
							<label class="attachment-upload">
								Add image
								<input type="file" accept="image/*" onchange={addSelectedAttachment} />
							</label>
							<label class="attachment-upload">
								Add file
								<input type="file" onchange={addSelectedAttachment} />
							</label>
						</div>
					</div>

					{#if attachmentBlocks.length === 0}
						<p class="empty-state">No attachments.</p>
					{:else}
						<ol class="attachment-list" aria-label="Attached files">
							{#each attachmentBlocks as block, index (block.assetId)}
								{@const asset = assets[block.assetId]}
								{@const draft = draftFor(block)}
								<li data-attachment-kind={block.type} data-attachment-asset-id={block.assetId}>
									<div class="attachment-meta">
										<strong data-attachment-name>{labelFor(block)}</strong>
										<span data-attachment-type>{asset?.mimeType ?? block.type}</span>
										<span data-attachment-size>{formatByteSize(asset?.size ?? 0)}</span>
									</div>
									{#if block.type === 'image'}
										<label>
											Alt text
											<input
												value={draft.alt}
												oninput={(event) =>
													editDraft(block.assetId, { alt: event.currentTarget.value })}
											/>
										</label>
									{/if}
									<label>
										Caption
										<input
											value={draft.caption}
											oninput={(event) =>
												editDraft(block.assetId, { caption: event.currentTarget.value })}
										/>
									</label>
									<div class="attachment-actions">
										<button
											type="button"
											class="secondary"
											disabled={index === 0}
											aria-label={`Move ${labelFor(block)} earlier`}
											onclick={() => onMoveAttachment?.(index, -1)}
										>
											Up
										</button>
										<button
											type="button"
											class="secondary"
											disabled={index === attachmentBlocks.length - 1}
											aria-label={`Move ${labelFor(block)} later`}
											onclick={() => onMoveAttachment?.(index, 1)}
										>
											Down
										</button>
										{#if block.type === 'image'}
											<button type="button" class="secondary" onclick={() => saveImage(block)}>
												Save image
											</button>
										{:else}
											<button type="button" class="secondary" onclick={() => saveFile(block)}>
												Save file
											</button>
										{/if}
										<button
											type="button"
											class="danger"
											aria-label={`Remove ${labelFor(block)}`}
											onclick={() => onDeleteAttachment?.(block.assetId)}
										>
											Remove
										</button>
									</div>
								</li>
							{/each}
						</ol>
					{/if}

					{#if attachmentStatus}
						<p class="attachment-status" role="status">{attachmentStatus}</p>
					{/if}
				</section>

				<div class="actions">
					<button type="button" class="secondary" onclick={onTogglePinned}>
						{node.pinned ? 'Unpin' : 'Pin'}
					</button>
					<button type="button" class="danger" onclick={onDelete}>Delete</button>
					<button type="button" class="secondary" onclick={onCancel}>Cancel</button>
					<button type="button" class="primary" onclick={save}>Save</button>
				</div>
			</div>
		{:else}
			<div
				id="edge-edit-tabpanel"
				role="tabpanel"
				aria-labelledby="edge-edit-tab"
				class="tabpanel edges-tab"
				tabindex="0"
			>
				{#if incidentEdges.length === 0}
					<p class="empty-state">No connected edges yet.</p>
				{:else}
					{#each incidentEdges as edge (edge.id)}
						{@const neighbor = neighborTitle(edge)}
						<div class="edge-row" data-edit-edge-id={edge.id}>
							<div>
								<p class="edge-neighbor">Connected to {neighbor}</p>
								<p class="edge-id">{edge.id}</p>
							</div>

							<label>
								Direction for {neighbor}
								<select
									value={directionFor(edge)}
									onchange={(event) =>
										saveEdgeDirection(edge, parseDirectionChoice(event.currentTarget.value))}
								>
									<option value="undirected">Undirected</option>
									<option value="outgoing">From this node</option>
									<option value="incoming">To this node</option>
								</select>
							</label>

							<label>
								Edge tags for {neighbor}
								<input
									name={`edge-tags-${edge.id}`}
									value={edgeTagTextById[edge.id] ?? ''}
									placeholder="rel strong"
									oninput={(event) =>
										(edgeTagTextById = {
											...edgeTagTextById,
											[edge.id]: event.currentTarget.value
										})}
								/>
							</label>

							{#if edgeTagsFor(edge).length > 0}
								<ol class="edge-tag-list" aria-label={`Ordered edge tags for ${neighbor}`}>
									{#each edgeTagsFor(edge) as tag, index (`${edge.id}:${tag}:${index}`)}
										<li>
											<span>{tag}</span>
											<div class="edge-tag-actions">
												<button
													type="button"
													class="secondary"
													disabled={index === 0}
													aria-label={`Move edge tag ${tag} earlier`}
													onclick={() => moveEdgeTag(edge, index, -1)}
												>
													Up
												</button>
												<button
													type="button"
													class="secondary"
													disabled={index === edgeTagsFor(edge).length - 1}
													aria-label={`Move edge tag ${tag} later`}
													onclick={() => moveEdgeTag(edge, index, 1)}
												>
													Down
												</button>
											</div>
										</li>
									{/each}
								</ol>
							{/if}

							<button
								type="button"
								class="secondary edge-save"
								aria-label={`Save edge to ${neighbor}`}
								onclick={() => saveEdgeTags(edge)}
							>
								Save edge
							</button>
						</div>
					{/each}
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	.sheet-layer {
		position: absolute;
		inset: 0;
		z-index: 30;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		pointer-events: auto;
	}

	.sheet-backdrop {
		position: absolute;
		inset: 0;
		border: 0;
		background: rgb(15 23 42 / 24%);
		touch-action: none;
	}

	.node-edit-sheet {
		position: relative;
		z-index: 1;
		box-sizing: border-box;
		width: min(100%, 34rem);
		max-height: calc(100% - 2rem);
		overflow: auto;
		border-radius: 1rem 1rem 0 0;
		padding: 1rem;
		background: #ffffff;
		box-shadow: 0 -12px 40px rgb(0 0 0 / 22%);
		animation: sheet-in 160ms ease-out;
		/*
		 * `pan-y`, not the blanket `none` every other overlay here uses. Those are
		 * surfaces that must swallow the gesture whole; this one is a scroll
		 * container, and `none` meant a finger could not reach the fields below the
		 * fold at all. Horizontal panning and pinch stay disabled, so the canvas
		 * underneath is no more reachable than it was.
		 */
		touch-action: pan-y;
	}

	header,
	.actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	header {
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	h2,
	.eyebrow,
	.edge-neighbor,
	.edge-id,
	.empty-state {
		margin: 0;
	}

	.eyebrow,
	.edge-id {
		color: #64748b;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.tabs {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.tabs button {
		background: #e2e8f0;
		color: #0f172a;
	}

	.tabs button.active {
		background: #0f172a;
		color: #ffffff;
	}

	.tabpanel {
		display: grid;
		gap: 0.875rem;
	}

	label {
		display: grid;
		gap: 0.375rem;
		color: #334155;
		font-weight: 600;
	}

	input,
	select,
	textarea {
		box-sizing: border-box;
		width: 100%;
		border: 1px solid #cbd5e1;
		border-radius: 0.625rem;
		padding: 0.625rem 0.75rem;
		font: inherit;
	}

	.actions {
		justify-content: flex-end;
		flex-wrap: wrap;
	}

	.weight-field {
		display: grid;
		gap: 0.375rem;
	}

	.weight-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.weight-row input {
		flex: 1;
		min-width: 0;
		min-height: 44px;
	}

	.weight-unit {
		color: #475569;
	}

	.field-hint {
		margin: 0;
		color: #64748b;
		font-size: 0.8125rem;
	}

	.math-preview {
		display: grid;
		gap: 0.5rem;
		border: 1px solid #e2e8f0;
		border-radius: 0.875rem;
		padding: 0.875rem;
		background: #f8fafc;
	}

	.math-preview h3 {
		margin: 0;
		color: #475569;
		font-size: 0.8125rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.math-preview-body {
		color: #0f172a;
		line-height: 1.65;
	}

	.edges-tab {
		max-height: min(60vh, 28rem);
		overflow: auto;
		padding-right: 0.125rem;
		/* Its own scroll container nested in the sheet's, so it needs the rule too. */
		touch-action: pan-y;
	}

	.edge-row {
		display: grid;
		gap: 0.75rem;
		border: 1px solid #e2e8f0;
		border-radius: 0.875rem;
		padding: 0.875rem;
	}

	.edge-neighbor {
		color: #0f172a;
		font-weight: 700;
	}

	.edge-tag-list {
		display: grid;
		gap: 0.5rem;
		padding: 0;
		margin: 0;
		list-style: none;
	}

	.attachments-panel,
	.attachment-list {
		display: grid;
		gap: 0.75rem;
	}

	.attachments-header,
	.attachment-uploads,
	.attachment-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.attachments-header {
		justify-content: space-between;
		flex-wrap: wrap;
	}

	.attachments-header h3,
	.attachment-status {
		margin: 0;
	}

	.attachment-upload {
		display: inline-flex;
		min-height: 44px;
		align-items: center;
		border-radius: 999px;
		padding: 0.625rem 0.875rem;
		background: #e2e8f0;
		color: #0f172a;
		font-weight: 400;
		cursor: pointer;
	}

	.attachment-upload input,
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}

	.attachment-list {
		padding: 0;
		margin: 0;
		list-style: none;
	}

	.attachment-list li {
		display: grid;
		gap: 0.625rem;
		border: 1px solid #e2e8f0;
		border-radius: 0.75rem;
		padding: 0.75rem;
	}

	.attachment-meta {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		color: #475569;
	}

	.attachment-actions {
		justify-content: flex-end;
		flex-wrap: wrap;
	}

	.addons-group {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.75rem;
		border: 1px solid #e2e8f0;
		border-radius: 0.875rem;
		padding: 0.75rem 0.875rem;
	}

	.addons-group legend {
		padding: 0 0.375rem;
		color: #475569;
		font-size: 0.8125rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.addon-toggle {
		display: inline-flex;
		min-height: 44px;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
	}

	.addon-toggle input {
		width: 1.125rem;
		height: 1.125rem;
	}

	.edge-tag-list li,
	.edge-tag-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.edge-tag-list li {
		justify-content: space-between;
		padding: 0.5rem;
		border: 1px solid #e2e8f0;
		border-radius: 0.75rem;
	}

	.edge-tag-list span {
		font-weight: 700;
	}

	.edge-save {
		justify-self: stretch;
	}

	button {
		min-height: 44px;
		border: 0;
		border-radius: 999px;
		padding: 0.625rem 0.875rem;
		font: inherit;
	}

	.primary {
		background: #0f172a;
		color: #ffffff;
	}

	.secondary {
		background: #e2e8f0;
		color: #0f172a;
	}

	.danger {
		background: #fee2e2;
		color: #991b1b;
	}

	@media (min-width: 640px) {
		.sheet-layer {
			align-items: center;
		}

		.node-edit-sheet {
			border-radius: 1rem;
			box-shadow: 0 20px 60px rgb(0 0 0 / 24%);
		}
	}

	.node-edit-sheet.reduced-motion {
		animation: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.node-edit-sheet {
			animation: none;
		}
	}

	@keyframes sheet-in {
		from {
			transform: translateY(1rem);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}
</style>
