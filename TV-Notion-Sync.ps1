# TV Wallpaper -> Notion sync (Windows)
# Sends each trade the Journal records (from your recordings folder) to your Notion Trades database,
# with its chart video attached when it fits your Notion plan's file size limit.
#
#   First time:   powershell -NoProfile -ExecutionPolicy Bypass -File TV-Notion-Sync.ps1 -Setup
#   Runs by itself every 5 minutes after setup. To run now:   ... -File TV-Notion-Sync.ps1
#   To stop it:   ... -File TV-Notion-Sync.ps1 -Uninstall
#
# Your Notion key is stored encrypted with your Windows login (only your account on this PC can read it).

param([switch]$Setup, [switch]$Uninstall, [switch]$Quiet)

$ErrorActionPreference = 'Stop'
$selfPath = $PSCommandPath
$dir = if ($env:TVWP_DIR) { $env:TVWP_DIR } else { Join-Path $env:LOCALAPPDATA 'TVWallpaper' }
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$configPath = Join-Path $dir 'notion-sync.json'
$statePath = Join-Path $dir 'notion-sync-state.json'
$logPath = Join-Path $dir 'notion-sync.log'
$taskName = 'TV Wallpaper Notion Sync'
$api = if ($env:TVWP_NOTION_API) { $env:TVWP_NOTION_API.TrimEnd('/') } else { 'https://api.notion.com' }
$notionVersion = '2022-06-28'

function Log($m) {
  $line = "$(Get-Date -Format s)  $m"
  Add-Content -Path $logPath -Value $line -Encoding UTF8
  if (-not $Quiet) { Write-Host $m }
}
function Read-Json($path) {
  if (-not (Test-Path $path)) { return $null }
  return [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8) | ConvertFrom-Json
}
function Write-Json($path, $obj) {
  [IO.File]::WriteAllText($path, (ConvertTo-Json -InputObject $obj -Depth 12), (New-Object Text.UTF8Encoding $false))
}

# ---------- the Notion key ----------
function Save-Token([Security.SecureString]$secure) {
  $cfg = Read-Json $configPath
  if (-not $cfg) { $cfg = [pscustomobject]@{} }
  $enc = ConvertFrom-SecureString $secure          # DPAPI: only this Windows user can decrypt it
  $cfg | Add-Member -NotePropertyName tokenEnc -NotePropertyValue $enc -Force
  Write-Json $configPath $cfg
}
function Get-Token($cfg) {
  if ($env:TVWP_NOTION_TOKEN) { return $env:TVWP_NOTION_TOKEN }
  $sec = ConvertTo-SecureString $cfg.tokenEnc
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

# ---------- talking to Notion ----------
$script:token = $null
function Invoke-Notion([string]$method, [string]$path, $body) {
  $headers = @{ Authorization = "Bearer $script:token"; 'Notion-Version' = $notionVersion }
  for ($try = 1; $try -le 4; $try++) {
    try {
      if ($null -ne $body) {
        $json = ConvertTo-Json -InputObject $body -Depth 14
        $bytes = [Text.Encoding]::UTF8.GetBytes($json)
        $r = Invoke-RestMethod -Method $method -Uri "$api$path" -Headers $headers -Body $bytes -ContentType 'application/json; charset=utf-8'
      } else {
        $r = Invoke-RestMethod -Method $method -Uri "$api$path" -Headers $headers
      }
      Start-Sleep -Milliseconds 350          # stay under Notion's ~3 requests/second
      return $r
    } catch {
      $code = $null
      try { $code = [int]$_.Exception.Response.StatusCode } catch {}
      if (($code -eq 429 -or $code -ge 500) -and $try -lt 4) { Start-Sleep -Seconds (2 * $try); continue }
      $detail = ''
      try { $detail = $_.ErrorDetails.Message } catch {}
      throw "Notion $method $path failed ($code): $($_.Exception.Message) $detail"
    }
  }
}
function Send-File([string]$filePath, [string]$name, [string]$contentType) {
  $up = Invoke-Notion 'POST' '/v1/file_uploads' @{ filename = $name; content_type = $contentType }
  Add-Type -AssemblyName System.Net.Http
  $client = New-Object System.Net.Http.HttpClient
  $client.Timeout = [TimeSpan]::FromMinutes(5)
  $req = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Post, "$api/v1/file_uploads/$($up.id)/send")
  $req.Headers.Add('Authorization', "Bearer $script:token")
  $req.Headers.Add('Notion-Version', $notionVersion)
  $form = New-Object System.Net.Http.MultipartFormDataContent
  $fs = [IO.File]::OpenRead($filePath)
  try {
    $part = New-Object System.Net.Http.StreamContent($fs)
    $part.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse($contentType)
    $form.Add($part, 'file', $name)
    $req.Content = $form
    $resp = $client.SendAsync($req).Result
    if (-not $resp.IsSuccessStatusCode) { throw "upload failed: $([int]$resp.StatusCode) $($resp.Content.ReadAsStringAsync().Result)" }
  } finally { $fs.Dispose(); $client.Dispose() }
  Start-Sleep -Milliseconds 350
  return $up.id
}

