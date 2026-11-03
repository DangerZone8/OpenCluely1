$ErrorActionPreference = 'Stop'

$fromVersion = '1.0.340'
$toVersion = '1.0.341'
$releaseBase = 'https://github.com/DangerZone8/OpenCluely1/releases/download'
$oldInstallerName = "Slickly-AI-Setup-$fromVersion.exe"
$oldReleaseUrl = "$releaseBase/v$fromVersion"
$installDir = Join-Path $env:RUNNER_TEMP 'SlicklyAutoUpdate341'
$installer = Join-Path $env:RUNNER_TEMP $oldInstallerName
$checksumFile = Join-Path $env:RUNNER_TEMP 'SHA256SUMS-1.0.340.txt'
$isolatedProfile = Join-Path $env:RUNNER_TEMP 'SlicklyAutoUpdate341Profile'
$logDir = Join-Path $isolatedProfile '.OpenCluely\logs'
$artifactLogDir = Join-Path $env:RUNNER_TEMP 'slickly-update-logs'
$stdoutLog = Join-Path $env:RUNNER_TEMP 'slickly-update-stdout.log'
$stderrLog = Join-Path $env:RUNNER_TEMP 'slickly-update-stderr.log'

New-Item -ItemType Directory -Force -Path $env:RUNNER_TEMP | Out-Null
Remove-Item -LiteralPath $installDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $isolatedProfile -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $isolatedProfile | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $isolatedProfile 'AppData\Roaming') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $isolatedProfile 'AppData\Local') | Out-Null
Remove-Item -LiteralPath (Join-Path $HOME '.OpenCluely') -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $artifactLogDir -Recurse -Force -ErrorAction SilentlyContinue

