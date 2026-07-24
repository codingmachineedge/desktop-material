# Recorded narration + melody assets

Wires the 244 pre-generated audio assets in `app/static/audio/` into the
optional audio runtime, so meaningful events can play a recorded human-style
voice line and a composed melody instead of live speech synthesis and a
synthesized cue. It builds on the [audio system](audio-system.md); the same
gating, throttling, quiet-hours, reduced-sound, and screen-reader rules apply
unchanged.

## Behavior

- **Manifest.** `app/static/audio/manifest.json` lists 81 narrated events. Each
  event has an `id`, a `category`, an English clip (`<id>.en.mp3`), a Cantonese
  clip (`<id>.yue.mp3`), and a melody (`<id>.melody.wav`). The manifest is
  imported at build time by `app/src/lib/audio/narration-assets.ts`, which
  normalizes it defensively (a malformed entry is skipped, never thrown).
- **Recorded narration.** When an event maps to a manifest id and recorded
  narration is enabled, the narrator plays the pre-generated clip for the active
  narration language instead of live TTS:
  - English mode → the `.en.mp3` clip.
  - Cantonese mode → the `.yue.mp3` clip.
  - Bilingual mode → English **then** Cantonese, strictly one after another.
- **Non-overlapping queue.** A single serialized narration queue plays one voice
  at a time (recorded clips and any live fallback share it). A newer event
  supersedes anything still queued for an older event and stops the current clip,
  so voices are replaced, never layered. This holds for the two-clip bilingual
  case: the pair is queued together and only a later event interrupts it.
- **Melody cue.** When recorded narration is enabled and the event has a melody,
  its `.melody.wav` plays as that event's sound effect in place of the
  synthesized tone. The melody and the voice are separate channels and may
  sound together, exactly as the synthesized cue and live TTS do today.
- **Event mapping.** Notification kinds map to manifest ids in
  `narration-assets.ts` (`narrationEventIdForKind`): `auto-commit` →
  `commit-created`, `auto-pull` → `pull-complete`, `merge-all` and `clone-batch`
  → `all-done`, `cheap-lfs` → `cheaplfs-restored`. Kinds with no specific
  recording (generic `app-error`, low-signal `info`) return `null` and use the
  existing category-based live narrator.
- **Preview.** The Sound pane's *Preview narration* button plays the recorded
  `commit-created` clip in the active narration language when recorded narration
  is on, otherwise the live line. It bypasses throttling but honors the toggle.

## Configuration

- **Setting:** `useRecordedNarration` in `IAudioSystemSettings`
  (`app/src/lib/audio/audio-settings.ts`), persisted in the existing
  `audio-system-settings-v1` localStorage blob. Default **on** (the assets ship
  with the app).
- **UI:** *Use recorded narration* toggle in Settings → Sound, under the Spoken
  narrator group. Localized in English and Cantonese and indexed in the
  settings-search catalog (`sound-recorded-narration`).
- **Language:** the active narration language follows the app language mode
  (English / Cantonese / bilingual) via `narrationLocalesForMode`. Funny-level
  still scales only the live-TTS fallback text, never the recorded clips or any
  error copy.

## Failure modes

- **Missing / undecodable clip.** If a recorded clip fails to load, decode, or
  autoplay, that utterance falls back to the existing live TTS line for the same
  event; the rest of the queue continues. In bilingual mode a single failed clip
  falls back on its own without dropping the other language.
- **Missing melody.** If a melody fails to load or play, the event falls back to
  the synthesized `tone-synth` cue.
- **Absent manifest.** If the manifest fails to load or an event id is unknown,
  the runtime behaves exactly as the live audio system did (live TTS + synth).
- **Errors stay plain.** Error narration is never suppressed by these paths and
  the spoken/notification error copy stays clear and literal at every
  funny-level, matching the audio system's rules.

## Security

- All media is loaded from bundled `file://` URLs under the app's own
  `static/audio` directory via `encodePathAsUrl(__dirname, 'static/audio', …)`.
  No network requests, no remote assets, and no user-supplied paths are involved
  (the per-repository music feature remains the only user-path audio source).
- Playback is best-effort and fully sandboxed from app logic: every audio call
  is wrapped so a decode/playback failure can never propagate into the renderer.

## Build

`script/build.ts`'s `copyStaticResources()` copies `app/static/audio` into the
packaged `static/audio` folder (the top-level `audio` directory is not part of
`common/`, so it is copied explicitly) so the renderer's `file://` URLs resolve
in a packaged build.

## Verification

- `app/test/unit/audio-narration-manifest-test.ts` reads the filesystem and
  asserts that every manifest event has all three files on disk, that ids are
  unique, that every runtime-narrated event id exists in the manifest with its
  assets present, and that each narrated notification kind maps to a real event
  id (while generic errors intentionally map to none). It also checks the
  language → locale selection (bilingual = English then Cantonese).
- `app/test/unit/audio-settings-test.ts` covers the `useRecordedNarration`
  default and coercion.
- Gating is unchanged and still proven by `app/test/unit/audio-throttle-test.ts`
  (cooldowns, quiet hours, reduced-sound, screen-reader coexistence, errors
  never suppressed).
