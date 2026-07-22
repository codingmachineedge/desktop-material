# Cheap LFS public/private GitHub and UI acceptance — 2026-07-22

## Result and scope

Cheap LFS passed live GitHub storage, fresh-clone history, and Desktop Material
UI acceptance in both repository visibility modes while authenticated as
`DingDingChae`. The two purpose-built repositories are retained for review:

- Public:
  [`DingDingChae/desktop-material-cheap-lfs-public-20260722-153308`](https://github.com/DingDingChae/desktop-material-cheap-lfs-public-20260722-153308),
  `main` commit `a7c90eff6a4d7963577125e3204a1b9af28da756`.
- Private: `DingDingChae/desktop-material-cheap-lfs-private-20260722-153308`,
  `main` commit `e56519d4742c63bb2c9f5f1e917de3fca7379fdd`.

Both final commits are named **Re-pin payload through Cheap LFS UI** and are
present on the remote `main` branches. Fresh clones resolved to those exact
SHAs and retained the earlier **Pin deterministic payload with Cheap LFS**
commits as their direct parents.

## Desktop Material UI acceptance

The current source compiled all five official production Webpack targets in
their normal order and completed production staging with packaging disabled in
296.8 seconds. The resulting `out` bundle was launched only on isolated
off-screen Win32 desktops with isolated profiles. The visible desktop was not
shown, focused, resized, or used for input.

The public flow materialized the committed pointer to the exact 1,048,576-byte
payload, selected that file through the native Windows picker, reviewed the
release tag in the Large files panel, uploaded it, and replaced the bytes with
a verified pointer. The private flow opened through a fresh profile, performed
the enabled on-open materialization to the same exact payload, then passed the
same native-picker review and pin sequence. Both final panels showed one pinned
file and an available **Materialize** action.

The live exercise exposed and corrected two provider-shape defects before the
successful rerun:

- GitHub's exact draft-tag route can return 404, so the Releases store now
  falls back to its bounded release inventory and still resolves the reviewed
  draft.
- GitHub returns an absent Release-asset label as either `null` or an empty
  string. The model now normalizes both spellings to the same semantic value,
  preventing a verified unlabeled upload from being rejected and deleted.

The accepted 1200×752 client capture is
`docs/assets/screenshots/cheap-lfs-ui-acceptance.png`, 79,404 bytes, SHA-256
`8f53ed803dc7415ca86e4399040201afbbd627718a48e4a453e637099fa03684`.
Original-resolution inspection confirmed that it is nonblank, unclipped, and
contains no token, email address, local path, or private file content.

## Release-asset contract

Each repository has a draft prerelease tagged
`assets-test-20260722-153308`. The original backend fixture and the successful
UI upload are both retained:

- Public release `358270369`: asset `486345586`, `payload-public.bin`, and UI
  asset `486477022`, `payload-public-30e1495.bin`.
- Private release `358270368`: asset `486345587`, `payload-private.bin`, and UI
  asset `486479377`, `payload-private-30e1495.bin`.

All four assets are in `uploaded` state at 1,048,576 bytes and report
`sha256:30e14955ebf1352266dc2ff8067e68104607e750abb9d3b36582b8af909fcb58`.
Unauthenticated draft-asset URLs returned HTTP 404 for both repositories,
including the public repository, as expected for unpublished draft releases.
Authenticated downloads reproduced the exact byte count and digest.

## Pointer and fresh-clone history contract

Each final `main` commit tracks a canonical five-line
`desktop-material/cheap-lfs/v1` pointer naming its release tag, deduplicated UI
asset, byte size, and SHA-256 digest. The public Git blob is 201 bytes and its
fresh Windows CRLF checkout is 206 bytes; the private values are 202 and 207
bytes. Both fresh clones were clean, and `git lfs ls-files` returned no entries,
confirming that the history contains Cheap LFS pointers rather than Git LFS
objects.

## Credential boundary and cleanup

The backend setup reused the already configured GitHub CLI account. For the UI
exercise, the user explicitly authorized a temporary bridge from that logged-in
account into Desktop Material's development secure-store service. The token was
retrieved only inside the one-purpose helper and was never printed, placed in a
command argument or URL, written to source, captured in a screenshot, or added
to Git history. After both app runs, the exact development service/login entry
was deleted and re-read as absent. Both app PIDs exited, both off-screen
desktops had zero windows before close, and both CDP ports closed.

## Logo evidence

Both retained acceptance repositories include the generated Cheap LFS logo.
The public raw logo returned HTTP 200, and the private repository's
authenticated contents response reported 1,091,778 bytes. The canonical
documentation asset is `docs/assets/cheap-lfs-logo.png`: 1254×1254,
1,091,778 bytes, SHA-256
`34b2e68ad1e95f45cac08e3c2ee5d9981a35611d30b0deb7282a5c7fe0682a2f`.

## Focused verification

- GitHub Releases model and main-process transfer regression suites: 41/41.
- GitHub Releases store suite, including the draft-route fallback: 17/17.
- TypeScript: passed.
- All five production Webpack targets plus normal staging: passed.
- Public and private fresh-clone history, pointer, and no-Git-LFS checks:
  passed.

Remote CI, Pages, wiki, and installer-release status are recorded separately in
`HANDOFF.md` so this receipt does not overstate publication that has not yet
completed.
