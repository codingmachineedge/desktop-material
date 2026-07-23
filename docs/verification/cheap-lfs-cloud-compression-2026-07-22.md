# Cheap LFS cloud compression acceptance — 2026-07-22

## Scope

This receipt covers the public-auto/private-opt-in cloud-compression policy,
one-object-at-a-time GitHub Actions implementation, automatic pointer adoption,
failure-safe raw fallback, and local-only Desktop Material decompression.

## Contract

- Public repositories install an automatic caller after GitHub visibility is
  confirmed.
- Private repositories are off by default and require an explicit persisted UI
  opt-in. Unknown visibility fails closed.
- The accepted caller pins `actions/checkout` to
  `de0fac2e4500dabe0009e67214ff5f5447ce83dd` and the reviewed composite Action
  to `16983c59d702d9e6fa49d2ac4fa4b35c415e9190`. It requests only
  `contents: write`.
- Release assets are downloaded, compressed with raw DEFLATE level 9, verified,
  and uploaded directly. Actions artifacts and caches are not used, and only
  one object's raw/compressed working set exists at a time.
- A strictly smaller verified result updates exactly one pointer object to v1
  `part-deflate`. Failed and non-beneficial objects keep their original raw
  pointer and asset. Original raw assets are retained for historical commits.
- GitHub Actions never decompresses. Desktop Material performs bounded local
  expansion and verifies the original object and whole-file sizes and SHA-256
  values before atomic replacement.

## Live public automatic setup

