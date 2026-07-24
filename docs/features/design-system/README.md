# Design-system features

- [Command palette rows and
  appearance](command-palette-appearance.md) — icon/keyword/group rows, the
  anchored Customize appearance editor, and discoverability entries for
  otherwise-buried surfaces.
- [Material ripple and theme reveal](material-ripple-and-theme-reveal.md) —
  shared interaction feedback and bounded animated theme transitions.
- [Dialog wheel and trackpad scrolling](dialog-wheel-scrolling.md) — route
  pointer scrolling from any descendant to the nearest usable dialog scroll
  owner while preserving nested controls and stacked-panel behavior.
- [Audio system](audio-system.md) — optional, off-by-default spoken narrator,
  synthesized sound effects, and per-repository music, with rate-limiting,
  quiet hours, reduced-sound, screen-reader coexistence, and funny-level tone.
- [Repository-themed music](repository-theme-music.md) — a deterministic,
  synthesized looping theme per repository (no bundled files) seeded from its
  identity, with per-repo custom-track/mute overrides persisted in a Git-backed
  dedicated setting and a one-time migration from localStorage.

This category has no HTTP API. Postman collections are not applicable.
