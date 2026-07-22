# Tab groups and command palette verification — 2026-07-22

This receipt records local acceptance for the persistent tab-group and rich
command-palette continuation. It does not claim a commit, remote publication,
CI, Pages, wiki, or installer Release result.

## Reproducible build

- Build route: fixed Lowlevel MCP HTTP endpoint at `http://127.0.0.1:8765/mcp`
- Command (shown with PowerShell continuations for readability):

  ```powershell
  npx --no-install cross-env `
    RELEASE_CHANNEL=development `
    DESKTOP_SKIP_PACKAGE=1 `
    yarn build:prod
  ```

- Result: passed in 394.1 seconds with `client_ok: true`

## Off-screen runtime acceptance

The application ran on one isolated Win32 headless desktop with a disposable
synthetic Git fixture and isolated user data. Chromium did not accept background
coordinate input consistently, so the run used the documented app-native
Playwright CDP hook without showing or switching to the off-screen desktop.

- A named group persisted across relaunch.
- Collapsing set the group chip to `aria-expanded="false"`, left it selected,
  and exposed `role="tab"` while hiding its member.
- Expanding returned `aria-expanded="true"` and made the repository member
  visible again.
- The command-palette appearance editor was visible and fully contained, its
  Reset control remained visible, and the `ollama` search returned five matches.

## Accepted captures

Both PNGs were inspected at original resolution for expected state, clipping,
blank output, and private data before promotion.

- `docs/assets/screenshots/material-tab-groups.png`
  - Dimensions: 1000×687
  - Bytes: 94,467
  - SHA-256:
    `fd857137f71b79fbef65225e4469f2d2e3d95ecb6701e4847b84da11ad2875b8`
- `docs/assets/screenshots/material-command-palette-appearance.png`
  - Dimensions: 1000×687
  - Bytes: 99,234
  - SHA-256:
    `ac4db2aa3696d2e1987c0c93573ccf48f86c61111e42fcabf0cec54db3b87a7d`

README, Pages, the wiki User Guide, and the Guided Feature Gallery all reference
the two accepted assets. The gallery contract now assigns every one of the 71
tracked screenshot PNGs to exactly one catalog row and one raw-main wiki image.

## Remaining publication gates

The owning publish workflow must still record the exact commit and pushed
`origin/main` SHA, applicable CI/code-scanning/Pages runs, separate wiki push,
raw image delivery, uniquely tagged installer Release, and owned headless/temp
resource cleanup. The previously published `7edca120c5` receipts prove only the
baseline preceding this continuation.