try {
  Write-Host "Downloading the published v$fromVersion installer."
  Invoke-WebRequest -Uri "$oldReleaseUrl/$oldInstallerName" -OutFile $installer
  Invoke-WebRequest -Uri "$oldReleaseUrl/SHA256SUMS.txt" -OutFile $checksumFile

  $sumLine = Get-Content $checksumFile | Where-Object { $_ -match ([regex]::Escape($oldInstallerName) + '$') } | Select-Object -First 1
  if (-not $sumLine -or $sumLine -notmatch '^([A-Fa-f0-9]{64})\s+') {
    throw "Could not find a SHA-256 checksum for $oldInstallerName in the published release."
  }
  $expectedHash = $Matches[1].ToLowerInvariant()
  $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $installer).Hash.ToLowerInvariant()
  if ($actualHash -ne $expectedHash) {
    throw "The downloaded v$fromVersion installer checksum does not match its published checksum."
  }
  Write-Host "PASS: v$fromVersion installer downloaded and SHA-256 verified."

  Write-Host "Installing v$fromVersion into isolated path $installDir."
  $install = Start-Process -FilePath $installer -ArgumentList "/S /D=$installDir" -Wait -PassThru
  if ($install.ExitCode -ne 0) { throw "The v$fromVersion installer exited with code $($install.ExitCode)." }

  $appExe = Join-Path $installDir 'Slickly AI.exe'
  if (-not (Test-Path -LiteralPath $appExe)) { throw "Installed executable not found: $appExe" }
  $installedVersion = (Get-Item -LiteralPath $appExe).VersionInfo.ProductVersion
  if (-not $installedVersion.StartsWith($fromVersion)) {
    throw "Expected installed v$fromVersion before upgrade, found '$installedVersion'."
  }
  Write-Host "PASS: older installed application reports v$installedVersion."

  # GitHub-hosted runners set CI=true. Slickly intentionally disables auto-update
  # in CI, so clear that variable only for this isolated installed-app process.
  $env:CI = 'false'
  # Electron's os.homedir() and app.getPath('userData') resolve from these
  # Windows profile variables. Isolate them so logs and updater state are
  # deterministic and cannot be redirected by the hosted runner's HOME value.
  $env:USERPROFILE = $isolatedProfile
  $env:HOME = $isolatedProfile
  $env:APPDATA = Join-Path $isolatedProfile 'AppData\Roaming'
  $env:LOCALAPPDATA = Join-Path $isolatedProfile 'AppData\Local'
  $oldLaunch = Start-Process -FilePath $appExe -ArgumentList '--disable-gpu' -PassThru -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog

  $deadline = (Get-Date).AddMinutes(6)
  $visible = $null
  $updateAvailable = $false
  $updateDownloaded = $false
  $logFile = Join-Path $logDir ("application-" + (Get-Date -Format 'yyyy-MM-dd') + ".log")

  while ((Get-Date) -lt $deadline -and (-not $visible -or -not $updateAvailable -or -not $updateDownloaded)) {
    $visible = Get-Process -Name 'Slickly AI' -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
      Select-Object -First 1

    if (Test-Path -LiteralPath $logFile) {
      $log = Get-Content -LiteralPath $logFile -Raw
      $updateAvailable = $log -match ('(?s)Slickly AI update available.{0,500}"version"\s*:\s*"' + [regex]::Escape($toVersion) + '"')
      $updateDownloaded = $log -match ('(?s)Slickly AI update downloaded; it will install on quit.{0,500}"version"\s*:\s*"' + [regex]::Escape($toVersion) + '"')
    }
    Start-Sleep -Seconds 3
  }

  if (-not $visible) { throw 'The installed older application never exposed a visible window.' }
  if (-not $updateAvailable) { throw "v$fromVersion did not log detection of update v$toVersion within six minutes." }
  Write-Host "PASS: installed v$fromVersion detected update v$toVersion."
  if (-not $updateDownloaded) { throw "v$fromVersion did not finish downloading update v$toVersion within six minutes." }
  Write-Host "PASS: installed v$fromVersion logged the completed v$toVersion download."

  $beforePids = @(Get-Process -Name 'Slickly AI' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
  if ($beforePids.Count -eq 0) { throw 'Could not identify the running older application processes before closing.' }

  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SlicklyWindowCloser {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
'@

  # Send WM_CLOSE to every visible Slickly window. This follows the app's normal
  # window-close -> app.quit path so electron-updater can install on quit.
  $windows = Get-Process -Name 'Slickly AI' -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero }
  foreach ($window in $windows) {
    [void][SlicklyWindowCloser]::PostMessage($window.MainWindowHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
  }

  $quitDeadline = (Get-Date).AddSeconds(90)
  do {
    $remainingOld = @($beforePids | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
    if ($remainingOld.Count -eq 0) { break }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $quitDeadline)
  if ($remainingOld.Count -ne 0) {
    throw "The old app did not exit cleanly after WM_CLOSE; remaining original PIDs: $($remainingOld -join ', ')."
  }
  Write-Host 'PASS: old app exited through its normal window-close path; updater install-on-quit was triggered.'

  $restartDeadline = (Get-Date).AddMinutes(4)
  $newApp = $null
  $newVersion = ''
  while ((Get-Date) -lt $restartDeadline) {
    $newVersion = (Get-Item -LiteralPath $appExe).VersionInfo.ProductVersion
    $newApp = Get-Process -Name 'Slickly AI' -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $beforePids -notcontains $_.Id } |
      Select-Object -First 1
    if ($newVersion.StartsWith($toVersion) -and $newApp) { break }
    Start-Sleep -Seconds 3
  }

  if (-not $newVersion.StartsWith($toVersion)) {
    throw "Installed executable did not advance to v$toVersion; current ProductVersion is '$newVersion'."
  }
  if (-not $newApp) {
    throw "The updater installed v$toVersion but did not automatically restart the application with a new process."
  }
  Write-Host "PASS: application automatically restarted with PID $($newApp.Id) and ProductVersion $newVersion."
  Write-Host "PASS: complete installed-app upgrade v$fromVersion -> v$toVersion (detection, download, install, restart)."
}
finally {
  New-Item -ItemType Directory -Force -Path $artifactLogDir | Out-Null
  if (Test-Path -LiteralPath $logDir) {
    Get-ChildItem -LiteralPath $logDir -File -Recurse | Copy-Item -Destination $artifactLogDir -Force
  }
  foreach ($capture in @($stdoutLog, $stderrLog)) {
    if (Test-Path -LiteralPath $capture) { Copy-Item -LiteralPath $capture -Destination $artifactLogDir -Force }
  }
  if (Test-Path -LiteralPath $artifactLogDir) {
    Write-Host "Diagnostic files captured: $((Get-ChildItem -LiteralPath $artifactLogDir -File | Select-Object -ExpandProperty Name) -join ', ')"
  }
}
