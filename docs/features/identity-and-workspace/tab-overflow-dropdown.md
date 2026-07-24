# Tab-strip overflow dropdown

When more repository tabs are open than the strip can show, the tabs that do
not fit move into a "more tabs" dropdown instead of being clipped or reachable
only by horizontal scrolling. Every open repository stays one click away, and
the strip itself never scrolls sideways.

## Behavior and configuration

- **Overflow split.** The strip measures the room available to the tab row and
  the laid-out width of each tab, then keeps a contiguous, in-order run of tabs
  visible and moves the rest into the dropdown. The split is recomputed whenever
  the tab set, an individual tab's width (rename, restyle), or the window size
  changes, driven by a `ResizeObserver` on the tab list.
- **More-tabs button.** A compact trailing button appears at the end of the
  visible tab run only while an overflow exists. It shows a chevron and the
  count of hidden tabs and opens the dropdown. It is a normal icon button in the
  strip's visual language: hover and open states fill to the secondary
  container, and it has a visible focus ring.
- **Active tab stays visible.** If the active tab would fall outside the visible
  run, the run slides just far enough to keep it on screen, exactly as the old
  scroll-into-view behavior did, without reordering tabs. Selecting a tab from
  the dropdown activates it and pulls it back into the strip on the next
  measurement.
- **Collapsed group chips are pinned.** Collapsed-group chips are always kept in
  the strip; only individual tabs move into the dropdown, and the room the chips
  occupy is reserved before the tabs compete for space.
- **Dropdown list.** The dropdown is a keyboard-navigable listbox: Arrow
  Up/Down moves the highlight, Home/End jump to the ends, Enter or Space
  activates, and Escape or an outside click closes it, restoring focus to the
  button. Each row shows the tab label and repository path with Active, Pinned,
  and Favorite chips where they apply.
- **Appearance preserved.** Both visible tabs and dropdown rows keep every
  per-tab appearance customization. Visible tabs render through the unchanged
  tab component; dropdown rows re-apply the same validated per-tab title style
  (font family, size, color, weight, and text effects) and the tab's custom
  background, so a customized tab looks the same in the dropdown as in the strip.
  Theme, density, and the appearance-editor surfaces are untouched.

All labels ship in English, playful Hong Kong Cantonese, and the compact
bilingual mode through the shared translation catalog. The copy here is
navigational rather than tonal, so it reads clearly at every funny level; the
funny-level scale applies to tonal surfaces and is not yet a parameter on these
static strings.

## Persistence

This surface owns no persistence. The overflow split is derived entirely from
measured geometry at render time and is never written to disk. Tab identity,
order, grouping, pinning, and per-tab appearance continue to persist through
their existing stores, unchanged.

## Accessibility

The strip keeps its `tablist` semantics. The more-tabs button exposes an
accessible name with the hidden-tab count, `aria-haspopup="dialog"`, and
`aria-expanded`. The dropdown is a labelled `listbox` of `option` rows with
`aria-selected` tracking the highlight and `aria-activedescendant` on the list.
Every control is keyboard reachable with a visible focus ring, and the button
and rows meet the strip's contrast and hit-target norms.

## Failure modes and recovery

- If `ResizeObserver` is unavailable, the initial measurement still runs and the
  split updates on tab-set changes; only live drag-resize recomputation is lost.
- A single tab wider than the whole strip is always shown rather than hidden, so
  the strip never collapses to just the dropdown button. A lone oversized tab is
  never moved into the dropdown because there is nothing to switch to.
- A sub-pixel rounding slack prevents a layout that fits exactly from being
  forced into overflow by a measurement rounding error.
- Widths for tabs currently in the dropdown are cached; when a width is unknown
  (for example a newly added tab), a one-frame full-measurement pass lays every
  tab out to measure it before re-applying the split.

## Security considerations

The dropdown renders localized static copy, tab labels, and repository paths
that already appear in the strip and existing tab search. Per-tab styles reach
inline CSS only through the same validated `tabTitleStyleToCss` /
`tabFrameStyleToCss` helpers used by the strip, which drop any value that is not
a known-safe hex color, curated font, or bounded numeric — so a persisted style
can never inject arbitrary CSS.

## Verification

`tab-overflow-test.ts` covers the pure split geometry: the empty strip, the
all-fit case, the exact-fit rounding guard, trailing overflow, overflow-button
width reservation, the active-tab guarantee sliding the window (and not sliding
when unnecessary), order preservation across both partitions, the
always-show-one and lone-oversized-tab guards, and variable-width tabs.
Typechecking (`npx tsc --noEmit`) covers the component wiring.
