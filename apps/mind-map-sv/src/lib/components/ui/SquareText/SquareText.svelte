<script lang="ts">
	import MathText from '../MathText/MathText.svelte';
	import { hasMath as containsMath } from '../MathText/lib/mathSegments';
	import { mathPlainText } from '../MathText/lib/mathPlainText';

	let {
		text = 'SquareText fallback text.',
		classList = []
	}: {
		text: string;
		classList: string[];
	} = $props();

	let squareTextRef = $state<HTMLElement | null>(null);

	/**
	 * Keeps text without math on the plain path, so its markup and its fit are
	 * untouched by this feature. The substring test short-circuits the real check
	 * because this runs for every visible node and most titles have no `$` at all;
	 * the real check still has to run, or a price like `\$5` would take the math
	 * path and gain a wrapper it does not need.
	 */
	const hasMath = $derived(text.includes('$') && containsMath(text));

	/**
	 * What the plain path draws. Not `text`: an escaped dollar is unescaped by the
	 * segmenter, so `\$5` is math-free text that still must not be drawn verbatim.
	 * Every other surface a title reaches — the details heading, the edit sheet,
	 * the breadcrumbs, the accessible names, search — resolves the escape, and
	 * drawing the backslash here made the canvas the one place it showed through.
	 *
	 * Free for the overwhelmingly common case: `mathPlainText` returns its input
	 * by identity when there is no `$` at all, and this is read once per visible
	 * node.
	 */
	const plainText = $derived(mathPlainText(text));

	function checkOverflow(el: HTMLElement) {
		const oldOverflow = el.style.overflow;

		if (!oldOverflow || oldOverflow === 'visible') {
			el.style.overflow = 'hidden';
		}

		const isOverflowing = el.clientWidth < el.scrollWidth || el.clientHeight < el.scrollHeight;

		el.style.overflow = oldOverflow;

		return isOverflowing;
	}

	function setSize() {
		if (!squareTextRef) return;

		// Step 1: find upper bound
		let size = 10;
		squareTextRef.style.position = 'absolute';
		squareTextRef.style.width = `${size}px`;
		squareTextRef.style.height = `${size}px`;

		let step = 50;
		while (checkOverflow(squareTextRef)) {
			size += step;
			squareTextRef.style.width = `${size}px`;
			squareTextRef.style.height = `${size}px`;
			step *= 2;
		}

		// Step 2: binary search minimum fitting size
		let lower = 10;
		let upper = size;

		while (upper - lower > 1) {
			const mid = Math.floor((lower + upper) / 2);
			squareTextRef.style.width = `${mid}px`;
			squareTextRef.style.height = `${mid}px`;

			if (checkOverflow(squareTextRef)) {
				lower = mid;
			} else {
				upper = mid;
			}
		}

		squareTextRef.style.width = `${upper}px`;
		squareTextRef.style.height = `${upper}px`;

		// Scale down to fit within parent
		const parent = squareTextRef.parentElement;
		if (parent && upper > parent.clientWidth) {
			const scale = parent.clientWidth / upper;
			squareTextRef.style.transform = `scale(${scale})`;
			squareTextRef.style.transformOrigin = 'top left';
		} else {
			squareTextRef.style.transform = '';
			squareTextRef.style.transformOrigin = '';
			squareTextRef.style.position = 'relative';
		}
	}

	$effect(() => {
		// Read the content so a retitle re-fits. Without this the effect tracks only
		// the element binding, and the fit found for the previous text would stand.
		void text;
		setSize();
	});

	/**
	 * Temml's fonts are fetched only once a glyph needs them, so the first fit of
	 * a math title is measured in a fallback face and is wrong by however much the
	 * two differ. One re-fit when loading settles corrects it.
	 *
	 * Text without math never subscribes: it is already drawn in a face the
	 * document has, and re-fitting every node on a font event would be a cost paid
	 * by graphs that contain no math at all.
	 */
	$effect(() => {
		if (!hasMath) return;

		let active = true;
		void document.fonts?.ready.then(() => {
			if (active) setSize();
		});

		return () => {
			active = false;
		};
	});
</script>

<div class="squareTextContainer">
	<div bind:this={squareTextRef} class={['squareText', ...classList]}>
		<!--
			`.squareTextBody` is the text's own box, the flex item either way (a
			bare text node was an anonymous one, so the fit is unchanged). It is
			what a caller styles to put something tight behind the words alone —
			the node's backdrop over a thick ring — rather than the fitted square.
		-->
		<!-- prettier-ignore -->
		{#if hasMath}<MathText {text} singleLine classList={['squareTextBody']} />{:else}<span class="squareTextBody">{plainText}</span>{/if}
	</div>
</div>

<style>
	.squareTextContainer {
		position: relative;
		width: 100%;
		height: 100%;
		display: flex;
		justify-content: center;
		align-items: center;
	}

	.squareText {
		position: relative; /* changed to absolute during size & scale calculation then back again */
		left: 0px;
		top: 0;
		display: flex;
		justify-content: center;
		align-items: center;
		box-sizing: border-box;
		padding: 10%;
	}
</style>
