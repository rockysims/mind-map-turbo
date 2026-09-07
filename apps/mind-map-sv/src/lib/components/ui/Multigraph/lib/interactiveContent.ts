/**
 * Which presses inside a zoom world belong to the content rather than the
 * world.
 *
 * `ZoomWorld` captures the pointer to pan with it, and a capture retargets the
 * `pointerup` — and therefore the `click` — at the world. So a press that lands
 * on something the reader is pressing *for its own sake* must not start a pan:
 * the world declines it, the browser dispatches the click, and the control
 * works.
 *
 * The list is every element that answers a press by itself. Buttons, links and
 * form fields are the obvious half; `summary`, `details` and `label` are the
 * half the workbench taught us — a `<summary>` opens its disclosure on click, so
 * a captured press left "What Claude will see" unopenable inside deep zoom.
 * `details` rather than `summary` alone because a press anywhere in an open
 * disclosure is a press on its content, and `label` because a label's click is
 * its control's.
 *
 * Shared rather than copied: the rule is asserted by `ZoomWorld` and by the
 * workbench's harness, and two copies of a selector is exactly how one of them
 * comes to be missing an entry.
 */

/** Every element whose own press beats a world pan. */
const INTERACTIVE_CONTENT_SELECTOR =
	'button, a, input, textarea, select, summary, details, label, [contenteditable]';

/**
 * Whether a press on `target` belongs to interactive content — the element
 * itself, or anything inside one.
 *
 * A non-element target (a text node, or nothing at all) is not interactive: it
 * is the world's, which is the same answer the empty case has always had.
 */
export function startsOnInteractiveContent(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest(INTERACTIVE_CONTENT_SELECTOR) !== null;
}
