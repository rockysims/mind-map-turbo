<script lang="ts">
	/**
	 * What one confirmed input actually means, without leaving the node reading it.
	 *
	 * The question a reader has at an input chip is "what is this?", and answering
	 * it by flying the canvas somewhere else costs them their place. So the
	 * definition comes to them: every node that claims this quantity, with the
	 * equation each one wrote, rendered as written. Going there stays available as
	 * an explicit choice rather than the price of asking.
	 *
	 * One line per definer, and that line is the equation. The card hangs directly
	 * under the chip that opened it, so a header restating the quantity would say
	 * what the reader is already looking at, and a node title above each equation
	 * would push the answer below the question. The title appears only where there
	 * is no equation to show instead — a node that confirmed the output but whose
	 * text no longer states it. It is still a real answer to "who defines this", so
	 * hiding it would make the peek disagree with the edge on screen.
	 *
	 * A node whose text states the definition without anyone having confirmed it is
	 * an answer too, and the most important one: saying "nothing defines this" over
	 * an equation someone has already written invites the reader to write it a
	 * second time. Those rows are drawn as ghosts — the same treatment a ghost chip
	 * gets, an offer rather than a fact — and each carries the one tap that makes it
	 * a fact.
	 *
	 * The next question is almost always "and what is *that* symbol?", so each
	 * definer row also offers that node's own confirmed inputs as chips, and a
	 * chip opens another card of exactly this kind underneath. The card is
	 * therefore recursive and entirely presentational: which branches are open,
	 * where focus should land, and what Escape means all live in the one
	 * controller above it, because N cards each holding a document listener would
	 * race to close each other.
	 */
	import MathText from '../MathText/MathText.svelte';
	import { symbolFor, type QuantitySymbol } from '../MathText/lib/mathSymbols';
	import PeekCard from './QuantityPeekCard.svelte';
	import QuantityChip from './QuantityChip.svelte';
	import type { QuantityDesignation } from '../types/node';
	import type { QuantityDefinitionRecord, QuantityIndexEntry } from './lib/quantityIndex';
	import {
		isBranchOpen,
		isLoop,
		serializePath,
		type PeekCascade,
		type PeekPath
	} from './lib/peekCascade';

	/** Shared so a definer with nothing to drill into allocates nothing per render. */
	const NO_INPUTS: readonly QuantityDesignation[] = [];

	/**
	 * Levels of visual indent before the cascade stops stepping right. Depth is
	 * unbounded, but past four steps the indent is costing more width than it is
	 * buying legibility, and the nesting is still readable from the enclosing
	 * cards' borders.
	 */
	const MAX_INDENT_LEVELS = 4;
	const INDENT_REM_PER_LEVEL = 0.75;

	let {
		entry,
		label,
		quantityKey,
		path = [],
		cascade,
		isRoot = false,
		titleForNodeId,
		inputsForNodeId = () => NO_INPUTS,
		quantityEntryFor,
		currentNodeId,
		focusRequestPath = null,
		onFocusHandled,
		onToggleBranch,
		onJumpToNode,
		onCreateDefiningNode,
		onConfirmDefiner,
		onClose
	}: {
		/** The index entry for this card's quantity, or undefined when nothing knows it. */
		entry?: QuantityIndexEntry;
		/** Human-readable quantity name, for the copy when there is no entry to read. */
		label: string;
		/** This card's own quantity key — what "Define x" here would be seeding. */
		quantityKey: string;
		/** Where this card sits in the cascade. Empty is the root card. */
		path?: PeekPath;
		/** Every branch open under the root quantity, owned by the controller. */
		cascade: PeekCascade;
		/** The root card is the dialog and owns the dismiss; nested cards are groups. */
		isRoot?: boolean;
		titleForNodeId: (nodeId: string) => string;
		/** A definer's own confirmed inputs — the chips its drill line offers. */
		inputsForNodeId?: (nodeId: string) => readonly QuantityDesignation[];
		/** The graph-wide record for one quantity, read when a nested card opens. */
		quantityEntryFor?: (key: string) => QuantityIndexEntry | undefined;
		/**
		 * The node the reader is currently in. Its own definer row still shows its
		 * equation — it is a real answer to "who defines this", and often the most
		 * interesting one when definers disagree — but offers no "Go to node",
		 * because there is nowhere for it to go.
		 */
		currentNodeId?: string;
		/** Serialized path of the card that should take focus, or null for none. */
		focusRequestPath?: string | null;
		/** Consume the focus request, so a re-render does not refocus. */
		onFocusHandled?: () => void;
		onToggleBranch?: (path: PeekPath) => void;
		onJumpToNode?: (nodeId: string) => void;
		/**
		 * The key rides along with the label so the new node can be seeded with the
		 * designation that makes it a definer — and it is *this* card's key, not the
		 * root's, or drilling three levels down would define the wrong quantity.
		 * `consumerNodeId` is the node whose confirmed input this card answers — the
		 * last step's definer — so the new node lands beside the node that actually
		 * asked for it; undefined at the root card, whose consumer only the details
		 * view knows.
		 */
		onCreateDefiningNode?: (
			quantityLabel: string,
			quantityKey: string,
			consumerNodeId?: string
		) => void;
		/**
		 * Designate this card's quantity as the named node's output — the one tap
		 * that turns an unconfirmed row into a confirmed one. The *key* rather than
		 * the symbol, matching `onCreateDefiningNode`, so the diagnostics list can
		 * hand the same callback the key it already has. Absent means no control is
		 * offered, exactly as with Define: a surface with no graph behind it reads
		 * and changes nothing.
		 */
		onConfirmDefiner?: (definerNodeId: string, quantityKey: string) => void;
		/** Root card only: dismiss the whole cascade. */
		onClose?: () => void;
	} = $props();

	let card = $state<HTMLDivElement | null>(null);

	const selfPath = $derived(serializePath(path));
	const indentRem = $derived(Math.min(path.length, MAX_INDENT_LEVELS) * INDENT_REM_PER_LEVEL);

	/** One node that defines this quantity, and whether it has said so. */
	interface DefinerRow {
		nodeId: string;
		/** Confirmed as an output. An unconfirmed row is an offer, not a fact. */
		confirmed: boolean;
		definitions: QuantityDefinitionRecord[];
	}

	function recordsFor(records: readonly QuantityDefinitionRecord[], nodeId: string) {
		return records.filter((record) => record.nodeId === nodeId);
	}

	/**
	 * Confirmed rows first, then the ones only the text claims. The two lists are
	 * disjoint by construction — the index subtracts the confirmed definers out of
	 * the text ones — so a node appears at most once and `row.nodeId` is a key.
	 */
	const rows = $derived<DefinerRow[]>([
		...(entry?.definerNodeIds ?? []).map((nodeId) => ({
			nodeId,
			confirmed: true,
			definitions: recordsFor(entry?.definitions ?? [], nodeId)
		})),
		...(entry?.textDefinerNodeIds ?? []).map((nodeId) => ({
			nodeId,
			confirmed: false,
			definitions: recordsFor(entry?.textDefinitions ?? [], nodeId)
		}))
	]);

	/** One drill chip: the quantity it names, where opening it would land, and its state. */
	interface DrillChip {
		symbol: QuantitySymbol;
		path: PeekPath;
		pathKey: string;
		/** Already open above this chip on its own path — following it would never end. */
		loop: boolean;
		open: boolean;
	}

	/**
	 * The chips one definer row offers, read from that node's live designations.
	 *
	 * A node may designate the same quantity twice; the row shows it once, because
	 * two identical chips would be two ways to ask one question.
	 */
	function drillChipsFor(definerNodeId: string): DrillChip[] {
		// A list rather than a Set: a row's worth of designations is a handful, and
		// this runs per row per render.
		const seen: string[] = [];
		const chips: DrillChip[] = [];
		for (const designation of inputsForNodeId(definerNodeId)) {
			const symbol = symbolFor(designation.base, designation.subscript);
			if (seen.includes(symbol.key)) continue;
			seen.push(symbol.key);
			const childPath = [...path, { definerNodeId, key: symbol.key }];
			chips.push({
				symbol,
				path: childPath,
				pathKey: serializePath(childPath),
				loop: isLoop(cascade, path, symbol.key),
				open: isBranchOpen(cascade, childPath)
			});
		}
		return chips;
	}

	function drillAttributes(chip: DrillChip): Record<string, string | undefined> {
		if (chip.loop) {
			return {
				'data-peek-drill': chip.symbol.key,
				'data-peek-drill-path': chip.pathKey,
				'data-peek-loop': 'true',
				title: 'Already open in this chain'
			};
		}
		return {
			'data-peek-drill': chip.symbol.key,
			'data-peek-drill-path': chip.pathKey,
			'aria-pressed': chip.open ? 'true' : 'false',
			title: `Show where ${chip.symbol.label} is defined`
		};
	}

	/**
	 * Inline even when the source was displayed. A display block would break the
	 * row the "Go to node" button shares, and the reader is scanning a list of
	 * definitions here rather than reading one.
	 */
	function texOf(definition: { sourceTex: string }): string {
		return `$${definition.sourceTex}$`;
	}

	// Standard dialog entry: Enter on the chip opened this card, so the next Tab
	// has to land inside it rather than on the next chip. The row buttons come
	// first in the DOM, so the first focusable is the leading "Go to node". A plain
	// focus() so a pointer-opened card is left to :focus-visible rather than given
	// a ring. Only the card the request names reacts, and it clears the request as
	// it does, or every later render would drag focus back here.
	$effect(() => {
		if (focusRequestPath !== selfPath) return;
		card?.querySelector('button')?.focus();
		onFocusHandled?.();
	});
