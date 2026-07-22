# Cheap LFS public/private GitHub acceptance — 2026-07-22

## Result and scope

Cheap LFS's release-backed pointer contract was accepted against live GitHub
repositories in both visibility modes while authenticated as `DingDingChae`.
The two purpose-built repositories are retained for review:

- Public:
  [`DingDingChae/desktop-material-cheap-lfs-public-20260722-153308`](https://github.com/DingDingChae/desktop-material-cheap-lfs-public-20260722-153308),
  `main` commit `0ca7df318fa741cae31fd6ade7d7133e2be76133`.
- Private: `DingDingChae/desktop-material-cheap-lfs-private-20260722-153308`,
  `main` commit `c2f2cbd5a8ebcd877c86f4d0a8e356290e001125`.

This is live GitHub protocol and storage-backend acceptance. It does not claim
that Desktop Material's GUI selected an account, obtained a token from the app
keychain, or drove its account-bound upload/download transport end to end.

## Release-asset contract

Each repository has a draft prerelease with tag
`assets-test-20260722-153308`. The releases and their uploaded assets are:

- Public: release `358270369`, asset `486345586`, `payload-public.bin`, state
  `uploaded`, 1,048,576 bytes.
- Private: release `358270368`, asset `486345587`, `payload-private.bin`, state
  `uploaded`, 1,048,576 bytes.

Both assets report
`sha256:30e14955ebf1352266dc2ff8067e68104607e750abb9d3b36582b8af909fcb58`.
Unauthenticated draft-asset URLs returned HTTP 404 for both repositories,
including the public repository, as expected for unpublished draft releases.
Authenticated `gh release download` materialized exactly 1,048,576 bytes in
each case. The downloaded SHA-256 values matched the release metadata and
`fc /b` reported no differences from the deterministic source payloads.

## Pointer and fresh-clone contract

Each `main` commit tracks a canonical five-line
`desktop-material/cheap-lfs/v1` pointer naming its release tag, asset, byte
size, and SHA-256 digest. The public pointer is a 193-byte LF Git blob and the
private pointer is a 194-byte LF Git blob; their names differ by one character.
Fresh Windows clones checked out CRLF working-tree copies of 198 and 199 bytes,
respectively. `git lfs ls-files` returned no entries in either clone, confirming
that the tracked artifacts are Cheap LFS pointers rather than Git LFS objects.

## Credential boundary

The acceptance reused the credentials already configured for GitHub CLI.
No token was printed, exported to a shell variable, copied into a repository,
or duplicated into Desktop Material's keychain. The authenticated download
therefore proves the repository/release/pointer/materialization protocol and
the public/private authorization boundary without overstating GUI coverage.

## Logo evidence

Both retained acceptance repositories include the generated Cheap LFS logo.
The public raw logo returned HTTP 200, and the private repository's
authenticated contents response reported 1,091,778 bytes. The canonical
documentation asset is `docs/assets/cheap-lfs-logo.png`: 1254×1254,
1,091,778 bytes, SHA-256
`34b2e68ad1e95f45cac08e3c2ee5d9981a35611d30b0deb7282a5c7fe0682a2f`.

## Product follow-up

The Large files panel now says that files above the single-asset limit are
split into 1.5 GiB parts rather than the former 2 GiB wording. Its focused UI
test asserts the corrected copy. An app-owned, account-bound GUI transfer and
materialization remains the final end-to-end acceptance gap.
