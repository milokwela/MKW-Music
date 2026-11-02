// MKW Discord — помощник, который показывает в Discord «Слушает MKW Music»:
// название трека, исполнителя, обложку и сколько осталось, как у Яндекс Музыки и Spotify.
//
// Как работает: сайт MKW Music (mkwmusic.ru) отправляет сюда, на ваш же компьютер (127.0.0.1:47331), что сейчас играет,
// а помощник передаёт это в приложение Discord через его официальный локальный канал (Rich Presence).
// Никуда в интернет помощник ничего не отправляет и ничего не хранит.
//
// Запуск: MKW-Discord.exe (Windows) или `node mkw-discord.js` (macOS, Linux). Discord должен быть открыт.
'use strict';
const net = require('net');
const http = require('http');
const path = require('path');

const VERSION = '1.0.0';
const PORT = 47331;
const ORIGINS = /^(https:\/\/(www\.)?mkwmusic\.ru|https:\/\/xn--80adpkcic0dzd\.xn--p1acf|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;
let clientId = process.env.MKW_DISCORD_ID || '';

// ---------- Discord: локальный канал (named pipe на Windows, сокет на macOS/Linux) ----------
function pipePaths() {
  const out = [];
  for (let i = 0; i < 10; i++) {
    if (process.platform === 'win32') { out.push(`\\\\?\\pipe\\discord-ipc-${i}`); continue; }
    const base = (process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp').replace(/\/$/, '');
    out.push(path.join(base, `discord-ipc-${i}`));
    out.push(path.join(base, 'app', 'com.discordapp.Discord', `discord-ipc-${i}`)); // Flatpak
    out.push(path.join(base, 'snap.discord', `discord-ipc-${i}`)); // Snap
  }
  return out;
}

let sock = null, ready = false, connecting = false, buf = Buffer.alloc(0), timer = null;
let want = null, shown = null, lastSent = 0, sendTimer = null;

function frame(op, obj) {
  const data = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(8);
  head.writeUInt32LE(op, 0); head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data]);
}
function log(...a) { const t = new Date().toLocaleTimeString('ru-RU'); console.log(`[${t}]`, ...a); }

function connect() {
  if (sock || connecting || !clientId) return;
  connecting = true;
  const paths = pipePaths();
  let i = 0;
  const tryNext = () => {
    if (i >= paths.length) { connecting = false; retry(); return; }
    const p = paths[i++];
    const s = net.createConnection(p);
    s.once('connect', () => {
      connecting = false; sock = s; buf = Buffer.alloc(0);
      s.write(frame(0, { v: 1, client_id: clientId }));
      s.on('data', onData);
      s.on('close', () => { if (ready) log('Discord закрылся — жду, когда откроется снова'); sock = null; ready = false; shown = null; retry(); });
      s.on('error', () => {});
    });
    s.once('error', () => { s.destroy(); tryNext(); });
  };
  tryNext();
}
function retry() { clearTimeout(timer); timer = setTimeout(connect, 5000); }

function onData(chunk) {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 8) {
    const op = buf.readUInt32LE(0), len = buf.readUInt32LE(4);
    if (buf.length < 8 + len) break;
    let msg = {};
    try { msg = JSON.parse(buf.slice(8, 8 + len).toString('utf8')); } catch { /* ignore */ }
    buf = buf.slice(8 + len);
    if (op === 1 && msg.evt === 'READY') {
      ready = true;
      const u = msg.data && msg.data.user;
      log(`Подключено к Discord${u ? ` (${u.global_name || u.username})` : ''}. Включите музыку в MKW Music`);
      schedule();
    } else if (op === 1 && msg.evt === 'ERROR') {
      log('Discord ответил ошибкой:', (msg.data && msg.data.message) || '');
    } else if (op === 2) {
      log('Discord отклонил подключение:', msg.message || '', '— проверьте Application ID');
      try { sock.destroy(); } catch { /* ignore */ }
    } else if (op === 3) {
      try { sock.write(frame(4, msg)); } catch { /* ignore */ } // ping → pong
    }
  }
}

