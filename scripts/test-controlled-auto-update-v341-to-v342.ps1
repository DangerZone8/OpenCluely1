param(
  [Parameter(Mandatory = $true)][string]$BaselineInstaller,
  [Parameter(Mandatory = $true)][string]$FeedRoot
)
$ErrorActionPreference = 'Stop'
$fromVersion = '1.0.341'
$toVersion = '1.0.342'
$testRoot = Join-Path $env:RUNNER_TEMP 'SlicklyControlledAutoUpdate'
$installDir = Join-Path $testRoot 'installed-v1341'
$profileDir = Join-Path $testRoot 'isolated-profile'
$portFile = Join-Path $testRoot 'feed-port.txt'
$serverStdoutLog = Join-Path $testRoot 'feed-server-stdout.log'
$serverStderrLog = Join-Path $testRoot 'feed-server-stderr.log'
$stdoutLog = Join-Path $testRoot 'app-stdout.log'
$stderrLog = Join-Path $testRoot 'app-stderr.log'
$diagnostics = Join-Path $PWD 'slickly-controlled-update-logs'
$serverProcess = $null
function Assert-File([string]$Path, [string]$Description) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Description not found: $Path" }
}
New-Item -ItemType Directory -Force -Path $testRoot, $profileDir, $diagnostics | Out-Null
Remove-Item -LiteralPath $installDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $profileDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Join-Path $profileDir 'AppData\Roaming'), (Join-Path $profileDir 'AppData\Local') | Out-Null
Assert-File $BaselineInstaller 'Locally built v1.0.341 installer'
Assert-File (Join-Path $FeedRoot 'latest.yml') 'Controlled v1.0.342 manifest'
$targetInstaller = Get-ChildItem -LiteralPath $FeedRoot -Filter 'Slickly-AI-Setup-1.0.342.exe' -File | Select-Object -First 1
if (-not $targetInstaller) { throw 'Controlled feed has no v1.0.342 NSIS installer.' }
$manifest = Get-Content -LiteralPath (Join-Path $FeedRoot 'latest.yml') -Raw
if ($manifest -notmatch '(?m)^version:\s*["'']?1\.0\.342["'']?\s*$') { throw 'latest.yml does not advertise v1.0.342.' }
$expectedSha512 = [regex]::Match($manifest, '(?m)^sha512:\s*["'']?([^''"\r\n]+)').Groups[1].Value.Trim()
if (-not $expectedSha512) { throw 'Manifest has no top-level SHA-512 digest.' }
$actualSha512 = [Convert]::ToBase64String([Security.Cryptography.SHA512]::HashData([IO.File]::ReadAllBytes($targetInstaller.FullName)))
if ($actualSha512 -ne $expectedSha512) { throw 'v1.0.342 installer SHA-512 does not match latest.yml.' }
Write-Host 'PASS: controlled manifest and v1.0.342 installer SHA-512 match.'
try {
  Write-Host 'Installing locally built v1.0.341 into an isolated directory.'
  $install = Start-Process -FilePath $BaselineInstaller -ArgumentList "/S /D=$installDir" -Wait -PassThru
  if ($install.ExitCode -ne 0) { throw "v1.0.341 installer exited with code $($install.ExitCode)." }
  $appExe = Join-Path $installDir 'Slickly AI.exe'
  Assert-File $appExe 'Installed v1.0.341 executable'
  $installedVersion = (Get-Item -LiteralPath $appExe).VersionInfo.ProductVersion
  if (-not $installedVersion.StartsWith($fromVersion)) { throw "Expected v1.0.341, found '$installedVersion'." }
  Write-Host "PASS: installed baseline executable reports $installedVersion."
  $updateConfig = Join-Path $installDir 'resources\app-update.yml'
  Assert-File $updateConfig 'Installed electron-updater app-update.yml'
  $nodeServer = Join-Path $PWD 'scripts\controlled-update-feed-server.js'
  Assert-File $nodeServer 'Controlled local feed server'
  $serverProcess = Start-Process -FilePath 'node' -ArgumentList @($nodeServer, '--root', $FeedRoot, '--port-file', $portFile) -PassThru -RedirectStandardOutput $serverStdoutLog -RedirectStandardError $serverStderrLog
  $portDeadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $portDeadline -and -not (Test-Path -LiteralPath $portFile)) {
    if ($serverProcess.HasExited) { throw 'Controlled feed server exited before binding.' }
    Start-Sleep -Milliseconds 250
  }
  Assert-File $portFile 'Controlled feed server port file'
  $port = [int](Get-Content -LiteralPath $portFile -Raw).Trim()
  if ($port -lt 1 -or $port -gt 65535) { throw "Invalid controlled feed port: $port" }
  $feedUrl = "http://127.0.0.1:$port/"
  $originalUpdateConfig = Get-Content -LiteralPath $updateConfig -Raw
  $cacheSetting = [regex]::Match($originalUpdateConfig, '(?m)^updaterCacheDirName:\\s*.+
  $env:CI = 'false'
  $env:NODE_ENV = 'production'
  Remove-Item Env:SLICKLY_DISABLE_AUTO_UPDATE -ErrorAction SilentlyContinue
  $env:USERPROFILE = $profileDir
  $env:HOME = $profileDir
  $env:APPDATA = Join-Path $profileDir 'AppData\Roaming'
  $env:LOCALAPPDATA = Join-Path $profileDir 'AppData\Local'
  $appProcess = Start-Process -FilePath $appExe -ArgumentList '--disable-gpu' -PassThru -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
  $logDir = Join-Path $profileDir '.OpenCluely\logs'
  $logFile = Join-Path $logDir ("application-" + (Get-Date -Format 'yyyy-MM-dd') + '.log')
  $deadline = (Get-Date).AddMinutes(4)
  $updateAvailable = $false
  $updateDownloaded = $false
  $visible = $false
  $log = ''
  while ((Get-Date) -lt $deadline -and (-not $updateAvailable -or -not $updateDownloaded -or -not $visible)) {
    if (Test-Path -LiteralPath $logFile) {
      $log = Get-Content -LiteralPath $logFile -Raw
      $visible = $log -match 'Main window displayed'
      $updateAvailable = $log -match ('(?s)Slickly AI update available.{0,500}"version"\s*:\s*"' + [regex]::Escape($toVersion) + '"')
      $updateDownloaded = $log -match ('(?s)Slickly AI update downloaded; it will install on quit.{0,500}"version"\s*:\s*"' + [regex]::Escape($toVersion) + '"')
      if ($log -match 'Slickly AI auto-update check/download failed') {
        $failure = [regex]::Match($log, '(?s)Slickly AI auto-update check/download failed.{0,700}').Value
        throw "Updater reported an error before completing the download: $failure"
      }
    }
    Start-Sleep -Seconds 2
  }
  if (-not $visible) { throw 'Installed v1.0.341 did not log that its main window was displayed.' }
  if (-not $updateAvailable) { throw 'Installed v1.0.341 did not detect v1.0.342 from controlled feed within eight minutes.' }
  Write-Host 'PASS: installed v1.0.341 detected v1.0.342.'
  if (-not $updateDownloaded) { throw 'Installed v1.0.341 did not finish downloading v1.0.342 within eight minutes.' }
  Write-Host 'PASS: electron-updater completed the v1.0.342 download and checksum verification.'
  $requestsFile = Join-Path $FeedRoot 'controlled-feed-requests.jsonl'
  $requests = if (Test-Path -LiteralPath $requestsFile) { Get-Content -LiteralPath $requestsFile -Raw } else { '' }
  if ($requests -notmatch 'latest\.yml' -or $requests -notmatch [regex]::Escape($targetInstaller.Name)) { throw 'Feed access log does not show both manifest and installer requests.' }
  Write-Host 'PASS: feed log confirms latest.yml and installer requests.'
  $beforePids = @(Get-Process -Name 'Slickly AI' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
  if ($beforePids.Count -eq 0) { throw 'No running Slickly process found before install-on-quit.' }
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class SlicklyControlledUpdateCloser {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", SetLastError=true)] static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
  public static int[] GetVisibleProcessIds() {
    var ids = new HashSet<int>();
    EnumWindows((hWnd, lParam) => {
      if (IsWindowVisible(hWnd)) {
        uint pid;
        GetWindowThreadProcessId(hWnd, out pid);
        if (pid != 0) ids.Add((int)pid);
      }
      return true;
    }, IntPtr.Zero);
    var result = new int[ids.Count];
    ids.CopyTo(result);
    return result;
  }
  public static int CloseVisibleWindowsFor(int[] processIds) {
    int closed = 0;
    EnumWindows((hWnd, lParam) => {
      if (IsWindowVisible(hWnd)) {
        uint pid;
        GetWindowThreadProcessId(hWnd, out pid);
        if (Array.IndexOf(processIds, (int)pid) >= 0 && PostMessage(hWnd, 0x0010, IntPtr.Zero, IntPtr.Zero)) closed++;
      }
      return true;
    }, IntPtr.Zero);
    return closed;
  }
}
'@
  $visiblePids = [SlicklyControlledUpdateCloser]::GetVisibleProcessIds()
  $appWindowPids = @($beforePids | Where-Object { $visiblePids -contains [int]$_ })
  if ($appWindowPids.Count -eq 0) { throw "App log reported a visible main window, but no visible top-level window belonged to Slickly processes: $($beforePids -join ', ')." }
  $closedWindows = [SlicklyControlledUpdateCloser]::CloseVisibleWindowsFor([int[]]$beforePids)
  if ($closedWindows -eq 0) { throw 'Could not send WM_CLOSE to a visible Slickly window.' }
  $quitDeadline = (Get-Date).AddSeconds(120)
  do {
    $remaining = @($beforePids | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
    if ($remaining.Count -eq 0) { break }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $quitDeadline)
  if ($remaining.Count -ne 0) { throw "Original app processes did not exit after WM_CLOSE: $($remaining -join ', ')." }
  Write-Host 'PASS: original app exited through normal close, invoking install-on-quit.'
  $restartDeadline = (Get-Date).AddMinutes(4)
  $newApp = $null
  $newVersion = ''
  while ((Get-Date) -lt $restartDeadline) {
    $newVersion = (Get-Item -LiteralPath $appExe).VersionInfo.ProductVersion
    $newProcesses = @(Get-Process -Name 'Slickly AI' -ErrorAction SilentlyContinue | Where-Object { $beforePids -notcontains $_.Id })
    $visiblePids = [SlicklyControlledUpdateCloser]::GetVisibleProcessIds()
    $newApp = $newProcesses | Where-Object { $visiblePids -contains $_.Id } | Select-Object -First 1
    if ($newVersion.StartsWith($toVersion) -and $newApp) { break }
    Start-Sleep -Seconds 2
  }
  if (-not $newVersion.StartsWith($toVersion)) { throw "Installed executable remained '$newVersion'; expected v1.0.342." }
  if (-not $newApp) { throw 'Updater installed v1.0.342 but did not relaunch the application.' }
  Write-Host "PASS: executable updated to $newVersion and app relaunched with PID $($newApp.Id)."
  Write-Host 'PASS: complete controlled installed-app update v1.0.341 -> v1.0.342.'
}
finally {
  if ($serverProcess -and -not $serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue }
  foreach ($file in @($stdoutLog, $stderrLog, $serverStdoutLog, $serverStderrLog)) { if (Test-Path -LiteralPath $file) { Copy-Item -LiteralPath $file -Destination $diagnostics -Force } }
  $requestsFile = Join-Path $FeedRoot 'controlled-feed-requests.jsonl'
  if (Test-Path -LiteralPath $requestsFile) { Copy-Item -LiteralPath $requestsFile -Destination $diagnostics -Force }
  if (Test-Path -LiteralPath $profileDir) {
    $logs = Join-Path $profileDir '.OpenCluely\logs'
    if (Test-Path -LiteralPath $logs) { Get-ChildItem -LiteralPath $logs -File -Recurse | Copy-Item -Destination $diagnostics -Force }
  }
  Write-Host "Updater diagnostic directory: $diagnostics"
  Get-ChildItem -LiteralPath $diagnostics -File -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "===== $($_.Name) ====="
    Get-Content -LiteralPath $_.FullName -Tail 160 -ErrorAction SilentlyContinue
  }
}
).Value
  if (-not $cacheSetting) { throw 'Built v1.0.341 app-update.yml has no updaterCacheDirName; refusing to replace required updater metadata.' }
  $testConfig = 'provider: generic' + [Environment]::NewLine + "url: $feedUrl" + [Environment]::NewLine + 'useMultipleRangeRequest: false' + [Environment]::NewLine + $cacheSetting + [Environment]::NewLine
  [IO.File]::WriteAllText($updateConfig, $testConfig, [Text.UTF8Encoding]::new($false))
  Write-Host "PASS: installed v1.0.341 is isolated to loopback feed $feedUrl and preserves $cacheSetting."
  $env:CI = 'false'
  $env:NODE_ENV = 'production'
  Remove-Item Env:SLICKLY_DISABLE_AUTO_UPDATE -ErrorAction SilentlyContinue
  $env:USERPROFILE = $profileDir
  $env:HOME = $profileDir
  $env:APPDATA = Join-Path $profileDir 'AppData\Roaming'
  $env:LOCALAPPDATA = Join-Path $profileDir 'AppData\Local'
  $appProcess = Start-Process -FilePath $appExe -ArgumentList '--disable-gpu' -PassThru -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
  $logDir = Join-Path $profileDir '.OpenCluely\logs'
  $logFile = Join-Path $logDir ("application-" + (Get-Date -Format 'yyyy-MM-dd') + '.log')
  $deadline = (Get-Date).AddMinutes(4)
  $updateAvailable = $false
  $updateDownloaded = $false
  $visible = $false
  $log = ''
  while ((Get-Date) -lt $deadline -and (-not $updateAvailable -or -not $updateDownloaded -or -not $visible)) {
    if (Test-Path -LiteralPath $logFile) {
      $log = Get-Content -LiteralPath $logFile -Raw
      $visible = $log -match 'Main window displayed'
      $updateAvailable = $log -match ('(?s)Slickly AI update available.{0,500}"version"\s*:\s*"' + [regex]::Escape($toVersion) + '"')
      $updateDownloaded = $log -match ('(?s)Slickly AI update downloaded; it will install on quit.{0,500}"version"\s*:\s*"' + [regex]::Escape($toVersion) + '"')
      if ($log -match 'Slickly AI auto-update check/download failed') {
        $failure = [regex]::Match($log, '(?s)Slickly AI auto-update check/download failed.{0,700}').Value
        throw "Updater reported an error before completing the download: $failure"
      }
    }
    Start-Sleep -Seconds 2
  }
  if (-not $visible) { throw 'Installed v1.0.341 did not log that its main window was displayed.' }
  if (-not $updateAvailable) { throw 'Installed v1.0.341 did not detect v1.0.342 from controlled feed within eight minutes.' }
  Write-Host 'PASS: installed v1.0.341 detected v1.0.342.'
  if (-not $updateDownloaded) { throw 'Installed v1.0.341 did not finish downloading v1.0.342 within eight minutes.' }
  Write-Host 'PASS: electron-updater completed the v1.0.342 download and checksum verification.'
  $requestsFile = Join-Path $FeedRoot 'controlled-feed-requests.jsonl'
  $requests = if (Test-Path -LiteralPath $requestsFile) { Get-Content -LiteralPath $requestsFile -Raw } else { '' }
  if ($requests -notmatch 'latest\.yml' -or $requests -notmatch [regex]::Escape($targetInstaller.Name)) { throw 'Feed access log does not show both manifest and installer requests.' }
  Write-Host 'PASS: feed log confirms latest.yml and installer requests.'
  $beforePids = @(Get-Process -Name 'Slickly AI' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
  if ($beforePids.Count -eq 0) { throw 'No running Slickly process found before install-on-quit.' }
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class SlicklyControlledUpdateCloser {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", SetLastError=true)] static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
  public static int[] GetVisibleProcessIds() {
    var ids = new HashSet<int>();
    EnumWindows((hWnd, lParam) => {
      if (IsWindowVisible(hWnd)) {
        uint pid;
        GetWindowThreadProcessId(hWnd, out pid);
        if (pid != 0) ids.Add((int)pid);
      }
      return true;
    }, IntPtr.Zero);
    var result = new int[ids.Count];
    ids.CopyTo(result);
    return result;
  }
  public static int CloseVisibleWindowsFor(int[] processIds) {
    int closed = 0;
    EnumWindows((hWnd, lParam) => {
      if (IsWindowVisible(hWnd)) {
        uint pid;
        GetWindowThreadProcessId(hWnd, out pid);
        if (Array.IndexOf(processIds, (int)pid) >= 0 && PostMessage(hWnd, 0x0010, IntPtr.Zero, IntPtr.Zero)) closed++;
      }
      return true;
    }, IntPtr.Zero);
    return closed;
  }
}
'@
  $visiblePids = [SlicklyControlledUpdateCloser]::GetVisibleProcessIds()
  $appWindowPids = @($beforePids | Where-Object { $visiblePids -contains [int]$_ })
  if ($appWindowPids.Count -eq 0) { throw "App log reported a visible main window, but no visible top-level window belonged to Slickly processes: $($beforePids -join ', ')." }
  $closedWindows = [SlicklyControlledUpdateCloser]::CloseVisibleWindowsFor([int[]]$beforePids)
  if ($closedWindows -eq 0) { throw 'Could not send WM_CLOSE to a visible Slickly window.' }
  $quitDeadline = (Get-Date).AddSeconds(120)
  do {
    $remaining = @($beforePids | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
    if ($remaining.Count -eq 0) { break }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $quitDeadline)
  if ($remaining.Count -ne 0) { throw "Original app processes did not exit after WM_CLOSE: $($remaining -join ', ')." }
  Write-Host 'PASS: original app exited through normal close, invoking install-on-quit.'
  $restartDeadline = (Get-Date).AddMinutes(4)
  $newApp = $null
  $newVersion = ''
  while ((Get-Date) -lt $restartDeadline) {
    $newVersion = (Get-Item -LiteralPath $appExe).VersionInfo.ProductVersion
    $newProcesses = @(Get-Process -Name 'Slickly AI' -ErrorAction SilentlyContinue | Where-Object { $beforePids -notcontains $_.Id })
    $visiblePids = [SlicklyControlledUpdateCloser]::GetVisibleProcessIds()
    $newApp = $newProcesses | Where-Object { $visiblePids -contains $_.Id } | Select-Object -First 1
    if ($newVersion.StartsWith($toVersion) -and $newApp) { break }
    Start-Sleep -Seconds 2
  }
  if (-not $newVersion.StartsWith($toVersion)) { throw "Installed executable remained '$newVersion'; expected v1.0.342." }
  if (-not $newApp) { throw 'Updater installed v1.0.342 but did not relaunch the application.' }
  Write-Host "PASS: executable updated to $newVersion and app relaunched with PID $($newApp.Id)."
  Write-Host 'PASS: complete controlled installed-app update v1.0.341 -> v1.0.342.'
}
finally {
  if ($serverProcess -and -not $serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue }
  foreach ($file in @($stdoutLog, $stderrLog, $serverStdoutLog, $serverStderrLog)) { if (Test-Path -LiteralPath $file) { Copy-Item -LiteralPath $file -Destination $diagnostics -Force } }
  $requestsFile = Join-Path $FeedRoot 'controlled-feed-requests.jsonl'
  if (Test-Path -LiteralPath $requestsFile) { Copy-Item -LiteralPath $requestsFile -Destination $diagnostics -Force }
  if (Test-Path -LiteralPath $profileDir) {
    $logs = Join-Path $profileDir '.OpenCluely\logs'
    if (Test-Path -LiteralPath $logs) { Get-ChildItem -LiteralPath $logs -File -Recurse | Copy-Item -Destination $diagnostics -Force }
  }
  Write-Host "Updater diagnostic directory: $diagnostics"
  Get-ChildItem -LiteralPath $diagnostics -File -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "===== $($_.Name) ====="
    Get-Content -LiteralPath $_.FullName -Tail 160 -ErrorAction SilentlyContinue
  }
}
