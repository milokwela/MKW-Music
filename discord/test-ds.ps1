# Проверка помощника MKW Discord на настоящем Windows (GitHub Actions): поддельный Discord + запросы как от сайта.
# push: проверяем локальный ds.ps1. workflow_dispatch: ровно те команды, что пользователь вставляет в Win+R (качают с mkwmusic.ru).
$ErrorActionPreference = 'Stop'
$mode = $env:MKW_MODE
$log = Join-Path $env:RUNNER_TEMP 'fake.log'
Set-Content -Path $log -Value '' -Encoding UTF8

# поддельный Discord: принимает подключения по очереди, отвечает READY и на каждую команду
$fake = Start-Job -ArgumentList $log -ScriptBlock {
  param($log)
  while ($true) {
    $srv = New-Object System.IO.Pipes.NamedPipeServerStream('discord-ipc-0', [IO.Pipes.PipeDirection]::InOut, 1, [IO.Pipes.PipeTransmissionMode]::Byte, [IO.Pipes.PipeOptions]::None)
    $srv.WaitForConnection()
    function RF { $h = New-Object byte[] 8; $n = 0; while ($n -lt 8) { $r = $srv.Read($h, $n, 8 - $n); if ($r -le 0) { return $null }; $n += $r }; $len = [BitConverter]::ToInt32($h, 4); $b = New-Object byte[] $len; $n = 0; while ($n -lt $len) { $r = $srv.Read($b, $n, $len - $n); if ($r -le 0) { return $null }; $n += $r }; [Text.Encoding]::UTF8.GetString($b) }
    function WF($op, $j) { $b = [Text.Encoding]::UTF8.GetBytes($j); $srv.Write([BitConverter]::GetBytes([int32]$op), 0, 4); $srv.Write([BitConverter]::GetBytes([int32]$b.Length), 0, 4); $srv.Write($b, 0, $b.Length); $srv.Flush() }
    try {
      $hs = RF; [IO.File]::AppendAllText($log, "HS $hs`n", [Text.Encoding]::UTF8)
      WF 1 '{"cmd":"DISPATCH","evt":"READY","data":{"user":{"username":"tester","global_name":"Тестер"}}}'
      while ($true) { $m = RF; if ($m -eq $null) { break }; [IO.File]::AppendAllText($log, "FR $m`n", [Text.Encoding]::UTF8); WF 1 '{"cmd":"SET_ACTIVITY","evt":null,"data":{}}' }
    } catch {}
    $srv.Dispose()
  }
}
Start-Sleep -Seconds 2

