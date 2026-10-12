# Settings panel number inputs and Reset buttons are under the 44px touch floor

**Created:** 2026-10-11
**Area:** `apps/mind-map-sv/src/lib/components/ui/SettingsPanel/SettingNumber.svelte`, `SettingRange.svelte`, `SettingToggle.svelte`, `SettingSelect.svelte`
**Cost if ignored:** on a phone, the numeric inputs and every Reset button are about 22px tall, so a tap lands on a neighbouring row or misses; the panel is otherwise usable, so this bites only while tuning on touch.

## What we did

The panel's rows are 1.75rem tall and the numeric inputs and Reset buttons
inherit that. The select control added on 2026-10-11 keeps its `<select>` at
2.75rem to meet the floor, but its Reset button copies the others so the
panel stays visually consistent.

## Why

The panel was built for desktop tuning first, dense on purpose so a long
schema fits on screen. Raising every control to 44px is a layout change
across the whole panel, out of scope for the task that added one control.

## What paying it off looks like

Each row's interactive elements reach 44px (padding or an invisible hit area,
not necessarily a taller visible box), checked by a phone-viewport story on
`SettingsPanel.stories.svelte`, with the panel still fitting its schema
without a second scrollbar.
