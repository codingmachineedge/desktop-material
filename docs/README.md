# Desktop Material documentation

Desktop Material keeps the upstream
[GitHub Desktop](https://github.com/desktop/desktop) development documentation
while adding product, Material Design, acceptance, and publishing guidance for
this fork.

Desktop Material itself is supported and released on Windows only. Inherited
non-Windows source and historical upstream documentation do not define a
supported runtime; see [Windows-only platform support](features/integrations/windows-only-platform-support.md).

## Product and Material design

- **[Project overview](../README.md)** - shipped workflows and the compact
  screenshot gallery
- **[Desktop Material roadmap](../ROADMAP.md)** - completed milestones,
  current maintenance, and acceptance gates
- **[Feature and acceptance plan](../PLAN.md)** - implementation ledger,
  architecture contracts, and historical receipts
- **[Material redesign contract](../MATERIAL_REDESIGN.md)** - design system,
  customization scopes, adaptive app-bar behavior, and entry surfaces
- **[Feature documentation](features/README.md)** - categorized user workflows,
  persistence boundaries, failure modes, security notes, and acceptance targets
- **[Tab groups](features/identity-and-workspace/tab-groups.md)** - named,
  colored, collapsible repository-tab organization with profile persistence
- **[Command palette appearance](features/design-system/command-palette-appearance.md)**
  - localized row density, icons, group chips, and search-term presentation
- **[Verification records](verification/README.md)** - reproducible local
  acceptance evidence and links to exact publication receipts

Appearance is now owner-scoped. Right-clicking an actual visual opens an editor
beside it; every profile element, feature entry point, repository element, and
tab title has its own strict setting, local Git repository, and mutable history.
Ordinary language/theme/scale preferences stay in Settings, and Repository
Settings no longer has a monolithic Appearance tab. The measured app bar moves
Build & Run and then Commit & Push into **More** before clipping and restores
those mounted actions as space returns.
The pure Material Welcome and landing redesigns share the same token and surface
language.

The same shipped maintenance release adds pinned/manual/one-shot tab arrangement,
preserves the original regex close action, and adds a guarded literal
close-everything-except match with live counts and preview. It also completes
exact workflow-run cancellation, reviewed current-branch rebase, and immediate
Provider Triage propagation of the repository account selected in settings;
aligns GitHub OAuth with the bounded feature scopes; and corrects compact-height
scrolling/reflow in Repository Tools, Remote Manager, and Regex Builder. These
items passed the integrated production build, focused and repository-wide
checks, off-screen interaction review, compact/zoomed geometry gates, and
privacy review recorded in the acceptance ledger.

Settings now gives the durable background clone policy its own **Clone queue**
destination, with account-scoped directory, parallel/sequential mode, and
enable controls. **Settings → Agent access** also opens the configured mobile
site with a newly generated one-use pairing fragment when Paired LAN mode is
running. The behavior, failure, persistence, and security boundaries are
documented in [Clone queue settings](features/repository-management/clone-queue-settings.md)
and the [Local Agent HTTP API](features/agent-api/local-agent-http-api.md).

The application-menu Pull action and a right click on the toolbar Pull button
now fetch before
showing a bounded review of the exact local/upstream identities, incoming
commits, changed files, and configured integration route. Confirmation requires
a clean worktree and integrates only the full reviewed upstream object ID; a
failed fetch cannot fall back to stale tracking data. Scheduled and local-agent
automation remain noninteractive. Behavior, recovery, security, configuration,
language modes, and verification are documented in
[Reviewed ordinary Git pull previews](features/repository-management/pull-previews.md).

The locally accepted repository-navigation change adds
**Open temporary viewer** to initialized Submodule Manager rows and changed/new
submodule commit cards. The resulting read-only workspace is temporary: it does
not enter the repository list, Recent group, or persisted last selection, and
both **Close viewer** and the profile-customizable Back control return to the
persisted root repository while clearing temporary state. Right-clicking Back
opens its dedicated editor and
history beside it; explicit English, playful Hong Kong Cantonese, and compact
bilingual language remain ordinary preferences.
Behavior, persistence, containment checks, and failure recovery are documented
in [Temporary submodule repository navigation](features/repository-management/submodule-repository-navigation.md).
The earlier accepted exact production build, ten-pass off-screen evidence, and
promoted capture hashes are recorded in the [run manifest](../.codex/run-manifests/2026-07-18-ci-10-pass-submodule-navigation.md).
After the later stale-parent correction, the same MCP command rebuilt the
renderer but its client stream detached before returning a receipt; the fresh
bundle then passed the final 1440×960 duplicate Open/Back race regression
recorded in the [final race manifest](../.codex/run-manifests/2026-07-19-final-exact-race-regression.md).
Local validation finished at 237/237 focused, 66/66 lifecycle, 32/32
localization, all 562 unit-test files (3,986 passing tests and one skipped),
and 16/16 script tests, with TypeScript, lint, workflow checks, and diff checks
green. Owned app, provider, CDP, credential, desktop, and fixture resources were
cleaned. Initial remote CI exposed a macOS arm64 symlink/junction error-ordering
issue and correctly emitted no release; correction `98d93ccc` passed the full
CI matrix, CodeQL, and gated installer publication as
`v3.6.3-beta3-b0000000165`. Exact Pages, wiki, asset, and cleanup evidence is
recorded in `HANDOFF.md`.

The current six-image local acceptance refresh is
[`material-repository-tools.png`](assets/screenshots/material-repository-tools.png),
[`material-repository-tools-scroll.png`](assets/screenshots/material-repository-tools-scroll.png),
[`material-effective-branch-rules.png`](assets/screenshots/material-effective-branch-rules.png),
[`add-submodule-dialog.png`](assets/screenshots/add-submodule-dialog.png),
[`material-customization.png`](assets/screenshots/material-customization.png), and
[`material-submodule-context.png`](assets/screenshots/material-submodule-context.png).
The earlier adaptive-maintenance captures and their original hashes remain
historical evidence in `PLAN.md` and `HANDOFF.md`; the current file hashes are
the values in this run's manifest.

## Contributing

If you are interested in contributing to the project, you should read these
resources to get familiar with how things work:

- **[How Can I Contribute?](../.github/CONTRIBUTING.md#how-can-i-contribute)** -
  details about how you can participate
- **[Development Environment Setup](contributing/setup.md)** - everything
  you need to know to get Desktop up and running
- **[Engineering Values](contributing/engineering-values.md)** - our
  high-level engineering values
- **[Style Guide](contributing/styleguide.md)** - notes on the coding style
- **[Tooling](contributing/tooling.md)** - if you have a preferred IDE,
  there's some enhancements to make your life easier
- **[Troubleshooting](contributing/troubleshooting.md)** - some additional
  known issues if you're having environment issues

## Process

Details about how the team is organizing and shipping Desktop Material:

- **[Upstream historical roadmap](process/roadmap.md)** - shipped GitHub
  Desktop release themes inherited by the fork
- **[Release Planning](process/release-planning.md)** - how we plan and execute
  releases
- **[Issue Triage](process/issue-triage.md)** - how we address issues reported
  by users
- **[Pull Requests](process/pull-requests.md)** - how code contributions are
  submitted and reviewed
- **[Writing Release Notes](process/writing-release-notes.md)** - how
  user-facing changes are described for a release

## Technical

These documents contain more details about the internals of GitHub Desktop
and how things work:

- **[Dialogs](technical/dialogs.md)** - details about the dialog component API
- **[Windows menu bar](technical/windows-menu-bar.md)** - Electron doesn't
  provide inbuilt support for styling the menu for Windows, so we've created
  our own custom components to achieve this.
- **[Developer OAuth App](technical/oauth.md)** - GitHub Desktop ships with
  the ability to OAuth on behalf of a user. A developer OAuth app is bundled
  to reduce the friction of getting started.
- **[Building and Packaging Desktop](technical/packaging.md)** - outlines how
  Desktop is built and packaged for Windows
- **[Automatic Git Proxy support](technical/proxies.md)** - a pre-launch
  overview and troubleshooting guide for Git automatic proxy support
