# Tab-strip settings commit chip

The repository tab strip's trailing cluster carries the signature per-account
settings-repo feedback from the v2 design: a persistent commit chip, a
Settings-history entry point, and undo/redo controls that dim when there is
nothing to act on. Together they make the account's local settings repository
visible without opening a dialog.

## Behavior and configuration

The trailing cluster renders, left to right: the notification bell, the commit
chip, undo, redo, and the Settings-history button.

- **Commit chip.** A pill using the `commit` Material Symbol and a monospace
  label. At rest it reads `Saved · <shortSha>` in the neutral
  surface-container-highest tone, where `<shortSha>` is the abbreviated HEAD of
  the active profile's settings repository (an em dash when history is empty or
  unavailable). When a genuinely new commit lands, the chip flips to the
  primary-container tone, its label becomes `Committed <shortSha>`, and the
  glyph plays a single `dmBounce` pulse. The pulse class is removed on
  `animationend`, with a short timer as a fallback, and is never applied under
  reduced motion. A hover tooltip explains that every tab and settings change
  commits to the account's local settings repo.
- **Undo / redo.** The existing settings undo and redo actions are unchanged;
  each control now dims to ~0.35 opacity and is disabled whenever the store
  reports nothing to undo (respectively redo) at HEAD, keeping the affordance
  present but visibly inert.
- **Settings history.** A `manage_history` Material Symbol button opens the
  existing settings-history manager by dispatching the `SettingsHistory` popup —
  the same viewer reachable from the application menu.

All labels ship in English, playful Hong Kong Cantonese, and the compact
bilingual mode through the shared translation catalog.

## Persistence

This surface owns no persistence. It presents state that already lives in the
per-account settings repository. The tab store exposes a read-only
`ISettingsCommitSummary` (`sha`, `shortSha`, `canUndo`, `canRedo`) obtained from
the same profile-history read the settings-history dialog performs, and emits a
dedicated `did-update-settings-commit` event only when that summary actually
changes. Commit, undo, redo, and restore semantics are untouched — the chip is
presentation and wiring only.

## Failure modes and recovery

The summary refresh is defensive: against a disabled or history-less profile
store it is a no-op, leaving the chip at `Saved · —` with undo and redo
disabled. Refreshes triggered by tab activity are debounced past the profile
store's own commit window so the read observes the naturally committed HEAD and
never forces an early flush that would split batched changes. A failed history
read is logged and leaves the previous summary in place. Pulse and refresh
timers plus the summary subscription are disposed on unmount.

Because the refresh is driven by tab-store updates, undo/redo, and mount, a
settings-only change made elsewhere (for example a Preferences toggle) is
reflected on the next tab-store update rather than instantly.

## Security considerations

The chip renders an abbreviated commit sha and localized static copy only; it
never displays repository contents, credentials, or paths. The Settings-history
button dispatches an internal popup type and performs no navigation to
externally supplied targets.

## Verification

`repository-tab-sha-chip-test.tsx` covers the rendered short sha, the pulse and
`Committed` label on a new commit event, pulse clearing on `animationend`,
suppression under reduced motion, undo/redo disabled state following the store,
and the Settings-history button dispatching the `SettingsHistory` popup. Its
store-level block covers the summary read, change-only notification, and the
no-op path when the profile store lacks history support.