// ---------- что показывать ----------
const cut = (s, n) => { s = String(s || '').trim(); if (s.length < 2) s = `${s}  `; return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
function bigArt(url) {
  url = String(url || '');
  if (!/^https:\/\//.test(url) || url.length > 250) return 'https://mkwmusic.ru/ic5-512.png';
  return url.replace(/\/\d+x\d+(bb)?\.(jpg|png|webp)/, '/512x512bb.$2'); // обложки iTunes — в хорошем качестве
}
function activityOf(np) {
  if (!np || !np.title) return null;
  const a = {
    type: 2, // «Слушает»
    status_display_type: 0,
    details: cut(np.title, 128),
    state: cut(np.playing ? np.artist : `${np.artist || ''} · пауза`, 128),
    assets: { large_image: bigArt(np.art), large_text: cut(np.album || 'MKW Music', 128), small_image: 'https://mkwmusic.ru/ic5-192.png', small_text: 'MKW Music' },
    buttons: [{ label: 'Слушать в MKW Music', url: 'https://mkwmusic.ru' }],
    instance: false,
  };
  if (np.playing && np.dur > 0) {
    const start = Date.now() - Math.max(0, np.pos || 0) * 1000;
    a.timestamps = { start: Math.round(start), end: Math.round(start + np.dur * 1000) };
  }
  return a;
}
const sameAs = (a, b) => {
  if (!a || !b) return a === b;
  const ta = a.timestamps ? a.timestamps.start : 0, tb = b.timestamps ? b.timestamps.start : 0;
  return a.details === b.details && a.state === b.state && a.assets.large_image === b.assets.large_image && Math.abs(ta - tb) < 3000;
};
// Discord разрешает менять статус не чаще 5 раз в 20 секунд — собираем изменения
function schedule() {
  clearTimeout(sendTimer);
  const wait = Math.max(0, 4000 - (Date.now() - lastSent));
  sendTimer = setTimeout(flush, wait);
}
function flush() {
  if (!ready || !sock) { connect(); return; }
  if (sameAs(want, shown)) return;
  lastSent = Date.now();
  shown = want;
  sock.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: want }, nonce: `${Date.now()}-${Math.random()}` }));
  log(want ? `Статус: ${want.details} — ${want.state}` : 'Статус очищен');
}

// ---------- локальный адрес для сайта ----------
let pauseTimer = null;
const server = http.createServer((req, res) => {
  const origin = req.headers.origin || '';
  const ok = !origin || ORIGINS.test(origin);
  const head = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (origin && ok) Object.assign(head, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '600' });
  if (!ok) { res.writeHead(403, head); res.end('{"error":"forbidden"}'); return; }
  if (req.method === 'OPTIONS') { res.writeHead(204, head); res.end(); return; }
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/ping') { res.writeHead(200, head); res.end(JSON.stringify({ ok: true, app: 'mkw-discord', v: VERSION, discord: ready, id: Boolean(clientId) })); return; }
  if (req.method === 'POST' && url.pathname === '/np') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 20000) req.destroy(); });
    req.on('end', () => {
      let np = null;
      try { np = JSON.parse(body || 'null'); } catch { /* ignore */ }
      if (np && /^\d{15,22}$/.test(String(np.app || '')) && np.app !== clientId) {
        clientId = String(np.app); shown = null;
        if (sock) { try { sock.destroy(); } catch { /* ignore */ } } else connect();
      }
      clearTimeout(pauseTimer);
      want = np && np.title && np.on !== false ? activityOf(np) : null;
      // на паузе больше 5 минут — убираем статус совсем
      if (np && np.title && !np.playing) pauseTimer = setTimeout(() => { want = null; schedule(); }, 5 * 60000);
      schedule();
      res.writeHead(200, head); res.end(JSON.stringify({ ok: true, discord: ready }));
    });
    return;
  }
  res.writeHead(404, head); res.end('{"error":"not found"}');
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { log('MKW Discord уже запущен в другом окне. Это окно можно закрыть.'); setTimeout(() => process.exit(0), 8000); }
  else log('Ошибка:', e.message);
});
server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  MKW Discord', VERSION);
  console.log('  Показывает в Discord «Слушает MKW Music» — трек, исполнителя, обложку и время.');
  console.log('');
  console.log('  1. Откройте Discord');
  console.log('  2. Откройте mkwmusic.ru → Профиль → Настройки → «Статус в Discord» и включите');
  console.log('  3. Это окно можно свернуть. Закроете его — статус пропадёт');
  console.log('');
  if (clientId) connect(); else log('Жду, когда откроется MKW Music…');
});
setInterval(() => { if (!sock && clientId) connect(); }, 15000);
process.on('SIGINT', () => process.exit(0));
