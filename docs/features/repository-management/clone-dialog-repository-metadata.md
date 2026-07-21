# Clone dialog repository metadata

Every row in the Clone dialog's GitHub repository list is a rich metadata card
rather than a bare name, matching the Desktop Material v2 prototype. The card
surfaces the information needed to pick the right repository without opening it
in a browser first.

## Behavior

- Each row shows the owner/name, a short **description**, and an inline
  metadata line with the primary **language** (a color dot plus the language
  name), **stars**, **forks**, on-disk **size**, the **default branch**, and a
  relative **last-updated** time.
- Metric icons come from the bundled Material Symbols set (`star`,
  `fork_right`, `database`, `alt_route`, `schedule`); the language dot uses a
  small fixed palette of GitHub Linguist-style colors with a neutral M3 outline
  fallback for any language not in the palette.
- A **Public / Private** pill (with a `public` or `lock` glyph) sits beside the
  name so visibility is explicit on every row, not only implied by an icon.
- Star and fork counts are formatted compactly (for example `4300` renders as
  `4.3k`); size is scaled from the API's kilobytes into a human byte string
  (for example `8.1 MB`); the timestamp renders as a relative "x ago" phrase.
- The **filter panel** adds **language chips** alongside the existing
  visibility chips. The chips are derived from the languages actually present
  in the loaded repository set, deduplicated case-insensitively and sorted, so
  the offered filters always reflect real data. Selecting languages is additive
  (multi-select); an empty selection means no language filter. Language chips
  are derived from the visibility-filtered set *before* the language filter is
  applied, so selecting one language never hides the other chips.

## Data and configuration

- The GitHub listing type `IAPIRepository` carries the metadata additively:
  `description`, `language`, `stargazers_count`, `forks_count`, `size`, and
  `updated_at`. These fields flow straight from the `/user/repos` response;
  `private` and `default_branch` were already present.
- The fields are optional. Older GitHub Enterprise Server responses and the
  GitLab / Bitbucket adapters may omit any of them, in which case that single
  metric is dropped from the row while the rest still paint. A repository with
  no detected language contributes no chip and shows no language dot.
- The metadata card is opt-in per list via the `showMetadata` prop. The reused
  submodule and subtree pickers keep the compact single-line row.
- New visible labels (the visibility pill, the description fallback, the metric
  accessible names, and the language filter eyebrow) are localized in all three
  language modes — English, playful Hong Kong Cantonese, and the bilingual
  view — and update live when the language mode changes.

## Performance and accessibility

The list stays virtualized. Each metadata card paints at a fixed 84px height
(the description and metadata lines are single-line and height-pinned) so the
list's pointer hit-testing matches the painted rows exactly. The metadata
container is always rendered — even when a sparse response yields no metrics —
so the row height never varies. Metric glyphs are decorative and hidden from
assistive technology; each metric span carries an accessible label such as
"4.3k stars" so screen readers announce the value with its meaning.

## Failure modes and security

Metadata is presentational and derived only from the repository listing the
account already has permission to read. Missing, null, or unparseable values
(a blank description, an absent language, an unparseable timestamp) degrade to
a neutral fallback or an omitted metric rather than an error. No additional
network requests are made to populate the card.

## Verification

Focused tests cover the language-color palette (known, case-insensitive, and
neutral-fallback cases), language derivation and deduplication from a listing,
compact count/size/relative-time formatting with graceful nulls, the additive
metadata mapping onto list items, and the language filter's case-insensitive
narrowing. Row-rendering tests assert the description, language dot and color,
every metric, the Public/Private pill, the blank-description fallback, graceful
omission of absent metrics, the English/Cantonese/bilingual labels, and that
the compact (non-metadata) row still renders.
