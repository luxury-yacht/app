param(
    [Parameter(Mandatory = $true)]
    [string]$UserInstaller,
    [Parameter(Mandatory = $true)]
    [string]$SystemInstaller,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedVersion,
    [Parameter(Mandatory = $true)]
    [string]$ProductName,
    [Parameter(Mandatory = $true)]
    [string]$UninstallRegistryPath
)

$ErrorActionPreference = 'Stop'
$userInstallerPath = (Resolve-Path -LiteralPath $UserInstaller).Path
$systemInstallerPath = (Resolve-Path -LiteralPath $SystemInstaller).Path
$installRoot = Join-Path (Join-Path $env:LOCALAPPDATA 'Programs') $ProductName
$executablePath = Join-Path $installRoot 'luxury-yacht.exe'
$markerPath = Join-Path $installRoot 'luxury-yacht.install.json'
$uninstallerPath = Join-Path $installRoot 'uninstall.exe'
$userKey = "HKCU:\$UninstallRegistryPath"
$machineKey = "HKLM:\$UninstallRegistryPath"
$settingsRoot = Join-Path $env:APPDATA 'luxury-yacht'
$settingsProbe = Join-Path $settingsRoot 'scope-preservation-probe'
$machineTempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$machineInstallRoot = Join-Path $machineTempRoot 'luxury-yacht-machine-conflict'
$machineExecutablePath = Join-Path $machineInstallRoot 'luxury-yacht.exe'
$machineMarkerPath = Join-Path $machineInstallRoot 'luxury-yacht.install.json'
$machineUninstallerPath = Join-Path $machineInstallRoot 'uninstall.exe'

function Assert-Contract([bool]$Condition, [string]$Message) {
    if (-not $Condition) {
        throw $Message
    }
}

function Invoke-And-Wait([string]$Path, [string]$Arguments) {
    return Start-Process -FilePath $Path -ArgumentList $Arguments -Wait -PassThru
}

if (Test-Path -LiteralPath $installRoot) {
    throw "Windows package drill requires an unused install root: $installRoot"
}
if (Test-Path -LiteralPath $userKey) {
    throw "Windows package drill requires no existing per-user registration: $userKey"
}
if (Test-Path -LiteralPath $machineKey) {
    throw "Windows package drill requires no existing machine registration: $machineKey"
}
if (Test-Path -LiteralPath $machineInstallRoot) {
    throw "Windows package drill requires an unused machine install root: $machineInstallRoot"
}

New-Item -ItemType Directory -Path $settingsRoot -Force | Out-Null
Set-Content -LiteralPath $settingsProbe -Value 'preserve-me' -NoNewline

