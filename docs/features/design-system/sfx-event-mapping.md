# Distinct sound-effect event mapping

Builds on the [audio system](audio-system.md) to give each meaningful app event
its **own** recognizable sound effect instead of routing everything through the
shared commit / auto-commit cue. It covers the git network operations (push,
fetch, pull) and every Build & Run lifecycle phase, and organizes the cues into
four motif families so they read as a coherent set while staying individually
distinguishable.

Everything is still fully gated by the audio system's own settings (off by
default) and its throttle, quiet-hours, reduced-motion and screen-reader rules.

## What changed

- **push / fetch / pull are distinct end to end.** Previously a scheduled push
  narrated via the `auto-commit` notification and manual network operations had
  no distinct cue. Now `AppStore.performPush`, `performPull` and (user-initiated)
  `performFetch` emit their own category through `AudioCueStore.handleGitOperation`,
  which runs through the same pure `decideAudioActions` gate.
- **Build & Run phases each have a cue.** `App` subscribes to the `BuildRunStore`
  and forwards genuine phase transitions (`detecting`, `installing`, `building`,
  `running`, `succeeded`, `failed`, `cancelled`) to
  `AudioCueStore.handleBuildRunPhase`. The renderer-owned `gitignore` prep phase
  shares the light `detecting` progress cue. The resting `idle` phase is silent.
- **Motif families.** Cues are grouped into `success`, `progress`, `warning`,
  `error` and a `neutral` fallback (see `motifFamilyForCategory`). Success cues
  are bright rising sine arpeggios; progress cues are soft ascending triangle
  ticks; the warning (cancelled) cue is a calm, non-alarming fall; error cues are
  a heavy descending sawtooth. Within a family every category still has its own
  motif — e.g. a completed build (`succeeded`) resolves higher than the generic
  `success`, and a failed build (`failed`) sits lower than the generic `error`.

## Architecture

The event → category → motif mapping is a pure, DOM-free module,
`app/src/lib/audio/sfx-event-map.ts`:

- `categoryForSfxEvent(event)` maps a git operation or a build-run phase onto an
  `AudioCueCategory`.
- `motifFamilyForCategory(category)` classifies a category into its `MotifFamily`.
- `CategoryMotifs` / `motifForCategory(category)` hold the exact tone steps
  synthesized for each category. `ToneSynth` only turns those steps into Web
  Audio nodes; it owns no cue data of its own.

Wiring:

- `AudioCueStore.handleGitOperation` / `handleBuildRunPhase` route an event
  through `decideAudioActions` and play the synthesized cue (and, for speakable
  categories, a narrator line).
- `AppStore.emitGitAudioCue('push' | 'pull' | 'fetch')` is called at the success
  point of each network operation, best-effort and wrapped so audio can never
  break a git path.
- `App.syncBuildRunAudio(repositoryId)` tracks the last phase per repository and
  cues only on real transitions.

## Configuration

No new persisted setting is required — the cues reuse the existing SFX enable
toggle and volume. **Settings → Sound → Sound effects** gains an **Audition each
cue** grid: one accessible button per category, grouped by family, each playing
its synthesized cue regardless of throttling. All labels are localized (English,
Cantonese, bilingual) and a settings-search entry (`sound-cue-audition`) points
at the section.

### Cooldowns

Per-category SFX cooldowns live in `audio-throttle.ts`:

- `SfxCategoryCooldownMs` (900 ms) — terminal cues (git operations, `succeeded`,
  `cancelled`, generic outcomes).
- `ProgressSfxCooldownMs` (4000 ms) — the in-flight progress phases
  (`detecting` / `installing` / `building` / `running`), rate-limited harder so a
  busy build never stutters. `sfxCooldownForCategory(category)` selects the tier.
- Errors are always audible when SFX is enabled: `isEssentialCategory` returns
  true for both `error` and `failed`, so those bypass debounce, cooldown,
  quiet-hours and reduced-motion muting.

Narration follows the same "only meaningful events" rule as before: `succeeded`
and `failed` are spoken (funny-level-scaled for succeeded; clear and constant for
failed), while `fetch`, the progress phases and a plain `cancelled` are SFX-only.

## Failure modes

- No Web Audio / suspended context / autoplay block → cues silently no-op
  (`ToneSynth` swallows every error); the app is never affected.
- Audio disabled or master off → `decideAudioActions` returns a no-op before any
  synthesis.
- A git or build path throwing is impossible to trigger from audio: every emit
  is wrapped in `try/catch` and treated as best-effort.

## Security considerations

Synthesis is entirely local (Web Audio oscillators); no assets are fetched and
no event data leaves the renderer. The mapping is pure data with no user input.

## Verification

- `app/test/unit/sfx-event-map-test.ts` — exhaustive event → category → family →
  motif mapping: every git operation and every build-run phase maps to the
  expected category, every category has a family and a non-empty, distinct motif,
  the motif table covers exactly the category union, and family timbres hold.
- `app/test/unit/audio-throttle-test.ts` — progress cues are rate-limited harder
  than terminal cues, `failed` is essential (audible during quiet-hours /
  reduced-motion, bypasses cooldown), and push/pull/fetch each play with fetch
  staying SFX-only.
- `app/test/unit/audio-settings-test.ts` — new `succeeded` / `failed` narrator
  lines (scaled vs. constant) and the silent progress/cancel categories.
