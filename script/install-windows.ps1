#Requires -Version 5.1

<#
.SYNOPSIS
Installs the newest Desktop Material release for the current Windows architecture.

.DESCRIPTION
Queries the latest published release from Ding-Ding-Projects/desktop-material,
selects the exact per-user Squirrel installer for the native architecture,
verifies GitHub's SHA-256 release-asset digest and any Authenticode signature,
runs the installer silently, and removes the temporary download.

.PARAMETER ResolveOnly
Resolves and validates release metadata without downloading or installing it.
#>
[CmdletBinding()]
param(
  [switch]$ResolveOnly
)

# Keep functions and preference changes out of the caller's scope when this file
# is executed through Invoke-Expression.
& {
  [CmdletBinding()]
  param(
    [bool]$ResolveOnly
  )

  Set-StrictMode -Version 3.0
  $ErrorActionPreference = 'Stop'

  $repository = 'Ding-Ding-Projects/desktop-material'
  $apiUrl = "https://api.github.com/repos/$repository/releases/latest"
  $requestHeaders = @{
    Accept                   = 'application/vnd.github+json'
    'X-GitHub-Api-Version'   = '2022-11-28'
    'User-Agent'             = 'Desktop-Material-Windows-Installer'
  }
  $maximumAssetBytes = 1GB

  function Get-OptionalPropertyValue {
    param(
      [Parameter(Mandatory = $true)]
      [object]$InputObject,

      [Parameter(Mandatory = $true)]
      [string]$Name
    )

    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) {
      return $null
    }

    return $property.Value
  }

  function Get-NativeWindowsArchitecture {
    if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
      throw 'Desktop Material can only be installed by this script on Windows.'
    }

    if (-not [System.Environment]::Is64BitOperatingSystem) {
      throw 'Desktop Material requires 64-bit Windows; no x86 installer is published.'
    }

    $architecture = $null
    try {
      $architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    } catch {
      # RuntimeInformation is available on supported Windows versions, but the
      # environment fallback keeps Windows PowerShell 5.1 hosts predictable.
    }

    if ([string]::IsNullOrWhiteSpace([string]$architecture)) {
      $architecture = $env:PROCESSOR_ARCHITEW6432
      if ([string]::IsNullOrWhiteSpace([string]$architecture)) {
        $architecture = $env:PROCESSOR_ARCHITECTURE
      }
    }

    switch -Regex ([string]$architecture) {
      '^(X64|AMD64|x86_64)$' { return 'x64' }
      '^(Arm64|ARM64|aarch64)$' { return 'arm64' }
      default {
        throw "Unsupported Windows architecture '$architecture'."
      }
    }
  }

  function Get-LatestDesktopMaterialRelease {
    try {
      $release = Invoke-RestMethod `
        -Uri $apiUrl `
        -Headers $requestHeaders `
        -UseBasicParsing `
        -TimeoutSec 30 `
        -ErrorAction Stop
    } catch {
      throw "Could not query the latest release from $repository. $($_.Exception.Message)"
    }

    if ($null -eq $release) {
      throw "GitHub returned no latest release for $repository."
    }

    if ([bool](Get-OptionalPropertyValue -InputObject $release -Name 'draft')) {
      throw 'GitHub unexpectedly returned a draft as the latest release.'
    }

    if ([bool](Get-OptionalPropertyValue -InputObject $release -Name 'prerelease')) {
      throw 'GitHub unexpectedly returned a prerelease as the latest release.'
    }

    $tag = [string](Get-OptionalPropertyValue -InputObject $release -Name 'tag_name')
    if ([string]::IsNullOrWhiteSpace($tag)) {
      throw 'The latest GitHub release does not have a tag.'
    }

    return $release
  }

  function Get-DesktopMaterialInstallerAsset {
    param(
      [Parameter(Mandatory = $true)]
      [object]$Release,

      [Parameter(Mandatory = $true)]
      [ValidateSet('x64', 'arm64')]
      [string]$Architecture
    )

    $expectedName = "GitHubDesktopSetup-$Architecture.exe"
    $assetsValue = Get-OptionalPropertyValue -InputObject $Release -Name 'assets'
    $matches = @(
      @($assetsValue) | Where-Object {
        [string](Get-OptionalPropertyValue -InputObject $_ -Name 'name') -ceq $expectedName
      }
    )

    if ($matches.Count -ne 1) {
      throw "Expected exactly one '$expectedName' asset in the latest release; found $($matches.Count)."
    }

    $asset = $matches[0]
    $downloadUrl = [string](Get-OptionalPropertyValue -InputObject $asset -Name 'browser_download_url')
    $downloadUri = $null
    if (-not [System.Uri]::TryCreate($downloadUrl, [System.UriKind]::Absolute, [ref]$downloadUri)) {
      throw "The '$expectedName' asset has an invalid download URL."
    }

    $escapedRepository = [System.Text.RegularExpressions.Regex]::Escape($repository)
    $escapedName = [System.Text.RegularExpressions.Regex]::Escape($expectedName)
    $expectedPath = "^/$escapedRepository/releases/download/[^/]+/$escapedName$"
    if (
      $downloadUri.Scheme -cne 'https' -or
      $downloadUri.Host -cne 'github.com' -or
      $downloadUri.AbsolutePath -cnotmatch $expectedPath
    ) {
      throw "The '$expectedName' asset URL is not an exact HTTPS release download from $repository."
    }

    $assetSize = 0L
    $assetSizeValue = Get-OptionalPropertyValue -InputObject $asset -Name 'size'
    if (
      -not [long]::TryParse([string]$assetSizeValue, [ref]$assetSize) -or
      $assetSize -le 0 -or
      $assetSize -gt $maximumAssetBytes
    ) {
      throw "The '$expectedName' asset size is missing or outside the allowed range."
    }

    $digest = [string](Get-OptionalPropertyValue -InputObject $asset -Name 'digest')
    $digestMatch = [System.Text.RegularExpressions.Regex]::Match(
      $digest,
      '^sha256:([0-9a-fA-F]{64})$'
    )
    if (-not $digestMatch.Success) {
      throw "The '$expectedName' asset has no supported GitHub SHA-256 digest; refusing an unverified install."
    }

    return [pscustomobject]@{
      Name        = $expectedName
      DownloadUrl = $downloadUri.AbsoluteUri
      Size        = $assetSize
      Sha256      = $digestMatch.Groups[1].Value.ToLowerInvariant()
    }
  }

  function New-ControlledInstallerDirectory {
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $directoryName = "desktop-material-install-$([System.Guid]::NewGuid().ToString('N'))"
    $path = [System.IO.Path]::Combine($tempRoot, $directoryName)
    [System.IO.Directory]::CreateDirectory($path) | Out-Null
    return $path
  }

  function Remove-ControlledInstallerDirectory {
    param(
      [Parameter(Mandatory = $true)]
      [string]$Path
    )

    if (-not [System.IO.Directory]::Exists($Path)) {
      return
    }

    $trimCharacters = [char[]]@('\', '/')
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd($trimCharacters)
    $candidate = [System.IO.Path]::GetFullPath($Path).TrimEnd($trimCharacters)
    $requiredPrefix = $tempRoot + [System.IO.Path]::DirectorySeparatorChar
    $leafName = [System.IO.Path]::GetFileName($candidate)

    if (
      -not $candidate.StartsWith($requiredPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
      -not $leafName.StartsWith('desktop-material-install-', [System.StringComparison]::Ordinal)
    ) {
      throw "Refusing to remove uncontrolled temporary path '$candidate'."
    }

    Remove-Item -LiteralPath $candidate -Recurse -ErrorAction Stop
  }

  function Confirm-DesktopMaterialInstaller {
    param(
      [Parameter(Mandatory = $true)]
      [string]$Path,

      [Parameter(Mandatory = $true)]
      [object]$Asset
    )

    $downloadedSize = (Get-Item -LiteralPath $Path -ErrorAction Stop).Length
    if ($downloadedSize -ne $Asset.Size) {
      throw "Downloaded size mismatch: expected $($Asset.Size) bytes, received $downloadedSize."
    }

    $actualHash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
    if ($actualHash -cne $Asset.Sha256) {
      throw "Downloaded SHA-256 mismatch: expected $($Asset.Sha256), received $actualHash."
    }
    Write-Host "Verified GitHub SHA-256: $actualHash"

    $signature = Get-AuthenticodeSignature -FilePath $Path -ErrorAction Stop
    if ($signature.Status -eq [System.Management.Automation.SignatureStatus]::Valid) {
      $signer = $signature.SignerCertificate.Subject
      Write-Host "Verified Authenticode signature: $signer"
    } elseif ($signature.Status -eq [System.Management.Automation.SignatureStatus]::NotSigned) {
      Write-Warning 'This repository currently publishes unsigned installers. The GitHub release-asset SHA-256 digest was verified.'
    } else {
      throw "The installer has an invalid or untrusted Authenticode signature: $($signature.Status)."
    }
  }

  function Invoke-DesktopMaterialInstall {
    param(
      [bool]$ResolveOnly
    )

    $architecture = Get-NativeWindowsArchitecture
    $release = Get-LatestDesktopMaterialRelease
    $tag = [string](Get-OptionalPropertyValue -InputObject $release -Name 'tag_name')
    $asset = Get-DesktopMaterialInstallerAsset -Release $release -Architecture $architecture

    if ($ResolveOnly) {
      return [pscustomobject]@{
        Repository   = $repository
        ReleaseTag   = $tag
        Architecture = $architecture
        AssetName    = $asset.Name
        Size         = $asset.Size
        Sha256       = $asset.Sha256
        DownloadUrl  = $asset.DownloadUrl
      }
    }

    Write-Host "Installing Desktop Material $tag for Windows $architecture..."
    $workDirectory = $null
    try {
      $workDirectory = New-ControlledInstallerDirectory
      $installerPath = [System.IO.Path]::Combine($workDirectory, $asset.Name)

      $originalProgressPreference = $ProgressPreference
      try {
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest `
          -Uri $asset.DownloadUrl `
          -Headers $requestHeaders `
          -UseBasicParsing `
          -MaximumRedirection 5 `
          -TimeoutSec 900 `
          -OutFile $installerPath `
          -ErrorAction Stop | Out-Null
      } finally {
        $ProgressPreference = $originalProgressPreference
      }

      Confirm-DesktopMaterialInstaller -Path $installerPath -Asset $asset

      $installerProcess = Start-Process `
        -FilePath $installerPath `
        -ArgumentList '/S' `
        -Wait `
        -PassThru `
        -ErrorAction Stop
      if ($installerProcess.ExitCode -ne 0) {
        throw "Desktop Material installer exited with code $($installerProcess.ExitCode)."
      }

      Write-Host 'Desktop Material installed successfully.'
    } finally {
      if ($null -ne $workDirectory) {
        try {
          Remove-ControlledInstallerDirectory -Path $workDirectory
        } catch {
          Write-Warning "Could not remove temporary installer directory '$workDirectory'. $($_.Exception.Message)"
        }
      }
    }
  }

  $originalSecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol
  try {
    [System.Net.ServicePointManager]::SecurityProtocol =
      $originalSecurityProtocol -bor [System.Net.SecurityProtocolType]::Tls12
    Invoke-DesktopMaterialInstall -ResolveOnly $ResolveOnly
  } finally {
    [System.Net.ServicePointManager]::SecurityProtocol = $originalSecurityProtocol
  }
} -ResolveOnly:$ResolveOnly.IsPresent
