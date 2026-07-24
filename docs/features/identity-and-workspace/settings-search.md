# Settings search / 設定搜尋

A search box at the top of the Settings (Preferences) dialog's left rail lets
you find a setting by name, description, or keyword across every tab, and jump
straight to the tab that owns it. Because the rail is present on every
Preferences tab, the search box is reachable from every settings page.

呢個搜尋框喺「設定」對話框左邊嘅最頂，可以打字跨所有分頁搵設定，跟住一撳就跳去嗰個設定所屬嘅分頁。因為左邊條 rail 喺每一頁都會顯示，所以每一頁都用到呢個搜尋。

## Behaviour

- Type in the search box to filter a catalog of settings by title, description,
  and hidden keyword aliases (e.g. "telemetry" finds **Usage stats**).
- Results are grouped by the tab that owns each setting. The matching portion of
  each result's title is highlighted.
- Rail tabs that own a match show a count badge; tabs with no match dim while a
  search is active.
- Selecting a result (click, or keyboard `Enter`) jumps to that setting's tab
  and clears the query so the pane shows through. `Escape` clears the query.
- Matching works in **fuzzy** (default), **substring**, and **regex** modes via
  the shared filter-mode control and its regex builder — the same
  fuzzy/substring/regex contract used by every other search surface in the app.
  Case sensitivity applies to substring and regex modes.
- A query typed in either English or Cantonese matches, regardless of the
  current display language, because the search index carries both localizations
  of every entry's title and description plus bilingual keyword aliases.

## Localization and tone

All search UI copy (label, placeholder, result count, "in {tab}", jump hint,
empty state) and every catalog entry's title, description, and tab name are
localized in English, playful Hong Kong Cantonese, and bilingual mode through
`app/src/lib/i18n-resources.ts` (`settingsSearch.*` keys). The search surface is
purely navigational, so it carries no funny-level tone scaling; result counts,
the empty state, and accessibility copy stay clear at every level.

## Accessibility

- The input is a labelled `combobox` (`aria-label`, `aria-controls`,
  `aria-expanded`, `aria-activedescendant`) driving a `listbox`/`option` result
  list; the highlighted option is tracked with `aria-selected`.
- Full keyboard support: `ArrowUp`/`ArrowDown`, `Home`/`End`, `Enter` to open,
  `Escape` to clear. Focus rings are visible on the input, the clear button, and
  every result.
- A live `role="status"` region announces the result count as the query
  changes; the no-results state is announced politely.
- The clear (✕) button has an accessible name and an adequate hit target.

## Implementation

- Catalog and pure matching/grouping logic:
  `app/src/lib/settings-search/settings-search-catalog.ts`
  (`SettingsSearchCatalog`, `filterSettingsEntries`, `groupSettingsResultsByTab`,
  `settingsTabsWithMatches`, `settingsSearchKeys`, `settingsTabNameKey`).
  All searchable text is packed into the first two match keys so keyword
  aliases match in fuzzy mode too, not only substring/regex.
- UI: `app/src/ui/preferences/settings-search.tsx` (`SettingsSearch`), mounted
  in the rail by `app/src/ui/preferences/preferences.tsx`.
- The surface is registered as the `preferences` standalone search surface in
  `app/src/lib/collection-surface-registry.ts` and reuses the shared
  `FilterModeControl` and regex builder.

## Failure modes

- **Invalid regex**: the shared matcher returns every catalog entry unfiltered
  and exposes an error message rather than throwing, so the list stays usable
  while the pattern is still being typed. Patterns over 1000 characters are
  rejected the same way to guard against catastrophic backtracking.
- **Unknown setting**: the catalog is a representative index of the
  most-searched settings, not an exhaustive mirror of every control. A setting
  with no catalog entry simply will not appear in results; add an entry to make
  it findable.

## Verification

`app/test/unit/settings-search-test.ts` covers tab coverage, unique ids,
bilingual match keys, empty-query handling, English/Cantonese/keyword matching,
case sensitivity, invalid- and valid-regex behaviour, title highlight ranges,
and tab grouping. `app/test/unit/collection-surface-registry-test.ts` enforces
the one-to-one registry/regex-builder binding for the `preferences` surface.

## API applicability

This feature is entirely local UI navigation and adds no HTTP endpoint, so a
Postman collection is not applicable.
