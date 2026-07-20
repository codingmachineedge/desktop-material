# Windows-only platform support

Desktop Material is a Windows application. Windows is the only supported
runtime, packaging target, installer target, and end-to-end acceptance
environment. Source inherited from upstream may still contain non-Windows
adapters, but those paths are compatibility history rather than supported
Desktop Material product surfaces.

## Behavior and configuration

- CI builds Windows x64 and Windows arm64 and runs the full unit suite on
  Windows x64.
- Packaged end-to-end smoke testing installs and exercises Windows x64.
- Automated releases publish the Windows x64 Squirrel feed, EXE, and MSI.
- WSL, UNC shares, mapped drives, Windows editor registration, and Windows
  shell behavior remain first-class integrations.

There is no macOS or Linux runtime support mode to enable. Non-Windows runners
may host platform-neutral repository automation such as lint, documentation,
static analysis, release metadata, or issue triage; those runners do not expand
application support.

## Failure modes and recovery

A non-Windows host is outside the support boundary and receives no packaged
Desktop Material release. Use a supported Windows system or Windows virtual
machine. Windows architecture or installer failures remain release blockers;
non-Windows application behavior is not an acceptance gate.

## Security considerations

Keeping one runtime boundary reduces signing, installer, credential-store, and
shell-launch ambiguity. Windows packages still require the existing digest,
safe argument, credential, and reviewed release checks. The policy does not
permit Windows-only code to bypass those controls.

## Verification

The tracked CI safety test rejects macOS runners and Apple signing inputs in the
application workflow, requires Windows 2022 x64/arm64 build targets, and keeps
the packaged Windows x64 E2E lane. The installer workflow validates the exact
current `main` SHA and publishes only non-empty Windows release assets after CI
succeeds.
