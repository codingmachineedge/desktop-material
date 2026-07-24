[Overview](../../README.md) · **Install** · [Features](features.md) · [Screenshots](screenshots.md) · [Roadmap & receipts](roadmap-and-receipts.md) · [Development](development.md)

<sub>Tabbed README — GitHub can't run scripts, so each tab above is a separate page.</sub>

# Install on Windows

Desktop Material's automated releases provide a per-user x64 Windows installer.
The Windows package command also creates `dist/GitHub Desktop-x64.zip`, and the
gated release workflow requires that portable archive beside the installer
assets. A successful main CI run enters packaging directly; a manual express
dispatch runs lint, Windows x64 trampoline/unit/script tests, and packaging in
parallel. The packaging
job preserves the complete payload as a short-lived Actions artifact before
attempting its create-only GitHub Release, so installers remain available when
publication alone fails. Run this one line in Windows PowerShell 5.1 or
PowerShell 7; it does not require an administrator shell:

```powershell
Microsoft.PowerShell.Utility\Invoke-RestMethod 'https://raw.githubusercontent.com/Ding-Ding-Projects/desktop-material/main/script/install-windows.ps1' | Microsoft.PowerShell.Utility\Invoke-Expression
```

The [tracked installer script](../../script/install-windows.ps1) asks GitHub for this
exact repository's latest stable installer release, accepts only the installer
for the native architecture, verifies its release-asset size and GitHub SHA-256 digest,
checks any Authenticode signature, runs the Squirrel installer silently with
`/S`, and removes its controlled temporary directory. The current release
workflow publishes unsigned x64 builds, so the script reports that status and
stops on ARM64 until an ARM64 asset is available. Review the script before
running any remote command, or use the
[latest release page](https://github.com/Ding-Ding-Projects/desktop-material/releases/latest)
for a manual installer or portable-ZIP download. Extract the ZIP before running
the packaged executable. The focused archive/workflow contract is green; a
published baseline already contains the required installer, feed, and portable
ZIP assets. The updater-migration Releases additionally verify the complete
installer, feed, NuGet, MSI, and portable-ZIP payload on exact source
`04246fdf12`.

When GitHub Actions is actively building or packaging a newer exact commit but
has not yet published its Release, the About updater reports **New update coming
soon** in the selected English, playful Hong Kong Cantonese, or bilingual mode.
The state is transient and fails closed; normal Squirrel update behavior resumes
on the next check after publication. Automated Release notes list bounded,
sanitized commit subjects from the previous installer release through the exact
release SHA. CI, installer, and Pages runs use unique groups so a newer
invocation never cancels or replaces older running or pending work. See
[Automated update build status and release
notes](../features/integrations/automated-updates-and-release-notes.md).
