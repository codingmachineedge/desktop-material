# Repository-themed music

Every repository gets its own recognizable, looping background theme — **without
shipping or downloading a single audio file**. A stable hash of the repository's
identity seeds a small deterministic generator that picks the musical parameters
(tempo, scale, root note, timbre, and a short melodic motif); the audio system
synthesizes and loops that motif with the Web Audio API. The same repository
always produces the same theme, and different repositories almost always differ.

This extends the optional [audio system](audio-system.md): the master and music
gates, the volume slider, quiet hours, and reduced-motion handling all still
apply. Music is still off by default.

## Behavior

- **Derived theme.** `deriveRepositoryTheme(seedKey)`
  (`app/src/lib/audio/repo-theme.ts`) is pure and deterministic. It draws, in a
  fixed order, from an FNV-1a → Mulberry32 PRNG:
  - tempo (72–138 BPM),
  - scale (`major`, `minor`, `dorian`, `mixolydian`, `lydian`, `pentatonic`),
  - root note (a low MIDI tonic, 48–71),
  - waveform (biased toward soft `sine`/`triangle`),
  - a descriptive mood and texture (used only for the display name),
  - a 6–10 note motif built as a bounded random walk over scale degrees.
- **Seed identity.** `repositoryThemeSeedKey` prefers the GitHub `owner/name`
  (stable across local folder renames), then the display name, then a
  separator-normalized path, then a fixed constant. Reordering the PRNG draws
  would silently re-theme every repository, so the draw order is frozen.
- **Playback.** `RepositoryThemePlayer` (`app/src/lib/audio/theme-player.ts`)
  realizes the motif into note frequencies and loop timing
  (`repositoryThemeSequence`) and schedules them on a shared Web Audio context
  with a small look-ahead scheduler. It is renderer-only and entirely
  best-effort; any failure is swallowed so audio can never break the app.
- **Per-repository override.** A repository can be switched from its derived
  theme to either a user-chosen local file / URL (`custom`) or explicit silence
  (`off`); clearing the override returns it to the derived theme. Absence of an
  override in the document means "play the derived theme".
- **Display name.** `repositoryThemeName` (`repo-theme-name.ts`) composes a
  friendly localized label such as *"Dreamy Cascade in F#3 Dorian"* from the
  mood/texture/scale translation keys plus the note label. The Sound pane shows
  it for the current repository, with **Preview theme**, **Mute here**, **Choose
  track**, and **Use generated theme** controls.

## Configuration

- Preferences → **Sound** → *Per-repository music* → *Repository theme*.
- Localized in English, playful Hong Kong Cantonese, and bilingual mode via the
  `settings.soundTheme*` / `settings.repoTheme*` keys in
  `app/src/lib/i18n-resources.ts`. The funny-level tone setting affects narrator
  copy only; theme names and state/error copy stay plain.
- Searchable in Preferences via the `sound-repository-theme` entry in the
  settings-search catalog.

## Persistence

Per-repository selections moved **out of `localStorage`** into a dedicated,
Git-backed setting repository (`RepoMusicStore`,
`app/src/lib/stores/repo-music-store.ts`, wrapping `DedicatedSettingStore`).
This gives the choices the same append-only history, undo/redo, and restore
timeline as every other dedicated setting, stored beside the app's own data
directory (`<userData>/repository-music/themes`) — never inside a user
repository.

- **One-time migration.** On first load the audio cue store folds any legacy
  `audio-system-repo-music-v1` localStorage map into the document (each legacy
  track becomes a `custom` override), then removes the legacy key. Existing
  overrides always win, so the migration is idempotent and never clobbers a
  newer choice.
- A synchronous bootstrap cache reads the legacy value so the settings UI has
  something to show before the Git-backed store finishes loading.

## Failure modes

- No Web Audio context (headless / unsupported): the theme player is a no-op;
  the rest of the app is unaffected.
- No Git-backed store (e.g. outside the renderer, or `getPath` unavailable): the
  in-memory bootstrap cache still drives the derived themes and any legacy
  tracks; selections simply aren't versioned until the store is available.
- Corrupt or hand-edited documents are normalized field-by-field; unknown or
  malformed overrides are dropped rather than throwing.
- Autoplay policies can leave the context suspended until a user gesture; the
  player resumes best-effort and never surfaces an error.

## Security

- Seed derivation and document handling are pure and allocation-cheap; no
  network access and no third-party assets.
- The dedicated repository is created only under the app's own data directory
  with the same ownership-root and symlink/reparse-point guards every dedicated
  setting enforces; it never writes a `.git` into a user's repository.
- A per-document byte cap bounds a hand-edited file.

## Verification

- `app/test/unit/repo-theme-test.ts` — determinism (same seed → identical
  params), near-uniqueness and scale/tempo spread across a two-dozen-repository
  fixture list, field-range invariants, and sequence/frequency realization.
- `app/test/unit/repo-theme-name-test.ts` — localized name composition in
  English, Cantonese, and bilingual mode.
- `app/test/unit/repo-music-document-test.ts` — document normalization,
  serialization round-trip, override set/clear, and the pure legacy-map merge.
- `app/test/unit/repo-music-store-test.ts` — Git-backed durability across a
  reopen, per-change commit history, and the one-time localStorage migration
  (including idempotency and never overwriting a newer choice).
