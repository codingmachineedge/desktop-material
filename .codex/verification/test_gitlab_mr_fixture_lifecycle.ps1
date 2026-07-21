param(
  [Parameter(Mandatory = $true)]
  [string]$PythonExecutable,
  [Parameter(Mandatory = $true)]
  [string]$SourceRoot
)

$ErrorActionPreference = 'Stop'
$startScript = Join-Path $PSScriptRoot 'start_gitlab_mr_fixture.ps1'
$probeScript = Join-Path $PSScriptRoot 'probe_gitlab_mr_fixture.ps1'
$cleanupScript = Join-Path $PSScriptRoot 'cleanup_gitlab_mr_fixture.ps1'
$runToken = [Guid]::NewGuid().ToString('N')
$tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
$firstRoot = Join-Path $tempRoot "desktop-material-gitlab-mr-first-$runToken"
$secondRoot = Join-Path $tempRoot "desktop-material-gitlab-mr-second-$runToken"
$readyCollisionRoot = Join-Path $tempRoot "desktop-material-gitlab-mr-ready-collision-$runToken"
$logCollisionRoot = Join-Path $tempRoot "desktop-material-gitlab-mr-log-collision-$runToken"

function Remove-OwnedGitLabMRTestRoot {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }
  $resolved = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  $item = Get-Item -LiteralPath $resolved -Force -ErrorAction Stop
  if (
    -not [string]::Equals(
      [IO.Path]::GetDirectoryName($resolved),
      $tempRoot,
      [StringComparison]::OrdinalIgnoreCase
    ) -or
    [IO.Path]::GetFileName($resolved) -notmatch '^desktop-material-gitlab-mr-' -or
    [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)
  ) {
    throw "Refusing to remove an unowned GitLab MR test root: $resolved"
  }
  $links = @(
    Get-ChildItem -LiteralPath $resolved -Force -Recurse -ErrorAction Stop |
      Where-Object { [bool]($_.Attributes -band [IO.FileAttributes]::ReparsePoint) }
  )
  if ($links.Count -gt 0) {
    throw "Refusing to remove a GitLab MR test root containing a reparse point: $resolved"
  }
  Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction Stop
}

function Assert-Throws {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Operation,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $failed = $false
  try {
    & $Operation
  } catch {
    $failed = $true
  }
  if (-not $failed) {
    throw "Expected operation to fail: $Label"
  }
}

function Write-JsonWithoutBom {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)]$Value
  )

  [IO.File]::WriteAllText(
    $Path,
    (($Value | ConvertTo-Json -Depth 10) + [Environment]::NewLine),
    [Text.UTF8Encoding]::new($false)
  )
}

function Assert-CredentialAndPathSafeReceipt {
  param(
    [Parameter(Mandatory = $true)][string]$RunRoot,
    [Parameter(Mandatory = $true)]$Started
  )

  $owned = Join-Path $RunRoot 'gitlab-mr'
  foreach ($name in @('ready.json', 'mutations.jsonl', 'launcher.json', 'stdout.log', 'stderr.log')) {
    $path = Join-Path $owned $name
    $content = [string](Get-Content -LiteralPath $path -Raw -ErrorAction Stop)
    if (
      ($null -ne $content -and $content.Contains('desktop-material-gitlab-token')) -or
      ($null -ne $content -and $content.Contains([IO.Path]::GetFullPath($RunRoot)))
    ) {
      throw "Owned fixture artifact leaked a credential or absolute run-root path: $name"
    }
  }
  if (
    [string]$Started.mutationLog -ne 'gitlab-mr/mutations.jsonl' -or
    ([string]($Started | ConvertTo-Json -Compress)).Contains([IO.Path]::GetFullPath($RunRoot))
  ) {
    throw 'Start output leaked an absolute run-root path.'
  }
}

