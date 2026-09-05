<script lang="ts">
	import { SvelteMap } from 'svelte/reactivity';
	import type { GraphAssetStore } from '$lib/assets/assetStore';
	import MathText from '../MathText/MathText.svelte';
	import type { GraphAssetMetadata } from '../types/multigraph';
	import type {
		NodeData,
		NodeFileContent,
		NodeImageContent,
		QuantityDesignation
	} from '../types/node';
	import { formatByteSize } from './lib/byteSize';
	import type { NodeDiagnosticsView } from './lib/nodeDiagnosticsView';
	import type { NodeQuantities } from './lib/nodeQuantities';
	import type { QuantityIndexEntry } from './lib/quantityIndex';
	import type { QuantitySymbol } from '../MathText/lib/mathSymbols';
	import { designationView, type DesignationChip } from './lib/quantityDesignations';
	import {
		cascadesInChipOrder,
		closeBranch,
		closeCascadeIn,
		findCascade,
		isBranchOpen,
		openCascadeIn,
		parsePath,
		replaceCascade,
		serializePath,
		toggleBranch,
		type PeekCascade,
		type PeekCascades,
		type PeekDirection,
		type PeekPath
	} from './lib/peekCascade';
	import QuantityDesignationChips from './QuantityDesignationChips.svelte';
	import QuantityPeekCard from './QuantityPeekCard.svelte';

	const EMPTY_DIAGNOSTICS: NodeDiagnosticsView = { items: [], cycleNodeIds: [] };
	const EMPTY_QUANTITIES: NodeQuantities = { defines: [], references: [] };
	const EMPTY_DESIGNATIONS: readonly QuantityDesignation[] = [];

	/**
	 * One sentence per state, in the reader's vocabulary rather than the model's.
	 * "Confirm" is a word for something they were never shown; what they were
	 * shown is two columns of labels, so every repair here is described as
	 * labelling.
	 *
	 * Each line ends where its node buttons pick the sentence up, so the trailing
	 * preposition is load-bearing.
	 */
	const DIAGNOSTIC_TEXT = {
		unresolved: 'is not defined anywhere',
		// Nothing to name and nowhere to go: the equation is on this node's own
		// surface, so the sentence finishes itself — and says which rule read it as
		// a definition, since that rule is the one thing the reader cannot see.
		'self-unconfirmed':
			'is labeled as an input, but this node’s math defines it (alone on the left of “=”)',
		// The related-node buttons finish the sentence by naming who wrote it, so
		// the copy ends on "in" rather than restating the node names in prose.
		unconfirmed: 'is written but not labeled as an output in',
		// "Off screen" rather than "outside the visible area": the reader is being
		// told where to look, and it flows into the node button that follows.
		'out-of-view': 'is defined off screen, in',
		// Both say "differently" rather than "more than once", because agreeing
		// definitions are not reported at all and the copy should not imply they are.
		conflict: 'is defined differently by',
		'self-conflict': 'is defined more than one way in this node'
	} as const;

	/**
	 * The repair, named for what it does to the label that is already there. A
	 * writer nobody has decided about gets its first label; this node, which has
	 * the quantity filed under Inputs, gets that label moved.
	 */
	const DESIGNATE_TEXT = {
		unconfirmed: 'Label as output',
		'self-unconfirmed': 'Relabel as output'
	} as const;

	let {
		node,
		assets = {},
		assetStore = null,
		assetScope = '',
		diagnostics = EMPTY_DIAGNOSTICS,
		quantities = EMPTY_QUANTITIES,
		quantityEntryFor,
		inputsForNodeId = () => EMPTY_DESIGNATIONS,
		outputsForNodeId = () => EMPTY_DESIGNATIONS,
		titleForNodeId = (nodeId: string) => nodeId,
		currentNodeId,
		onCycleDesignation,
		onCreateDefiningNode,
		onConfirmDefiner,
		onJumpToNode,
		onToggleTaskDone
	}: {
		node: NodeData;
		assets?: Record<string, GraphAssetMetadata>;
		assetStore?: GraphAssetStore | null;
		assetScope?: string;
		/** What this node's math says about quantities it cannot resolve cleanly. */
		diagnostics?: NodeDiagnosticsView;
		/** What this node's text says it defines and mentions — the suggestion pool. */
		quantities?: NodeQuantities;
		/**
		 * The graph-wide record for one quantity, read only when a peek opens. A
		 * lookup rather than a map so nothing here depends on the whole index.
		 */
		quantityEntryFor?: (key: string) => QuantityIndexEntry | undefined;
		/**
		 * One node's confirmed inputs, for the drill line under each definer row.
		 * A lookup for the same reason `quantityEntryFor` is one, and it hands back
		 * the node's own array so the cards do no work per graph frame.
		 */
		inputsForNodeId?: (nodeId: string) => readonly QuantityDesignation[];
		/** A consumer's own confirmed outputs — what a downstream drill line offers. */
		outputsForNodeId?: (nodeId: string) => readonly QuantityDesignation[];
		titleForNodeId?: (nodeId: string) => string;
		/**
		 * The node these details belong to. A peek row for this node offers no way
		 * to go to it: the reader is already there, and a button that navigates
		 * nowhere reads as one that is broken.
		 */
		currentNodeId?: string;
		/**
		 * Advance one quantity around the assignment cycle — what a tap on a chip
		 * does here, exactly as it does in the edit sheet. Absent leaves the chips
		 * answering questions and changing nothing, which is what a surface with no
		 * graph behind it wants.
		 */
		onCycleDesignation?: (symbol: QuantitySymbol, suggestedRole?: 'input' | 'output') => void;
		/**
		 * The key rides along with the label so the new node can be seeded with the
		 * designation that makes it a definer — the label alone is display text.
		 */
		onCreateDefiningNode?: (
			quantityLabel: string,
			quantityKey: string,
			consumerNodeId?: string
		) => void;
		/**
		 * Designate a quantity as some *other* node's output — what an unconfirmed
		 * peek row and an unconfirmed diagnostic both offer. The key rather than the
		 * symbol, matching `onCreateDefiningNode`, so both callers hand over what
		 * they already hold.
		 */
		onConfirmDefiner?: (definerNodeId: string, quantityKey: string) => void;
		/**
		 * Leave for another node without pinning it. Every navigation offered here
		 * goes through this: a surface that reads is not a surface that edits, and
		 * pinning from a diagnostic would edit the graph behind a button that reads
		 * like a link.
		 */
		onJumpToNode?: (nodeId: string) => void;
		/**
		 * Mark this node's task done or not done. The details view is where the
		 * milestone puts the toggle: the canvas badge only reports, so that every
		 * tap over the graph stays available to drag and double-tap.
		 */
		onToggleTaskDone?: (done: boolean) => void;
	} = $props();

	/**
	 * One object URL per attachment, image or file, revoked together when the
	 * details view closes or its node changes.
	 *
	 * Files get theirs up front rather than on the press of Open, which is what
	 * lets Open be an `<a href>`: the blob lives in IndexedDB, so building the URL
	 * on demand means an `await` between the tap and the navigation, and that gap
	 * is exactly what mobile Safari's popup blocker and a `file://` page's
	 * `window.open` both refuse.
	 */
	let assetUrls = $state<Record<string, string>>({});
	/**
	 * Every peek card on screen, as one tree. This is the whole cascade's state:
	 * the cards themselves are presentational, because N cards each holding a
	 * document listener would race — every one of them stopping propagation, and
	 * the wrong one closing.
	 */
	let cascades = $state<PeekCascades>([]);
	/**
	 * The chip each cascade belongs to, so dismissing returns focus to it. Keyed by
	 * cascade id rather than held singly: several are open at once, and the one a
	 * dismissal has to return focus to is the one being dismissed.
	 */
	let peekAnchors = new SvelteMap<number, HTMLElement>();
	/**
	 * Ids increase with each open, which is what makes "the newest" answerable
	 * without a timestamp — and, being integers, what lets a card be found by
	 * selector when its quantity key cannot be.
	 */
	let nextCascadeId = 1;
	/**
	 * The card that should take focus, addressed by cascade and serialized path.
	 * Consumed and cleared by whichever card matches, or every later render would
	 * refocus it.
	 */
	let focusRequest = $state<{ cascadeId: number; path: string } | null>(null);
	/** The subtree the cards live in, for hit-testing a press against them. */
	let peekSection = $state<HTMLElement | null>(null);

	const designations = $derived(designationView(quantities, node.inputs, node.outputs));
	const hasDesignations = $derived(
		designations.inputs.length > 0 ||
			designations.outputs.length > 0 ||
			designations.suggestions.length > 0
	);
	/**
	 * Every chip on this surface, whichever column it sits in. A peek belongs to a
	 * quantity, not to a role — and since a tap now moves a chip between the
	 * columns, reading only the inputs would lose track of the card the reader
	 * has open the moment they cycle the chip that opened it.
	 */
	const designatedChips = $derived<DesignationChip[]>([
		...designations.inputs,
		...designations.outputs,
		...designations.suggestions
	]);
	/**
	 * Every key with a card open, so a chip reads as pressed while any of its
	 * cards is. A quantity confirmed both ways has two, and either one marks it.
	 */
	const peekKeys = $derived(new Set(cascades.map((cascade) => cascade.rootKey)));

	/** The cards of one column, ordered to sit under the chips they came from. */
	function columnCascades(direction: PeekDirection, chips: DesignationChip[]): PeekCascade[] {
		return cascadesInChipOrder(
			cascades,
			direction,
			chips.map((chip) => chip.symbol.key)
		);
	}

	const inputCascades = $derived(
		columnCascades('upstream', [
			...designations.inputs,
			...designations.suggestions.filter((chip) => chip.suggestedRole !== 'output')
		])
	);
	const outputCascades = $derived(
		columnCascades('downstream', [
			...designations.outputs,
			...designations.suggestions.filter((chip) => chip.suggestedRole === 'output')
		])
	);

	function labelFor(key: string): string {
		return designatedChips.find((chip) => chip.symbol.key === key)?.symbol.label ?? '';
	}

	// A card whose quantity leaves the node deliberately stays: the reader asked
	// the question, and a designation cycled off — here or anywhere else — is not
	// them withdrawing it. It keeps its column position until dismissed, which is
	// what makes a comparison survive an edit made while reading it.

	function openPeek(key: string, anchor: HTMLElement, direction: PeekDirection) {
		// A chip that reads as pressed has to un-press: the same gesture that asked
		// the question is how a reader takes it back. Scoped to this direction, so
		// the output chip of a quantity confirmed both ways does not close the card
		// its input chip opened.
		const open = findCascade(cascades, key, direction);
		if (open !== undefined) {
			closeCascade(open.id);
			return;
		}
		const id = nextCascadeId;
		nextCascadeId += 1;
		peekAnchors.set(id, anchor);
		cascades = openCascadeIn(cascades, id, key, direction);
		focusRequest = { cascadeId: id, path: '' };
	}

	function closeCascade(id: number) {
		cascades = closeCascadeIn(cascades, id);
		if (focusRequest?.cascadeId === id) focusRequest = null;
		const anchor = peekAnchors.get(id);
		peekAnchors.delete(id);
		anchor?.focus();
	}

	/**
	 * What a press outside the section does: drop the most recent card and leave
	 * the rest. Unwinding newest-first is how the reader built the comparison up,
	 * and one at a time is what stops a stray press costing the whole set.
	 */
	function closeNewest() {
		const newest = cascades.reduce<PeekCascade | null>(
			(latest, cascade) => (latest === null || cascade.id > latest.id ? cascade : latest),
			null
		);
		if (newest !== null) closeCascade(newest.id);
	}

	function toggleBranchAt(cascadeId: number, path: PeekPath) {
		const open = cascades.find((cascade) => cascade.id === cascadeId);
		if (open === undefined) return;
		const opening = !isBranchOpen(open, path);
		cascades = replaceCascade(cascades, toggleBranch(open, path));
		// Opening is the same gesture as opening the root card, so it lands the
		// reader inside the answer; closing leaves them on the chip they pressed.
		focusRequest = opening ? { cascadeId, path: serializePath(path) } : null;
	}

	/**
	 * The chip that opened the card at this path, within one cascade. It carries
	 * the same serialized path the card does, which is what makes this a lookup
	 * rather than a search: quantity keys embed a NUL, and `CSS.escape` turns that
	 * into U+FFFD rather than escaping it, so the raw key is not usable in a
	 * selector — but the cascade id is an integer and is.
	 */
	function drillChipFor(cascadeId: number, serializedPath: string): HTMLElement | null {
		// A descendant of the cascade's card rather than the same element: the chip
		// carries the path, the card carries the id, and a path is unique within one
		// cascade so the nearest enclosing card is enough to disambiguate.
		const found = peekSection?.querySelector(
			`[data-peek-cascade="${cascadeId}"] [data-peek-drill-path="${serializedPath}"]`
		);
		return found instanceof HTMLElement ? found : null;
	}

	// One listener pair for every card on screen, registered from inside the click
	// that opened the first, so that opening gesture's own press has been and
	// gone. One pair rather than one per card: N cards each stopping propagation
	// would race, and the wrong one would close.
	$effect(() => {
		if (cascades.length === 0) return;

		/**
		 * `click` rather than `pointerdown`, which is what this used to be.
		 *
		 * Dismissing on the press collapsed the cards while the reader's finger was
		 * still down, and everything below them — the diagnostics list's "Define",
		 * "Label as output" and node buttons — jumped up ~90px before the click was
		 * dispatched. The press landed on the button, the click landed on empty
		 * space, and the first tap on any of those controls did nothing.
		 *
		 * Capture phase, so this still runs before the button's own handler; the
		 * event's target was fixed when the dispatch began, so the layout moving
		 * during it cannot re-route the click. A drag that starts outside no longer
		 * dismisses, which is the better behaviour anyway.
		 */
		function onOutsideClick(event: MouseEvent) {
			const target = event.target;
			// Inside means the whole designation section — every chip and every card,
			// not just the clicked card and its own anchor. Scoped any tighter, a
			// press on a third chip would count as outside the second card and close
			// it on the way in, capping the reader at two cards forever.
			if (target instanceof Node && peekSection?.contains(target)) return;
			closeNewest();
		}

		function onKeyDown(event: KeyboardEvent) {
			if (event.key !== 'Escape') return;
			if (cascades.length === 0) return;
			// The focus overlay closes on Escape too, and dismissing a card is the
			// narrower intent while one is open.
			event.stopPropagation();

			// Deepest wins, read off the DOM rather than from a second copy of the
			// tree: the card holding focus is the one the reader is in. With focus
			// outside every card there is no "the one they are in", so the newest
			// goes — the same card an outside press would have taken.
			const active = document.activeElement;
			const holder = active instanceof Element ? active.closest('[data-peek-path]') : null;
			if (holder === null) {
				closeNewest();
				return;
			}
			const cascadeId = Number(holder.getAttribute('data-peek-cascade'));
			const serializedPath = holder.getAttribute('data-peek-path') ?? '';
			const open = cascades.find((cascade) => cascade.id === cascadeId);
			if (open === undefined) return;
			if (serializedPath === '') {
				closeCascade(cascadeId);
				return;
			}

			// Read the chip before the card goes, then hand the reader back to the
			// question they had just asked rather than to the top of the tab order.
			const chip = drillChipFor(cascadeId, serializedPath);
			cascades = replaceCascade(cascades, closeBranch(open, parsePath(serializedPath)));
			focusRequest = null;
			chip?.focus();
		}

		document.addEventListener('click', onOutsideClick, true);
		document.addEventListener('keydown', onKeyDown, true);
		return () => {
			document.removeEventListener('click', onOutsideClick, true);
			document.removeEventListener('keydown', onKeyDown, true);
		};
	});

	const imageBlocks = $derived(
		(node.content ?? []).filter((block): block is NodeImageContent => block.type === 'image')
	);
	const fileBlocks = $derived(
		(node.content ?? []).filter((block): block is NodeFileContent => block.type === 'file')
	);
	const taskAddon = $derived(node.addons?.task);

	$effect(() => {
		let cancelled = false;
		const urlsToRevoke: string[] = [];
		const blocks = [...imageBlocks, ...fileBlocks];
		async function loadAssets() {
			if (!assetStore || !assetScope) return;
			const loaded: Record<string, string> = {};
			for (const block of blocks) {
				const asset = await assetStore.get(assetScope, block.assetId);
				if (!asset.ok) continue;
				const url = URL.createObjectURL(asset.value.blob);
				urlsToRevoke.push(url);
				loaded[block.assetId] = url;
			}
			if (!cancelled) assetUrls = loaded;
		}
		void loadAssets();
		return () => {
			cancelled = true;
			for (const url of urlsToRevoke) URL.revokeObjectURL(url);
		};
	});
