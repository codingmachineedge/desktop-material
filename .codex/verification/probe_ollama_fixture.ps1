param(
  [Parameter(Mandatory = $true)]
  [string]$RunRoot
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ollama_fixture_common.ps1')

$paths = Get-OwnedOllamaFixturePaths -RunRoot $RunRoot
$ready = Read-OwnedOllamaReadyReceipt -Paths $paths
if (-not (Get-Process -Id ([int]$ready.pid) -ErrorAction SilentlyContinue)) {
  throw "Owned Ollama fixture process is not running: $([int]$ready.pid)"
}
$endpoint = ([string]$ready.endpoint).TrimEnd('/')

function ConvertTo-FixtureJson {
  param([Parameter(Mandatory = $true)]$Value)
  return $Value | ConvertTo-Json -Compress -Depth 8
}

function Invoke-FixtureJson {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Path,
    $Body
  )

  $options = @{
    Method = $Method
    Uri = "$endpoint$Path"
    UseBasicParsing = $true
  }
  if ($null -ne $Body) {
    $options.Body = ConvertTo-FixtureJson $Body
    $options.ContentType = 'application/json'
  }
  return Invoke-RestMethod @options
}

function Assert-FixtureStatus {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][int]$ExpectedStatus,
    $Body
  )

  try {
    $options = @{
      Method = $Method
      Uri = "$endpoint$Path"
      UseBasicParsing = $true
    }
    if ($null -ne $Body) {
      $options.Body = ConvertTo-FixtureJson $Body
      $options.ContentType = 'application/json'
    }
    $response = Invoke-WebRequest @options
    $status = [int]$response.StatusCode
  } catch {
    if ($null -eq $_.Exception.Response) {
      throw
    }
    $status = [int]$_.Exception.Response.StatusCode
  }
  if ($status -ne $ExpectedStatus) {
    throw "$Method $Path returned $status; expected $ExpectedStatus."
  }
}

function Set-FixtureFault {
  param([Parameter(Mandatory = $true)][string]$Mode)
  $state = Invoke-FixtureJson -Method Post -Path '/__fixture__/fault' -Body @{ mode = $Mode }
  if ([string]$state.faultMode -ne $Mode) {
    throw "Fixture fault mode did not settle at $Mode."
  }
}

# Begin from a deterministic state and prove the complete non-streaming model lifecycle.
$null = Invoke-FixtureJson -Method Post -Path '/__fixture__/reset' -Body @{}
$version = Invoke-FixtureJson -Method Get -Path '/api/version'
$tags = Invoke-FixtureJson -Method Get -Path '/api/tags'
$running = Invoke-FixtureJson -Method Get -Path '/api/ps'
$shown = Invoke-FixtureJson -Method Post -Path '/api/show' -Body @{ model = 'material-vision:3b' }
if (
  [string]$version.version -ne [string]$ready.version -or
  @($tags.models).Count -ne 3 -or
  @($running.models).Count -ne 1 -or
  -not (@($shown.capabilities) -contains 'vision') -or
  @($tags.models | Where-Object { [string]$_.digest -notmatch '^sha256:[0-9a-f]{64}$' }).Count -ne 0
) {
  throw 'Base Ollama inventory contract failed.'
}

$copyName = 'material-probe-copy:3b'
$null = Invoke-FixtureJson -Method Post -Path '/api/copy' -Body @{
  source = 'material-vision:3b'
  destination = $copyName
}
$null = Invoke-FixtureJson -Method Post -Path '/api/generate' -Body @{
  model = $copyName
  prompt = ''
  keep_alive = -1
  stream = $false
}
$runningAfterLoad = Invoke-FixtureJson -Method Get -Path '/api/ps'
if (-not (@($runningAfterLoad.models.name) -contains $copyName)) {
  throw 'Copied model did not enter the running inventory.'
}
$null = Invoke-FixtureJson -Method Post -Path '/api/generate' -Body @{
  model = $copyName
  prompt = ''
  keep_alive = 0
  stream = $false
}
$null = Invoke-FixtureJson -Method Delete -Path '/api/delete' -Body @{ model = $copyName }

