# TV Wallpaper launcher for the TradingView desktop app (Windows)
# - Downloads the latest TV Wallpaper script (falls back to the last copy if offline)
# - Starts TradingView with a local debug connection
# - Loads the script into every chart window, and again after reloads
# Run once with -InstallShortcut to put a "TradingView (Wallpaper)" shortcut on your desktop.

param(
  [switch]$InstallShortcut,
  [string]$RepoUrl = 'https://raw.githubusercontent.com/antoniog06/tv-wallpaper/main',
  [int]$Port = 9222
)

$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:LOCALAPPDATA 'TVWallpaper'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$ScriptUrl = "$RepoUrl/tvwp.user.js"
$cache = Join-Path $dir 'tvwp.user.js'
$icon = Join-Path $dir 'logo.ico'
$installed = Join-Path $dir 'TV-Wallpaper.ps1'
$log = Join-Path $dir 'launcher.log'
function Log($m) { "$(Get-Date -Format s)  $m" | Add-Content -Path $log }
Add-Type -AssemblyName PresentationFramework
function Say($m, $buttons = 'OK') { [System.Windows.MessageBox]::Show($m, 'TV Wallpaper', $buttons) }

# ---------- find TradingView ----------
function Find-TradingView {
  $pkg = Get-AppxPackage -Name '*TradingView*' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($pkg) {
    $p = Join-Path $pkg.InstallLocation 'TradingView.exe'
    if (Test-Path $p) { return $p }
  }
  foreach ($root in @("$env:LOCALAPPDATA\Programs", $env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if (-not $root -or -not (Test-Path $root)) { continue }
    $hit = Get-ChildItem $root -Filter 'TradingView.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($hit) { return $hit.FullName }
  }
  return $null
}
$exe = Find-TradingView
if (-not $exe) { Say "Couldn't find the TradingView desktop app on this PC."; exit 1 }

# ---------- app icon ----------
function Update-Icon {
  try {
    Invoke-WebRequest -Uri "$RepoUrl/logo.ico" -UseBasicParsing -OutFile "$icon.tmp" -TimeoutSec 15
    Move-Item -Force "$icon.tmp" $icon
  } catch { Log "Icon download failed: $($_.Exception.Message)" }
}
# Points every 'TradingView (Wallpaper)' shortcut (desktop, taskbar pin, Start menu) at our icon.
function Set-ShortcutIcons {
  if (-not (Test-Path $icon)) { return }
  $places = @(
    [Environment]::GetFolderPath('Desktop'),
    (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'),
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs')
  )
  $ws = New-Object -ComObject WScript.Shell
  $changed = $false
  foreach ($pl in $places) {
    $f = Join-Path $pl 'TradingView (Wallpaper).lnk'
    if (-not (Test-Path $f)) { continue }
    $lnk = $ws.CreateShortcut($f)
    if ($lnk.IconLocation -ne "$icon,0") { $lnk.IconLocation = "$icon,0"; $lnk.Save(); $changed = $true; Log "Icon set: $f" }
  }
  if ($changed) { try { & "$env:SystemRoot\System32\ie4uinit.exe" -show 2>$null } catch {} }   # ask Windows to refresh icons
}

# ---------- one-time shortcut install ----------
if ($InstallShortcut) {
  $self = $MyInvocation.MyCommand.Path
  if ($self -ne $installed) { Copy-Item -Force $self $installed }
  Update-Icon
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'TradingView (Wallpaper).lnk'))
  $lnk.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$installed`""
  $lnk.IconLocation = if (Test-Path $icon) { "$icon,0" } else { "$exe,0" }
  $lnk.WorkingDirectory = $dir
  $lnk.Save()
  Set-ShortcutIcons
  Say "Done. Use the 'TradingView (Wallpaper)' shortcut on your desktop to open TradingView from now on."
  exit 0
}

# ---------- keep the launcher, icon and shortcuts up to date ----------
try {
  Invoke-WebRequest -Uri "$RepoUrl/TV-Wallpaper.ps1" -UseBasicParsing -OutFile "$installed.tmp" -TimeoutSec 15
  if ((Get-Item "$installed.tmp").Length -gt 1000) { Move-Item -Force "$installed.tmp" $installed; Log 'Launcher updated (used next launch)' }
} catch { Log "Launcher update failed: $($_.Exception.Message)" }
Update-Icon
Set-ShortcutIcons

# ---------- get the latest script ----------
try {
  Invoke-WebRequest -Uri $ScriptUrl -UseBasicParsing -OutFile "$cache.tmp" -TimeoutSec 15
  Move-Item -Force "$cache.tmp" $cache
  Log 'Script updated'
} catch {
  Log "Download failed, using cached copy: $($_.Exception.Message)"
}
if (-not (Test-Path $cache)) { Say "Couldn't download the TV Wallpaper script and there's no saved copy yet. Check your internet and try again."; exit 1 }
$userScript = [IO.File]::ReadAllText($cache)
$injectExpr = "(function(){ if (window.__tvwpLoaded) return 'already'; `n" + $userScript + "`n; return 'injected'; })()"

# ---------- start TradingView with the debug connection ----------
function Test-Port {
  try { Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}
if (-not (Test-Port)) {
  if (Get-Process -Name 'TradingView' -ErrorAction SilentlyContinue) {
    $a = Say "TradingView is already open without wallpaper support.`n`nClose it and reopen with TV Wallpaper?" 'YesNo'
    if ($a -ne 'Yes') { exit 0 }
    Get-Process -Name 'TradingView' -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
  }
  Start-Process -FilePath $exe -ArgumentList "--remote-debugging-port=$Port"
  $deadline = (Get-Date).AddSeconds(45)
  while (-not (Test-Port)) {
    if ((Get-Date) -gt $deadline) { Say "TradingView didn't open its debug connection. Try closing it fully (including the tray icon) and run this again."; exit 1 }
    Start-Sleep -Milliseconds 500
  }
}
Log "Connected to TradingView on port $Port"

# ---------- talk to a window ----------
function Invoke-Cdp([string]$wsUrl, [string]$expression) {
  $ws = New-Object System.Net.WebSockets.ClientWebSocket
  $ct = [Threading.CancellationToken]::None
  try {
    $ws.ConnectAsync([Uri]$wsUrl, $ct).Wait(5000) | Out-Null
    if ($ws.State -ne 'Open') { return $null }
    $msg = @{ id = 1; method = 'Runtime.evaluate'; params = @{ expression = $expression; returnByValue = $true } } | ConvertTo-Json -Depth 5 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($msg)
    $ws.SendAsync([ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct).Wait(5000) | Out-Null
    $buf = New-Object byte[] 65536
    $end = (Get-Date).AddSeconds(10)
    while ((Get-Date) -lt $end) {
      $ms = New-Object IO.MemoryStream
      do {
        $task = $ws.ReceiveAsync([ArraySegment[byte]]::new($buf), $ct)
        if (-not $task.Wait(10000)) { return $null }
        $ms.Write($buf, 0, $task.Result.Count)
      } while (-not $task.Result.EndOfMessage)
      $reply = [Text.Encoding]::UTF8.GetString($ms.ToArray()) | ConvertFrom-Json
      if ($reply.id -eq 1) { return $reply }
    }
    return $null
  } catch {
    return $null
  } finally {
    try { $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, '', $ct).Wait(2000) | Out-Null } catch {}
    $ws.Dispose()
  }
}

# ---------- keep chart windows loaded while TradingView is open ----------
while ($true) {
  if (-not (Get-Process -Name 'TradingView' -ErrorAction SilentlyContinue)) { Log 'TradingView closed, exiting'; break }
  try {
    $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 3
  } catch { Start-Sleep -Seconds 2; continue }
  foreach ($t in $targets) {
    if ($t.type -ne 'page' -or $t.url -notmatch '^https://([a-z0-9-]+\.)*tradingview\.com/') { continue }
    $check = Invoke-Cdp $t.webSocketDebuggerUrl '!!window.__tvwpLoaded'
    if ($check -and $check.result.result.value -eq $false) {
      $r = Invoke-Cdp $t.webSocketDebuggerUrl $injectExpr
      $status = if ($r -and $r.result.result.value) { $r.result.result.value } elseif ($r -and $r.result.exceptionDetails) { 'error: ' + $r.result.exceptionDetails.text } else { 'no reply' }
      Log "$status -> $($t.url)"
    }
  }
  Start-Sleep -Seconds 2
}
