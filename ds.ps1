# MKW Discord — статус «Слушает MKW Music» в Discord, без установки и без .exe.
# Запуск: Win+R → вставить команду из MKW Music (Настройки → «Статус в Discord») → Enter.
# Что делает: принимает от сайта MKW Music название трека — только с этого компьютера (адрес 127.0.0.1:47331) —
# и передаёт его в приложение Discord через его официальный локальный канал (Rich Presence). Больше ничего:
# не ставит программ, не читает файлы, никуда в интернет данные не отправляет.
# Остановить: закрыть окно «MKW Discord». Убрать из автозапуска: Win+R → shell:startup → удалить «MKW Discord».

# Windows с «Интеллектуальным управлением приложениями» (или другой защитой) может ограничить PowerShell —
# тогда объясняем, что делать, а не падаем с непонятной ошибкой
if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') {
  Write-Host ''
  Write-Host '  MKW Discord' -ForegroundColor Magenta
  Write-Host '  Windows ограничил PowerShell на этом компьютере (так работает «Интеллектуальное управление приложениями»),'
  Write-Host '  поэтому через эту команду помощник не запустится.'
  Write-Host ''
  Write-Host '  Что сделать (любой из способов):'
  Write-Host '  1. Поставьте Node.js с сайта nodejs.org (кнопка LTS, официальная программа — Windows её пропустит).'
  Write-Host '     Потом в MKW Music: Настройки → «Как подключить Discord» → «Способ 2» → скопировать команду → Win+R → Ctrl+V → Enter.'
  Write-Host '  2. Или выключите «Интеллектуальное управление приложениями»: Безопасность Windows → Управление приложениями/браузером.'
  Write-Host '     Учтите: обратно его включить можно только после переустановки Windows.'
  Write-Host ''
  Read-Host '  Нажмите Enter, чтобы закрыть'
  return
}
$ErrorActionPreference = 'Stop'
$MkwVer = '2.0.1'
$AppId = '1566880916784029786'
$Port = 47331
$RunCmd = 'try{[Net.ServicePointManager]::SecurityProtocol=3072}catch{};iex (iwr https://mkwmusic.ru/ds.txt -UseB).Content'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
try { $Host.UI.RawUI.WindowTitle = 'MKW Discord' } catch {}

function Log([string]$t) { Write-Host ('[' + (Get-Date -Format 'HH:mm:ss') + '] ' + $t) }
function NowMs { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }

Write-Host ''
Write-Host "  MKW Discord $MkwVer" -ForegroundColor Magenta
Write-Host '  Показывает в Discord «Слушает MKW Music» — трек, исполнителя, обложку и время.'
Write-Host '  Это окно можно свернуть. Закроете — статус пропадёт.'
Write-Host ''

# ---------- автозапуск вместе с Windows (если попросили) ----------
if ($mkwAuto) {
  try {
    $lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'MKW Discord.lnk'
    $sh = New-Object -ComObject WScript.Shell
    $s = $sh.CreateShortcut($lnk)
    $s.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $s.Arguments = '-NoProfile -WindowStyle Hidden -Command "' + $RunCmd + '"'
    $s.WindowStyle = 7
    $s.Description = 'MKW Discord: статус «Слушает MKW Music» в Discord'
    $s.Save()
    Log 'Добавил в автозапуск: теперь статус будет работать сам после включения компьютера.'
  } catch { Log 'Не получилось добавить в автозапуск — ничего страшного, работает и так.' }
}

# ---------- адрес для сайта: 127.0.0.1:47331 ----------
$listener = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $Port)
try { $listener.Start() }
catch {
  Log 'MKW Discord уже запущен (в другом окне или в автозапуске). Это окно можно закрыть.'
  Start-Sleep -Seconds 6
  return
}

# ---------- Discord: локальный канал \\.\pipe\discord-ipc-N ----------
$script:pipe = $null
$script:ready = $false
$script:lastTry = 0
$script:noDiscordSaid = $false

