<#
.SYNOPSIS
Installs the NSIS toolchain used by the Windows release workflow.

.DESCRIPTION
Downloads the NSIS installer, the NSIS long string patch, and the EnvVar plugin.
By default, the script installs NSIS, applies the patch, and expands the plugin
into the NSIS installation directory.

Run from the repository root with PowerShell 7:

  pwsh -ExecutionPolicy Bypass -File .github\actions\install-nsis\install-nsis.ps1 -NsisVersion 3.10

Download only, without installing or expanding anything:

  pwsh -ExecutionPolicy Bypass -File .github\actions\install-nsis\install-nsis.ps1 -NsisVersion 3.10 -DownloadOnly

Download into a folder that is safe to delete afterward:

  pwsh -ExecutionPolicy Bypass -File .github\actions\install-nsis\install-nsis.ps1 -NsisVersion 3.10 -DownloadOnly -TempDir .\tmp\nsis

If pwsh is not installed or is not on PATH, use the built-in Windows PowerShell
executable instead:

  powershell -ExecutionPolicy Bypass -File .github\actions\install-nsis\install-nsis.ps1 -NsisVersion 3.10 -DownloadOnly

.PARAMETER NsisVersion
The NSIS version to download and install.

.PARAMETER InstallDir
The NSIS installation directory. Defaults to C:\Program Files (x86)\NSIS.

.PARAMETER TempDir
The download directory. Defaults to RUNNER_TEMP in GitHub Actions, otherwise the
current user's temp directory.

.PARAMETER AddToGitHubPath
Appends the NSIS installation directory to GITHUB_PATH when running in GitHub
Actions.

.PARAMETER DownloadOnly
Downloads the installer, patch archive, and plugin archive, then prints their
paths and exits without installing or expanding anything.
#>
[CmdletBinding()]
param(
  [Parameter()]
  [ValidateNotNullOrEmpty()]
  [string] $NsisVersion = "3.10",

  [Parameter()]
  [ValidateNotNullOrEmpty()]
  [string] $InstallDir = $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} "NSIS" } else { "C:\Program Files (x86)\NSIS" }),

  [Parameter()]
  [ValidateNotNullOrEmpty()]
  [string] $TempDir = $(if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }),

  [Parameter()]
  [switch] $AddToGitHubPath,

  [Parameter()]
  [switch] $DownloadOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$isWindowsPlatform = if (Get-Variable -Name IsWindows -ErrorAction SilentlyContinue) {
  $IsWindows
} else {
  $env:OS -eq "Windows_NT"
}

if (-not $isWindowsPlatform) {
  throw "NSIS installation is supported on Windows only."
}

New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

function Invoke-FileDownload {
  param(
    [Parameter(Mandatory)]
    [string] $Uri,

    [Parameter(Mandatory)]
    [string] $OutFile,

    [Parameter()]
    [string] $UserAgent
  )

  $request = @{
    Uri = $Uri
    OutFile = $OutFile
    MaximumRedirection = 10
  }

  if ($UserAgent) {
    $request.UserAgent = $UserAgent
  }

  Invoke-WebRequest @request
}

function Assert-WindowsExecutable {
  param(
    [Parameter(Mandatory)]
    [string] $Path
  )

  if ((Get-Item $Path).Length -lt 1MB) {
    Get-Content $Path -TotalCount 20
    throw "Downloaded file is too small; likely got HTML instead of installer."
  }

  $header = [System.IO.File]::ReadAllBytes($Path)[0..1]
  if ($header[0] -ne 0x4d -or $header[1] -ne 0x5a) {
    throw "Downloaded NSIS installer is not a valid Windows executable."
  }
}

function Assert-ZipArchive {
  param(
    [Parameter(Mandatory)]
    [string] $Path
  )

  $header = [System.IO.File]::ReadAllBytes($Path)[0..1]
  if ($header[0] -ne 0x50 -or $header[1] -ne 0x4b) {
    Get-Content $Path -TotalCount 20
    throw "Downloaded file is not a valid ZIP archive: $Path"
  }
}

$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$installer = Join-Path $TempDir "nsis-$NsisVersion-setup.exe"
$installerUrl = "https://downloads.sourceforge.net/project/nsis/NSIS%203/$NsisVersion/nsis-$NsisVersion-setup.exe?ts=$timestamp&use_mirror=autoselect"

Write-Host "Downloading NSIS $NsisVersion installer..."
Invoke-FileDownload -Uri $installerUrl -OutFile $installer -UserAgent "Wget/1.21.4"
Assert-WindowsExecutable -Path $installer

$patchArchive = Join-Path $TempDir "nsis-$NsisVersion-strlen_8192.zip"
$patchUrl = "https://downloads.sourceforge.net/project/nsis/NSIS%203/$NsisVersion/nsis-$NsisVersion-strlen_8192.zip?ts=$timestamp&use_mirror=autoselect"

Write-Host "Downloading NSIS long string patch..."
Invoke-FileDownload -Uri $patchUrl -OutFile $patchArchive -UserAgent "Wget/1.21.4"
Assert-ZipArchive -Path $patchArchive

$pluginArchive = Join-Path $TempDir "EnVar_plugin.zip"
$pluginUrl = "https://nsis.sourceforge.io/mediawiki/images/7/7f/EnVar_plugin.zip"

Write-Host "Downloading NSIS EnvVar plugin..."
Invoke-FileDownload -Uri $pluginUrl -OutFile $pluginArchive
Assert-ZipArchive -Path $pluginArchive

if ($DownloadOnly) {
  Write-Host "Downloaded files:"
  Write-Host "  $installer"
  Write-Host "  $patchArchive"
  Write-Host "  $pluginArchive"
  exit 0
}

Write-Host "Installing NSIS $NsisVersion..."
$installerProcess = Start-Process -FilePath $installer -ArgumentList "/S" -Wait -PassThru
if ($installerProcess.ExitCode -ne 0) {
  throw "NSIS installer failed with exit code $($installerProcess.ExitCode)."
}

$makensis = Join-Path $InstallDir "makensis.exe"
if (-not (Test-Path $makensis)) {
  throw "NSIS installation failed; makensis.exe was not found at $makensis."
}

Write-Host "Applying NSIS long string patch..."
Expand-Archive $patchArchive -DestinationPath $InstallDir -Force

Write-Host "Installing NSIS EnvVar plugin..."
Expand-Archive $pluginArchive -DestinationPath $InstallDir -Force

if ($AddToGitHubPath -and $env:GITHUB_PATH) {
  $InstallDir | Out-File -FilePath $env:GITHUB_PATH -Encoding utf8 -Append
}

if (($env:PATH -split [System.IO.Path]::PathSeparator) -notcontains $InstallDir) {
  $env:PATH = "$env:PATH$([System.IO.Path]::PathSeparator)$InstallDir"
}

Write-Host "NSIS $NsisVersion is installed at $InstallDir."
