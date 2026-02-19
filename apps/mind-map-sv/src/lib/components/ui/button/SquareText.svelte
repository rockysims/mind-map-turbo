<script lang="ts">
	const {
		text = 'SquareText fallback text.',
		classList = []
	} = $props<{
		text: string;
		classList: string[];
	}>();

	let squareTextRef = $state<HTMLElement | null>(null);
	
	function checkOverflow(el: HTMLElement) {
		const oldOverflow = el.style.overflow;

		if (!oldOverflow || oldOverflow === 'visible') {
			el.style.overflow = 'hidden';
		}

		const isOverflowing = false
			|| el.clientWidth < el.scrollWidth
			|| el.clientHeight < el.scrollHeight;

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

	$effect(setSize);
</script>

<div class="squareTextContainer">
	<div
		bind:this={squareTextRef}
		class="squareText"
		class:list={classList.join(' ')}
	>
		{text}
	</div>
</div>

<style>
	.squareTextContainer {
		position: relative;
		width: 90%;
		height: 90%;
	
		display: flex;
		justify-content: center;
		align-items: center;
	}
	
	.squareText {
		position: relative; /* changed to absolute during size & scale calculation then back again */
		left: 0px;
		top: 0;
	}
</style>