# ---------- turning a recorded trade into a Notion row ----------
$nyZone = $null
foreach ($id in 'Eastern Standard Time', 'America/New_York') { try { $nyZone = [TimeZoneInfo]::FindSystemTimeZoneById($id); break } catch {} }
function To-NY([double]$ms) { [TimeZoneInfo]::ConvertTimeFromUtc([DateTimeOffset]::FromUnixTimeMilliseconds([long]$ms).UtcDateTime, $nyZone) }
function Iso([double]$ms) { [DateTimeOffset]::FromUnixTimeMilliseconds([long]$ms).UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ss.fffZ") }
function Get-Root([string]$sym) {
  $s = ($sym -split ':')[-1]
  $s = $s -replace '\d!$', ''
  $s = $s -replace '[FGHJKMNQUVXZ]\d{1,4}$', ''
  return $s.ToUpper()
}
function Get-Market([string]$sym) {
  if ($sym -match '^(CME|CME_MINI|CBOT|CBOT_MINI|COMEX|COMEX_MINI|NYMEX|NYMEX_MINI|ICE\w*|EUREX)\:' -or $sym -match '(\d!|[FGHJKMNQUVXZ]\d{2,4})$') { return 'Futures' }
  if ($sym -match '(USDT|USDC|BTC|ETH)' -or $sym -match '^(BINANCE|COINBASE|KRAKEN|BYBIT|OKX)\:') { return 'Crypto' }
  return $null
}
function Get-Session($ny) {
  $m = $ny.Hour * 60 + $ny.Minute
  if ($m -ge 1080 -or $m -lt 120) { return 'Asia' }              # 6 PM - 2 AM
  if ($m -lt 480) { return 'London' }                             # 2 AM - 8 AM
  if ($m -lt 570) { return 'Pre-market' }                         # 8 AM - 9:30 AM
  if ($m -lt 630) { return 'Open (first hour)' }                  # 9:30 - 10:30
  if ($m -lt 900) { return 'Midday' }                             # 10:30 - 3 PM
  if ($m -lt 960) { return 'Power Hour / Close' }                 # 3 PM - 4 PM
  return 'After-hours'                                            # 4 PM - 6 PM
}
function Get-Timeframe([string]$tf) {
  switch ($tf) { '1' { '1m' } '5' { '5m' } '15' { '15m' } '60' { '1H' } '240' { '4H' } { $_ -in 'D', '1D' } { 'Daily' } default { $null } }
}
function Build-Properties($t, $cfg, $schema) {
  $root = Get-Root $t.symbol
  $dirName = if ($t.dir -gt 0) { 'Long' } else { 'Short' }
  $ny = To-NY $t.openTime
  $title = "$root $dirName " + [char]0x00B7 + " " + $ny.ToString('MMM d h:mm tt', [Globalization.CultureInfo]::InvariantCulture)
  $account = if ($t.broker -match 'paper') { 'Paper' } else { $cfg.account }
  $p = [ordered]@{
    'Trade'       = @{ title = @(@{ text = @{ content = $title } }) }
    'Ticker'      = @{ rich_text = @(@{ text = @{ content = $root } }) }
    'Direction'   = @{ select = @{ name = $dirName } }
    'Account'     = @{ select = @{ name = $account } }
    'Entry Price' = @{ number = [double]$t.entry }
    'Exit Price'  = @{ number = [double]$t.exit }
    'Size'        = @{ number = [double]$t.qty }
    'Fees'        = @{ number = [math]::Round([double]$t.commission, 2) }
    'Entry Time'  = @{ date = @{ start = (Iso $t.openTime) } }
    'Exit Time'   = @{ date = @{ start = (Iso $t.closeTime) } }
    'Session'     = @{ select = @{ name = (Get-Session $ny) } }
  }
  $market = Get-Market $t.symbol
  if ($market) { $p['Market'] = @{ select = @{ name = $market } } }
  if ($t.pointValue) { $p['Multiplier'] = @{ number = [double]$t.pointValue } }
  $tf = Get-Timeframe ([string]$t.tf)
  if ($tf) { $p['Timeframe'] = @{ select = @{ name = $tf } } }
  # only send fields your database actually has (with the same type), so renamed columns never break it
  $out = [ordered]@{}
  foreach ($k in @($p.Keys)) {
    $col = $schema.$k
    if (-not $col) { continue }
    $want = @($p[$k].Keys)[0]
    if ($col.type -eq $want) { $out[$k] = $p[$k] }
  }
  return $out
}

# ---------- setup / uninstall ----------
function Register-Task {
  $self = Join-Path $dir 'TV-Notion-Sync.ps1'
  if ($selfPath -and ($selfPath -ne $self)) { Copy-Item -Force $selfPath $self }
  # a tiny .vbs starts PowerShell with no window flashing up every 5 minutes
  $vbs = Join-Path $dir 'notion-sync-hidden.vbs'
  $cmd = "powershell -NoProfile -ExecutionPolicy Bypass -File ""$self"" -Quiet"
  [IO.File]::WriteAllText($vbs, "CreateObject(""WScript.Shell"").Run """ + $cmd.Replace('"', '""') + """, 0, False", [Text.Encoding]::ASCII)
  schtasks /Create /F /SC MINUTE /MO 5 /TN $taskName /TR "wscript.exe `"$vbs`"" | Out-Null
}
if ($Uninstall) {
  schtasks /Delete /F /TN $taskName 2>$null | Out-Null
  Remove-Item -Force -ErrorAction SilentlyContinue $configPath
  Write-Host 'Notion sync removed. Your recordings and your Notion pages are untouched.'
  exit 0
}
if ($Setup) {
  Write-Host "`nTV Wallpaper -> Notion setup`n"
  Write-Host '1. Make a Notion integration: open https://www.notion.so/profile/integrations , click New integration,'
  Write-Host '   pick your workspace, save, then copy its "Internal Integration Secret".'
  Write-Host '2. In Notion, open your Trades database, click ... (top right) > Connections, and add that integration.'
  $secure = Read-Host "`nPaste the integration secret" -AsSecureString
  Save-Token $secure
  $cfg = Read-Json $configPath
  $script:token = Get-Token $cfg
  try { $me = Invoke-Notion 'GET' '/v1/users/me' $null } catch { Write-Host "That secret didn't work: $_"; exit 1 }
  $link = Read-Host 'Paste the link to your Trades database'
  $m = [regex]::Match($link, '[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')
  if (-not $m.Success) { Write-Host "Couldn't find a database ID in that link."; exit 1 }
  $dbId = $m.Value -replace '-', ''
  try { $db = Invoke-Notion 'GET' "/v1/databases/$dbId" $null } catch { Write-Host "Can't open that database. Did you add the integration under Connections? $_"; exit 1 }
  $docs = [Environment]::GetFolderPath('MyDocuments')
  $folder = Read-Host "Your recordings folder (the one picked in Journal > Save to a folder), e.g. $docs\Trading"
  $folder = $folder.Trim('"', ' ')
  if (-not (Test-Path $folder)) { Write-Host "That folder doesn't exist."; exit 1 }
  $acct = Read-Host 'Account type for trades that are not Paper Trading: 1 = Live, 2 = Prop / Funded  [1]'
  $account = if ($acct -eq '2') { 'Prop / Funded' } else { 'Live' }
  $old = Read-Host 'Also send trades already recorded? (y/N)'
  $limit = 5242880
  try { if ($me.bot.workspace_limits.max_file_upload_size_in_bytes) { $limit = [long]$me.bot.workspace_limits.max_file_upload_size_in_bytes } } catch {}
  $cfg | Add-Member -Force -NotePropertyName databaseId -NotePropertyValue $dbId
  $cfg | Add-Member -Force -NotePropertyName folder -NotePropertyValue $folder
  $cfg | Add-Member -Force -NotePropertyName account -NotePropertyValue $account
  $cfg | Add-Member -Force -NotePropertyName since -NotePropertyValue $(if ($old -match '^y') { 0 } else { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() })
  $cfg | Add-Member -Force -NotePropertyName maxBytes -NotePropertyValue $limit
  Write-Json $configPath $cfg
  Register-Task
  Write-Host "`nConnected to '$($db.title[0].plain_text)'. New trades will appear there within about 5 minutes."
  Write-Host ("Videos up to {0:N1} MB are attached (your Notion plan's limit)." -f ($limit / 1MB))
}

# ---------- sync ----------
$cfg = Read-Json $configPath
if (-not $cfg -or -not $cfg.databaseId) { Write-Host 'Run this once with -Setup first.'; exit 1 }
$script:token = Get-Token $cfg
$backupPath = Join-Path $cfg.folder 'journal-backup.json'
if (-not (Test-Path $backupPath)) { Log "No journal-backup.json in $($cfg.folder) yet. Turn on Journal > Save to a folder."; exit 0 }
$backup = Read-Json $backupPath
$state = Read-Json $statePath
if (-not $state) { $state = [pscustomobject]@{ pages = [pscustomobject]@{}; videos = [pscustomobject]@{} } }

try { $db = Invoke-Notion 'GET' "/v1/databases/$($cfg.databaseId)" $null } catch { Log "Can't reach your Trades database: $_"; exit 1 }
$schema = $db.properties
$maxBytes = if ($cfg.maxBytes) { [long]$cfg.maxBytes } else { 5242880 }
$sent = 0; $vids = 0
foreach ($t in @($backup.trades | Sort-Object closeTime)) {
  if (-not $t.id -or -not $t.closeTime -or [double]$t.closeTime -lt [double]$cfg.since) { continue }
  $pageId = $state.pages.($t.id)
  try {
    if (-not $pageId) {
      $props = Build-Properties $t $cfg $schema
      $page = Invoke-Notion 'POST' '/v1/pages' @{ parent = @{ database_id = $cfg.databaseId }; properties = $props }
      $pageId = $page.id
      $state.pages | Add-Member -Force -NotePropertyName $t.id -NotePropertyValue $pageId
      Write-Json $statePath $state
      $sent++
    }
    if ($t.videoFile -and -not $state.videos.($t.id)) {
      $vpath = Join-Path $cfg.folder ($t.videoFile -replace '/', [IO.Path]::DirectorySeparatorChar)
      if (Test-Path $vpath) {
        $size = (Get-Item $vpath).Length
        $vname = Split-Path $vpath -Leaf
        if ($size -le $maxBytes) {
          $vtype = if ($vname -like '*.mp4') { 'video/mp4' } else { 'video/webm' }
          $fid = Send-File $vpath $vname $vtype
          # plays right in the page...
          Invoke-Notion 'PATCH' "/v1/blocks/$pageId/children" @{ children = @(@{ object = 'block'; type = 'video'; video = @{ type = 'file_upload'; file_upload = @{ id = $fid } } }) } | Out-Null
          # ...and shows in the Screenshots column, when your database has it
          if ($schema.'Screenshots' -and $schema.'Screenshots'.type -eq 'files') {
            try { Invoke-Notion 'PATCH' "/v1/pages/$pageId" @{ properties = @{ 'Screenshots' = @{ files = @(@{ type = 'file_upload'; file_upload = @{ id = $fid }; name = $vname }) } } } | Out-Null } catch { Log "Video added to the page but not the Screenshots column: $_" }
          }
          $state.videos | Add-Member -Force -NotePropertyName $t.id -NotePropertyValue 'sent'
          $vids++
        } else {
          $mb = '{0:N1}' -f ($size / 1MB)
          $note = "Chart video is $mb MB, over your Notion plan's limit, so it's kept in your recordings folder: $vpath"
          Invoke-Notion 'PATCH' "/v1/blocks/$pageId/children" @{ children = @(@{ object = 'block'; type = 'paragraph'; paragraph = @{ rich_text = @(@{ text = @{ content = $note } }) } }) } | Out-Null
          $state.videos | Add-Member -Force -NotePropertyName $t.id -NotePropertyValue 'too-big'
        }
        Write-Json $statePath $state
      }
    }
  } catch {
    Log "Trade $($t.id): $_"
  }
}
if ($sent -or $vids) { Log "Sent $sent trade(s) and $vids video(s) to Notion." }
elseif (-not $Quiet) { Write-Host 'Nothing new to send.' }