$h = @{ Origin = 'https://mkwmusic.ru' }
function Np([string]$json) {
  $b = [Text.Encoding]::UTF8.GetBytes($json)
  Invoke-WebRequest -Uri http://127.0.0.1:47331/np -Method Post -Body $b -ContentType 'application/json' -Headers $h -UseBasicParsing
}
function Check-Helper([string]$name, $proc, [string]$out) {
  Set-Content -Path $log -Value '' -Encoding UTF8
  $ok = $false
  for ($i = 0; $i -lt 30; $i++) { try { $ping = Invoke-RestMethod -Uri http://127.0.0.1:47331/ping -Headers $h -TimeoutSec 2; if ($ping.discord) { $ok = $true; break } } catch {}; Start-Sleep -Milliseconds 500 }
  Write-Host "[$name] PING: $($ping | ConvertTo-Json -Compress)"
  $r = Np '{"app":"1566880916784029786","on":true,"title":"распять","artist":"greyrock, tewiq & madk1d","album":"распять","art":"https://is1-ssl.mzstatic.com/image/thumb/Music/v4/aa/100x100bb.jpg","pos":12,"dur":150,"playing":true}'
  Write-Host "[$name] NP: $($r.StatusCode) $($r.Content) ACAO=$($r.Headers['Access-Control-Allow-Origin'])"
  $o = Invoke-WebRequest -Uri http://127.0.0.1:47331/np -Method Options -Headers @{ Origin = 'https://mkwmusic.ru'; 'Access-Control-Request-Private-Network' = 'true' } -UseBasicParsing
  Write-Host "[$name] OPTIONS: $($o.StatusCode) PNA=$($o.Headers['Access-Control-Allow-Private-Network'])"
  $bad = try { (Invoke-WebRequest -Uri http://127.0.0.1:47331/ping -Headers @{ Origin = 'https://evil.example' } -UseBasicParsing).StatusCode } catch { $_.Exception.Response.StatusCode.value__ }
  Write-Host "[$name] EVIL ORIGIN: $bad"
  Start-Sleep -Seconds 5
  Np '{"app":"1566880916784029786","on":true,"title":"распять","artist":"greyrock","pos":20,"dur":150,"playing":false}' | Out-Null
  Start-Sleep -Seconds 6
  Stop-Process -Id $proc.Id -Force
  Start-Sleep -Seconds 1
  Write-Host "--- [$name] помощник:"; if (Test-Path $out) { Get-Content $out -Encoding UTF8 }
  Write-Host "--- [$name] поддельный Discord:"; Get-Content $log -Encoding UTF8
  $t = [IO.File]::ReadAllText($log, [Text.Encoding]::UTF8)
  if ($t -notmatch '"client_id":"1566880916784029786"') { throw "[$name] нет рукопожатия" }
  if ($t -notmatch 'распять' -or $t -notmatch '"type":2') { throw "[$name] статус не дошёл" }
  if ($t -notmatch 'пауза') { throw "[$name] пауза не дошла" }
  if ($bad -ne 403) { throw "[$name] чужой сайт не отклонён" }
  Write-Host "[$name] РАБОТАЕТ" -ForegroundColor Green
}

# 1) PowerShell
$out = Join-Path $env:RUNNER_TEMP 'ps.log'
if ($mode -eq 'workflow_dispatch') {
  $resp = Invoke-WebRequest https://mkwmusic.ru/ds.txt -UseBasicParsing
  Write-Host "ds.txt Content-Type: $($resp.Headers['Content-Type'])"
  $cmd = 'try{[Net.ServicePointManager]::SecurityProtocol=3072}catch{};iex (iwr https://mkwmusic.ru/ds.txt -UseB).Content'
} else {
  $cmd = "iex([IO.File]::ReadAllText('$PWD\discord\ds.ps1',[Text.Encoding]::UTF8))"
}
$p = Start-Process powershell -ArgumentList '-NoProfile', '-Command', $cmd -PassThru -RedirectStandardOutput $out -WindowStyle Hidden
Check-Helper 'PowerShell' $p $out

if ($mode -eq 'workflow_dispatch') {
  # 2) PowerShell, ограниченный Windows (как при «Интеллектуальном управлении приложениями»): должна быть понятная подсказка
  $out2 = Join-Path $env:RUNNER_TEMP 'clm.log'
  $in = Join-Path $env:RUNNER_TEMP 'empty.txt'; Set-Content $in ''
  $env:__PSLockdownPolicy = '4'
  $p2 = Start-Process powershell -ArgumentList '-NoProfile', '-Command', ('$ExecutionContext.SessionState.LanguageMode;' + $cmd) -PassThru -RedirectStandardOutput $out2 -RedirectStandardError ($out2 + '.err') -RedirectStandardInput $in -WindowStyle Hidden
  Remove-Item Env:__PSLockdownPolicy
  Start-Sleep -Seconds 8
  try { Stop-Process -Id $p2.Id -Force } catch {}
  Write-Host '--- [ограниченный PowerShell] вывод:'; Get-Content $out2 -Encoding UTF8; Get-Content ($out2 + '.err') -ErrorAction SilentlyContinue
  $t2 = [IO.File]::ReadAllText($out2, [Text.Encoding]::UTF8)
  if ($t2 -notmatch 'ConstrainedLanguage') { Write-Host 'внимание: режим не включился' }
  elseif ($t2 -notmatch 'ограничил PowerShell') { throw 'в ограниченном режиме нет подсказки' }
  else { Write-Host '[ограниченный PowerShell] ПОДСКАЗКА ПОКАЗАНА' -ForegroundColor Green }

  # 3) Node.js (способ 2)
  $out3 = Join-Path $env:RUNNER_TEMP 'node.log'
  $p3 = Start-Process node -ArgumentList '-e', '"fetch(''https://mkwmusic.ru/mkw-discord.js'').then(r=>r.text()).then(eval)"' -PassThru -RedirectStandardOutput $out3 -WindowStyle Hidden
  Check-Helper 'Node.js' $p3 $out3
}
Write-Host 'ВСЁ РАБОТАЕТ' -ForegroundColor Green