</script>

{#snippet cardBody()}
	{#if rows.length === 0}
		<!-- Nothing confirmed AND nothing written down: only here is "define it" the
		     right offer. Making it when someone has already written the equation is
		     how a reader ends up with two nodes saying the same thing. -->
		<p class="note">Nothing defines {label} yet.</p>
		{#if onCreateDefiningNode}
			<button
				type="button"
				class="create"
				data-create-defining-node={label}
				onclick={() => onCreateDefiningNode?.(label, quantityKey, path.at(-1)?.definerNodeId)}
			>
				Define {label}
			</button>
		{/if}
	{:else}
		<ul>
			<!--
				Keyed on the node alone, never on the node and its state. Confirming a row
				has to MOVE it from the unconfirmed half of the list to the confirmed one;
				a composite key would tear the `<li>` down and rebuild it, taking any
				nested cascade, scroll position and focus underneath it with it.
			-->
			{#each rows as row (row.nodeId)}
				{@const definerId = row.nodeId}
				{@const drills = drillChipsFor(definerId)}
				<li
					data-peek-definer={definerId}
					data-peek-definer-state={row.confirmed ? 'confirmed' : 'unconfirmed'}
				>
					<div class="definition-row">
						<span class="definition" class:unconfirmed={!row.confirmed}>
							{#if row.definitions.length === 0}
								<!-- Confirmed-only by construction: a text definer is on the list
								     because its text defines the symbol, so it always has a body. -->
								{titleForNodeId(definerId)}
							{:else}
								{#each row.definitions as definition (definition.bodyKey)}
									<MathText text={texOf(definition)} />
								{/each}
							{/if}
						</span>
						{#if definerId !== currentNodeId}
							<button
								type="button"
								class="goto"
								data-peek-goto={definerId}
								onclick={() => onJumpToNode?.(definerId)}
							>
								Go to node
							</button>
						{/if}
						{#if !row.confirmed && onConfirmDefiner}
							<!-- After "Go to node" in the DOM so the card's mount focus lands on
							     a control that reads rather than one that writes, wherever there
							     is one. The accessible name carries what the ghost styling says
							     to the eye: this is an offer, and the node it belongs to. -->
							<button
								type="button"
								class="confirm"
								data-peek-confirm={definerId}
								aria-label={`Label ${label} as an output of ${titleForNodeId(definerId)}`}
								onclick={() => onConfirmDefiner?.(definerId, quantityKey)}
							>
								Label as output
							</button>
						{/if}
					</div>

					{#if drills.length > 0}
						<!--
							The definer's own inputs, in the same visual language as the
							Inputs column overhead: the reader has already learned that a
							pill with an italic letter is a quantity worth asking about.
						-->
						<div class="drill" data-peek-drill-line={definerId}>
							{#each drills as drill (drill.pathKey)}
								<QuantityChip
									label={drill.symbol.label}
									interactive={!drill.loop}
									peeking={drill.open}
									marker={drill.loop ? '↺' : undefined}
									attributes={drillAttributes(drill)}
									onclick={() => onToggleBranch?.(drill.path)}
								/>
							{/each}
						</div>
					{/if}

					{#each drills as drill (drill.pathKey)}
						{#if drill.open}
							<PeekCard
								entry={quantityEntryFor?.(drill.symbol.key)}
								label={drill.symbol.label}
								quantityKey={drill.symbol.key}
								path={drill.path}
								{cascade}
								{titleForNodeId}
								{inputsForNodeId}
								{quantityEntryFor}
								{currentNodeId}
								{focusRequestPath}
								{onFocusHandled}
								{onToggleBranch}
								{onJumpToNode}
								{onCreateDefiningNode}
								{onConfirmDefiner}
							/>
						{/if}
					{/each}
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#if isRoot}
	<div
		bind:this={card}
		class="quantity-peek root"
		data-quantity-peek={label}
		data-peek-path=""
		data-peek-depth="0"
		role="dialog"
		aria-label={`Where ${label} is defined`}
	>
		<!-- The focus overlay has no scroll container on purpose — wheel input has to
		     reach the ZoomWorld underneath — and its pan clamp puts below-frame
		     content out of reach, so a deep cascade has to scroll here. -->
		<div class="peek-scroll" data-peek-scroll>
			{@render cardBody()}
		</div>

		<!-- Last in the DOM so Tab runs the answers before the way out, parked in the
		     corner so it never competes with them for the row, and outside the
		     scroller so it cannot scroll away from the reader who wants it. -->
		<button type="button" class="dismiss" aria-label="Close definition" onclick={() => onClose?.()}
			>✕</button
		>
	</div>
{:else}
	<!-- A group rather than a dialog: nested cards claim no modality, since every
	     level of the cascade stays visible and interactive at once. -->
	<div
		bind:this={card}
		class="quantity-peek nested"
		data-quantity-peek={label}
		data-peek-path={selfPath}
		data-peek-depth={path.length}
		role="group"
		aria-label={`Where ${label} is defined`}
		style={`margin-left: ${indentRem}rem`}
	>
		{@render cardBody()}
	</div>
{/if}

<style>
	.quantity-peek {
		display: grid;
		gap: 0.4rem;
		border: 1px solid #cbd5e1;
		border-radius: 0.75rem;
		background: #ffffff;
		font-size: 0.95rem;
	}

	.quantity-peek.root {
		position: absolute;
		top: calc(100% + 0.35rem);
		left: 0;
		right: 0;
		z-index: 5;
		/* Right padding keeps the rows clear of the corner dismiss, which is now a
		   full-width control rather than a bare glyph. */
		padding: 0.5rem 2.75rem 0.5rem 0.75rem;
		box-shadow: 0 12px 32px rgb(15 23 42 / 18%);
	}

	/* Indented and edged rather than shadowed: a nested card is part of the row
	   above it, not a new surface floating over one. */
	.quantity-peek.nested {
		margin-top: 0.35rem;
		border-left: 3px solid #94a3b8;
		padding: 0.5rem 0.75rem;
	}

	.peek-scroll {
		display: grid;
		gap: 0.4rem;
		max-height: min(24rem, 55vh);
		overflow: auto;
		overscroll-behavior: contain;
	}

	ul {
		display: grid;
		gap: 0.3rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: grid;
		gap: 0.25rem;
	}

	.definition-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.definition {
		flex: 1;
		min-width: 0;
		color: #0f172a;
		overflow-x: auto;
	}

	/*
	 * The same treatment a ghost chip gets, and for the same reason: this equation
	 * is written down but nobody has confirmed it, so it reads as an offer rather
	 * than as part of what the graph does. Opacity is not an accessible signal on
	 * its own — the confirm control's name carries the meaning too.
	 */
	.definition.unconfirmed {
		color: #475569;
		opacity: 0.65;
	}

	.drill {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
	}

	.note {
		margin: 0;
		color: #64748b;
		font-size: 0.85rem;
	}

	button {
		flex: none;
		border: 1px solid #cbd5e1;
		border-radius: 0.35rem;
		background: #f8fafc;
		color: #334155;
		padding: 0.1rem 0.45rem;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}

	/* Border, background and colour deliberately left to the shared `button` rule
	   above: the way out is the same kind of control as "Go to node", and styling
	   it as a bare glyph made it read as decoration and sit off their baseline. */
	button.dismiss {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
	}

	button.create {
		justify-self: start;
		border-color: #f59e0b;
		background: #fffbeb;
	}

	/* Filled rather than outlined: it is the row's own answer, and leaving it in
	   the same quiet grey as "Go to node" beside it would make the offer look like
	   a second way to navigate. Amber belongs to Define, which extends the graph —
	   this only confirms what is already written. */
	button.confirm {
		border-color: #94a3b8;
		background: #e2e8f0;
		color: #0f172a;
	}
</style>
