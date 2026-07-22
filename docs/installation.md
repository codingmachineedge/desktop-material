# Installing Desktop Material

Desktop Material is supported on Windows only. The current automated release
publishes Windows x64 installers and a Squirrel update feed; macOS and Linux
packages are not produced or supported.

## Windows

From Windows PowerShell 5.1 or PowerShell 7, the verified current-user install
is:

```powershell
Microsoft.PowerShell.Utility\Invoke-RestMethod 'https://raw.githubusercontent.com/Ding-Ding-Projects/desktop-material/main/script/install-windows.ps1' | Microsoft.PowerShell.Utility\Invoke-Expression
```

The tracked script resolves this repository's latest release, verifies the
published GitHub SHA-256 asset digest and any Authenticode signature, installs
for the current user, and removes its temporary download. Current builds are
unsigned, which the script reports after digest verification.

For a manual installation, download one of these assets from the
[latest Ding-Ding-Projects release](https://github.com/Ding-Ding-Projects/desktop-material/releases/latest):

- `GitHubDesktopSetup-x64.exe` installs for the current user.
- `GitHubDesktopSetup-x64.msi` provides the Windows Installer package for
  managed deployment.
- `GitHub.Desktop-x64.zip` is the portable package; extract it before running
  the packaged executable.

An unsupported architecture or a missing or unverifiable release asset fails
closed. Use a supported Windows x64 system or Windows virtual machine; there is
no non-Windows compatibility mode.

## Data directories

- `%LOCALAPPDATA%\GitHubDesktop\` contains the installed application and
  retained update versions.
- `%APPDATA%\GitHub Desktop\` contains user-specific application data and is
  created on first launch.

## Log files

Application logs are stored below the user data directory in a `logs`
subdirectory, organized as `YYYY-MM-DD.desktop.production.log`.

Installer and updater diagnostics are stored in:

- `%LOCALAPPDATA%\GitHubDesktop\SquirrelSetup.log` for updates after install.
- `%LOCALAPPDATA%\SquirrelSetup.log` for the initial installation. This file
  may contain entries for other Squirrel applications, so focus on
  `GitHubDesktop.exe`.
