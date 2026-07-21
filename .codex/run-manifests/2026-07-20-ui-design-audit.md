# UI Design Audit — M22 Gallery Completion Run Manifest

## Scope

- Mode: `handoff` (publication paused at the user's request)
- Milestone: M22 Material Design UI audit and gallery completion
- Worktree: isolated `codex/ui-design-audit-20260720`
- Expected integration target: `main`
- Initial baseline: audit branch contains the completed UI audit history plus
  organization Git authentication commit `f21c6255bb`; `yarn.cmd` is an owned,
  untracked build shim and must never be committed.
- Product boundary: Windows application only. All UI work stays on an
  off-screen Win32 desktop through the fixed Lowlevel MCP service.

## Required verification

1. Revalidate the fixed MCP scheduled-task contract, service checkout SHA, and
   isolated worktree path.
2. Run exactly `npx --no-install cross-env RELEASE_CHANNEL=development
   DESKTOP_SKIP_PACKAGE=1 yarn build:prod` through MCP with no dependency
   download.
3. Use a short owned Temp root below
   `%TEMP%\desktop-material-p0-ui-r6-9f64a2c1` for fixtures, profile, captures,
   and cleanup ledger. Resolve containment before removal.
4. Capture the canonical gallery only on an owned headless desktop. Inspect
   every candidate at original resolution and preserve existing M24 sparse
   captures byte-for-byte.
5. Promote only the absent M22 captures:
   `material-repository-folder-detection.png`,
   `material-repository-submodule-management.png`, and
   `material-cheap-lfs-preparing.png`.
6. Update the 69-item public gallery/docs contract, run static and runtime
   checks, then commit, push, merge into `main`, push `main`, verify CI/release,
   prove ancestry, and remove this merged branch/worktree only after remote
   proof.

## Safety constraints

- Do not modify the default checkout or its unrelated `gemoji` deletions.
- Do not replace M24 sparse screenshot blobs.
- Do not expose, focus, or switch to the visible desktop.
- Do not record user paths, identities, credentials, or tokens in captures,
  logs, or documentation.

## MCP preflight receipt

- `startup_status`: `client_ok: true`; scheduled task running.
- Fixed service command: repository-pinned Python runs
  `lowlevel_computer_use_mcp.server --http --host 127.0.0.1 --port 8765` from
  the fixed MCP checkout.
- MCP checkout: `ed1427f69b20dcd66df1de2ae3c6ba6591e2e640`.
- The isolated worktree's owned `yarn.cmd` resolves only to the pinned
  `vendor/yarn-1.21.1.js` runtime, allowing the exact required command without
  installing Yarn globally.

## Execution ledger

- The exact required production build completed from source
  `f21c6255bb8fd8978cd332c27f71e18cdc3fc549` through the fixed MCP service in
  264.6 seconds with `client_ok: true`, exit code 0, and no timeout. It used
  the owned pinned-Yarn shim without downloading a dependency.
- Build artifact receipt:

  | Artifact | Bytes | SHA-256 |
  | --- | ---: | --- |
  | `out/main.js` | 4,280,983 | `4fc70af5dd1e2ec88ce0008fcf410647ba91b3fff83cd1f864c1bfc4ff1a752a` |
  | `out/renderer.js` | 9,568,530 | `8c4356d93e2666a22121b301e4f93611a7ac95b3544f5c3c43d195515794840f` |
  | `out/index.html` | 236 | `d44d3b8f637b17fc75c9f3ea14bc08166a7fa931de46b6ea41971ccd6131f553` |
  | `out/keytar.node` | 707,584 | `391976ea3af33d6697a9df2e007a8a00d5c7e0aa6f08c7eceeb21fb483591c09` |
  | Electron x64 | 226,577,920 | `082d352efc6a9f5882354ee4096ae0b40b78bc6c8e52fc5084f3df9254c613ff` |

- Capture is pending. The temporary `yarn.cmd` shim was removed immediately
  after the successful build and remains uncommitted.

## Handoff status

- The user requested consolidation before the headless gallery capture began.
  No fixture, desktop, provider, credential, screenshot candidate, or promoted
  image was created by this run.
- The committed audit history remains ready for a later final visual-capture
  pass. Resume from this receipt only after reconciling the target `main` tip,
  then run the canonical capture and promote no assets without original-pixel
  inspection.
- This handoff records the accepted exact build receipt only; it does not claim
  completed runtime verification, gallery publication, CI, release, or Pages
  verification.
