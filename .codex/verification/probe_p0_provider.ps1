param(
  [Parameter(Mandatory = $true)]
  [string]$RunRoot
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
$readyPath = Join-Path $resolvedRoot 'provider\ready.json'
$ready = Get-Content -LiteralPath $readyPath -Raw | ConvertFrom-Json
$api = [string]$ready.endpoint
$repo = "$api/repos/$($ready.owner)/$($ready.repository)"
$headers = @{ Authorization = "Bearer $($ready.token)" }

$preflightOptions = @{
  UseBasicParsing = $true
  Method = 'Options'
  Uri = $repo
  Headers = @{
    Origin = 'file://'
    'Access-Control-Request-Method' = 'GET'
    'Access-Control-Request-Headers' = 'authorization,content-type,x-github-api-version'
    'Access-Control-Request-Private-Network' = 'true'
  }
}
$preflight = Invoke-WebRequest @preflightOptions
if (
  $preflight.StatusCode -ne 204 -or
  $preflight.Headers['Access-Control-Allow-Origin'] -ne '*' -or
  $preflight.Headers['Access-Control-Allow-Private-Network'] -ne 'true'
) {
  throw 'Provider CORS preflight contract failed.'
}

$repository = Invoke-RestMethod -Method Get -Uri $repo -Headers $headers
if (
  $repository.full_name -ne "$($ready.owner)/$($ready.repository)" -or
  $repository.clone_url -ne "$($ready.htmlUrl)/$($ready.owner)/$($ready.repository).git"
) {
  throw 'Provider repository identity contract failed.'
}
$encodedBranch = [Uri]::EscapeDataString([string]$ready.featureBranch)
$branch = Invoke-RestMethod -Method Get -Uri "$repo/branches/$encodedBranch" -Headers $headers
$rules = Invoke-RestMethod -Method Get -Uri "$repo/rules/branches/$encodedBranch`?per_page=100" -Headers $headers
if (-not $branch.protected -or $rules.Count -lt 8) {
  throw 'Provider branch-rules contract failed.'
}

$workflows = Invoke-RestMethod -Method Get -Uri "$repo/actions/workflows?per_page=100" -Headers $headers
$runsPage1 = Invoke-RestMethod -Method Get -Uri "$repo/actions/runs?per_page=50&page=1" -Headers $headers
$runsPage2 = Invoke-RestMethod -Method Get -Uri "$repo/actions/runs?per_page=50&page=2" -Headers $headers
$successPage1 = Invoke-RestMethod -Method Get -Uri "$repo/actions/runs?per_page=50&page=1&status=success" -Headers $headers
$successPage2 = Invoke-RestMethod -Method Get -Uri "$repo/actions/runs?per_page=50&page=2&status=success" -Headers $headers
$inspectorRun = @($runsPage2.workflow_runs) | Where-Object { [int]$_.id -eq [int]$ready.inspectorWorkflowRunId }
$inspectorRoot = "$repo/actions/runs/$([int]$ready.inspectorWorkflowRunId)"
$inspectorJobsPage1 = Invoke-RestMethod -Method Get -Uri "$inspectorRoot/jobs?filter=latest&per_page=50&page=1" -Headers $headers
$historicalJobsPage2 = Invoke-RestMethod -Method Get -Uri "$inspectorRoot/attempts/1/jobs?per_page=50&page=2" -Headers $headers
$pendingDeployments = Invoke-RestMethod -Method Get -Uri "$inspectorRoot/pending_deployments" -Headers $headers
$reviewHistory = Invoke-RestMethod -Method Get -Uri "$inspectorRoot/approvals" -Headers $headers
$jobLog = Invoke-WebRequest -UseBasicParsing -Method Get -Uri "$repo/actions/jobs/$([int]$ready.inspectorCurrentJobSentinelId)/logs" -Headers $headers
$runId = [int]$ready.workflowRunId
$artifactsPage1 = Invoke-RestMethod -Method Get -Uri "$repo/actions/runs/$runId/artifacts?per_page=30&page=1" -Headers $headers
$artifactsPage2 = Invoke-RestMethod -Method Get -Uri "$repo/actions/runs/$runId/artifacts?per_page=30&page=2" -Headers $headers
$artifact = @($artifactsPage2.artifacts)[0]
$encodedDigest = [Uri]::EscapeDataString([string]$artifact.digest)
$attestations = Invoke-RestMethod -Method Get -Uri "$repo/attestations/$encodedDigest`?per_page=1" -Headers $headers
if (
  $workflows.total_count -ne 1 -or
  $runsPage1.total_count -ne [int]$ready.workflowRunCount -or
  @($runsPage1.workflow_runs).Count -ne 50 -or
  @($runsPage2.workflow_runs).Count -ne 2 -or
  $successPage1.total_count -ne [int]$ready.successfulWorkflowRunCount -or
  @($successPage1.workflow_runs).Count -ne 50 -or
  @($successPage2.workflow_runs).Count -ne 1 -or
  [int](@($successPage2.workflow_runs)[0].id) -ne [int]$ready.workflowRunSentinelId -or
  @($inspectorRun).Count -ne 1 -or
  [int]$inspectorRun.run_attempt -ne [int]$ready.inspectorLatestAttempt -or
  $inspectorRun.conclusion -ne 'action_required' -or
  [int]$inspectorJobsPage1.total_count -ne [int]$ready.inspectorJobCount -or
  @($inspectorJobsPage1.jobs).Count -ne 50 -or
  @($historicalJobsPage2.jobs).Count -ne 1 -or
  [int](@($historicalJobsPage2.jobs)[0].id) -ne [int]$ready.inspectorHistoricalJobSentinelId -or
  @($pendingDeployments).Count -ne 2 -or
  @($reviewHistory).Count -ne 1 -or
  -not $jobLog.Content.Contains("Exact workflow job $([int]$ready.inspectorCurrentJobSentinelId)") -or
  $artifactsPage1.total_count -ne [int]$ready.artifactCount -or
  @($artifactsPage1.artifacts).Count -ne 30 -or
  @($artifactsPage2.artifacts).Count -ne 1 -or
  [int]$artifact.id -ne [int]$ready.artifactSentinelId -or
  @($attestations.attestations).Count -ne 1
) {
  throw 'Provider Actions metadata contract failed.'
}

$download = Join-Path $resolvedRoot 'provider\probe-artifact.zip'
$downloadOptions = @{
  UseBasicParsing = $true
  Method = 'Get'
  Uri = "$repo/actions/artifacts/$([int]$artifact.id)/zip"
  Headers = $headers
  OutFile = $download
}
Invoke-WebRequest @downloadOptions
$downloadInfo = Get-Item -LiteralPath $download
$digest = 'sha256:' + (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant()
if ($downloadInfo.Length -ne [int64]$artifact.size_in_bytes -or $digest -ne $artifact.digest) {
  throw 'Provider artifact byte contract failed.'
}
Remove-Item -LiteralPath $download -Force

try {
  $receivePackOptions = @{
    UseBasicParsing = $true
    Method = 'Get'
    Uri = "http://127.0.0.1:$([int]$ready.port)/$($ready.owner)/$($ready.repository).git/info/refs?service=git-receive-pack"
  }
  Invoke-WebRequest @receivePackOptions | Out-Null
  throw 'Provider unexpectedly admitted Git receive-pack.'
} catch {
  if ([int]$_.Exception.Response.StatusCode -ne 403) {
    throw
  }
}

[ordered]@{
  endpoint = $api
  htmlUrl = [string]$ready.htmlUrl
  cors = 'pass'
  repository = [string]$repository.full_name
  branchRules = $rules.Count
  workflows = [int]$workflows.total_count
  runs = [int]$runsPage1.total_count
  successfulRuns = [int]$successPage1.total_count
  runPage2 = @($runsPage2.workflow_runs).Count
  workflowRunSentinelId = [int]$ready.workflowRunSentinelId
  inspectorWorkflowRunId = [int]$ready.inspectorWorkflowRunId
  inspectorLatestAttempt = [int]$ready.inspectorLatestAttempt
  inspectorJobs = [int]$inspectorJobsPage1.total_count
  inspectorHistoricalSentinelId = [int](@($historicalJobsPage2.jobs)[0].id)
  pendingDeployments = @($pendingDeployments).Count
  reviewHistory = @($reviewHistory).Count
  jobLog = 'redirected-and-loaded'
  artifacts = [int]$artifactsPage1.total_count
  artifactPage2 = @($artifactsPage2.artifacts).Count
  artifactSentinelId = [int]$artifact.id
  artifactSize = [int64]$artifact.size_in_bytes
  artifactDigest = [string]$artifact.digest
  attestationPresence = $true
  receivePack = 'blocked'
} | ConvertTo-Json -Compress
