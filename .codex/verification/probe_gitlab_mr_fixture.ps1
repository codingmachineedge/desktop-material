param(
  [Parameter(Mandatory = $true)]
  [string]$RunRoot
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'gitlab_mr_fixture_common.ps1')

$paths = Get-OwnedGitLabMRFixturePaths -RunRoot $RunRoot
$ready = Read-OwnedGitLabMRReadyReceipt -Paths $paths
if (-not (Get-Process -Id ([int]$ready.pid) -ErrorAction SilentlyContinue)) {
  throw "Owned GitLab MR fixture process is not running: $([int]$ready.pid)"
}
$endpoint = ([string]$ready.endpoint).TrimEnd('/')
$projectApi = "/api/v4/projects/$($script:GitLabMREncodedProjectPath)"
$apiHeaders = @{ 'PRIVATE-TOKEN' = $script:GitLabMRPrivateToken }

function Invoke-GitLabMRJson {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Path,
    $Body,
    [switch]$NoAuth
  )

  $options = @{
    Method = $Method
    Uri = "$endpoint$Path"
    UseBasicParsing = $true
  }
  if (-not $NoAuth) {
    $options.Headers = $apiHeaders
  }
  if ($null -ne $Body) {
    $options.Body = $Body | ConvertTo-Json -Compress -Depth 8
    $options.ContentType = 'application/json'
  }
  return Invoke-RestMethod @options
}

