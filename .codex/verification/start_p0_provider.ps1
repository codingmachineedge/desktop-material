param(
  [Parameter(Mandatory = $true)]
  [string]$RunRoot,
  [Parameter(Mandatory = $true)]
  [string]$PythonExecutable,
  [Parameter(Mandatory = $true)]
  [string]$SourceRoot,
  [ValidateRange(0, 65535)]
  [int]$Port = 0,
  [switch]$CopilotEnabled
)

$ErrorActionPreference = 'Stop'
$resolvedRoot = [IO.Path]::GetFullPath($RunRoot)
$resolvedTemp = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
if (
  -not $resolvedRoot.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -or
  [IO.Path]::GetFileName($resolvedRoot) -notlike 'desktop-material-p0-ui-*'
) {
  throw "Run root must be a named child of TEMP: $resolvedRoot"
}
if (-not (Test-Path -LiteralPath $resolvedRoot -PathType Container)) {
  throw "Run root does not exist: $resolvedRoot"
}

$script = Join-Path ([IO.Path]::GetFullPath($SourceRoot)) '.codex\verification\p0_fake_github_provider.py'
$gitRoot = Join-Path $resolvedRoot 'git-http'
$providerRoot = Join-Path $resolvedRoot 'provider'
$artifact = Join-Path $providerRoot 'artifact.zip'
$requestLog = Join-Path $providerRoot 'requests.jsonl'
$ready = Join-Path $providerRoot 'ready.json'

foreach ($required in @($PythonExecutable, $script, $gitRoot)) {
  if (-not (Test-Path -LiteralPath $required)) {
    throw "Required provider input does not exist: $required"
  }
}
if (Test-Path -LiteralPath $ready) {
  throw "Provider ready file already exists: $ready"
}

$arguments = @(
  $script,
  '--git-project-root', $gitRoot,
  '--artifact-file', $artifact,
  '--request-log', $requestLog,
  '--ready-file', $ready,
  '--port', $Port,
  '--html-url', 'http://material-provider.invalid'
)
if ($CopilotEnabled) {
  $arguments += '--copilot-enabled'
}
$startOptions = @{
  FilePath = $PythonExecutable
  ArgumentList = $arguments
  WorkingDirectory = $SourceRoot
  WindowStyle = 'Hidden'
  PassThru = $true
}
$process = Start-Process @startOptions

$deadline = [DateTime]::UtcNow.AddSeconds(15)
while (-not (Test-Path -LiteralPath $ready)) {
  if ($process.HasExited) {
    throw "Provider exited before readiness ($($process.ExitCode))."
  }
  if ([DateTime]::UtcNow -ge $deadline) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw 'Timed out waiting for the provider ready file.'
  }
  Start-Sleep -Milliseconds 100
}

$state = Get-Content -LiteralPath $ready -Raw | ConvertFrom-Json
[ordered]@{
  pid = [int]$state.pid
  launcherPid = $process.Id
  bind = [string]$state.bind
  port = [int]$state.port
  endpoint = [string]$state.endpoint
  htmlUrl = [string]$state.htmlUrl
  copilotEnabled = [bool]$state.copilotEnabled
  owner = [string]$state.owner
  repository = [string]$state.repository
  featureBranch = [string]$state.featureBranch
  credentialService = [string]$state.credentialService
  workflowRunId = [int]$state.workflowRunId
  workflowRunCount = [int]$state.workflowRunCount
  successfulWorkflowRunCount = [int]$state.successfulWorkflowRunCount
  workflowRunSentinelId = [int]$state.workflowRunSentinelId
  inspectorWorkflowRunId = [int]$state.inspectorWorkflowRunId
  inspectorLatestAttempt = [int]$state.inspectorLatestAttempt
  inspectorJobCount = [int]$state.inspectorJobCount
  inspectorCurrentJobId = [int]$state.inspectorCurrentJobId
  inspectorCurrentJobSentinelId = [int]$state.inspectorCurrentJobSentinelId
  inspectorHistoricalJobId = [int]$state.inspectorHistoricalJobId
  inspectorHistoricalJobSentinelId = [int]$state.inspectorHistoricalJobSentinelId
  pendingEnvironmentIds = @($state.pendingEnvironmentIds | ForEach-Object { [int]$_ })
  artifactId = [int]$state.artifactId
  artifactCount = [int]$state.artifactCount
  artifactSentinelId = [int]$state.artifactSentinelId
  artifactSize = [int]$state.artifactSize
  artifactDigest = [string]$state.artifactDigest
} | ConvertTo-Json -Compress
exit 0
