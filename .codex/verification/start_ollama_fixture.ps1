param(
  [Parameter(Mandatory = $true)]
  [string]$RunRoot,
  [Parameter(Mandatory = $true)]
  [string]$PythonExecutable,
  [Parameter(Mandatory = $true)]
  [string]$SourceRoot,
  [ValidateRange(0, 65535)]
  [int]$Port = 0,
  [ValidateRange(0, 2000)]
  [int]$PullFrameDelayMs = 300,
  [ValidateSet('none', 'unavailable', 'partial', 'malformed', 'error', 'stream-failure')]
  [string]$FaultMode = 'none'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ollama_fixture_common.ps1')

$paths = Get-OwnedOllamaFixturePaths -RunRoot $RunRoot -CreateOwnedDirectory
$resolvedSource = [IO.Path]::GetFullPath($SourceRoot).TrimEnd('\')
$sourceItem = Get-Item -LiteralPath $resolvedSource -ErrorAction Stop
if (-not $sourceItem.PSIsContainer -or (Test-OllamaReparsePoint $sourceItem)) {
  throw "Source root must be a real directory: $resolvedSource"
}
$scriptPath = Join-Path $resolvedSource '.codex\verification\fake_ollama_server.py'
$pythonItem = Get-Item -LiteralPath ([IO.Path]::GetFullPath($PythonExecutable)) -ErrorAction Stop
$fixtureItem = Get-Item -LiteralPath $scriptPath -ErrorAction Stop
foreach ($required in @($pythonItem, $fixtureItem)) {
  if ($required.PSIsContainer -or (Test-OllamaReparsePoint $required)) {
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
  (ConvertTo-QuotedProcessArgument $fixtureItem.FullName),
  '--bind', '127.0.0.1',
  '--port', [string]$Port,
  '--run-root', (ConvertTo-QuotedProcessArgument $paths.Root),
  '--ready-file', (ConvertTo-QuotedProcessArgument $paths.Ready),
  '--mutation-log', (ConvertTo-QuotedProcessArgument $paths.MutationLog),
  '--fault-mode', $FaultMode,
  '--pull-frame-delay-ms', [string]$PullFrameDelayMs
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
      throw "Ollama fixture exited before readiness ($($process.ExitCode)): $stderr"
    }
    if ([DateTime]::UtcNow -ge $deadline) {
      throw 'Timed out waiting for the Ollama fixture ready receipt.'
    }
    Start-Sleep -Milliseconds 100
  }
  $ready = Read-OwnedOllamaReadyReceipt -Paths $paths
  if ([int]$ready.pid -ne $process.Id) {
    throw "Ready PID $([int]$ready.pid) does not match launcher PID $($process.Id)."
  }
  $launcher = [ordered]@{
    fixture = $script:OllamaFixtureId
    protocolVersion = $script:OllamaFixtureProtocolVersion
    pid = $process.Id
    processStartTimeUtc = $startedAt
    runRootName = $paths.RootName
    pythonExecutable = $pythonItem.FullName
    fixtureScript = $fixtureItem.FullName
  }
  [IO.File]::WriteAllText(
    $paths.Launcher,
    (($launcher | ConvertTo-Json -Depth 4) + [Environment]::NewLine),
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
  runId = [string]$ready.runId
  runRootName = [string]$ready.runRootName
  mutationLog = [string]$ready.mutationLog
  faultMode = [string]$ready.faultMode
  pullFrameDelayMs = [int]$ready.pullFrameDelayMs
  minimumPullDurationMs = [int]$ready.minimumPullDurationMs
} | ConvertTo-Json -Compress
