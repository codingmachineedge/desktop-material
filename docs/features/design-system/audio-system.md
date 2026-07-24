# Audio system (narrator, sound effects, per-repository music)

An optional, settings-gated audio layer. Every part is **off by default** and
designed never to become annoying. Three cooperating parts:

1. **Spoken narrator (TTS)** — speaks selected, meaningful app events (commit,
   push, pull, success, errors) via the renderer `SpeechSynthesis` API, with
   natural voices for both English (`en-US`) and Hong Kong Cantonese
   (`zh-HK`). Rate-limited by a configurable cooldown so it never chatters.
2. **Sound effects (SFX)** — short cues synthesized with the Web Audio API
   (no bundled audio assets), one recognizable gesture per event category, with
   a volume control.
3. **Per-repository music** — an optional user-chosen track looped quietly for
   the active repository, pausable at any time.

## User workflow

Open **Settings → Sound**. The master switch gates the entire system; the three
parts each have their own enable toggle, volume slider, and previews. The
narrator adds a per-language funny-level (English and Cantonese, 1–5), a
minimum-gap slider, and a preview. Music is chosen per repository via a file
picker (mp3/ogg/wav/m4a/flac/aac). Quiet hours and a "follow reduced-motion"
toggle round out the anti-annoyance controls.

## Event routing

App events reach audio through the in-app notification centre. `App` diffs the
newest-first notification list on every `AppStore` update and forwards only
genuinely new (non-replayed, deduped) entries to `AudioCueStore`. Startup
history is seeded silently. Each `NotificationCentreKind` maps to an audio cue
category (`categoryForNotificationKind`).

## Anti-annoyance rules (pure, tested)

`decideAudioActions` (in `app/src/lib/audio/audio-throttle.ts`) is a pure
function — the clock is passed in — so throttling is fully unit-tested:

- Master switch off → nothing plays.
- Quiet hours and reduced-sound mute everything **except errors**.
- SFX: a global debounce (250 ms) plus a per-category cooldown (900 ms).
- Narrator: a configurable cooldown between lines; low-signal `info`/`fetch`
  are never spoken; a screen reader being active suppresses narration to avoid
  double-speak.
- Errors are always essential: they bypass cooldown, debounce, quiet-hours,
  reduced-sound, and screen-reader suppression, and their spoken line is
  identical at every funny-level so the message stays clear.

## Localization and tone

Spoken line templates live in `app/src/lib/audio/narrator-lines.ts`, separate
from logic, with English and Cantonese variants per category and three tone
bands the funny-level selects (1–2 plain, 3 light, 4–5 playful). Error lines
are level-independent and clear. The spoken locale follows the persisted
language mode (bilingual mode speaks one side). All Settings copy is localized
through `i18n-resources` (`settings.sound*`) in English, Cantonese, and
bilingual.

## Persistence

- `AudioSettingsStorageKey` (`audio-system-settings-v1`) — a JSON blob of the
  settings, normalized/clamped on read so a corrupt or hand-edited value can
  never break audio.
- `AudioRepoMusicStorageKey` (`audio-system-repo-music-v1`) — a
  repository-path → track map.

`normalizeAudioSettings`, `parse/serializeAudioSettings`, and the repo-music
map helpers are pure and round-trip tested.

## Accessibility and safety

- Reduced-motion is honored as a "reduced sound" analog (opt-out available).
- Screen-reader coexistence: narration is suppressed when a screen reader would
  announce the same content; errors still speak.
- All controls are keyboard reachable with visible focus and labelled sliders.
- Audio is strictly best-effort: every playback path is wrapped so a failure
  (no `AudioContext`, no voices, blocked autoplay) is swallowed and never
  propagates into app-state handling.

## Failure modes

- No Web Audio / SpeechSynthesis available → silent no-op, app unaffected.
- Autoplay blocked until a user gesture → music resumes on the next update; SFX
  attempt `context.resume()`.
- Missing Cantonese/English voice → falls back to any language-family match,
  else the platform default.

## Verification

- `app/test/unit/audio-throttle-test.ts` — throttle/cooldown/quiet-hours/
  reduced-sound/screen-reader/error-bypass decisions.
- `app/test/unit/audio-settings-test.ts` — settings + repo-music serialization,
  clamping, and narrator line selection.
- `npx tsc --noEmit` clean.

This category has no HTTP API. Postman collections are not applicable.