# Abort a live streaming response after its first frame and prove atomic rollback.
$pullBody = ConvertTo-FixtureJson @{ model = 'material-code:1.5b'; stream = $true }
$pullBodyBytes = [Text.Encoding]::UTF8.GetBytes($pullBody)
$rawRequest = @(
  'POST /api/pull HTTP/1.1'
  "Host: 127.0.0.1:$([int]$ready.port)"
  'Content-Type: application/json'
  "Content-Length: $($pullBodyBytes.Length)"
  'Connection: close'
  ''
  $pullBody
) -join "`r`n"
$tcp = [Net.Sockets.TcpClient]::new()
try {
  $tcp.NoDelay = $true
  $tcp.ReceiveTimeout = 5000
  $tcp.SendTimeout = 5000
  $tcp.Client.LingerState = [Net.Sockets.LingerOption]::new($true, 0)
  $tcp.Connect('127.0.0.1', [int]$ready.port)
  $networkStream = $tcp.GetStream()
  $requestBytes = [Text.Encoding]::ASCII.GetBytes($rawRequest)
  $networkStream.Write($requestBytes, 0, $requestBytes.Length)
  $networkStream.Flush()
  $buffer = [byte[]]::new(4096)
  $received = ''
  while (-not $received.Contains('"status":"pulling manifest"')) {
    $count = $networkStream.Read($buffer, 0, $buffer.Length)
    if ($count -le 0) {
      throw 'Streaming pull closed before the first progress frame.'
    }
    $received += [Text.Encoding]::UTF8.GetString($buffer, 0, $count)
    if ($received.Length -gt 64KB) {
      throw 'Streaming pull response exceeded the bounded first-frame probe.'
    }
  }
} finally {
  $tcp.Dispose()
}
$cancelDeadline = [DateTime]::UtcNow.AddSeconds(8)
do {
  $stateAfterCancel = Invoke-FixtureJson -Method Get -Path '/__fixture__/state'
  if (@($stateAfterCancel.activePulls).Count -eq 0) { break }
  if ([DateTime]::UtcNow -ge $cancelDeadline) {
    throw 'Cancelled pull did not release its active reservation.'
  }
  Start-Sleep -Milliseconds 100
} while ($true)
if (@($stateAfterCancel.installedModels) -contains 'material-code:1.5b') {
  throw 'Cancelled pull installed a partial model.'
}

# Exercise every deterministic failure profile without changing model state.
Set-FixtureFault -Mode 'unavailable'
Assert-FixtureStatus -Method Get -Path '/api/version' -ExpectedStatus 503
Set-FixtureFault -Mode 'partial'
Assert-FixtureStatus -Method Get -Path '/api/version' -ExpectedStatus 200
Assert-FixtureStatus -Method Get -Path '/api/ps' -ExpectedStatus 503
Set-FixtureFault -Mode 'malformed'
$malformed = Invoke-WebRequest -UseBasicParsing -Method Get -Uri "$endpoint/api/tags"
$malformedContent = if ($malformed.Content -is [byte[]]) {
  [Text.Encoding]::UTF8.GetString($malformed.Content)
} else {
  [string]$malformed.Content
}
$malformedRejected = $false
try {
  $null = $malformedContent | ConvertFrom-Json
} catch {
  $malformedRejected = $true
}
if (-not $malformedRejected) {
  throw 'Malformed fixture response unexpectedly parsed as JSON.'
}
Set-FixtureFault -Mode 'error'
Assert-FixtureStatus -Method Post -Path '/api/copy' -ExpectedStatus 500 -Body @{
  source = 'material-vision:3b'
  destination = 'blocked-by-fault:3b'
}
Set-FixtureFault -Mode 'stream-failure'
$streamFailure = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$endpoint/api/pull" -ContentType 'application/json' -Body (
  ConvertTo-FixtureJson @{ model = 'material-code:1.5b'; stream = $true }
)
$streamFailureContent = if ($streamFailure.Content -is [byte[]]) {
  [Text.Encoding]::UTF8.GetString($streamFailure.Content)
} else {
  [string]$streamFailure.Content
}
$streamFailureFrames = @(
  $streamFailureContent -split "`r?`n" |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    ForEach-Object { $_ | ConvertFrom-Json }
)
if (@($streamFailureFrames | Where-Object { $null -ne $_.PSObject.Properties['error'] }).Count -ne 1) {
  throw 'Stream-failure profile did not emit one Ollama error frame.'
}
Set-FixtureFault -Mode 'none'
$pull = Invoke-FixtureJson -Method Post -Path '/api/pull' -Body @{
  model = 'material-code:1.5b'
  stream = $false
}
if ([string]$pull.status -ne 'success') {
  throw 'Non-streaming pull did not finish successfully.'
}

$events = @(
  Get-Content -LiteralPath $paths.MutationLog -ErrorAction Stop |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    ForEach-Object { $_ | ConvertFrom-Json }
)
for ($index = 0; $index -lt $events.Count; $index++) {
  if ([int]$events[$index].sequence -ne $index + 1) {
    throw 'Mutation log sequence is not contiguous.'
  }
}
$operations = @($events | Where-Object { $_.kind -eq 'mutation' } | ForEach-Object { $_.operation })
foreach ($required in @(
  'copy',
  'load',
  'unload',
  'delete',
  'pull-cancelled',
  'pull-failed',
  'pull-complete',
  'set-fault'
)) {
  if (-not ($operations -contains $required)) {
    throw "Mutation log is missing $required."
  }
}
$null = Invoke-FixtureJson -Method Post -Path '/__fixture__/reset' -Body @{}

[ordered]@{
  fixture = [string]$ready.fixture
  endpoint = $endpoint
  version = [string]$version.version
  installedModels = @($tags.models).Count
  initialRunningModels = @($running.models).Count
  liveCancellation = 'pass'
  faultModes = @('unavailable', 'partial', 'malformed', 'error', 'stream-failure')
  mutationEvents = @($events | Where-Object { $_.kind -eq 'mutation' }).Count
  requestEvents = @($events | Where-Object { $_.kind -eq 'request' }).Count
} | ConvertTo-Json -Compress -Depth 5
