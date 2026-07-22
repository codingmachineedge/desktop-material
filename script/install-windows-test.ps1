#Requires -Version 5.1

[CmdletBinding()]
param()

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

$installerPath = Join-Path $PSScriptRoot 'install-windows.ps1'
$tokens = $null
$parseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
  $installerPath,
  [ref]$tokens,
  [ref]$parseErrors
) | Out-Null

if ($parseErrors.Count -gt 0) {
  $messages = $parseErrors | ForEach-Object { $_.Message }
  throw "Installer syntax errors: $($messages -join '; ')"
}

function New-MockRelease {
  $digest = 'sha256:' + ('a' * 64)
  $assets = @()
  foreach ($architecture in @('x64', 'arm64')) {
    $name = "GitHubDesktopSetup-$architecture.exe"
    $assets += [pscustomobject]@{
      name                 = $name
      size                 = 123456
      digest               = $digest
      browser_download_url = "https://github.com/Ding-Ding-Projects/desktop-material/releases/download/v1.2.3/$name"
    }
  }

  return [pscustomobject]@{
    tag_name   = 'v1.2.3'
    draft      = $false
    prerelease = $false
    assets      = $assets
  }
}

$global:DesktopMaterialInstallerMockRelease = New-MockRelease

# The installer validation mode must use only the supplied release metadata. A
# test-scoped function shadows the network cmdlet without changing production.
function Invoke-RestMethod {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Uri,

    [hashtable]$Headers,

    [switch]$UseBasicParsing,

    [int]$TimeoutSec
  )

  if ($Uri -cne 'https://api.github.com/repos/Ding-Ding-Projects/desktop-material/releases/latest') {
    throw "Unexpected API URL '$Uri'."
  }

  return $global:DesktopMaterialInstallerMockRelease
}

$resolved = & $installerPath -ResolveOnly
$expectedName = "GitHubDesktopSetup-$($resolved.Architecture).exe"
if ($resolved.Repository -cne 'Ding-Ding-Projects/desktop-material') {
  throw "Unexpected repository '$($resolved.Repository)'."
}
if ($resolved.AssetName -cne $expectedName) {
  throw "Expected '$expectedName', received '$($resolved.AssetName)'."
}
if ($resolved.Sha256 -cne ('a' * 64)) {
  throw 'The resolved SHA-256 digest was not normalized correctly.'
}

$global:DesktopMaterialInstallerMockRelease = New-MockRelease
$selectedAsset = @($global:DesktopMaterialInstallerMockRelease.assets | Where-Object { $_.name -ceq $expectedName })[0]
$selectedAsset.browser_download_url = "https://example.invalid/$expectedName"
$unsafeUrlWasRejected = $false
try {
  & $installerPath -ResolveOnly | Out-Null
} catch {
  $unsafeUrlWasRejected = $_.Exception.Message -match 'not an exact HTTPS release download'
}
if (-not $unsafeUrlWasRejected) {
  throw 'A release asset URL outside the exact GitHub repository was not rejected.'
}

$global:DesktopMaterialInstallerMockRelease = New-MockRelease
$selectedAsset = @($global:DesktopMaterialInstallerMockRelease.assets | Where-Object { $_.name -ceq $expectedName })[0]
$selectedAsset.digest = $null
$missingDigestWasRejected = $false
try {
  & $installerPath -ResolveOnly | Out-Null
} catch {
  $missingDigestWasRejected = $_.Exception.Message -match 'refusing an unverified install'
}
if (-not $missingDigestWasRejected) {
  throw 'An installer without a GitHub SHA-256 digest was not rejected.'
}

Remove-Variable -Name DesktopMaterialInstallerMockRelease -Scope Global -ErrorAction SilentlyContinue
Write-Host 'install-windows.ps1 validation tests passed.'
