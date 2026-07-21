# UI design audit cleanup ledger

- Run ID: `ui-design-audit-2026-07-20-9f64a2c1`
- Owned temporary root:
  `<system temporary folder>\desktop-material-ui-audit-20260720-9f64a2c1`
- Owned reference extraction: `<temporary-root>\reference`
- Owned Git fixture: `<temporary-root>\fixture`
- Owned bare fixture remote: `<temporary-root>\remote.git`
- Owned fixture provisioner: `<temporary-root>\prepare-fixture.ps1`
- Owned Electron user data: `<temporary-root>\user-data`
- Owned captures: `<temporary-root>\captures`
- Owned command shim: `<temporary-root>\bin\yarn.cmd`
- Owned canonical-gallery runtime root:
  `<system temporary folder>\desktop-material-p0-ui-design-audit-20260720-9f64a2c1-gallery-en-light-resume1`
  (confirmed absent before creation; rejected before the first scene when the
  pristine welcome shell could not render Preferences; fully removed after the
  exact credential, process, listener, window, and desktop cleanup below).
- Owned second diagnostic canonical-gallery runtime root:
  `<system temporary folder>\desktop-material-p0-ui-design-audit-20260720-9f64a2c1-gallery-en-light-resume2`
  (confirmed absent before creation; rejected at the first capture because this
  Electron runtime exposes a complete `document.fonts` object without a global
  `FontFaceSet` constructor; fully removed after exact cleanup).
- Owned third diagnostic canonical-gallery runtime root:
  `<system temporary folder>\desktop-material-p0-ui-design-audit-20260720-9f64a2c1-gallery-en-light-resume3`
  (confirmed absent before creation; welcome and all font gates passed, then
  rejected because synthetic Escape could not close Preferences through two
  stacked first-run dialogs; fully removed after exact cleanup).
- Owned fourth diagnostic canonical-gallery runtime root:
  `<system temporary folder>\desktop-material-p0-ui-design-audit-20260720-9f64a2c1-gallery-en-light-resume4`
  (confirmed absent before creation; rejected after eight candidate PNGs when
  the repository-toolbar appearance editor exposed an initialization failure;
  fully removed after exact cleanup).
- Owned fifth diagnostic canonical-gallery runtime root:
  `<system temporary folder>\desktop-material-p0-ui-design-audit-20260720-9f64a2c1-gallery-en-light-resume5`
  (confirmed absent before creation; rejected after eight candidate PNGs when
  lazy repository appearance stores crossed the Windows Git object-path limit;
  fully removed after exact cleanup).