</script>

{#snippet peekCard(cascade: PeekCascade)}
	<QuantityPeekCard
		isRoot
		{cascade}
		entry={quantityEntryFor?.(cascade.rootKey)}
		label={labelFor(cascade.rootKey)}
		quantityKey={cascade.rootKey}
		{titleForNodeId}
		{inputsForNodeId}
		{outputsForNodeId}
		{quantityEntryFor}
		{currentNodeId}
		focusRequestPath={focusRequest?.cascadeId === cascade.id ? focusRequest.path : null}
		onFocusHandled={() => (focusRequest = null)}
		onToggleBranch={(path) => toggleBranchAt(cascade.id, path)}
		onJumpToNode={(nodeId) => {
			cascades = [];
			focusRequest = null;
			peekAnchors.clear();
			onJumpToNode?.(nodeId);
		}}
		{onCreateDefiningNode}
		{onConfirmDefiner}
		onClose={() => closeCascade(cascade.id)}
	/>
{/snippet}

<div class="focus-content" data-focus-zoom-scale="1">
	{#if taskAddon}
		<!--
			The whole row is the control, sized for a thumb. This is the surface the
			milestone puts the toggle on: the canvas badge reports and nothing more,
			so a tap over the graph never quietly changes the graph.
		-->
		<button
			type="button"
			class="task-toggle"
			data-task-toggle
			data-task-done={taskAddon.done ? 'true' : 'false'}
			aria-pressed={taskAddon.done}
			onclick={() => onToggleTaskDone?.(!taskAddon.done)}
		>
			<span class="task-box" aria-hidden="true">{taskAddon.done ? '☑' : '☐'}</span>
			<span class="task-label">{taskAddon.done ? 'Done' : 'Not done'}</span>
		</button>
	{/if}

	{#if node.description.trim()}
		<p class="description"><MathText text={node.description} /></p>
	{/if}

	{#if hasDesignations}
		<!--
			Tap decides, hold asks. Assignment used to live only in the edit sheet, so
			that a tap over the canvas could never quietly rewrite the graph; changing
			a designation from here meant a round trip through a sheet the reader had
			not asked for. A tap now cycles, as it does in the sheet, and the question
			the chip used to answer moved to the gesture that means "tell me more":
			hold, right-click, or Shift+Enter.
		-->
		<section class="designation-section" bind:this={peekSection}>
			<QuantityDesignationChips
				mode="view"
				view={designations}
				onCycle={onCycleDesignation}
				onPeek={openPeek}
				{peekKeys}
			/>
			{#if cascades.length > 0}
				<!--
					Two columns matching the chips above, so a card sits under the column
					its question came from: inputs look upstream, outputs downstream.
					Below the breakpoint they stack — two half-width columns of equations
					do not fit a phone, and the chip columns are already tight there.
				-->
				<div class="peek-columns">
					<div class="peek-column" data-peek-column="input">
						{#each inputCascades as cascade (cascade.id)}
							{@render peekCard(cascade)}
						{/each}
					</div>
					<div class="peek-column" data-peek-column="output">
						{#each outputCascades as cascade (cascade.id)}
							{@render peekCard(cascade)}
						{/each}
					</div>
				</div>
			{/if}
		</section>
	{/if}

	{#if diagnostics.items.length > 0 || diagnostics.cycleNodeIds.length > 0}
		<!--
			Kept off the canvas on purpose. An undefined letter is common while
			drafting, so flagging it at graph scale would be noise; here it reads as
			an invitation to extend the graph.
		-->
		<section
			class="quantity-diagnostics"
			aria-label="Quantity diagnostics"
			data-quantity-diagnostics
		>
			<ul>
				{#each diagnostics.items as item (item.key)}
					<!-- Never a way back to where the reader already is. The states that
					     name other nodes exclude this one by construction; the filter is
					     what makes that a property of the list rather than of each state
					     that remembers to. -->
					{@const relatedIds = item.nodeIds.filter((nodeId) => nodeId !== currentNodeId)}
					{@const selfId = currentNodeId}
					<li data-diagnostic-state={item.state} data-diagnostic-quantity={item.label}>
						<span class="quantity">{item.label}</span>
						<span class="reason">{DIAGNOSTIC_TEXT[item.state]}</span>
						{#if relatedIds.length > 0}
							<span class="related">
								{#each relatedIds as relatedId (relatedId)}
									<button
										type="button"
										data-reveal-node={relatedId}
										onclick={() => onJumpToNode?.(relatedId)}>{titleForNodeId(relatedId)}</button
									>
									{#if item.state === 'unconfirmed' && onConfirmDefiner}
										<!-- Beside the node it belongs to, since the reader is choosing
										     which writer to believe when there is more than one. -->
										<button
											type="button"
											class="confirm"
											data-confirm-definer={relatedId}
											aria-label={`Label ${item.label} as an output of ${titleForNodeId(relatedId)}`}
											onclick={() => onConfirmDefiner(relatedId, item.key)}
											>{DESIGNATE_TEXT.unconfirmed}</button
										>
									{/if}
								{/each}
							</span>
						{/if}
						<!-- The one repair that lands on the node being read: its own label is
						     what disagrees with its own math, so there is no writer to name
						     and no journey to offer. -->
						{#if item.state === 'self-unconfirmed' && onConfirmDefiner && selfId}
							<button
								type="button"
								class="confirm"
								data-confirm-definer={selfId}
								aria-label={`Relabel ${item.label} as an output of this node`}
								onclick={() => onConfirmDefiner(selfId, item.key)}
								>{DESIGNATE_TEXT['self-unconfirmed']}</button
							>
						{/if}
						<!-- `unresolved` alone, and no wider: an `unconfirmed` quantity already
						     has a node stating it, so offering to define it here is the
						     duplicate-node trap the peek card just closed. -->
						{#if item.state === 'unresolved' && onCreateDefiningNode}
							<button
								type="button"
								class="create"
								data-create-defining-node={item.label}
								onclick={() => onCreateDefiningNode(item.label, item.key)}
								>Define {item.label}</button
							>
						{/if}
					</li>
				{/each}
				{#if diagnostics.cycleNodeIds.length > 0}
					<li data-diagnostic-state="cycle">
						<span class="reason">This node depends on itself, through</span>
						<span class="related">
							{#each diagnostics.cycleNodeIds as relatedId (relatedId)}
								<button
									type="button"
									data-reveal-node={relatedId}
									onclick={() => onJumpToNode?.(relatedId)}>{titleForNodeId(relatedId)}</button
								>
							{/each}
						</span>
					</li>
				{/if}
			</ul>
		</section>
	{/if}

	{#if imageBlocks.length > 0}
		<div class="image-grid" aria-label="Node images">
			{#each imageBlocks as image (image.assetId)}
				{@const asset = assets[image.assetId]}
				<figure>
					{#if assetUrls[image.assetId]}
						<div class="image-frame" role="presentation">
							<img
								class="focus-image"
								data-asset-id={image.assetId}
								src={assetUrls[image.assetId]}
								alt={image.alt}
							/>
						</div>
					{:else}
						<div class="missing-image" role="img" aria-label={image.alt || 'Missing image'}>
							{asset?.name ?? 'Image unavailable'}
						</div>
					{/if}
					{#if image.caption}
						<figcaption>{image.caption}</figcaption>
					{/if}
				</figure>
			{/each}
		</div>
	{/if}

	{#if fileBlocks.length > 0}
		<ul class="file-list" aria-label="Node files">
			{#each fileBlocks as file (file.assetId)}
				{@const asset = assets[file.assetId]}
				{@const url = assetUrls[file.assetId]}
				<li data-file-asset-id={file.assetId}>
					<div class="file-meta">
						<strong data-file-name>{file.name}</strong>
						<span data-file-type>{asset?.mimeType ?? 'Unknown type'}</span>
						<span data-file-size>{formatByteSize(asset?.size ?? 0)}</span>
					</div>
					{#if url}
						<!--
							An anchor rather than `window.open`, unlike the HTML opener in
							`browserGraphFile.ts`: the blob has to come out of IndexedDB, and
							a `window.open` after that await is a popup mobile Safari blocks
							and a top-level blob navigation a `file://` page is refused. A
							link click is the navigation the reader themselves made, and the
							URL is already in hand because the effect above built it. No
							`download`, so the browser shows what it can show and saves the
							rest, which is what "hands the blob to the browser" means.
						-->
						<!--
							A `blob:` URL is not a route: there is nothing for SvelteKit's
							`resolve()` to resolve, and it has to reach the browser verbatim.
						-->
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
						<a class="file-open" data-file-open href={url} target="_blank" rel="noopener">Open</a>
					{:else}
						<span class="file-unavailable" data-file-unavailable>Unavailable</span>
					{/if}
					<!-- After Open rather than before it, so the row's action keeps the
					     same place whether or not the reader wrote a caption. -->
					{#if file.caption}
						<p class="file-caption" data-file-caption>{file.caption}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.focus-content {
		display: grid;
		gap: 1rem;
		color: #334155;
		font-size: 1.125rem;
		line-height: 1.65;
	}

	p,
	figure {
		margin: 0;
	}

	.description {
		color: #334155;
		font-size: 1.125rem;
		line-height: 1.65;
		white-space: pre-wrap;
	}

	/* Positions the peek card, which is absolute so it never reflows the section. */
	.designation-section {
		position: relative;
	}

	/*
	 * One column per side, matching the `1fr 1fr` the chips use above, so a card
	 * sits under the column its question came from. Stacked below the breakpoint:
	 * two half-width columns of equations do not fit a phone, and the chip
	 * columns are already tight there. `min-width: 0` because a grid track
	 * otherwise refuses to shrink below its content, and a long definition would
	 * push the other column off screen rather than wrap.
	 */
	.peek-columns {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.peek-column {
		display: grid;
		align-content: start;
		gap: 0.5rem;
		min-width: 0;
	}

	.peek-column:empty {
		display: none;
	}

	@media (min-width: 640px) {
		.peek-columns {
			grid-template-columns: 1fr 1fr;
			gap: 0.75rem;
		}

		/*
		 * Kept in the grid when empty above the breakpoint, so the column that does
		 * have cards stays under its own chips instead of sliding across.
		 */
		.peek-column:empty {
			display: grid;
		}
	}

	.quantity-diagnostics ul {
		display: grid;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.95rem;
	}

	.quantity-diagnostics li {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.4rem;
		padding-left: 0.6rem;
		border-left: 3px solid #cbd5e1;
	}

	/* Amber, with the states that need the author to change something. A label
	   this node put on contradicting math this node wrote is a mistake, not the
	   quiet "nobody has said so yet" the grey below means. */
	.quantity-diagnostics li[data-diagnostic-state='unresolved'],
	.quantity-diagnostics li[data-diagnostic-state='self-unconfirmed'] {
		border-left-color: #f59e0b;
	}

	/* Informational grey, the same edge a nested peek card takes: nothing is wrong
	   here, the graph just has not been told yet. The unresolved amber would put
	   this at the same volume as a quantity nothing anywhere defines. */
	.quantity-diagnostics li[data-diagnostic-state='unconfirmed'] {
		border-left-color: #94a3b8;
	}

	.quantity-diagnostics li[data-diagnostic-state='conflict'],
	.quantity-diagnostics li[data-diagnostic-state='cycle'] {
		border-left-color: #ef4444;
	}

	.quantity {
		font-style: italic;
		font-weight: 600;
	}

	.reason {
		color: #64748b;
	}

	.related {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.quantity-diagnostics button {
		border: 1px solid #cbd5e1;
		border-radius: 0.35rem;
		background: #f8fafc;
		color: #334155;
		padding: 0.05rem 0.4rem;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.quantity-diagnostics button.create {
		border-color: #f59e0b;
		background: #fffbeb;
	}

	/* The same fill the peek card's confirm takes, since it is the same act. */
	.quantity-diagnostics button.confirm {
		border-color: #94a3b8;
		background: #e2e8f0;
		color: #0f172a;
	}

	/*
	 * Large on purpose: the milestone asks for an obvious control, and this is a
	 * surface read on a phone. The whole row is the hit target rather than a
	 * checkbox glyph a thumb has to find.
	 */
	.task-toggle {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.75rem 1rem;
		border: 1px solid #cbd5e1;
		border-radius: 0.6rem;
		background: #f8fafc;
		color: #0f172a;
		font: inherit;
		font-size: 1.0625rem;
		text-align: left;
		cursor: pointer;
	}

	.task-toggle[data-task-done='true'] {
		border-color: #94a3b8;
		background: #e2e8f0;
		color: #475569;
	}

	.task-box {
		font-size: 1.75rem;
		line-height: 1;
	}

	.file-list {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.file-list li {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem 0.75rem;
		padding: 0.6rem 0.75rem;
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		background: #f8fafc;
		font-size: 0.95rem;
	}

	.file-meta {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.5rem;
		flex: 1 1 12rem;
		min-width: 0;
	}

	.file-meta span {
		color: #64748b;
		font-size: 0.875rem;
	}

	.file-caption {
		flex: 1 1 100%;
		margin: 0;
		color: #475569;
		font-size: 0.925rem;
	}

	.file-open {
		margin-left: auto;
		border: 1px solid #94a3b8;
		border-radius: 0.35rem;
		background: #e2e8f0;
		color: #0f172a;
		padding: 0.4rem 0.9rem;
		font-size: 0.95rem;
		text-decoration: none;
	}

	/* The file row's answer to the image grid's missing frame: the document still
	   names the attachment, the blob store just has no copy of it here. */
	.file-unavailable {
		margin-left: auto;
		color: #64748b;
		font-size: 0.875rem;
		font-style: italic;
	}

	.image-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: 1rem;
	}

	figure {
		display: grid;
		gap: 0.5rem;
	}

	.image-frame,
	.missing-image {
		aspect-ratio: 4 / 3;
		width: 100%;
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		background: #f8fafc;
		overflow: hidden;
	}

	img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.missing-image {
		display: grid;
		place-items: center;
		color: #64748b;
	}

	figcaption {
		color: #475569;
		font-size: 0.925rem;
	}
</style>
