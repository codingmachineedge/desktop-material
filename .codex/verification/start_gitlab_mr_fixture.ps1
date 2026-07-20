param(
  [Parameter(Mandatory = $true)]
  [string]$RunRoot,
  [Parameter(Mandatory = $true)]
  [string]$PythonExecutable,
  [Parameter(Mandatory = $true)]
  [string]$SourceRoot,
  [ValidateRange(0, 65535)]
  [int]$Port = 0,
  [ValidateRange(50, 2000)]
  [int]$ResponseDelayMs = 600,
  [ValidateSet('none', 'unavailable', 'error', 'malformed', 'partial', 'delayed')]
  [string]$FaultMode = 'none'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'gitlab_mr_fixture_common.ps1')

$paths = Get-OwnedGitLabMRFixturePaths -RunRoot $RunRoot -CreateOwnedDirectory
$resolvedSource = [IO.Path]::GetFullPath($SourceRoot).TrimEnd('\')
$sourceItem = Get-Item -LiteralPath $resolvedSource -ErrorAction Stop
if (-not $sourceItem.PSIsContainer -or (Test-GitLabMRReparsePoint $sourceItem)) {
  throw "Source root must be a real directory: $resolvedSource"
}
$scriptPath = Join-Path $resolvedSource '.codex\verification\fake_gitlab_mr_server.py'
$pythonItem = Get-Item -LiteralPath ([IO.Path]::GetFullPath($PythonExecutable)) -ErrorAction Stop
$fixtureItem = Get-Item -LiteralPath $scriptPath -ErrorAction Stop
foreach ($required in @($pythonItem, $fixtureItem)) {
  if ($required.PSIsContainer -or (Test-GitLabMRReparsePoint $required)) {
    throw "Required fixture input must be a real file: $($required.FullName)"
  }
}
foreach ($output in @(
  $paths.Ready,
  $paths.MutationLog,
  $paths.Launcher,
  $paths.Stdout,
  $paths.Stderr
)) {
  if (Test-Path -LiteralPath $output) {
    throw "Owned fixture output already exists: $output"
  }
}

$arguments = @(
  (ConvertTo-GitLabMRQuotedProcessArgument $fixtureItem.FullName),
  '--bind', '127.0.0.1',
  '--port', [string]$Port,
  '--run-root', (ConvertTo-GitLabMRQuotedProcessArgument $paths.Root),
  '--ready-file', (ConvertTo-GitLabMRQuotedProcessArgument $paths.Ready),
  '--mutation-log', (ConvertTo-GitLabMRQuotedProcessArgument $paths.MutationLog),
  '--fault-mode', $FaultMode,
  '--response-delay-ms', [string]$ResponseDelayMs
)
$startOptions = @{
  FilePath = $pythonItem.FullName
  ArgumentList = $arguments
  WorkingDirectory = $resolvedSource
  WindowStyle = 'Hidden'
  RedirectStandardOutput = $paths.Stdout
  RedirectStandardError = $paths.Stderr
  PassThru = $true
}
$process = Start-Process @startOptions
$startedAt = $process.StartTime.ToUniversalTime().ToString('o')
$deadline = [DateTime]::UtcNow.AddSeconds(15)
try {
  while (-not (Test-Path -LiteralPath $paths.Ready -PathType Leaf)) {
    if ($process.HasExited) {
      $stderr = if (Test-Path -LiteralPath $paths.Stderr) {
        Get-Content -LiteralPath $paths.Stderr -Raw
      } else {
        ''
      }
      throw "GitLab MR fixture exited before readiness ($($process.ExitCode)): $stderr"
    }
    if ([DateTime]::UtcNow -ge $deadline) {
      throw 'Timed out waiting for the GitLab MR fixture ready receipt.'
    }
    Start-Sleep -Milliseconds 100
  }
  $ready = Read-OwnedGitLabMRReadyReceipt -Paths $paths
  if ([int]$ready.pid -ne $process.Id) {
    throw "Ready PID $([int]$ready.pid) does not match launcher PID $($process.Id)."
  }
  $launcher = [ordered]@{
    fixture = $script:GitLabMRFixtureId
    protocolVersion = $script:GitLabMRFixtureProtocolVersion
    pid = $process.Id
    processStartTimeUtc = $startedAt
    runRootName = $paths.RootName
    pythonExecutable = $pythonItem.FullName
    fixtureScript = $fixtureItem.FullName
  }
  $launcherJson = ($launcher | ConvertTo-Json -Depth 4) + [Environment]::NewLine
  if ($launcherJson.Contains($script:GitLabMRPrivateToken)) {
    throw 'Launcher receipt unexpectedly contains the private token.'
  }
  [IO.File]::WriteAllText(
    $paths.Launcher,
    $launcherJson,
    [Text.UTF8Encoding]::new($false)
  )
} catch {
  if (-not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
  throw
}

[ordered]@{
  fixture = [string]$ready.fixture
  protocolVersion = [int]$ready.protocolVersion
  pid = [int]$ready.pid
  bind = [string]$ready.bind
  port = [int]$ready.port
  endpoint = [string]$ready.endpoint
  apiEndpoint = [string]$ready.apiEndpoint
  projectId = [int]$ready.projectId
  projectPath = [string]$ready.projectPath
  encodedProjectPath = [string]$ready.encodedProjectPath
  tokenRequired = [bool]$ready.tokenRequired
  runId = [string]$ready.runId
  runRootName = [string]$ready.runRootName
  mutationLog = [string]$ready.mutationLog
  faultMode = [string]$ready.faultMode
  responseDelayMs = [int]$ready.responseDelayMs
} | ConvertTo-Json -Compress
