<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, within } from 'storybook/test';
	import StageStoryWrapper from './StageStoryWrapper.svelte';
	import type { NodeData } from '../types/node';

	const NODE_1: NodeData = {
		id: 'node-1',
		title: 'Node One',
		description: 'First node'
	};
	const NODE_2: NodeData = {
		id: 'node-2',
		title: 'Node Two',
		description: 'Second node'
	};

	const { Story } = defineMeta({
		title: 'Components/Multigraph/Stage',
		component: StageStoryWrapper,
		tags: [],
		argTypes: {
			nodes: { control: 'object' },
			positions: { control: 'object' }
		}
	});

	function getStage(el: HTMLElement): HTMLElement {
		const stage = el.querySelector('.stage');
		if (!stage) throw new Error('Stage not found');
		return stage as HTMLElement;
	}

	function getStageTransform(el: HTMLElement): string {
		return getStage(el).style.transform || '';
	}

	function dispatchPointer(
		target: HTMLElement,
		type: 'pointerdown' | 'pointermove' | 'pointerup',
		clientX: number,
		clientY: number,
		pointerId = 1
	) {
		target.dispatchEvent(
			new PointerEvent(type, {
				clientX,
				clientY,
				pointerId,
				bubbles: true,
				cancelable: true
			})
		);
	}

	function dispatchWheel(target: HTMLElement, deltaY: number) {
		target.dispatchEvent(
			new WheelEvent('wheel', {
				deltaY,
				bubbles: true,
				cancelable: true
			})
		);
	}

	function getCenter(el: HTMLElement): { x: number; y: number } {
		const r = el.getBoundingClientRect();
		return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
	}

	function sleep(ms: number = 0) {
		return new Promise((r) => setTimeout(r, ms));
	}
</script>

<Story
	name="Empty"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const wrapper = canvasElement.querySelector('[data-testid="stage-callbacks"]') as HTMLElement;
		expect(wrapper).toBeInTheDocument();
		const stage = getStage(canvasElement);
		expect(stage).toBeInTheDocument();

		const initialTransform = getStageTransform(canvasElement);
		const center = getCenter(stage);

		// Pan: down, move, up
		dispatchPointer(stage, 'pointerdown', center.x, center.y);
		dispatchPointer(stage, 'pointermove', center.x + 50, center.y + 30);
		dispatchPointer(stage, 'pointerup', center.x + 50, center.y + 30);

		// Wait for Svelte to flush reactive updates to the DOM
		await sleep();

		const afterPan = getStageTransform(canvasElement);
		expect(afterPan).toContain('translate');
		expect(afterPan).not.toBe(initialTransform);

		// Zoom: wheel
		dispatchWheel(stage, -100);
		await sleep();
		const afterZoom = getStageTransform(canvasElement);
		expect(afterZoom).toContain('scale');
		expect(afterZoom).toContain('translate');
	}}
/>

<Story
	name="SingleNode"
	args={{
		nodes: [NODE_1]
	}}
	play={async ({ canvasElement }) => {
		const wrapper = canvasElement.querySelector('[data-testid="stage-callbacks"]') as HTMLElement;
		expect(wrapper).toBeInTheDocument();
		await expect(within(canvasElement).getByText(NODE_1.title)).toBeInTheDocument();

		const stage = getStage(canvasElement);
		const circle = canvasElement.querySelector('.circle') as HTMLElement;
		expect(circle).toBeInTheDocument();
		const nodeCenter = getCenter(circle);

		// Node click: dispatch from circle so hit-test sees the node; stage receives via bubble
		dispatchPointer(circle, 'pointerdown', nodeCenter.x, nodeCenter.y);
		dispatchPointer(circle, 'pointerup', nodeCenter.x, nodeCenter.y);
		await sleep();
		expect(wrapper.dataset.lastNodeClick).toBe(NODE_1.id);

		// Node drag to background: down on node, move away, up on empty area
		const stageCenter = getCenter(stage);
		dispatchPointer(circle, 'pointerdown', nodeCenter.x, nodeCenter.y);
		dispatchPointer(stage, 'pointermove', stageCenter.x - 150, stageCenter.y - 150);
		dispatchPointer(stage, 'pointerup', stageCenter.x - 150, stageCenter.y - 150);
		await sleep();
		expect(wrapper.dataset.lastDropBg).toBe(NODE_1.id);
	}}
/>

<Story
	name="TwoNodes"
	args={{
		nodes: [NODE_1, NODE_2],
		positions: {
			[NODE_1.id]: { left: '30%', top: '50%' },
			[NODE_2.id]: { left: '70%', top: '50%' }
		}
	}}
	play={async ({ canvasElement }) => {
		const wrapper = canvasElement.querySelector('[data-testid="stage-callbacks"]') as HTMLElement;
		expect(wrapper).toBeInTheDocument();
		await expect(within(canvasElement).getByText(NODE_1.title)).toBeInTheDocument();
		await expect(within(canvasElement).getByText(NODE_2.title)).toBeInTheDocument();

		const stage = getStage(canvasElement);
		const circles = canvasElement.querySelectorAll('.circle');
		expect(circles.length).toBeGreaterThanOrEqual(2);
		const firstCircle = circles[0] as HTMLElement;
		const secondCircle = circles[1] as HTMLElement;
		const fromCenter = getCenter(firstCircle);
		const toCenter = getCenter(secondCircle);

		// Drag node 1 onto node 2: down on first, move to second, up
		dispatchPointer(stage, 'pointerdown', fromCenter.x, fromCenter.y);
		dispatchPointer(stage, 'pointermove', toCenter.x, toCenter.y);
		dispatchPointer(stage, 'pointerup', toCenter.x, toCenter.y);
		await sleep();

		expect(wrapper.dataset.lastDropNode).toBe(`${NODE_1.id},${NODE_2.id}`);
	}}
/>

<Story
	name="PanAndZoom"
	args={{ nodes: [] }}
	play={async ({ canvasElement }) => {
		const stage = getStage(canvasElement);
		const center = getCenter(stage);

		// Pan
		dispatchPointer(stage, 'pointerdown', center.x, center.y);
		dispatchPointer(stage, 'pointermove', center.x + 20, center.y + 20);
		dispatchPointer(stage, 'pointerup', center.x + 20, center.y + 20);
		await sleep();
		const afterPan = getStageTransform(canvasElement);
		expect(afterPan).toContain('translate(20px, 20px)');

		// Zoom in (negative deltaY)
		dispatchWheel(stage, -200);
		const afterZoom = getStageTransform(canvasElement);
		expect(afterZoom).toMatch(/scale\([1-9]/);
	}}
/>
