# Network and WSL repository paths

Add local repository accepts normal UNC shares, Windows mapped drives, and WSL
UNC shares as first-class repository locations. It preserves the exact UNC root
instead of folding it through the current local drive and identifies the
connection type during validation.

## Behavior and configuration

- `\\server\share\repo` is retained as a UNC path.
- mapped drive letters are detected with a bounded `net.exe use DRIVE:` probe.
- `\\wsl.localhost\Distro\...` and `\\wsl$\Distro\...` are identified as WSL
  shares.
- a successful add explains that the path depends on a reconnectable location;
  an unavailable location gives network-specific recovery guidance.

No mount or credential setting is stored by Desktop Material. Windows and WSL
remain responsible for reconnecting the location.

## Failure modes and recovery

An offline share, disconnected VPN, unavailable mapped drive, or stopped WSL
distribution is reported as unavailable instead of encouraging repository
creation on a missing network path. Reconnect it and submit the same path
again. Persisted repositories continue to use the existing Missing status and
picker filter while their location is offline.

## Security considerations

Device namespace paths such as `\\?\` and `\\.\`, controls, and empty paths are
rejected. Mapped-drive detection runs a fixed executable with positional
arguments, no shell, a two-second timeout, and a 32 KiB output cap. Git's
existing unsafe-owner check and explicit safe-directory review still apply to
network repositories.

## Verification

Unit coverage proves UNC preservation, UNC/WSL classification, exact mapped
drive probing, local-drive fallback, and device/control rejection.
