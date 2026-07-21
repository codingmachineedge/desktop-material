Set-StrictMode -Version 2.0

$script:GitLabMRFixtureId = 'desktop-material-gitlab-mr'
$script:GitLabMRFixtureProtocolVersion = 1
$script:GitLabMROwnedDirectoryName = 'gitlab-mr'
$script:GitLabMRReadyFileName = 'ready.json'
$script:GitLabMRMutationLogFileName = 'mutations.jsonl'
$script:GitLabMRPrivateToken = 'desktop-material-gitlab-token'
$script:GitLabMRProjectPath = 'material-labs/platform/desktop-material'
$script:GitLabMREncodedProjectPath = 'material-labs%2Fplatform%2Fdesktop-material'
$script:GitLabMRRunRootPattern = '^desktop-material-gitlab-mr-[A-Za-z0-9][A-Za-z0-9._-]{5,120}$'

function Test-GitLabMRReparsePoint {
  param([Parameter(Mandatory = $true)]$Item)

  return [bool]($Item.Attributes -band [IO.FileAttributes]::ReparsePoint)
}

function Resolve-OwnedGitLabMRRunRoot {
  param([Parameter(Mandatory = $true)][string]$RunRoot)

  if ([string]::IsNullOrWhiteSpace($env:TEMP)) {
    throw 'TEMP must identify the owned GitLab MR fixture parent directory.'
  }
  $tempItem = Get-Item -LiteralPath ([IO.Path]::GetFullPath($env:TEMP)) -ErrorAction Stop
  if (-not $tempItem.PSIsContainer -or (Test-GitLabMRReparsePoint $tempItem)) {
    throw 'TEMP must be a real directory, not a symlink or junction.'
  }
  $resolvedTemp = [IO.Path]::GetFullPath($tempItem.FullName).TrimEnd('\')
  $requestedRoot = [IO.Path]::GetFullPath($RunRoot).TrimEnd('\')
  if (
    -not [string]::Equals(
      [IO.Path]::GetDirectoryName($requestedRoot),
      $resolvedTemp,
      [StringComparison]::OrdinalIgnoreCase
    ) -or
    [IO.Path]::GetFileName($requestedRoot) -notmatch $script:GitLabMRRunRootPattern
  ) {
    throw "Run root must be a direct TEMP child named desktop-material-gitlab-mr-*: $requestedRoot"
  }
  $rootItem = Get-Item -LiteralPath $requestedRoot -ErrorAction Stop
  if (-not $rootItem.PSIsContainer -or (Test-GitLabMRReparsePoint $rootItem)) {
    throw "Run root must be a real directory, not a symlink or junction: $requestedRoot"
  }
  $resolvedRoot = [IO.Path]::GetFullPath($rootItem.FullName).TrimEnd('\')
  if (-not [string]::Equals(
    $requestedRoot,
    $resolvedRoot,
    [StringComparison]::OrdinalIgnoreCase
  )) {
    throw "Run root resolution changed unexpectedly: $requestedRoot"
  }
  return $resolvedRoot
}

function Get-OwnedGitLabMRFixturePaths {
  param(
    [Parameter(Mandatory = $true)][string]$RunRoot,
    [switch]$CreateOwnedDirectory
  )

  $resolvedRoot = Resolve-OwnedGitLabMRRunRoot -RunRoot $RunRoot
  $ownedDirectory = Join-Path $resolvedRoot $script:GitLabMROwnedDirectoryName
  if (-not (Test-Path -LiteralPath $ownedDirectory)) {
    if (-not $CreateOwnedDirectory) {
      throw "Owned GitLab MR directory does not exist: $ownedDirectory"
    }
    New-Item -ItemType Directory -Path $ownedDirectory -ErrorAction Stop | Out-Null
  }
  $ownedItem = Get-Item -LiteralPath $ownedDirectory -ErrorAction Stop
  if (-not $ownedItem.PSIsContainer -or (Test-GitLabMRReparsePoint $ownedItem)) {
    throw "Owned GitLab MR directory must be real, not a symlink or junction: $ownedDirectory"
  }
  $resolvedOwned = [IO.Path]::GetFullPath($ownedItem.FullName).TrimEnd('\')
  if (
    -not [string]::Equals(
      [IO.Path]::GetDirectoryName($resolvedOwned),
      $resolvedRoot,
      [StringComparison]::OrdinalIgnoreCase
    ) -or
    -not [string]::Equals(
      [IO.Path]::GetFileName($resolvedOwned),
      $script:GitLabMROwnedDirectoryName,
      [StringComparison]::OrdinalIgnoreCase
    )
  ) {
    throw "Owned GitLab MR directory escaped the run root: $resolvedOwned"
  }

  return [pscustomobject]@{
    Root = $resolvedRoot
    RootName = [IO.Path]::GetFileName($resolvedRoot)
    Directory = $resolvedOwned
    Ready = Join-Path $resolvedOwned $script:GitLabMRReadyFileName
    MutationLog = Join-Path $resolvedOwned $script:GitLabMRMutationLogFileName
    Launcher = Join-Path $resolvedOwned 'launcher.json'
    Stdout = Join-Path $resolvedOwned 'stdout.log'
    Stderr = Join-Path $resolvedOwned 'stderr.log'
  }
}

function Read-OwnedGitLabMRReadyReceipt {
  param([Parameter(Mandatory = $true)]$Paths)

  $readyItem = Get-Item -LiteralPath $Paths.Ready -ErrorAction Stop
  if ($readyItem.PSIsContainer -or (Test-GitLabMRReparsePoint $readyItem)) {
    throw "Ready receipt must be a real file: $($Paths.Ready)"
  }
  $readyRaw = Get-Content -LiteralPath $Paths.Ready -Raw -ErrorAction Stop
  if ($readyRaw.Contains($script:GitLabMRPrivateToken)) {
    throw 'Ready receipt contains the private token.'
  }
  $ready = $readyRaw | ConvertFrom-Json
  $expectedMutationLog = "$($script:GitLabMROwnedDirectoryName)/$($script:GitLabMRMutationLogFileName)"
  try {
    $endpoint = [Uri]([string]$ready.endpoint)
    $apiEndpoint = [Uri]([string]$ready.apiEndpoint)
  } catch {
    throw 'Ready receipt contains an invalid endpoint.'
  }
  if (
    [string]$ready.fixture -ne $script:GitLabMRFixtureId -or
    [int]$ready.protocolVersion -ne $script:GitLabMRFixtureProtocolVersion -or
    [string]$ready.runRootName -ne $Paths.RootName -or
    [string]$ready.bind -ne '127.0.0.1' -or
    $endpoint.Scheme -ne 'http' -or
    $endpoint.Host -ne '127.0.0.1' -or
    $endpoint.AbsolutePath -ne '/' -or
    -not [string]::IsNullOrEmpty($endpoint.Query) -or
    -not [string]::IsNullOrEmpty($endpoint.Fragment) -or
    $endpoint.Port -ne [int]$ready.port -or
    $apiEndpoint.Scheme -ne 'http' -or
    $apiEndpoint.Host -ne '127.0.0.1' -or
    $apiEndpoint.Port -ne [int]$ready.port -or
    $apiEndpoint.AbsolutePath -ne '/api/v4' -or
    -not [string]::IsNullOrEmpty($apiEndpoint.Query) -or
    -not [string]::IsNullOrEmpty($apiEndpoint.Fragment) -or
    [int]$ready.pid -le 0 -or
    [string]$ready.projectPath -ne $script:GitLabMRProjectPath -or
    [string]$ready.encodedProjectPath -ne $script:GitLabMREncodedProjectPath -or
    [bool]$ready.tokenRequired -ne $true -or
    [string]$ready.mutationLog -ne $expectedMutationLog
  ) {
    throw 'Ready receipt failed the owned loopback GitLab MR identity contract.'
  }
  return $ready
}

function ConvertTo-GitLabMRQuotedProcessArgument {
  param([Parameter(Mandatory = $true)][string]$Value)

  if ($Value.Contains('"')) {
    throw 'Process arguments may not contain quote characters.'
  }
  return '"' + $Value + '"'
}
