# Проверка помощника MKW Discord: поддельный Discord + запросы как от сайта (запускается в GitHub Actions на Windows)
$ErrorActionPreference = 'Stop'
$log = Join-Path $env:RUNNER_TEMP 'fake.log'
$fake = Start-Job -ArgumentList $log -ScriptBlock {
  param($log)
  $srv = New-Object System.IO.Pipes.NamedPipeServerStream('discord-ipc-0', [IO.Pipes.PipeDirection]::InOut, 1, [IO.Pipes.PipeTransmissionMode]::Byte, [IO.Pipes.PipeOptions]::None)
  $srv.WaitForConnection()
  function RF { $h = New-Object byte[] 8; $n = 0; while ($n -lt 8) { $r = $srv.Read($h, $n, 8 - $n); if ($r -le 0) { return $null }; $n += $r }; $len = [BitConverter]::ToInt32($h, 4); $b = New-Object byte[] $len; $n = 0; while ($n -lt $len) { $r = $srv.Read($b, $n, $len - $n); if ($r -le 0) { return $null }; $n += $r }; [Text.Encoding]::UTF8.GetString($b) }
  function WF($op, $j) { $b = [Text.Encoding]::UTF8.GetBytes($j); $srv.Write([BitConverter]::GetBytes([int32]$op), 0, 4); $srv.Write([BitConverter]::GetBytes([int32]$b.Length), 0, 4); $srv.Write($b, 0, $b.Length); $srv.Flush() }
  $hs = RF; [IO.File]::AppendAllText($log, "HS $hs`n", [Text.Encoding]::UTF8)
  WF 1 '{"cmd":"DISPATCH","evt":"READY","data":{"user":{"username":"tester","global_name":"Тестер"}}}'
  while ($true) { $m = RF; if ($m -eq $null) { break }; [IO.File]::AppendAllText($log, "FR $m`n", [Text.Encoding]::UTF8); WF 1 '{"cmd":"SET_ACTIVITY","evt":null,"data":{}}' }
}
Start-Sleep -Seconds 2
$out = Join-Path $env:RUNNER_TEMP 'helper.log'
$mode = $env:MKW_MODE
if ($mode -eq 'workflow_dispatch') {
  # как у пользователя: Win+R → команда с сайта (скрипт качается с mkwmusic.ru)
  $cmd = '[Net.ServicePointManager]::SecurityProtocol=3072;iex([Text.Encoding]::UTF8.GetString((iwr https://mkwmusic.ru/ds.ps1 -UseB).RawContentStream.ToArray()))'
} else {
  $cmd = "iex([IO.File]::ReadAllText('$PWD\discord\ds.ps1',[Text.Encoding]::UTF8))"
}
$p = Start-Process powershell -ArgumentList '-NoProfile', '-Command', $cmd -PassThru -RedirectStandardOutput $out -WindowStyle Hidden
Start-Sleep -Seconds 6
$h = @{ Origin = 'https://mkwmusic.ru' }
$ping = Invoke-RestMethod -Uri http://127.0.0.1:47331/ping -Headers $h
Write-Host "PING: $($ping | ConvertTo-Json -Compress)"
$body = [Text.Encoding]::UTF8.GetBytes('{"app":"1566880916784029786","on":true,"title":"распять","artist":"greyrock, tewiq & madk1d","album":"распять","art":"https://is1-ssl.mzstatic.com/image/thumb/Music/v4/aa/100x100bb.jpg","pos":12,"dur":150,"playing":true}')
$r = Invoke-WebRequest -Uri http://127.0.0.1:47331/np -Method Post -Body $body -ContentType 'application/json' -Headers $h -UseBasicParsing
Write-Host "NP: $($r.StatusCode) $($r.Content) ACAO=$($r.Headers['Access-Control-Allow-Origin'])"
$o = Invoke-WebRequest -Uri http://127.0.0.1:47331/np -Method Options -Headers @{ Origin = 'https://mkwmusic.ru'; 'Access-Control-Request-Private-Network' = 'true' } -UseBasicParsing
Write-Host "OPTIONS: $($o.StatusCode) PNA=$($o.Headers['Access-Control-Allow-Private-Network'])"
$bad = try { (Invoke-WebRequest -Uri http://127.0.0.1:47331/ping -Headers @{ Origin = 'https://evil.example' } -UseBasicParsing).StatusCode } catch { $_.Exception.Response.StatusCode.value__ }
Write-Host "EVIL ORIGIN: $bad"
Start-Sleep -Seconds 3
$body2 = [Text.Encoding]::UTF8.GetBytes('{"app":"1566880916784029786","on":true,"title":"распять","artist":"greyrock","pos":20,"dur":150,"playing":false}')
Invoke-WebRequest -Uri http://127.0.0.1:47331/np -Method Post -Body $body2 -ContentType 'application/json' -Headers $h -UseBasicParsing | Out-Null
Start-Sleep -Seconds 6
Stop-Process -Id $p.Id -Force
Write-Host '--- помощник:'; Get-Content $out -Encoding UTF8
Write-Host '--- поддельный Discord:'; Get-Content $log -Encoding UTF8
$t = [IO.File]::ReadAllText($log, [Text.Encoding]::UTF8)
if ($t -notmatch '"client_id":"1566880916784029786"') { throw 'нет рукопожатия' }
if ($t -notmatch 'распять' -or $t -notmatch '"type":2') { throw 'статус не дошёл' }
if ($t -notmatch 'пауза') { throw 'пауза не дошла' }
Write-Host 'ВСЁ РАБОТАЕТ'
