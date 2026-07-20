Set-StrictMode -Version 2.0

$script:OllamaFixtureId = 'desktop-material-ollama'
$script:OllamaFixtureProtocolVersion = 1
$script:OllamaOwnedDirectoryName = 'ollama'
$script:OllamaReadyFileName = 'ready.json'
$script:OllamaMutationLogFileName = 'mutations.jsonl'
$script:OllamaRunRootPattern = '^desktop-material-ollama-[A-Za-z0-9][A-Za-z0-9._-]{5,120}$'

function Test-OllamaReparsePoint {
  param([Parameter(Mandatory = $true)]$Item)

  return [bool]($Item.Attributes -band [IO.FileAttributes]::ReparsePoint)
}

function Resolve-OwnedOllamaRunRoot {
  param([Parameter(Mandatory = $true)][string]$RunRoot)

  if ([string]::IsNullOrWhiteSpace($env:TEMP)) {
    throw 'TEMP must identify the owned fixture parent directory.'
  }
  $tempItem = Get-Item -LiteralPath ([IO.Path]::GetFullPath($env:TEMP)) -ErrorAction Stop
  if (-not $tempItem.PSIsContainer -or (Test-OllamaReparsePoint $tempItem)) {
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
    [IO.Path]::GetFileName($requestedRoot) -notmatch $script:OllamaRunRootPattern
  ) {
    throw "Run root must be a direct TEMP child named desktop-material-ollama-*: $requestedRoot"
  }
  $rootItem = Get-Item -LiteralPath $requestedRoot -ErrorAction Stop
  if (-not $rootItem.PSIsContainer -or (Test-OllamaReparsePoint $rootItem)) {
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

function Get-OwnedOllamaFixturePaths {
  param(
    [Parameter(Mandatory = $true)][string]$RunRoot,
    [switch]$CreateOwnedDirectory
  )

  $resolvedRoot = Resolve-OwnedOllamaRunRoot -RunRoot $RunRoot
  $ownedDirectory = Join-Path $resolvedRoot $script:OllamaOwnedDirectoryName
  if (-not (Test-Path -LiteralPath $ownedDirectory)) {
    if (-not $CreateOwnedDirectory) {
      throw "Owned Ollama directory does not exist: $ownedDirectory"
    }
    New-Item -ItemType Directory -Path $ownedDirectory -ErrorAction Stop | Out-Null
  }
  $ownedItem = Get-Item -LiteralPath $ownedDirectory -ErrorAction Stop
  if (-not $ownedItem.PSIsContainer -or (Test-OllamaReparsePoint $ownedItem)) {
    throw "Owned Ollama directory must be real, not a symlink or junction: $ownedDirectory"
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
      $script:OllamaOwnedDirectoryName,
      [StringComparison]::OrdinalIgnoreCase
    )
  ) {
    throw "Owned Ollama directory escaped the run root: $resolvedOwned"
  }

  return [pscustomobject]@{
    Root = $resolvedRoot
    RootName = [IO.Path]::GetFileName($resolvedRoot)
    Directory = $resolvedOwned
    Ready = Join-Path $resolvedOwned $script:OllamaReadyFileName
    MutationLog = Join-Path $resolvedOwned $script:OllamaMutationLogFileName
    Launcher = Join-Path $resolvedOwned 'launcher.json'
    Stdout = Join-Path $resolvedOwned 'stdout.log'
    Stderr = Join-Path $resolvedOwned 'stderr.log'
  }
}

function Read-OwnedOllamaReadyReceipt {
  param([Parameter(Mandatory = $true)]$Paths)

  $readyItem = Get-Item -LiteralPath $Paths.Ready -ErrorAction Stop
  if ($readyItem.PSIsContainer -or (Test-OllamaReparsePoint $readyItem)) {
    throw "Ready receipt must be a real file: $($Paths.Ready)"
  }
  $ready = Get-Content -LiteralPath $Paths.Ready -Raw -ErrorAction Stop | ConvertFrom-Json
  $expectedMutationLog = "$($script:OllamaOwnedDirectoryName)/$($script:OllamaMutationLogFileName)"
  $endpoint = $null
  try {
    $endpoint = [Uri]([string]$ready.endpoint)
  } catch {
    throw 'Ready receipt contains an invalid endpoint.'
  }
  if (
    [string]$ready.fixture -ne $script:OllamaFixtureId -or
    [int]$ready.protocolVersion -ne $script:OllamaFixtureProtocolVersion -or
    [string]$ready.runRootName -ne $Paths.RootName -or
    [string]$ready.bind -ne '127.0.0.1' -or
    $endpoint.Scheme -ne 'http' -or
    $endpoint.Host -ne '127.0.0.1' -or
    $endpoint.AbsolutePath -ne '/' -or
    -not [string]::IsNullOrEmpty($endpoint.Query) -or
    -not [string]::IsNullOrEmpty($endpoint.Fragment) -or
    $endpoint.Port -ne [int]$ready.port -or
    [int]$ready.pid -le 0 -or
    [string]$ready.mutationLog -ne $expectedMutationLog
  ) {
    throw 'Ready receipt failed the owned loopback identity contract.'
  }
  return $ready
}

function ConvertTo-QuotedProcessArgument {
  param([Parameter(Mandatory = $true)][string]$Value)

  if ($Value.Contains('"')) {
    throw 'Process arguments may not contain quote characters.'
  }
  return '"' + $Value + '"'
}
