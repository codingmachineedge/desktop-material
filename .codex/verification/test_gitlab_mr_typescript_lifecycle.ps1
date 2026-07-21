param(
  [string]$SourceRoot = (Join-Path $PSScriptRoot '..\..'),
  [string]$PythonExecutable = '',
  [string]$NodeExecutable = '',
  [ValidateRange(1, 300)]
  [int]$TestTimeoutSeconds = 45
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'gitlab_mr_fixture_common.ps1')

function Stop-OwnedGitLabMRTypeScriptProcessTree {
  param(
    [Parameter(Mandatory = $true)]$Process,
    [Parameter(Mandatory = $true)][string]$ExpectedExecutable
  )

  if ($Process.HasExited) {
    return
  }
  $liveProcess = Get-Process -Id $Process.Id -ErrorAction Stop
  if ($liveProcess.StartTime.ToUniversalTime() -ne $Process.StartTime.ToUniversalTime()) {
    throw 'TypeScript test PID was reused by another process.'
  }
  $rootProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($Process.Id)"
  if (
    $null -eq $rootProcess -or
    [string]::IsNullOrWhiteSpace($rootProcess.ExecutablePath) -or
    -not [string]::Equals(
      [IO.Path]::GetFullPath($rootProcess.ExecutablePath),
      [IO.Path]::GetFullPath($ExpectedExecutable),
      [StringComparison]::OrdinalIgnoreCase
    )
  ) {
    throw 'TypeScript test process no longer matched the owned Node executable.'
  }

  $allProcesses = @(Get-CimInstance Win32_Process)
  $descendantIds = [Collections.Generic.List[uint32]]::new()
  $pendingIds = [Collections.Generic.Queue[uint32]]::new()
  $pendingIds.Enqueue([uint32]$Process.Id)
  while ($pendingIds.Count -gt 0) {
    $parentId = $pendingIds.Dequeue()
    foreach ($child in @($allProcesses | Where-Object { [uint32]$_.ParentProcessId -eq $parentId })) {
      $childId = [uint32]$child.ProcessId
      $descendantIds.Add($childId)
      $pendingIds.Enqueue($childId)
    }
  }
  for ($index = $descendantIds.Count - 1; $index -ge 0; $index--) {
    Stop-Process -Id $descendantIds[$index] -Force -ErrorAction SilentlyContinue
  }
  Stop-Process -Id $Process.Id -Force -ErrorAction Stop

  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    $remaining = @(
      @([uint32]$Process.Id) + @($descendantIds) |
        Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }
    )
    if ($remaining.Count -eq 0) {
      return
    }
    if ([DateTime]::UtcNow -ge $deadline) {
      throw 'Timed out stopping the owned TypeScript test process tree.'
    }
    Start-Sleep -Milliseconds 50
  } while ($true)
}

