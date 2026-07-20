param(
  [Parameter(Mandatory = $true)]
  [string]$PythonExecutable,
  [Parameter(Mandatory = $true)]
  [string]$SourceRoot
)

$ErrorActionPreference = 'Stop'
$startScript = Join-Path $PSScriptRoot 'start_ollama_fixture.ps1'
$probeScript = Join-Path $PSScriptRoot 'probe_ollama_fixture.ps1'
$cleanupScript = Join-Path $PSScriptRoot 'cleanup_ollama_fixture.ps1'
$runToken = [Guid]::NewGuid().ToString('N')
$firstRoot = Join-Path ([IO.Path]::GetFullPath($env:TEMP)) "desktop-material-ollama-first-$runToken"
$secondRoot = Join-Path ([IO.Path]::GetFullPath($env:TEMP)) "desktop-material-ollama-second-$runToken"
$junctionTarget = Join-Path ([IO.Path]::GetFullPath($env:TEMP)) "desktop-material-ollama-target-$runToken"
$junctionRoot = Join-Path ([IO.Path]::GetFullPath($env:TEMP)) "desktop-material-ollama-junction-$runToken"

function Remove-OwnedTestRoot {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) { return }
  $resolvedTemp = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
  $resolved = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  $item = Get-Item -LiteralPath $resolved -Force
  if (
    -not [string]::Equals(
      [IO.Path]::GetDirectoryName($resolved),
      $resolvedTemp,
      [StringComparison]::OrdinalIgnoreCase
    ) -or
    [IO.Path]::GetFileName($resolved) -notmatch '^desktop-material-ollama-' -or
    [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)
  ) {
    throw "Refusing to remove an unowned test root: $resolved"
  }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

$first = $null
$second = $null
try {
  New-Item -ItemType Directory -Path $firstRoot -ErrorAction Stop | Out-Null
  New-Item -ItemType Directory -Path $secondRoot -ErrorAction Stop | Out-Null
  $first = & $startScript -RunRoot $firstRoot -PythonExecutable $PythonExecutable -SourceRoot $SourceRoot -PullFrameDelayMs 100 | ConvertFrom-Json
  $second = & $startScript -RunRoot $secondRoot -PythonExecutable $PythonExecutable -SourceRoot $SourceRoot -PullFrameDelayMs 100 | ConvertFrom-Json
  if (
    [int]$first.pid -eq [int]$second.pid -or
    -not (Get-Process -Id ([int]$first.pid) -ErrorAction SilentlyContinue) -or
    -not (Get-Process -Id ([int]$second.pid) -ErrorAction SilentlyContinue)
  ) {
    throw 'The lifecycle test did not start two independent owned fixtures.'
  }

  $probe = & $probeScript -RunRoot $firstRoot | ConvertFrom-Json
  if ([string]$probe.liveCancellation -ne 'pass') {
    throw 'The owned fixture probe did not prove live cancellation.'
  }

  $firstCleanup = & $cleanupScript -RunRoot $firstRoot | ConvertFrom-Json
  if (
    -not [bool]$firstCleanup.stopped -or
    -not [bool]$firstCleanup.removed -or
    (Test-Path -LiteralPath $firstRoot)
  ) {
    throw 'The first owned fixture was not stopped and removed.'
  }
  if (
    -not (Test-Path -LiteralPath $secondRoot -PathType Container) -or
    -not (Get-Process -Id ([int]$second.pid) -ErrorAction SilentlyContinue)
  ) {
    throw 'Cleaning the first fixture changed the sibling fixture.'
  }
  $siblingHealth = Invoke-RestMethod -UseBasicParsing -Method Get -Uri "$([string]$second.endpoint)/__fixture__/health"
  if ([string]$siblingHealth.status -ne 'ok') {
    throw 'The sibling fixture stopped responding after first-root cleanup.'
  }

  $secondCleanup = & $cleanupScript -RunRoot $secondRoot | ConvertFrom-Json
  if (
    -not [bool]$secondCleanup.stopped -or
    -not [bool]$secondCleanup.removed -or
    (Test-Path -LiteralPath $secondRoot)
  ) {
    throw 'The sibling owned fixture was not stopped and removed.'
  }

  # A junction with an owned-looking name must be rejected before launch. The
  # target sentinel proves rejection/cleanup never traverses the junction.
  New-Item -ItemType Directory -Path $junctionTarget -ErrorAction Stop | Out-Null
  $sentinel = Join-Path $junctionTarget 'sentinel.txt'
  [IO.File]::WriteAllText($sentinel, 'junction target must survive')
  New-Item -ItemType Junction -Path $junctionRoot -Target $junctionTarget -ErrorAction Stop | Out-Null
  $junctionRejected = $false
  try {
    $null = & $startScript -RunRoot $junctionRoot -PythonExecutable $PythonExecutable -SourceRoot $SourceRoot
  } catch {
    $junctionRejected = $_.Exception.Message -match 'symlink or junction'
  }
  if (-not $junctionRejected -or -not (Test-Path -LiteralPath $sentinel -PathType Leaf)) {
    throw 'Owned-root junction rejection did not preserve the junction target.'
  }
  [IO.Directory]::Delete($junctionRoot)
  if (-not (Test-Path -LiteralPath $sentinel -PathType Leaf)) {
    throw 'Removing the rejected junction traversed its target.'
  }

  [ordered]@{
    fixturesStarted = 2
    liveCancellation = [string]$probe.liveCancellation
    faultModes = @($probe.faultModes).Count
    firstStopped = [bool]$firstCleanup.stopped
    siblingSurvivedFirstCleanup = $true
    secondStopped = [bool]$secondCleanup.stopped
    junctionRejected = $true
  } | ConvertTo-Json -Compress
} finally {
  if (Test-Path -LiteralPath $junctionRoot) {
    $junctionItem = Get-Item -LiteralPath $junctionRoot -Force
    if ([bool]($junctionItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      [IO.Directory]::Delete($junctionRoot)
    }
  }
  foreach ($root in @($firstRoot, $secondRoot)) {
    if (Test-Path -LiteralPath (Join-Path $root 'ollama\ready.json')) {
      try { $null = & $cleanupScript -RunRoot $root } catch {}
    }
    if (Test-Path -LiteralPath $root) {
      $owners = @(
        Get-CimInstance Win32_Process |
          Where-Object {
            $_.CommandLine -and
            $_.CommandLine.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0
          }
      )
      foreach ($owner in $owners) {
        if ([uint32]$owner.ProcessId -eq [uint32]$PID) { continue }
        Stop-Process -Id ([int]$owner.ProcessId) -Force -ErrorAction SilentlyContinue
      }
      $deadline = [DateTime]::UtcNow.AddSeconds(5)
      while (
        @(Get-CimInstance Win32_Process | Where-Object {
          $_.CommandLine -and
          $_.CommandLine.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
          [uint32]$_.ProcessId -ne [uint32]$PID
        }).Count -gt 0
      ) {
        if ([DateTime]::UtcNow -ge $deadline) {
          throw "Unable to stop a test-owned process for $root"
        }
        Start-Sleep -Milliseconds 100
      }
      Remove-OwnedTestRoot -Path $root
    }
  }
  Remove-OwnedTestRoot -Path $junctionTarget
}