$first = $null
$second = $null
$firstReadyOriginal = $null
$firstLauncherOriginal = $null
try {
  # Pre-existing receipts or logs must cause start to refuse without deleting them.
  foreach ($collision in @(
    @{ Root = $readyCollisionRoot; Name = 'ready.json' },
    @{ Root = $logCollisionRoot; Name = 'mutations.jsonl' }
  )) {
    New-Item -ItemType Directory -Path (Join-Path $collision.Root 'gitlab-mr') -Force -ErrorAction Stop | Out-Null
    $sentinel = Join-Path (Join-Path $collision.Root 'gitlab-mr') $collision.Name
    [IO.File]::WriteAllText($sentinel, "collision`n", [Text.UTF8Encoding]::new($false))
    Assert-Throws -Label "pre-existing $($collision.Name)" -Operation {
      $null = & $startScript -RunRoot $collision.Root -PythonExecutable $PythonExecutable -SourceRoot $SourceRoot
    }
    if (-not (Test-Path -LiteralPath $sentinel -PathType Leaf)) {
      throw "Start removed the pre-existing collision sentinel: $($collision.Name)"
    }
  }

  New-Item -ItemType Directory -Path $firstRoot -ErrorAction Stop | Out-Null
  New-Item -ItemType Directory -Path $secondRoot -ErrorAction Stop | Out-Null
  $first = & $startScript -RunRoot $firstRoot -PythonExecutable $PythonExecutable -SourceRoot $SourceRoot -ResponseDelayMs 250 | ConvertFrom-Json
  $second = & $startScript -RunRoot $secondRoot -PythonExecutable $PythonExecutable -SourceRoot $SourceRoot -ResponseDelayMs 250 | ConvertFrom-Json
  if (
    [int]$first.pid -eq [int]$second.pid -or
    [int]$first.port -eq [int]$second.port -or
    [string]$first.runRootName -eq [string]$second.runRootName
  ) {
    throw 'Independently owned GitLab MR fixtures collided.'
  }
  Assert-CredentialAndPathSafeReceipt -RunRoot $firstRoot -Started $first
  Assert-CredentialAndPathSafeReceipt -RunRoot $secondRoot -Started $second

  $probe = & $probeScript -RunRoot $firstRoot | ConvertFrom-Json
  if (
    [string]$probe.fixture -ne 'desktop-material-gitlab-mr' -or
    [string]$probe.dynamicUrls -ne 'pass' -or
    [string]$probe.cancellation -ne 'pass' -or
    @($probe.transientStatuses).Count -ne 3 -or
    @($probe.faultModes).Count -ne 5
  ) {
    throw 'GitLab MR fixture probe did not prove the complete contract.'
  }

  # The second server must retain its independent seed state.
  $secondState = Invoke-RestMethod -Method Get -Uri "$($second.endpoint)/__fixture__/state" -UseBasicParsing
  if (
    @($secondState.mergeRequestIids).Count -ne 5 -or
    [int]$secondState.nextIid -ne 42 -or
    [string]$secondState.faultMode -ne 'none'
  ) {
    throw 'Concurrent GitLab MR fixture state leaked between owned servers.'
  }

  # Tampering both receipts toward this unrelated PowerShell PID must refuse.
  $firstReadyPath = Join-Path $firstRoot 'gitlab-mr\ready.json'
  $firstLauncherPath = Join-Path $firstRoot 'gitlab-mr\launcher.json'
  $firstReadyOriginal = Get-Content -LiteralPath $firstReadyPath -Raw -ErrorAction Stop
  $firstLauncherOriginal = Get-Content -LiteralPath $firstLauncherPath -Raw -ErrorAction Stop
  $tamperedReady = $firstReadyOriginal | ConvertFrom-Json
  $tamperedLauncher = $firstLauncherOriginal | ConvertFrom-Json
  $tamperedReady.pid = $PID
  $tamperedLauncher.pid = $PID
  Write-JsonWithoutBom -Path $firstReadyPath -Value $tamperedReady
  Write-JsonWithoutBom -Path $firstLauncherPath -Value $tamperedLauncher
  Assert-Throws -Label 'unrelated PID identity' -Operation {
    $null = & $cleanupScript -RunRoot $firstRoot
  }
  if (
    -not (Get-Process -Id ([int]$first.pid) -ErrorAction SilentlyContinue) -or
    -not (Get-Process -Id $PID -ErrorAction SilentlyContinue)
  ) {
    throw 'PID identity refusal stopped an unrelated or owned process.'
  }
  [IO.File]::WriteAllText($firstReadyPath, $firstReadyOriginal, [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText($firstLauncherPath, $firstLauncherOriginal, [Text.UTF8Encoding]::new($false))

  # A receipt pointing outside the owned relative mutation log must also refuse.
  $tamperedReady = $firstReadyOriginal | ConvertFrom-Json
  $tamperedReady.mutationLog = '../unrelated/mutations.jsonl'
  Write-JsonWithoutBom -Path $firstReadyPath -Value $tamperedReady
  Assert-Throws -Label 'unrelated mutation-log path' -Operation {
    $null = & $cleanupScript -RunRoot $firstRoot
  }
  if (-not (Get-Process -Id ([int]$first.pid) -ErrorAction SilentlyContinue)) {
    throw 'Path identity refusal stopped the owned fixture process.'
  }
  [IO.File]::WriteAllText($firstReadyPath, $firstReadyOriginal, [Text.UTF8Encoding]::new($false))

  # A launcher receipt naming an unrelated script must refuse command ownership.
  $tamperedLauncher = $firstLauncherOriginal | ConvertFrom-Json
  $tamperedLauncher.fixtureScript = 'C:\Windows\System32\notepad.exe'
  Write-JsonWithoutBom -Path $firstLauncherPath -Value $tamperedLauncher
  Assert-Throws -Label 'unrelated fixture script' -Operation {
    $null = & $cleanupScript -RunRoot $firstRoot
  }
  if (-not (Get-Process -Id ([int]$first.pid) -ErrorAction SilentlyContinue)) {
    throw 'Command identity refusal stopped the owned fixture process.'
  }
  [IO.File]::WriteAllText($firstLauncherPath, $firstLauncherOriginal, [Text.UTF8Encoding]::new($false))

  $firstCleanup = & $cleanupScript -RunRoot $firstRoot | ConvertFrom-Json
  $first = $null
  $secondCleanup = & $cleanupScript -RunRoot $secondRoot | ConvertFrom-Json
  $second = $null
  if (
    [bool]$firstCleanup.stopped -ne $true -or
    [bool]$firstCleanup.removed -ne $true -or
    [bool]$secondCleanup.stopped -ne $true -or
    [bool]$secondCleanup.removed -ne $true -or
    (Test-Path -LiteralPath $firstRoot) -or
    (Test-Path -LiteralPath $secondRoot)
  ) {
    throw 'Owned GitLab MR fixture cleanup contract failed.'
  }

  [ordered]@{
    fixture = 'desktop-material-gitlab-mr'
    independentServers = 2
    collisionRefusals = 2
    pidRefusal = 'pass'
    pathRefusals = 2
    probe = $probe
    cleanup = 'pass'
  } | ConvertTo-Json -Compress -Depth 8
} finally {
  if ($null -ne $first -and (Test-Path -LiteralPath $firstRoot)) {
    $readyPath = Join-Path $firstRoot 'gitlab-mr\ready.json'
    $launcherPath = Join-Path $firstRoot 'gitlab-mr\launcher.json'
    if ($null -ne $firstReadyOriginal -and (Test-Path -LiteralPath $readyPath)) {
      [IO.File]::WriteAllText($readyPath, $firstReadyOriginal, [Text.UTF8Encoding]::new($false))
    }
    if ($null -ne $firstLauncherOriginal -and (Test-Path -LiteralPath $launcherPath)) {
      [IO.File]::WriteAllText($launcherPath, $firstLauncherOriginal, [Text.UTF8Encoding]::new($false))
    }
    $null = & $cleanupScript -RunRoot $firstRoot
  }
  if ($null -ne $second -and (Test-Path -LiteralPath $secondRoot)) {
    $null = & $cleanupScript -RunRoot $secondRoot
  }
  foreach ($ownedTestRoot in @(
    $firstRoot,
    $secondRoot,
    $readyCollisionRoot,
    $logCollisionRoot
  )) {
    Remove-OwnedGitLabMRTestRoot -Path $ownedTestRoot
  }
}
