param(
    [Parameter(Mandatory = $true)]
    [string]$Installer,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedVersion
)

$ErrorActionPreference = 'Stop'
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\Luxury Yacht'
$executablePath = Join-Path $installRoot 'luxury-yacht.exe'
$markerPath = Join-Path $installRoot 'luxury-yacht.install.json'
$uninstallerPath = Join-Path $installRoot 'uninstall.exe'
$userKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Luxury YachtLuxury Yacht'
$machineKey = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Luxury YachtLuxury Yacht'
$settingsRoot = Join-Path $env:APPDATA 'luxury-yacht'
$settingsProbe = Join-Path $settingsRoot 'migration-preservation-probe'
$machineTempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$machineInstallRoot = Join-Path $machineTempRoot 'luxury-yacht-machine-conflict'
$machineExecutable = Join-Path $machineInstallRoot 'luxury-yacht.exe'
$machineUninstaller = Join-Path $machineInstallRoot 'uninstall.exe'

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

New-Item -ItemType Directory -Path $settingsRoot -Force | Out-Null
Set-Content -LiteralPath $settingsProbe -Value 'preserve-me' -NoNewline

try {
    $installed = Invoke-And-Wait $installerPath '/S'
    Assert-Contract ($installed.ExitCode -eq 0) "Per-user installer exited $($installed.ExitCode)"
    Assert-Contract (Test-Path -LiteralPath $executablePath -PathType Leaf) 'Installed executable is missing'
    Assert-Contract (Test-Path -LiteralPath $markerPath -PathType Leaf) 'Installation marker is missing'

    $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
    Assert-Contract ($marker.schemaVersion -eq 1) 'Installation marker schemaVersion is incorrect'
    Assert-Contract ($marker.productIdentifier -eq 'app.luxury-yacht.desktop') 'Installation marker productIdentifier is incorrect'
    Assert-Contract ($marker.distribution -eq 'nsis') 'Installation marker distribution is incorrect'
    Assert-Contract ($marker.scope -eq 'user') 'Installation marker scope is incorrect'

    $registration = Get-ItemProperty -LiteralPath $userKey
    Assert-Contract ($registration.DisplayName -eq 'Luxury Yacht') 'Per-user DisplayName is incorrect'
    Assert-Contract ($registration.DisplayVersion -eq $ExpectedVersion) 'Per-user DisplayVersion is incorrect'
    Assert-Contract ([IO.Path]::GetFullPath($registration.DisplayIcon) -eq [IO.Path]::GetFullPath($executablePath)) 'Per-user DisplayIcon does not own the installed executable'
    Assert-Contract (-not (Test-Path -LiteralPath $machineKey)) 'Per-user installer wrote a machine registration'

    $uninstalled = Invoke-And-Wait $uninstallerPath '/S'
    Assert-Contract ($uninstalled.ExitCode -eq 0) "Per-user uninstaller exited $($uninstalled.ExitCode)"
    Assert-Contract (-not (Test-Path -LiteralPath $installRoot)) 'Per-user uninstaller left the install directory behind'
    Assert-Contract (-not (Test-Path -LiteralPath $userKey)) 'Per-user uninstaller left its registration behind'
    Assert-Contract (Test-Path -LiteralPath $settingsProbe -PathType Leaf) 'Per-user uninstaller removed user-profile settings'

    New-Item -ItemType Directory -Path $machineInstallRoot -Force | Out-Null
    Set-Content -LiteralPath $machineExecutable -Value 'machine executable' -NoNewline
    Set-Content -LiteralPath $machineUninstaller -Value 'machine uninstaller' -NoNewline
    New-Item -Path $machineKey -Force | Out-Null
    New-ItemProperty -LiteralPath $machineKey -Name DisplayName -Value 'Luxury Yacht' -PropertyType String -Force | Out-Null
    New-ItemProperty -LiteralPath $machineKey -Name DisplayIcon -Value $machineExecutable -PropertyType String -Force | Out-Null
    New-ItemProperty -LiteralPath $machineKey -Name UninstallString -Value ('"' + $machineUninstaller + '"') -PropertyType String -Force | Out-Null
    $blocked = Invoke-And-Wait $installerPath '/S'
    if ($blocked.ExitCode -ne 66) {
        throw "Side-by-side per-user install was not refused; exit code $($blocked.ExitCode)"
    }
    Assert-Contract (-not (Test-Path -LiteralPath $installRoot)) 'Refused installer created a per-user install directory'
    Assert-Contract (-not (Test-Path -LiteralPath $userKey)) 'Refused installer created a per-user registration'
}
finally {
    if (Test-Path -LiteralPath $uninstallerPath -PathType Leaf) {
        Invoke-And-Wait $uninstallerPath '/S' | Out-Null
    }
    if (Test-Path -LiteralPath $machineKey) {
        Remove-Item -LiteralPath $machineKey -Recurse -Force
    }
    if (Test-Path -LiteralPath $settingsProbe) {
        Remove-Item -LiteralPath $settingsProbe -Force
    }
    if (Test-Path -LiteralPath $machineInstallRoot) {
        Remove-Item -LiteralPath $machineInstallRoot -Recurse -Force
    }
}