$resolvedSource = [IO.Path]::GetFullPath($SourceRoot).TrimEnd('\')
$sourceItem = Get-Item -LiteralPath $resolvedSource -ErrorAction Stop
if (-not $sourceItem.PSIsContainer -or (Test-GitLabMRReparsePoint $sourceItem)) {
  throw 'Source root must be a real directory.'
}
if ([string]::IsNullOrWhiteSpace($PythonExecutable)) {
  $PythonExecutable = (Get-Command python.exe -ErrorAction Stop).Source
}
if ([string]::IsNullOrWhiteSpace($NodeExecutable)) {
  $NodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
}
$pythonItem = Get-Item -LiteralPath ([IO.Path]::GetFullPath($PythonExecutable)) -ErrorAction Stop
$nodeItem = Get-Item -LiteralPath ([IO.Path]::GetFullPath($NodeExecutable)) -ErrorAction Stop
foreach ($runtime in @($pythonItem, $nodeItem)) {
  if ($runtime.PSIsContainer -or (Test-GitLabMRReparsePoint $runtime)) {
    throw 'Fixture runtime must be a real executable file.'
  }
}

$tempItem = Get-Item -LiteralPath ([IO.Path]::GetFullPath($env:TEMP)) -ErrorAction Stop
if (-not $tempItem.PSIsContainer -or (Test-GitLabMRReparsePoint $tempItem)) {
  throw 'TEMP must be a real directory, not a symlink or junction.'
}
$runRootName = "desktop-material-gitlab-mr-ts-$([Guid]::NewGuid().ToString('N'))"
$runRoot = Join-Path $tempItem.FullName $runRootName
$rootCreated = $false
$paths = $null
$started = $false
$testProcess = $null
$failure = $null
$result = $null
$endpointVariable = 'DESKTOP_MATERIAL_GITLAB_MR_LIVE_ENDPOINT'
$projectVariable = 'DESKTOP_MATERIAL_GITLAB_MR_LIVE_PROJECT'
$hadEndpoint = Test-Path "Env:\$endpointVariable"
$hadProject = Test-Path "Env:\$projectVariable"
$previousEndpoint = [Environment]::GetEnvironmentVariable($endpointVariable, 'Process')
$previousProject = [Environment]::GetEnvironmentVariable($projectVariable, 'Process')

try {
  New-Item -ItemType Directory -Path $runRoot -ErrorAction Stop | Out-Null
  $rootCreated = $true
  $runRoot = Resolve-OwnedGitLabMRRunRoot -RunRoot $runRoot
  $startScript = Join-Path $PSScriptRoot 'start_gitlab_mr_fixture.ps1'
  $cleanupScript = Join-Path $PSScriptRoot 'cleanup_gitlab_mr_fixture.ps1'
  $startReceiptRaw = & $startScript `
    -RunRoot $runRoot `
    -PythonExecutable $pythonItem.FullName `
    -SourceRoot $resolvedSource `
    -ResponseDelayMs 800
  $started = $true
  $startReceipt = $startReceiptRaw | ConvertFrom-Json
  $paths = Get-OwnedGitLabMRFixturePaths -RunRoot $runRoot
  $ready = Read-OwnedGitLabMRReadyReceipt -Paths $paths
  if (
    [string]$startReceipt.endpoint -ne [string]$ready.endpoint -or
    [string]$startReceipt.projectPath -ne [string]$ready.projectPath
  ) {
    throw 'Fixture start receipt did not match the owned ready receipt.'
  }

  [Environment]::SetEnvironmentVariable(
    $endpointVariable,
    [string]$ready.endpoint,
    'Process'
  )
  [Environment]::SetEnvironmentVariable(
    $projectVariable,
    [string]$ready.projectPath,
    'Process'
  )
  $typescriptStdout = Join-Path $paths.Directory 'typescript-stdout.log'
  $typescriptStderr = Join-Path $paths.Directory 'typescript-stderr.log'
  $nodeArguments = @(
    ConvertTo-GitLabMRQuotedProcessArgument (
      Join-Path $resolvedSource 'script\test.mjs'
    )
    ConvertTo-GitLabMRQuotedProcessArgument (
      Join-Path $resolvedSource 'app\test\unit\gitlab-merge-request-live-fixture-test.ts'
    )
  )
  $testProcess = Start-Process `
    -FilePath $nodeItem.FullName `
    -ArgumentList $nodeArguments `
    -WorkingDirectory $resolvedSource `
    -WindowStyle Hidden `
    -RedirectStandardOutput $typescriptStdout `
    -RedirectStandardError $typescriptStderr `
    -PassThru
  $testDeadline = [DateTime]::UtcNow.AddSeconds($TestTimeoutSeconds)
  while (-not $testProcess.HasExited) {
    if ([DateTime]::UtcNow -ge $testDeadline) {
      throw 'The TypeScript GitLab fixture lifecycle test timed out.'
    }
    Start-Sleep -Milliseconds 50
    $testProcess.Refresh()
  }
  $testProcess.WaitForExit()
  foreach ($testOutput in @($typescriptStdout, $typescriptStderr)) {
    $content = [string](Get-Content -LiteralPath $testOutput -Raw -ErrorAction Stop)
    if (
      ($null -ne $content -and $content.Contains($script:GitLabMRPrivateToken)) -or
      ($null -ne $content -and $content.Contains($runRoot))
    ) {
      throw 'TypeScript test output exposed a credential or absolute temp path.'
    }
  }
  if ($testProcess.ExitCode -ne 0) {
    throw 'The TypeScript GitLab fixture lifecycle test failed.'
  }

  $events = @(
    Get-Content -LiteralPath $paths.MutationLog -ErrorAction Stop |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
      ForEach-Object { $_ | ConvertFrom-Json }
  )
  for ($index = 0; $index -lt $events.Count; $index++) {
    if ([int]$events[$index].sequence -ne $index + 1) {
      throw 'Fixture audit sequence was not contiguous.'
    }
  }
  $mutations = @($events | Where-Object { $_.kind -eq 'mutation' })
  $creates = @($mutations | Where-Object { $_.operation -eq 'create' })
  $updates = @($mutations | Where-Object { $_.operation -eq 'update' })
  $approves = @($mutations | Where-Object { $_.operation -eq 'approve' })
  $unapproves = @($mutations | Where-Object { $_.operation -eq 'unapprove' })
  $resets = @($mutations | Where-Object { $_.operation -eq 'reset' })
  $faults = @($mutations | Where-Object { $_.operation -eq 'set-fault' })
  if (
    $creates.Count -ne 1 -or
    $updates.Count -ne 3 -or
    $approves.Count -ne 1 -or
    $unapproves.Count -ne 1 -or
    $resets.Count -ne 1 -or
    @($faults | Where-Object { $_.mode -eq 'delayed' }).Count -ne 1 -or
    @($faults | Where-Object { $_.mode -eq 'none' }).Count -ne 2
  ) {
    throw 'TypeScript client mutation evidence had an unexpected operation count.'
  }
  $edit = @(
    $updates |
      Where-Object { @($_.changedFields) -contains 'target_branch' }
  )
  $stateUpdates = @(
    $updates |
      Where-Object { @($_.changedFields) -contains 'state_event' }
  )
  if (
    $edit.Count -ne 1 -or
    [string]$edit[0].targetBranch -ne 'release/next' -or
    @($edit[0].reviewerIds).Count -ne 1 -or
    @($edit[0].assigneeIds).Count -ne 2 -or
    $stateUpdates.Count -ne 2 -or
    @($stateUpdates | ForEach-Object { $_.state }) -notcontains 'closed' -or
    @($stateUpdates | ForEach-Object { $_.state }) -notcontains 'opened' -or
    [bool]$approves[0].headSHAProvided -ne $true -or
    [bool]$approves[0].headMatched -ne $true
  ) {
    throw 'TypeScript client mutation evidence did not prove the guarded lifecycle.'
  }
  $cancelDeadline = [DateTime]::UtcNow.AddSeconds(5)
  do {
    $events = @(
      Get-Content -LiteralPath $paths.MutationLog -ErrorAction Stop |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        ForEach-Object { $_ | ConvertFrom-Json }
    )
    $canceled = @(
      $events |
        Where-Object {
          $_.kind -eq 'request' -and
          $_.route -eq 'api-delayed' -and
          $_.outcome -eq 'canceled'
        }
    )
    if ($canceled.Count -eq 1) {
      break
    }
    if ([DateTime]::UtcNow -ge $cancelDeadline) {
      throw 'TypeScript client cancellation evidence was not recorded exactly once.'
    }
    Start-Sleep -Milliseconds 25
  } while ($true)
  for ($index = 0; $index -lt $events.Count; $index++) {
    if ([int]$events[$index].sequence -ne $index + 1) {
      throw 'Final fixture audit sequence was not contiguous.'
    }
  }
  $approveRequests = @(
    $events |
      Where-Object {
        $_.kind -eq 'request' -and
        $_.route -eq 'approve' -and
        $_.method -eq 'POST'
      }
  )
  $unapproveRequests = @(
    $events |
      Where-Object {
        $_.kind -eq 'request' -and
        $_.route -eq 'unapprove' -and
        $_.method -eq 'POST'
      }
  )
  if (
    $approveRequests.Count -ne 1 -or
    [int]$approveRequests[0].status -ne 201 -or
    $unapproveRequests.Count -ne 1 -or
    [int]$unapproveRequests[0].status -ne 200
  ) {
    throw 'Wrong-HEAD approval requests were dispatched to the fixture.'
  }

  foreach ($artifact in @(
    $paths.Ready,
    $paths.MutationLog,
    $paths.Launcher,
    $paths.Stdout,
    $paths.Stderr,
    $typescriptStdout,
    $typescriptStderr
  )) {
    $content = [string](Get-Content -LiteralPath $artifact -Raw -ErrorAction Stop)
    if (
      ($null -ne $content -and $content.Contains($script:GitLabMRPrivateToken)) -or
      ($null -ne $content -and $content.Contains($runRoot))
    ) {
      throw 'Owned fixture artifact exposed a credential or absolute temp path.'
    }
  }
  $result = [ordered]@{
    fixture = $script:GitLabMRFixtureId
    typescriptClientLifecycle = 'pass'
    staleMutationGuard = 'pass'
    wrongHeadMutationGuards = 'pass'
    exactHeadApproval = 'pass'
    cancellation = 'pass'
    mutationEvents = $mutations.Count
  }
} catch {
  $failure = $_
} finally {
  if ($hadEndpoint) {
    [Environment]::SetEnvironmentVariable(
      $endpointVariable,
      $previousEndpoint,
      'Process'
    )
  } else {
    Remove-Item "Env:\$endpointVariable" -ErrorAction SilentlyContinue
  }
  if ($hadProject) {
    [Environment]::SetEnvironmentVariable(
      $projectVariable,
      $previousProject,
      'Process'
    )
  } else {
    Remove-Item "Env:\$projectVariable" -ErrorAction SilentlyContinue
  }

  $testCleanupFailure = $null
  try {
    if ($null -ne $testProcess) {
      Stop-OwnedGitLabMRTypeScriptProcessTree `
        -Process $testProcess `
        -ExpectedExecutable $nodeItem.FullName
    }
  } catch {
    $testCleanupFailure = $_
  }

  try {
    if ($started -and (Test-Path -LiteralPath $runRoot)) {
      $cleanupScript = Join-Path $PSScriptRoot 'cleanup_gitlab_mr_fixture.ps1'
      $cleanupReceipt = & $cleanupScript -RunRoot $runRoot | ConvertFrom-Json
      if (
        [bool]$cleanupReceipt.stopped -ne $true -or
        [bool]$cleanupReceipt.removed -ne $true
      ) {
        throw 'Owned fixture cleanup receipt was incomplete.'
      }
    } elseif ($rootCreated -and (Test-Path -LiteralPath $runRoot)) {
      $verifiedRoot = Resolve-OwnedGitLabMRRunRoot -RunRoot $runRoot
      $owners = @(
        Get-CimInstance Win32_Process |
          Where-Object {
            $_.CommandLine -and
            $_.CommandLine.IndexOf(
              $verifiedRoot,
              [StringComparison]::OrdinalIgnoreCase
            ) -ge 0
          }
      )
      if ($owners.Count -gt 0) {
        throw 'A process still referenced the partially started owned fixture.'
      }
      $links = @(
        Get-ChildItem -LiteralPath $verifiedRoot -Force -Recurse -ErrorAction Stop |
          Where-Object { Test-GitLabMRReparsePoint $_ }
      )
      if ($links.Count -gt 0) {
        throw 'Partially started owned fixture contained a reparse point.'
      }
      Remove-Item -LiteralPath $verifiedRoot -Recurse -Force -ErrorAction Stop
    }
    if (Test-Path -LiteralPath $runRoot) {
      throw 'Owned fixture temp root remained after cleanup.'
    }
    $remainingOwners = @(
      Get-CimInstance Win32_Process |
        Where-Object {
          $_.CommandLine -and
          $_.CommandLine.IndexOf(
            $runRoot,
            [StringComparison]::OrdinalIgnoreCase
          ) -ge 0
        }
    )
    if ($remainingOwners.Count -gt 0) {
      throw 'An owned fixture process remained after cleanup.'
    }
    if ($null -ne $testCleanupFailure) {
      throw $testCleanupFailure
    }
  } catch {
    if ($null -eq $failure) {
      $failure = $_
    } else {
      $failure = [Exception]::new('Lifecycle validation and owned cleanup both failed.')
    }
  }
}

if ($null -ne $failure) {
  $message = [string]$failure.Exception.Message
  $message = [regex]::Replace(
    $message,
    [regex]::Escape($runRoot),
    '[owned-temp-root]',
    [Text.RegularExpressions.RegexOptions]::IgnoreCase
  )
  $message = $message.Replace($script:GitLabMRPrivateToken, '[fixture-token]')
  throw $message
}

$result.ownedProcessRemaining = $false
$result.ownedTempRootRemoved = $true
$result | ConvertTo-Json -Compress