try {
    $machineInstalled = Invoke-And-Wait $systemInstallerPath "/S /D=$machineInstallRoot"
    Assert-Contract ($machineInstalled.ExitCode -eq 0) "System installer exited $($machineInstalled.ExitCode)"
    Assert-Contract (Test-Path -LiteralPath $machineExecutablePath -PathType Leaf) 'System-installed executable is missing'
    Assert-Contract (Test-Path -LiteralPath $machineMarkerPath -PathType Leaf) 'System installation marker is missing'

    $machineMarker = Get-Content -LiteralPath $machineMarkerPath -Raw | ConvertFrom-Json
    Assert-Contract ($machineMarker.schemaVersion -eq 1) 'System installation marker schemaVersion is incorrect'
    Assert-Contract ($machineMarker.productIdentifier -eq 'app.luxury-yacht.desktop') 'System installation marker productIdentifier is incorrect'
    Assert-Contract ($machineMarker.distribution -eq 'nsis') 'System installation marker distribution is incorrect'
    Assert-Contract ($machineMarker.scope -eq 'machine') 'System installation marker scope is incorrect'

    $machineRegistration = Get-ItemProperty -LiteralPath $machineKey
    Assert-Contract ($machineRegistration.DisplayName -eq $ProductName) 'System DisplayName is incorrect'
    Assert-Contract ($machineRegistration.DisplayVersion -eq $ExpectedVersion) 'System DisplayVersion is incorrect'
    Assert-Contract ([IO.Path]::GetFullPath($machineRegistration.DisplayIcon) -eq [IO.Path]::GetFullPath($machineExecutablePath)) 'System DisplayIcon does not own the installed executable'
    Assert-Contract (-not (Test-Path -LiteralPath $userKey)) 'System installer wrote a per-user registration'

    $blocked = Invoke-And-Wait $userInstallerPath '/S'
    if ($blocked.ExitCode -ne 66) {
        throw "Side-by-side per-user install was not refused; exit code $($blocked.ExitCode)"
    }
    Assert-Contract (-not (Test-Path -LiteralPath $installRoot)) 'Refused installer created a per-user install directory'
    Assert-Contract (-not (Test-Path -LiteralPath $userKey)) 'Refused installer created a per-user registration'

    $machineUninstalled = Invoke-And-Wait $machineUninstallerPath '/S'
    Assert-Contract ($machineUninstalled.ExitCode -eq 0) "System uninstaller exited $($machineUninstalled.ExitCode)"
    Assert-Contract (-not (Test-Path -LiteralPath $machineInstallRoot)) 'System uninstaller left the install directory behind'
    Assert-Contract (-not (Test-Path -LiteralPath $machineKey)) 'System uninstaller left its registration behind'
    Assert-Contract (Test-Path -LiteralPath $settingsProbe -PathType Leaf) 'System uninstaller removed user-profile settings'

    $installed = Invoke-And-Wait $userInstallerPath '/S'
    Assert-Contract ($installed.ExitCode -eq 0) "Per-user installer exited $($installed.ExitCode)"
    Assert-Contract (Test-Path -LiteralPath $executablePath -PathType Leaf) 'Installed executable is missing'
    Assert-Contract (Test-Path -LiteralPath $markerPath -PathType Leaf) 'Installation marker is missing'

    $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
    Assert-Contract ($marker.schemaVersion -eq 1) 'Installation marker schemaVersion is incorrect'
    Assert-Contract ($marker.productIdentifier -eq 'app.luxury-yacht.desktop') 'Installation marker productIdentifier is incorrect'
    Assert-Contract ($marker.distribution -eq 'nsis') 'Installation marker distribution is incorrect'
    Assert-Contract ($marker.scope -eq 'user') 'Installation marker scope is incorrect'

    $registration = Get-ItemProperty -LiteralPath $userKey
    Assert-Contract ($registration.DisplayName -eq $ProductName) 'Per-user DisplayName is incorrect'
    Assert-Contract ($registration.DisplayVersion -eq $ExpectedVersion) 'Per-user DisplayVersion is incorrect'
    Assert-Contract ([IO.Path]::GetFullPath($registration.DisplayIcon) -eq [IO.Path]::GetFullPath($executablePath)) 'Per-user DisplayIcon does not own the installed executable'
    Assert-Contract (-not (Test-Path -LiteralPath $machineKey)) 'Per-user installer wrote a machine registration'

    $uninstalled = Invoke-And-Wait $uninstallerPath '/S'
    Assert-Contract ($uninstalled.ExitCode -eq 0) "Per-user uninstaller exited $($uninstalled.ExitCode)"
    Assert-Contract (-not (Test-Path -LiteralPath $installRoot)) 'Per-user uninstaller left the install directory behind'
    Assert-Contract (-not (Test-Path -LiteralPath $userKey)) 'Per-user uninstaller left its registration behind'
    Assert-Contract (Test-Path -LiteralPath $settingsProbe -PathType Leaf) 'Per-user uninstaller removed user-profile settings'

}
finally {
    if (Test-Path -LiteralPath $uninstallerPath -PathType Leaf) {
        Invoke-And-Wait $uninstallerPath '/S' | Out-Null
    }
    if (Test-Path -LiteralPath $machineUninstallerPath -PathType Leaf) {
        Invoke-And-Wait $machineUninstallerPath '/S' | Out-Null
    }
    if (Test-Path -LiteralPath $machineKey) {
        Remove-Item -LiteralPath $machineKey -Recurse -Force
    }
    if (Test-Path -LiteralPath $userKey) {
        Remove-Item -LiteralPath $userKey -Recurse -Force
    }
    if (Test-Path -LiteralPath $installRoot) {
        Remove-Item -LiteralPath $installRoot -Recurse -Force
    }
    if (Test-Path -LiteralPath $settingsProbe) {
        Remove-Item -LiteralPath $settingsProbe -Force
    }
    if (Test-Path -LiteralPath $machineInstallRoot) {
        Remove-Item -LiteralPath $machineInstallRoot -Recurse -Force
    }
}
