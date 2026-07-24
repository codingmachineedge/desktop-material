# Cheap LFS settings, scrolling, and commit-key acceptance

- Run ID: `20260723-221314-6ed09c0d`
- Mode: `publish`
- Milestone: prove the Large files settings route and vertical scrolling, plus the deletion-only private-key commit bypass
- Expected UI state: the Large files page shows `Open Cheap LFS settings`; activating it opens Repository settings on `Build & run`; a constrained window can scroll from the manager heading through the pinned-file list
- Ordered background interactions: preflight fixed MCP; build the unpackaged production app; create a disposable repository and isolated user-data directory; create one hidden desktop; launch only the built app; open Large files; constrain the window; capture and inspect; open Cheap LFS settings; capture and inspect; close app and hidden desktop; remove owned temporary files
- Disposable fixture root: `C:\Users\Administrator\AppData\Local\Temp\desktop-material-cheap-lfs-settings-scroll-20260723-221314-6ed09c0d`
- Headless desktop: `dm-cheap-lfs-settings-scroll-20260723-221314-6ed09c0d`
- Screenshot target: `C:\Users\Administrator\AppData\Local\Temp\desktop-material-cheap-lfs-settings-scroll-20260723-221314-6ed09c0d\acceptance.png`
- Screenshot contract: dark theme, client-only, constrained to approximately 900x700, no private data, no clipping or blank pixels
- Documentation allowlist: `README.md`, `ROADMAP.md`, `HANDOFF.md`, `docs/features/repository-management/release-backed-cheap-lfs.md`, `docs/wiki/User-Guide.md`, `site/index.html`
- Validation: focused Cheap LFS key/UI/style/i18n/entry-point tests; CI regression test; TypeScript; project lint; exact-file Prettier; production build; hidden UI acceptance
- Remote: `https://github.com/Ding-Ding-Projects/desktop-material.git`
- Account: `DingDingChae`
- Expected branch: `main`
- Cleanup ledger: owned run root, exact headless desktop name, launch PID, and resolved HWND will be recorded before launch and removed only after the owned app/window is gone

## Runtime ledger

- Fixed MCP preflight: `ok=true`, task action points to the fixed checkout and `127.0.0.1:8765`, checkout `547a102a49169d41da876de217856229ab7c03a1`
- Production build: `client_ok=true`, `returncode=0`, `timed_out=false`, built to `out`
- Fixture commit: `7b60531`, 60 canonical Release-pointer files, clean working tree
- Hidden desktop: created once, handle `1188`
- Launch PID: `10776`
- Resolved HWND: `532594` (`Desktop Material`, `Chrome_WidgetWin_1`, PID `10776`)
- CDP port: `63231`

## Acceptance receipt

- Bundle binding: `out/main.js` `c0573314a9e3fcda894e41cf545e5c2e876c1324317a3b7b5da7bbfcc3a1c625`; `out/index.html` `d44d3b8f637b17fc75c9f3ea14bc08166a7fa931de46b6ea41971ccd6131f553`; `out/keytar.node` `391976ea3af33d6697a9df2e007a8a00d5c7e0aa6f08c7eceeb21fb483591c09`; Electron `082d352efc6a9f5882354ee4096ae0b40b78bc6c8e52fc5084f3df9254c613ff`
- Manager geometry: computed `overflow-y: auto`; client height `518`; scroll height `9942`; 60 rendered rows
- Scroll proof: `scrollTop` moved from `0` to `9425`; `assets/large-file-60.bin` was fully visible inside the manager viewport
- Settings proof: `Open Cheap LFS settings` was visible and activated; `#repository-settings` existed with `Build & run` as its sole selected tab; the panel exposed download-after-clone, pin-on-commit, three-lane upload, storage-provider, and private cloud-compression controls
- Visual inspection: three 960x660 CDP captures were nonblank, unclipped, and contained only the disposable `fixture` identity
- Top/settings-route capture: `acceptance.png`, 77,369 bytes, SHA-256 `aaf99731b907fdc1bd16a63e5d4910a74a0af70d71693a2758af487f42123cf2`
- Bottom-row capture: `large-files-bottom-cdp.png`, 60,030 bytes, SHA-256 `ba2bcf944d37a488257603c2cfd94af2280864403e9fe93c38f90ca0d1d79dbc`
- Build & run capture: `settings-build-run-cdp.png`, 70,358 bytes, SHA-256 `c7f3c9019f3a4fcec485630e9df6a74dd6b647a5a8d47c42c0f9e89341773b5c`
- Cleanup: native alternate-desktop close could not resolve its revalidated HWND, so the verified saved app PID `10776` was terminated as the declared fallback; the desktop then reported zero windows and closed successfully. The exact owned Temp root was moved to the Recycle Bin after path validation and is recoverable until the bin is emptied.