- Owned final canonical-gallery runtime root:
  `<system temporary folder>\desktop-material-p0-ui-r6-9f64a2c1`
  (planned; must be confirmed absent before creation; its resolved path must
  remain at or below the runtime plan's 96-character ceiling).
- Audit-worktree dependency junctions: `node_modules` and `app\node_modules`.
- Audit-worktree gemoji state: isolated local shared clone at pinned gitlink
  `50865e8895c54037bf06c4c1691aa925d030a59d`; clean detached HEAD with all 845
  tracked Unicode images present.
- Audit-worktree local submodule copies (from the initialized default checkout,
  excluding all `.git` metadata): `app\static\common\choosealicense.com` and
  `app\static\common\gitignore`
- Copied submodule pointer files quarantined at
  `<temporary-root>\copied-git-metadata` so the audit worktree cannot resolve
  them against the default checkout's Git metadata.
- Detached unsafe build reparse points are quarantined at
  `<temporary-root>\detached-reparse-points`; this directory must never be
  recursively removed while they remain reparse points.
- Build-output repair: `out\emoji` is now a real directory containing the
  non-Unicode image set, not a reparse point.
- Definitive post-merge build source: audit-branch commit `52bfcf3e53`; the
  fixed-server MCP build returned `client_ok: true`, `returncode: 0`,
  `timed_out: false` (241.2 seconds client wall time; Yarn 239.33 seconds).
- Definitive emitted artifact SHA-256 values: `out\main.js`
  `4FC70AF5DD1E2EC88CE0008FCF410647BA91B3FFF83CD1F864C1BFC4FF1A752A`,
  `out\index.html`
  `D44D3B8F637B17FC75C9F3EA14BC08166A7FA931DE46B6EA41971CCD6131F553`,
  `out\keytar.node`
  `391976EA3AF33D6697A9DF2E007A8A00D5C7E0AA6F08C7ECEEB21FB483591C09`,
  and Electron
  `082D352EFC6A9F5882354EE4096AE0B40B78BC6C8E52FC5084F3DF9254C613FF`.
- Cross-worktree incident: the first hydrated build preserved the source
  junction as `out\emoji`; its normal `out\emoji\unicode` removal traversed to
  the default checkout and deleted 845 tracked submodule images. The M24 task
  applied and dropped preservation stash
  `c92556b9f422ac258eebabebb79a1a87a8a66a37`, leaving the 845 deletions
  intentionally preserved and unstaged in the default submodule with an empty
  stash list. Those paths and the default checkout remain M24-owned state; this
  audit must not restore, reset, stage, delete, or otherwise alter them.
- Diagnostic headless desktop: `DesktopMaterialAudit-20260720-9f64a2c1`
- Second diagnostic headless desktop:
  `DesktopMaterialAuditFinal-20260720-9f64a2c1-r2`
- Third diagnostic headless desktop:
  `DesktopMaterialAuditFinal-20260720-9f64a2c1-r3`
- Fourth diagnostic headless desktop:
  `DesktopMaterialAuditFinal-20260720-9f64a2c1-r4`
- Fifth diagnostic headless desktop:
  `DesktopMaterialAuditFinal-20260720-9f64a2c1-r5`
- Final headless desktop:
  `DesktopMaterialAuditFinal-20260720-9f64a2c1-r6`
- Temporary-root state: created and path-validated beneath `%TEMP%`
- Fixture state: deterministic `material-shell` branch at
  `ab393b42a40bef78ede163ee6786811707bf4659`, tracking the owned bare remote,
  with exactly eight intended working-tree changes (five modified, three new).
- Diagnostic desktop state: created exactly once with handle `1124`; closed
  with `closed: true` after its window list reached zero.
- Diagnostic launch PID: `25532`; the alternate-desktop graceful close failed
  closed, so its exact executable, `out\main.js`, profile, fixture, and CDP port
  were revalidated before terminating only this saved PID.
- Diagnostic resolved HWND: `223937652` (`Desktop Material`,
  `Chrome_WidgetWin_1`, dynamically resolved from the named desktop).
- Diagnostic runtime cleanup: production credential deleted and independently
  verified absent; provider PID `23188`/port `62739` stopped after exact
  command-line and listener ownership validation; CDP port `62800` absent;
  owned root removed; all process/listener/root checks returned absent.
- Second diagnostic desktop state: created exactly once with handle `1304`;
  closed with `closed: true` after its window list reached zero.
- Second diagnostic launch PID/HWND: `34620` / `354878052`; exact provenance
  was revalidated before saved-PID fallback cleanup.
- Second diagnostic provider/CDP: provider PID `34584` / port `58469`; CDP port
  `58519`; credential independently verified absent and every process,
  listener, desktop, and owned-root check passed after cleanup.
- Third diagnostic desktop state: created exactly once with handle `1276`;
  closed with `closed: true` after its window list reached zero.
- Third diagnostic launch PID/HWND: `16696` / `3670620`; exact provenance was
  revalidated before saved-PID fallback cleanup.
- Third diagnostic provider/CDP: provider PID `18916` / port `65287`; CDP port
  `65338`; credential independently verified absent and every live process,
  listener, desktop, and owned-root check passed after cleanup. Three
  ownerless `TIME_WAIT` rows remained briefly on the CDP port with
  `OwningProcess=0`; there was no listener or live child process.
- Fourth diagnostic desktop state: created exactly once with handle `964`;
  closed with `closed: true` after its window list reached zero.
- Fourth diagnostic launch PID: `36380`; exact executable, `out\main.js`,
  profile, fixture, and CDP port provenance was revalidated before terminating
  only this saved PID after the alternate-desktop close failed closed.
- Fourth diagnostic resolved HWND: `27460744` (`Desktop Material`,
  `Chrome_WidgetWin_1`, dynamically resolved from the final named desktop)
- Fourth diagnostic provider PID/port: serving PID `20016` plus its exact owned
  Python launcher PID `31036` / port `50784`; both were stopped only after
  command-line, root, script, and listener ownership validation.
- Fourth diagnostic CDP port: `50840`
- Fourth diagnostic failure evidence: the selected state was Repository / Changes
  and matched the owned fixture by ID and path; the toolbar existed and consumed
  both root and neutral-child context-menu events, but the dispatcher reported
  `isElementAppearanceCoordinatorReady() === false` and the visible notice read
  `Element appearance settings are not initialized.` The owned application log
  traced this to a renderer reload abandoning the empty
  `default-repository-logo.desktop-material.lock` during profile-store
  initialization. None of the eight diagnostic PNGs were promoted.
- Fourth diagnostic cleanup: production credential deleted and independently
  verified absent; both owned provider processes, provider/CDP listeners,
  Electron process tree, named desktop, and runtime root verified absent. Port
  `8765` retained only the standing MCP daemon listener (PID `3764`).
- Fifth diagnostic desktop state: created exactly once with handle `1068`;
  closed with `closed: true` after its window list reached zero.
- Fifth diagnostic launch PID/HWND: `5824` / `113444168`; exact executable,
  bundle, profile, fixture, and CDP provenance was revalidated before the
  saved-PID fallback cleanup.
- Fifth diagnostic provider/CDP: serving PID `12944` plus exact owned launcher
  PID `34652` / provider port `52059`; CDP port `52116`.
- Fifth diagnostic failure evidence: all coordinator gates passed, the selected
  Repository / Changes state matched the owned fixture, and the toolbar event
  was consumed. The 120-character root produced existing appearance Git object
  paths of 259 characters; subsequent lazy repository element initialization
  failed `git add -A` with `Filename too long`, so the async editor target was
  never assigned. None of the eight diagnostic PNGs were promoted.
- Fifth diagnostic cleanup: production credential deleted and independently
  verified absent; both owned provider processes, provider/CDP listeners,
  Electron process tree, named desktop, and runtime root verified absent. Port
  `8765` retained only the standing MCP daemon listener (PID `3764`).
- Final desktop state: not created
- Final launch PID: not assigned
- Final resolved HWND: not assigned
- Final provider PID/port: not assigned
- Final CDP port: not assigned
- Cleanup state: pending
