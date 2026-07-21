param(
  [Parameter(Mandatory = $true)]
  [string]$RunRoot
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'gitlab_mr_fixture_common.ps1')

$paths = Get-OwnedGitLabMRFixturePaths -RunRoot $RunRoot
$ready = Read-OwnedGitLabMRReadyReceipt -Paths $paths
$launcherItem = Get-Item -LiteralPath $paths.Launcher -ErrorAction Stop
if ($launcherItem.PSIsContainer -or (Test-GitLabMRReparsePoint $launcherItem)) {
  throw "Launcher receipt must be a real file: $($paths.Launcher)"
}
$launcherRaw = Get-Content -LiteralPath $paths.Launcher -Raw -ErrorAction Stop
if ($launcherRaw.Contains($script:GitLabMRPrivateToken)) {
  throw 'Launcher receipt contains the private token.'
}
$launcher = $launcherRaw | ConvertFrom-Json
if (
  [string]$launcher.fixture -ne $script:GitLabMRFixtureId -or
  [int]$launcher.protocolVersion -ne $script:GitLabMRFixtureProtocolVersion -or
  [string]$launcher.runRootName -ne $paths.RootName -or
  [int]$launcher.pid -ne [int]$ready.pid
) {
  throw 'Launcher receipt failed the owned fixture identity contract.'
}

foreach ($credentialFreeFile in @(
  $paths.Ready,
  $paths.MutationLog,
  $paths.Launcher,
  $paths.Stdout,
  $paths.Stderr
)) {
  if (Test-Path -LiteralPath $credentialFreeFile -PathType Leaf) {
    $content = [string](Get-Content -LiteralPath $credentialFreeFile -Raw -ErrorAction Stop)
    if ($null -ne $content -and $content.Contains($script:GitLabMRPrivateToken)) {
      throw "Owned fixture artifact contains the private token: $([IO.Path]::GetFileName($credentialFreeFile))"
    }
  }
}

$stopped = $false
$process = Get-Process -Id ([int]$ready.pid) -ErrorAction SilentlyContinue
if ($null -ne $process) {
  $processStart = $process.StartTime.ToUniversalTime()
  $receiptStart = if ($launcher.processStartTimeUtc -is [DateTime]) {
    $launcher.processStartTimeUtc.ToUniversalTime()
  } else {
    [DateTime]::Parse(
      [string]$launcher.processStartTimeUtc,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::RoundtripKind
    ).ToUniversalTime()
  }
  if ($processStart -ne $receiptStart) {
    throw "Fixture PID $([int]$ready.pid) was reused by another process."
  }
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$ready.pid)"
  if ($null -eq $processInfo -or [string]::IsNullOrWhiteSpace($processInfo.CommandLine)) {
    throw "Unable to verify the fixture process command line: $([int]$ready.pid)"
  }
  foreach ($requiredValue in @(
    [string]$launcher.fixtureScript,
    $paths.Root,
    $paths.Ready,
    $paths.MutationLog
  )) {
    if (
      [string]::IsNullOrWhiteSpace($requiredValue) -or
      $processInfo.CommandLine.IndexOf(
        $requiredValue,
        [StringComparison]::OrdinalIgnoreCase
      ) -lt 0
    ) {
      throw "Fixture process command line does not own the expected fixture path."
    }
  }
  if (
    -not [string]::IsNullOrWhiteSpace($processInfo.ExecutablePath) -and
    -not [string]::Equals(
      [IO.Path]::GetFullPath($processInfo.ExecutablePath),
      [IO.Path]::GetFullPath([string]$launcher.pythonExecutable),
      [StringComparison]::OrdinalIgnoreCase
    )
  ) {
    throw 'Fixture executable no longer matches the launcher receipt.'
  }

  Stop-Process -Id ([int]$ready.pid) -Force -ErrorAction Stop
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  while (Get-Process -Id ([int]$ready.pid) -ErrorAction SilentlyContinue) {
    if ([DateTime]::UtcNow -ge $deadline) {
      throw "Timed out stopping owned fixture PID $([int]$ready.pid)."
    }
    Start-Sleep -Milliseconds 100
  }
  $stopped = $true
}

$excludedProcessIds = [Collections.Generic.HashSet[uint32]]::new()
$cursorProcessId = [uint32]$PID
while ($cursorProcessId -ne 0 -and $excludedProcessIds.Add($cursorProcessId)) {
  $cursor = Get-CimInstance Win32_Process -Filter "ProcessId = $cursorProcessId"
  if ($null -eq $cursor) {
    break
  }
  $cursorProcessId = [uint32]$cursor.ParentProcessId
}
$owners = @(
  Get-CimInstance Win32_Process |
    Where-Object {
      -not $excludedProcessIds.Contains([uint32]$_.ProcessId) -and
      $_.CommandLine -and
      $_.CommandLine.IndexOf(
        $paths.Root,
        [StringComparison]::OrdinalIgnoreCase
      ) -ge 0
    } |
    Select-Object ProcessId, Name
)
if ($owners.Count -gt 0) {
  throw "Processes still reference the owned GitLab MR run root."
}

$reparsePoints = @(
  Get-ChildItem -LiteralPath $paths.Root -Force -Recurse -ErrorAction Stop |
    Where-Object { Test-GitLabMRReparsePoint $_ } |
    Select-Object -ExpandProperty FullName
)
if ($reparsePoints.Count -gt 0) {
  throw "Owned run root contains a symlink or junction: $($reparsePoints -join ', ')"
}

$resolvedAgain = Resolve-OwnedGitLabMRRunRoot -RunRoot $paths.Root
if (-not [string]::Equals(
  $resolvedAgain,
  $paths.Root,
  [StringComparison]::OrdinalIgnoreCase
)) {
  throw 'Owned GitLab MR run root changed before cleanup.'
}
Remove-Item -LiteralPath $paths.Root -Recurse -Force -ErrorAction Stop
if (Test-Path -LiteralPath $paths.Root) {
  throw "Owned GitLab MR cleanup failed: $($paths.Root)"
}
[ordered]@{
  fixture = $script:GitLabMRFixtureId
  rootName = $paths.RootName
  stopped = $stopped
  removed = $true
} | ConvertTo-Json -Compress