function Assert-GitLabMRStatus {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][int]$ExpectedStatus,
    $Body,
    [hashtable]$Headers = $apiHeaders
  )

  try {
    $options = @{
      Method = $Method
      Uri = "$endpoint$Path"
      UseBasicParsing = $true
      Headers = $Headers
    }
    if ($null -ne $Body) {
      $options.Body = $Body | ConvertTo-Json -Compress -Depth 8
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

function Set-GitLabMRFault {
  param([Parameter(Mandatory = $true)][string]$Mode)

  $state = Invoke-GitLabMRJson -Method Post -Path '/__fixture__/fault' -Body @{
    mode = $Mode
  } -NoAuth
  if ([string]$state.faultMode -ne $Mode) {
    throw "GitLab MR fixture fault mode did not settle at $Mode."
  }
}

function Read-GitLabMRAuditEvents {
  return @(
    Get-Content -LiteralPath $paths.MutationLog -ErrorAction Stop |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
      ForEach-Object { $_ | ConvertFrom-Json }
  )
}

$null = Invoke-GitLabMRJson -Method Post -Path '/__fixture__/reset' -Body @{} -NoAuth
$health = Invoke-GitLabMRJson -Method Get -Path '/__fixture__/health' -NoAuth
if (
  [string]$health.status -ne 'ok' -or
  [bool]$health.tokenRequired -ne $true -or
  [string]$health.projectPath -ne $script:GitLabMRProjectPath -or
  [string]$health.encodedProjectPath -ne $script:GitLabMREncodedProjectPath
) {
  throw 'GitLab MR fixture health contract failed.'
}

# Authentication accepts exactly one PRIVATE-TOKEN header and no alternatives.
Assert-GitLabMRStatus -Method Get -Path "$projectApi/merge_requests" -ExpectedStatus 401 -Headers @{}
Assert-GitLabMRStatus -Method Get -Path "$projectApi/merge_requests" -ExpectedStatus 401 -Headers @{
  Authorization = "Bearer $($script:GitLabMRPrivateToken)"
}
Assert-GitLabMRStatus -Method Get -Path "$projectApi/merge_requests?private_token=$($script:GitLabMRPrivateToken)" -ExpectedStatus 401 -Headers @{}

# The nested project path must be URL-encoded as one path segment.
$project = Invoke-GitLabMRJson -Method Get -Path $projectApi
if (
  [int]$project.id -ne [int]$ready.projectId -or
  [string]$project.path_with_namespace -ne $script:GitLabMRProjectPath
) {
  throw 'Encoded GitLab project lookup failed.'
}
Assert-GitLabMRStatus -Method Get -Path "/api/v4/projects/$($script:GitLabMRProjectPath)/merge_requests" -ExpectedStatus 404

# Offset pagination must be bounded and expose GitLab Link plus X headers.
$pageResponse = Invoke-WebRequest -Method Get -Uri "$endpoint$projectApi/merge_requests?state=all&per_page=2&page=2" -Headers $apiHeaders -UseBasicParsing
$pageValues = @($pageResponse.Content | ConvertFrom-Json)
if (
  [int]$pageResponse.StatusCode -ne 200 -or
  $pageValues.Count -ne 2 -or
  [int]$pageValues[0].iid -ne 39 -or
  [string]$pageResponse.Headers['X-Next-Page'] -ne '3' -or
  [string]$pageResponse.Headers['X-Page'] -ne '2' -or
  [string]$pageResponse.Headers['X-Per-Page'] -ne '2' -or
  [string]$pageResponse.Headers['X-Prev-Page'] -ne '1' -or
  [string]$pageResponse.Headers['X-Total'] -ne '5' -or
  [string]$pageResponse.Headers['X-Total-Pages'] -ne '3' -or
  [string]$pageResponse.Headers['Link'] -notmatch 'rel="next"'
) {
  throw 'GitLab offset pagination contract failed.'
}
Assert-GitLabMRStatus -Method Get -Path "$projectApi/merge_requests?per_page=101" -ExpectedStatus 400
Assert-GitLabMRStatus -Method Get -Path "$projectApi/merge_requests?page=1000&per_page=100" -ExpectedStatus 400

# Poll the official detailed_merge_status transient states through readiness.
$singlePath = "$projectApi/merge_requests/41"
$first = Invoke-GitLabMRJson -Method Get -Path "${singlePath}?with_merge_status_recheck=true"
$second = Invoke-GitLabMRJson -Method Get -Path "${singlePath}?with_merge_status_recheck=true"
$third = Invoke-GitLabMRJson -Method Get -Path "${singlePath}?with_merge_status_recheck=true"
if (
  [string]$first.detailed_merge_status -ne 'checking' -or
  [string]$second.detailed_merge_status -ne 'approvals_syncing' -or
  [string]$third.detailed_merge_status -ne 'not_approved'
) {
  throw 'GitLab detailed_merge_status readiness progression failed.'
}
$headSha = [string]$third.sha

# Create a draft, then update title, reviewers, assignees, and state.
$created = Invoke-GitLabMRJson -Method Post -Path "$projectApi/merge_requests" -Body @{
  source_branch = 'feature/probe-native-review'
  target_branch = 'main'
  title = '[Draft] Probe native GitLab review'
  description = 'Synthetic owned lifecycle proof.'
  reviewer_ids = @(101, 103)
  assignee_ids = @(104)
}
$createdIid = [int]$created.iid
if (
  $createdIid -ne 42 -or
  [bool]$created.draft -ne $true -or
  @($created.reviewers).Count -ne 2 -or
  @($created.assignees).Count -ne 1
) {
  throw 'GitLab merge-request create contract failed.'
}
$updated = Invoke-GitLabMRJson -Method Put -Path "$projectApi/merge_requests/$createdIid" -Body @{
  title = 'Probe native GitLab review'
  reviewer_ids = @(103)
  assignee_ids = @(101, 104)
  state_event = 'close'
}
if (
  [bool]$updated.draft -ne $false -or
  [string]$updated.state -ne 'closed' -or
  @($updated.reviewers).Count -ne 1 -or
  @($updated.assignees).Count -ne 2
) {
  throw 'GitLab merge-request update contract failed.'
}
$null = Invoke-GitLabMRJson -Method Put -Path "$projectApi/merge_requests/$createdIid" -Body @{
  state_event = 'reopen'
}

$membersResult = Invoke-GitLabMRJson -Method Get -Path "$projectApi/members/all?per_page=100&page=1"
$members = @($membersResult)
$underprivilegedMembers = @(
  $members | Where-Object { [int]$_.access_level -lt 30 }
)
if (
  $members.Count -ne 4 -or
  $underprivilegedMembers.Count -ne 0
) {
  throw "GitLab project members/all contract failed (count=$($members.Count), underprivileged=$($underprivilegedMembers.Count))."
}

# A stale SHA must conflict without approval; the current HEAD can approve.
Assert-GitLabMRStatus -Method Post -Path "$singlePath/approve" -ExpectedStatus 409 -Body @{
  sha = ('f' * 40)
}
$beforeApproval = Invoke-GitLabMRJson -Method Get -Path "$singlePath/approvals"
if (
  [bool]$beforeApproval.approved -ne $false -or
  [int]$beforeApproval.approvals_required -ne 1 -or
  [int]$beforeApproval.approvals_left -ne 1
) {
  throw 'Stale SHA unexpectedly approved the merge request.'
}
$approved = Invoke-GitLabMRJson -Method Post -Path "$singlePath/approve" -Body @{
  sha = $headSha
}
$approvalState = Invoke-GitLabMRJson -Method Get -Path "$singlePath/approvals"
if (
  [int]$approved.approvals_left -ne 0 -or
  [string]$approved.detailed_merge_status -ne 'mergeable' -or
  [bool]$approvalState.approved -ne $true -or
  [int]$approvalState.approvals_required -ne 1 -or
  [int]$approvalState.approvals_left -ne 0 -or
  @($approvalState.approved_by).Count -ne 1
) {
  throw 'GitLab approval contract failed.'
}
$unapproved = Invoke-GitLabMRJson -Method Post -Path "$singlePath/unapprove" -Body @{}
if ([int]$unapproved.approvals_left -ne 1) {
  throw 'GitLab unapprove contract failed.'
}

# Deterministic unavailable, error, malformed, and partial profiles.
Set-GitLabMRFault -Mode 'unavailable'
Assert-GitLabMRStatus -Method Get -Path "$projectApi/merge_requests" -ExpectedStatus 503
Set-GitLabMRFault -Mode 'error'
Assert-GitLabMRStatus -Method Get -Path "$projectApi/merge_requests" -ExpectedStatus 500
Set-GitLabMRFault -Mode 'malformed'
$malformed = Invoke-WebRequest -Method Get -Uri "$endpoint$projectApi/merge_requests" -Headers $apiHeaders -UseBasicParsing
$malformedRejected = $false
try {
  $null = $malformed.Content | ConvertFrom-Json
} catch {
  $malformedRejected = $true
}
if (-not $malformedRejected) {
  throw 'Malformed GitLab fixture response unexpectedly parsed as JSON.'
}
Set-GitLabMRFault -Mode 'partial'
$partialListResult = Invoke-GitLabMRJson -Method Get -Path "$projectApi/merge_requests"
$partialList = @($partialListResult)
if ($partialList.Count -lt 1) {
  throw 'Partial GitLab profile lost merge-request inventory.'
}
Assert-GitLabMRStatus -Method Get -Path "$projectApi/members/all" -ExpectedStatus 503
Assert-GitLabMRStatus -Method Get -Path "$singlePath/approvals" -ExpectedStatus 503

# Hold a delayed request until the fixture confirms ownership, then reset TCP.
Set-GitLabMRFault -Mode 'delayed'
$rawRequest = @(
  "GET $singlePath HTTP/1.1"
  "Host: 127.0.0.1:$([int]$ready.port)"
  "PRIVATE-TOKEN: $($script:GitLabMRPrivateToken)"
  'Connection: close'
  ''
  ''
) -join "`r`n"
$tcp = [Net.Sockets.TcpClient]::new()
try {
  $tcp.NoDelay = $true
  $tcp.ReceiveTimeout = 5000
  $tcp.SendTimeout = 5000
  $tcp.Connect('127.0.0.1', [int]$ready.port)
  $networkStream = $tcp.GetStream()
  $requestBytes = [Text.Encoding]::ASCII.GetBytes($rawRequest)
  $networkStream.Write($requestBytes, 0, $requestBytes.Length)
  $networkStream.Flush()
  $activeDeadline = [DateTime]::UtcNow.AddSeconds(5)
  do {
    $liveState = Invoke-GitLabMRJson -Method Get -Path '/__fixture__/state' -NoAuth
    if ([int]$liveState.activeDelayedRequests -eq 1) {
      break
    }
    if ([DateTime]::UtcNow -ge $activeDeadline) {
      throw 'Delayed request did not enter the active cancellation window.'
    }
    Start-Sleep -Milliseconds 25
  } while ($true)
  $tcp.Client.LingerState = [Net.Sockets.LingerOption]::new($true, 0)
} finally {
  $tcp.Dispose()
}
$cancelDeadline = [DateTime]::UtcNow.AddSeconds(5)
do {
  $events = Read-GitLabMRAuditEvents
  $cancelled = @(
    $events |
      Where-Object { $_.kind -eq 'request' -and $_.outcome -eq 'cancelled' }
  )
  if ($cancelled.Count -eq 1) {
    break
  }
  if ([DateTime]::UtcNow -ge $cancelDeadline) {
    throw 'Cancelled GitLab request was not recorded exactly once.'
  }
  Start-Sleep -Milliseconds 50
} while ($true)
$stderr = [string](Get-Content -LiteralPath $paths.Stderr -Raw -ErrorAction Stop)
if (-not [string]::IsNullOrWhiteSpace($stderr)) {
  throw 'Cancelled GitLab request produced stderr noise.'
}
Set-GitLabMRFault -Mode 'none'

$events = Read-GitLabMRAuditEvents
for ($index = 0; $index -lt $events.Count; $index++) {
  if ([int]$events[$index].sequence -ne $index + 1) {
    throw 'GitLab MR mutation log sequence is not contiguous.'
  }
}
$operations = @(
  $events |
    Where-Object { $_.kind -eq 'mutation' } |
    ForEach-Object { $_.operation }
)
foreach ($requiredOperation in @(
  'reset',
  'create',
  'update',
  'approve',
  'unapprove',
  'set-fault'
)) {
  if (-not ($operations -contains $requiredOperation)) {
    throw "GitLab MR mutation log is missing $requiredOperation."
  }
}

foreach ($credentialFreeFile in @(
  $paths.Ready,
  $paths.MutationLog,
  $paths.Launcher,
  $paths.Stdout,
  $paths.Stderr
)) {
  $content = [string](Get-Content -LiteralPath $credentialFreeFile -Raw -ErrorAction Stop)
  if ($null -ne $content -and $content.Contains($script:GitLabMRPrivateToken)) {
    throw "Owned GitLab MR artifact contains the private token."
  }
}
$null = Invoke-GitLabMRJson -Method Post -Path '/__fixture__/reset' -Body @{} -NoAuth

[ordered]@{
  fixture = [string]$ready.fixture
  endpoint = $endpoint
  projectPath = [string]$ready.projectPath
  mergeRequests = 5
  members = $members.Count
  transientStatuses = @('checking', 'approvals_syncing', 'not_approved')
  faultModes = @('unavailable', 'error', 'malformed', 'partial', 'delayed')
  cancellation = 'pass'
  mutationEvents = @($events | Where-Object { $_.kind -eq 'mutation' }).Count
  requestEvents = @($events | Where-Object { $_.kind -eq 'request' }).Count
} | ConvertTo-Json -Compress -Depth 5