The production Large files UI created and pushed public caller commit
[`72b2db3e0b6554364e07e5e34945c8be5c125216`](https://github.com/DingDingChae/desktop-material-cheap-lfs-public-20260722-153308/commit/72b2db3e0b6554364e07e5e34945c8be5c125216).
The caller records private opt-in as disabled, but its live visibility guard
allowed the confirmed-public repository to run automatically.

[Cheap LFS cloud-compression run `29969707165`](https://github.com/DingDingChae/desktop-material-cheap-lfs-public-20260722-153308/actions/runs/29969707165)
completed successfully and pushed pointer-only bot commit
[`f10d8d2acedbba0e3b5ce978dff09c25217cad9c`](https://github.com/DingDingChae/desktop-material-cheap-lfs-public-20260722-153308/commit/f10d8d2acedbba0e3b5ce978dff09c25217cad9c).
The Action summary reported `1 compressed, 0 kept raw, 0 failed safely`.

The pointer now records:

```text
part-deflate 30e14955ebf1352266dc2ff8067e68104607e750abb9d3b36582b8af909fcb58 1048576 1033 payload-public-30e1495.bin.cheap-lfs-30e14955ebf1.deflate
```

Release asset `486587725` is 1,033 bytes with stored digest
`sha256:8d22b086820b0896bdcb33cf965ebc275cb0b5f0b4c44a364aa4144c015f9f7b`.
The original raw asset `486477022` remains uploaded at 1,048,576 bytes with
digest
`sha256:30e14955ebf1352266dc2ff8067e68104607e750abb9d3b36582b8af909fcb58`.

## Live private explicit opt-in

The private production UI initially displayed cloud compression off. Enabling
its checkbox persisted consent, wrote the managed caller into Changes, and the
normal UI commit/push produced
`3d398786dd4c599730e0dbb77b0c83a5fa14a57a`. Private run `29969957449`
completed successfully and pushed pointer-only bot commit
`6259b0fa0dc6c65cdb5a90af8e1da9358b45b0ac`, again reporting
`1 compressed, 0 kept raw, 0 failed safely`.

The private pointer now records:

```text
part-deflate 30e14955ebf1352266dc2ff8067e68104607e750abb9d3b36582b8af909fcb58 1048576 1033 payload-private-30e1495.bin.cheap-lfs-30e14955ebf1.deflate
```

Release asset `486590906` has the same 1,033-byte stored size and
`sha256:8d22b086820b0896bdcb33cf965ebc275cb0b5f0b4c44a364aa4144c015f9f7b`
digest. The corresponding raw asset `486479377` remains uploaded at 1 MiB with
the original `30e14955…` digest.

## Live failure-safe fallback

The earlier public [run `29967844734`](https://github.com/DingDingChae/desktop-material-cheap-lfs-public-20260722-153308/actions/runs/29967844734)
hit GitHub's 404 response when the direct release-by-tag endpoint could not see
the draft Release. The Action reported `0 compressed, 0 kept raw, 1 failed
safely`, exited failed, and did not alter the raw pointer or delete its Release
asset. Desktop Material's production UI then materialized the object
successfully to exactly 1,048,576 bytes with SHA-256
`30e14955ebf1352266dc2ff8067e68104607e750abb9d3b36582b8af909fcb58`.
This proves a failed cloud object remains cloneable and recoverable through the
app rather than becoming dependent on an incomplete side asset.

Corrective Action commit `16983c59d702d9e6fa49d2ac4fa4b35c415e9190`
falls back to exact-tag matching across at most 100 pages of 100 releases. The
successful public and private runs above exercised that bounded draft lookup.
If the draft lies beyond those **10,000 releases**, the candidate fails safely
and remains raw. A Release can also contain at most **1,000 assets**. Since raw
history is deliberately retained, a full Release has no slot for the compressed
side asset; upload/adoption then fails without rewriting the pointer or deleting
the original object.

## Local-only materialization and UI evidence

After bot adoption, the production UI's per-row **Materialize** action restored
the public and private compressed pointers independently. Each local file was
exactly 1,048,576 bytes and matched SHA-256
`30e14955ebf1352266dc2ff8067e68104607e750abb9d3b36582b8af909fcb58`.
No GitHub Actions step decompressed either object.

The production bundle ran through the fixed Lowlevel MCP HTTP endpoint on the
isolated `DesktopMaterialCheapLfsCloud-20260722-190000` Win32 headless desktop.
The accepted original-resolution frame shows bilingual mode, private explicit
consent, the ready managed workflow notice, and a compressed row reporting
99.9% savings:

| Capture | Dimensions | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| `docs/assets/screenshots/cheap-lfs-cloud-compression.png` | 960×660 | 105,577 | `9449e50f60cd298e9cc261e9044fc0cd93706a8e9f243dcceb88d63b6df9ab8d` |

The frame was inspected at original pixels and contains no credential, token,
local filesystem path, signed URL, or unrelated private content.

## Automated and build evidence

Focused cloud tests exercise:

- the real composite Action against a temporary Git remote and fake GitHub
  Release API, including beneficial adoption, forced upload failure, an
  incompressible skip, ambiguous-push safety, tracked build-output paths, and
  bounded draft discovery;
- public/private/unknown policy, immutable caller pins, YAML parsing, managed
  ownership, disable guard, unowned-workflow refusal, atomic replacement,
  concurrent mutation, and rejection of workflow symlinks, junctions, and
  hardlinks;
- public automatic UI setup, private checkbox consent/persistence,
  repository-switch and unrelated-preference races, and raw/compressed/mixed
  pointer labels;
- existing raw/multipart behavior plus cloud-style single-object download and
  local raw-DEFLATE materialization, including truncated streams,
  over-expansion, and exact-size wrong-hash cleanup.

The final combined gate passed **134/134 tests across 25 suites**. The complete
script gate passed **27/27 tests across 8 suites**. Repository-wide Prettier,
the ESLint/Prettier compatibility check, repository-wide ESLint, TypeScript
`--noEmit --skipLibCheck`, and `git diff --check` all passed.

The canonical production command was attempted through the fixed MCP endpoint,
but the environment has no `yarn` executable, so it stopped before app code with
`ENOENT`. No dependency was downloaded. The equivalent existing-dependency
production Webpack command then compiled all five targets successfully through
that same endpoint in **420.6 seconds** with `ok: true`, `client_ok: true`,
`returncode: 0`, empty stderr, and no timeout. The earlier staging bundle
supplied the production UI used for the off-screen acceptance.

## Cleanup and publication receipts

The temporary development alias and GitHub credential entries were deleted and
verified absent. The production application credential was restored, and its
one-time backup was verified absent. The exact Electron process was terminated,
the headless desktop reported zero windows and closed successfully, and the
owned temporary run root (including its two fully synchronized materialized
test clones) was removed. The retained GitHub repositories, commits, Releases,
assets, and Actions runs above are unaffected.

The live feature behavior and local cleanup are accepted. Source checkpoint
`f7b4760a13894f0320f7b361f055f6fba40d913f` is pushed on `main` with zero local
or remote divergence. Exact-source
[CI `29972351158`](https://github.com/Ding-Ding-Projects/desktop-material/actions/runs/29972351158),
[CodeQL `29972351173`](https://github.com/Ding-Ding-Projects/desktop-material/actions/runs/29972351173),
and [Pages `29972351147`](https://github.com/Ding-Ding-Projects/desktop-material/actions/runs/29972351147)
all succeeded. Wiki commit `407cbf260c229e9f8e7fd86062afad83e5080f63`
publishes the synchronized seven-page source, and the live Pages gallery serves
all 73 figures plus the exact 105,577-byte accepted cloud-compression image.

Downstream
[installer run `29973527338`](https://github.com/Ding-Ding-Projects/desktop-material/actions/runs/29973527338)
succeeded and published latest non-draft, non-prerelease Release
[`v3.6.3-beta3-b0000040887`](https://github.com/Ding-Ding-Projects/desktop-material/releases/tag/v3.6.3-beta3-b0000040887)
from the exact source tag. Its six uploaded Windows x64 assets are
`GitHub.Desktop-x64.zip`, two versioned full `.nupkg` files,
`GitHubDesktopSetup-x64.exe`, `GitHubDesktopSetup-x64.msi`, and `RELEASES`; each
has a nonzero size and GitHub SHA-256 digest. The final audit found only local
and remote `main`, one root worktree, and no stashes. These publication receipts
do not alter the immutable live run and object evidence above.