function Write-Frame([int]$op, [string]$json) {
  $b = [Text.Encoding]::UTF8.GetBytes($json)
  $h = New-Object byte[] 8
  [BitConverter]::GetBytes([int32]$op).CopyTo($h, 0)
  [BitConverter]::GetBytes([int32]$b.Length).CopyTo($h, 4)
  $script:pipe.Write($h, 0, 8)
  $script:pipe.Write($b, 0, $b.Length)
  $script:pipe.Flush()
}
function Read-Exact([int]$len, [int]$ms) {
  $b = New-Object byte[] $len
  $n = 0
  while ($n -lt $len) {
    $t = $script:pipe.ReadAsync($b, $n, $len - $n)
    if (-not $t.Wait($ms)) { throw 'timeout' }
    if ($t.Result -le 0) { throw 'closed' }
    $n += $t.Result
  }
  return ,$b
}
function Read-Frame([int]$ms) {
  $h = Read-Exact 8 $ms
  $op = [BitConverter]::ToInt32($h, 0)
  $len = [BitConverter]::ToInt32($h, 4)
  $json = ''
  if ($len -gt 0) { $json = [Text.Encoding]::UTF8.GetString((Read-Exact $len $ms)) }
  return @{ op = $op; json = $json }
}
function Drop-Pipe {
  if ($script:pipe) { try { $script:pipe.Dispose() } catch {} }
  $script:pipe = $null
  $script:ready = $false
}
function Find-Pipes {
  try {
    $names = [IO.Directory]::GetFiles('\\.\pipe\') | ForEach-Object { [IO.Path]::GetFileName($_) } | Where-Object { $_ -match '^discord-ipc-\d$' } | Sort-Object
    if ($names) { return @($names) }
    return @()
  } catch { return @(0..9 | ForEach-Object { "discord-ipc-$_" }) }
}
function Connect-Discord {
  $script:lastTry = NowMs
  foreach ($name in (Find-Pipes)) {
    $p = $null
    try {
      $p = New-Object System.IO.Pipes.NamedPipeClientStream('.', $name, [IO.Pipes.PipeDirection]::InOut, [IO.Pipes.PipeOptions]::Asynchronous)
      $p.Connect(400)
      $script:pipe = $p
      Write-Frame 0 ('{"v":1,"client_id":"' + $AppId + '"}')
      $f = Read-Frame 6000
      if ($f.op -eq 1 -and $f.json -match '"READY"') {
        $script:ready = $true
        $script:noDiscordSaid = $false
        $who = ''
        try { $u = ($f.json | ConvertFrom-Json).data.user; $who = if ($u.global_name) { $u.global_name } else { $u.username } } catch {}
        Log ("Подключено к Discord" + $(if ($who) { " ($who)" } else { '' }) + '. Включите музыку в MKW Music')
        return $true
      }
      Log ('Discord не принял подключение: ' + $f.json)
      Drop-Pipe
    } catch { if ($p) { try { $p.Dispose() } catch {} }; $script:pipe = $null }
  }
  if (-not $script:noDiscordSaid) {
    $script:noDiscordSaid = $true
    Log 'Не вижу Discord. Откройте приложение Discord на компьютере (сайт discord.com не подойдёт).'
    Log 'Если Discord запущен «от имени администратора» — закройте его и откройте обычным способом.'
  }
  return $false
}

# ---------- что показывать ----------
function Cut($s, [int]$n) {
  $s = ([string]$s).Trim()
  if ($s.Length -lt 2) { $s = $s + '  ' }
  if ($s.Length -gt $n) { $s = $s.Substring(0, $n - 1) + '…' }
  return $s
}
function Art($u) {
  $u = [string]$u
  if ($u -notmatch '^https://' -or $u.Length -gt 250) { return 'https://mkwmusic.ru/ic5-512.png' }
  return ($u -replace '/\d+x\d+(bb)?\.(jpg|png|webp)', '/512x512bb.$2')
}
function Activity-Of($np) {
  if (-not $np -or -not $np.title -or $np.on -eq $false) { return $null }
  $state = if ($np.playing) { $np.artist } else { "$($np.artist) · пауза" }
  $album = if ($np.album) { $np.album } else { 'MKW Music' }
  $a = @{
    type = 2
    details = (Cut $np.title 128)
    state = (Cut $state 128)
    assets = @{ large_image = (Art $np.art); large_text = (Cut $album 128); small_image = 'https://mkwmusic.ru/ic5-192.png'; small_text = 'MKW Music' }
    buttons = @(@{ label = 'Слушать в MKW Music'; url = 'https://mkwmusic.ru' })
    instance = $false
  }
  if ($np.playing -and [double]$np.dur -gt 0) {
    $start = [int64]((NowMs) - [double]$np.pos * 1000)
    $a.timestamps = @{ start = $start; end = [int64]($start + [double]$np.dur * 1000) }
  }
  return $a
}
function Sig($a) { if (-not $a) { return 'none' }; $t = if ($a.timestamps) { [math]::Round($a.timestamps.start / 3000) } else { 0 }; return "$($a.details)|$($a.state)|$($a.assets.large_image)|$t" }

$script:want = $null; $script:wantSig = 'none'; $script:shownSig = 'none'; $script:lastSent = 0; $script:lastNp = 0; $script:siteSaid = $false
function Flush-Activity {
  if ($script:wantSig -eq $script:shownSig) { return }
  if ((NowMs) - $script:lastSent -lt 4000) { return } # Discord разрешает не чаще 5 раз в 20 секунд
  if (-not $script:ready) { return }
  try {
    $payload = @{ cmd = 'SET_ACTIVITY'; args = @{ pid = $PID; activity = $script:want }; nonce = [guid]::NewGuid().ToString() }
    Write-Frame 1 ($payload | ConvertTo-Json -Depth 8 -Compress)
    $f = Read-Frame 6000
    $script:lastSent = NowMs
    $script:shownSig = $script:wantSig
    if ($f.json -match '"evt":"ERROR"') { Log ('Discord ответил ошибкой: ' + $f.json) }
    elseif ($script:want) { Log ('Статус: ' + $script:want.details + ' — ' + $script:want.state) }
    else { Log 'Статус очищен' }
  } catch {
    Log 'Discord закрылся — жду, когда откроется снова'
    Drop-Pipe
    $script:shownSig = 'none'
  }
}

# ---------- HTTP ----------
$OriginOk = '^(https://(www\.)?mkwmusic\.ru|https://xn--80adpkcic0dzd\.xn--p1acf|http://(localhost|127\.0\.0\.1)(:\d+)?)$'
function Reply($stream, [int]$code, [string]$status, [string]$origin, [string]$json) {
  $b = [Text.Encoding]::UTF8.GetBytes($json)
  $h = "HTTP/1.1 $code $status`r`nContent-Type: application/json`r`nContent-Length: $($b.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n"
  if ($origin) { $h += "Access-Control-Allow-Origin: $origin`r`nAccess-Control-Allow-Methods: GET, POST, OPTIONS`r`nAccess-Control-Allow-Headers: Content-Type`r`nAccess-Control-Allow-Private-Network: true`r`nAccess-Control-Max-Age: 600`r`nVary: Origin`r`n" }
  $hb = [Text.Encoding]::ASCII.GetBytes($h + "`r`n")
  $stream.Write($hb, 0, $hb.Length)
  if ($b.Length) { $stream.Write($b, 0, $b.Length) }
  $stream.Flush()
}
function Handle($client) {
  $client.ReceiveTimeout = 3000
  $s = $client.GetStream()
  $buf = New-Object byte[] 16384
  $ms = New-Object IO.MemoryStream
  $end = -1; $all = $null; $txt = ''
  while ($end -lt 0) {
    $n = $s.Read($buf, 0, $buf.Length)
    if ($n -le 0) { return }
    $ms.Write($buf, 0, $n)
    if ($ms.Length -gt 60000) { return }
    $all = $ms.ToArray()
    $txt = [Text.Encoding]::ASCII.GetString($all)
    $end = $txt.IndexOf("`r`n`r`n")
  }
  $lines = $txt.Substring(0, $end) -split "`r`n"
  $first = $lines[0] -split ' '
  $method = $first[0]; $path = ($first[1] -split '\?')[0]
  $hd = @{}
  foreach ($ln in ($lines | Select-Object -Skip 1)) { $k = $ln.IndexOf(':'); if ($k -gt 0) { $hd[$ln.Substring(0, $k).Trim().ToLower()] = $ln.Substring($k + 1).Trim() } }
  $origin = [string]$hd['origin']
  if ($origin -and $origin -notmatch $OriginOk) { Reply $s 403 'Forbidden' '' '{"error":"forbidden"}'; return }
  $len = 0; [void][int]::TryParse([string]$hd['content-length'], [ref]$len)
  $start = $end + 4
  while ($all.Length - $start -lt $len) {
    $n = $s.Read($buf, 0, $buf.Length)
    if ($n -le 0) { break }
    $ms.Write($buf, 0, $n); $all = $ms.ToArray()
  }
  if ($method -eq 'OPTIONS') { Reply $s 204 'No Content' $origin ''; return }
  if ($method -eq 'GET' -and $path -eq '/ping') {
    Reply $s 200 'OK' $origin ('{"ok":true,"app":"mkw-discord","v":"' + $MkwVer + '","discord":' + $(if ($script:ready) { 'true' } else { 'false' }) + ',"id":true}')
    return
  }
  if ($method -eq 'POST' -and $path -eq '/np') {
    $body = ''
    if ($len -gt 0) { $body = [Text.Encoding]::UTF8.GetString($all, $start, [Math]::Min($len, $all.Length - $start)) }
    $np = $null
    try { $np = $body | ConvertFrom-Json } catch {}
    $script:lastNp = NowMs
    if (-not $script:siteSaid) { $script:siteSaid = $true; Log ($(if ($script:ready) { 'MKW Music на связи — статус появится, когда заиграет музыка' } else { 'MKW Music на связи. Жду Discord…' })) }
    $script:want = Activity-Of $np
    $script:wantSig = Sig $script:want
    Reply $s 200 'OK' $origin ('{"ok":true,"discord":' + $(if ($script:ready) { 'true' } else { 'false' }) + '}')
    return
  }
  Reply $s 404 'Not Found' $origin '{"error":"not found"}'
}

Log 'Ищу Discord…'
[void](Connect-Discord)
while ($true) {
  try {
    if ($listener.Pending()) {
      $c = $listener.AcceptTcpClient()
      try { Handle $c } catch {} finally { $c.Close() }
      continue
    }
    if (-not $script:ready -and (NowMs) - $script:lastTry -gt 8000) { [void](Connect-Discord) }
    # сайт молчит 3 минуты (закрыли MKW) — убираем статус
    if ($script:want -and $script:lastNp -and (NowMs) - $script:lastNp -gt 180000) { $script:want = $null; $script:wantSig = 'none' }
    Flush-Activity
    Start-Sleep -Milliseconds 150
  } catch { Start-Sleep -Milliseconds 500 }
}
