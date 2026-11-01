// Cloudflare Worker для распознавания музыки (как Shazam). Ключи хранятся ТОЛЬКО здесь, в настройках Cloudflare.
// Settings -> Variables and secrets:
//   ALLOWED_ORIGIN  (Text)    адреса сайта через запятую, например: https://mkwmusic.ru,https://www.mkwmusic.ru
// Вариант 1: ACRCloud (14 дней бесплатно после регистрации на console.acrcloud.com)
//   ACR_HOST    (Text)    например identify-eu-west-1.acrcloud.com
//   ACR_KEY     (Secret)  access_key проекта
//   ACR_SECRET  (Secret)  access_secret проекта
// Вариант 2: AudD (платный после пробного периода)
//   AUDD_TOKEN  (Secret)
// Если заданы ACR_*, используется ACRCloud, иначе AudD. Ответ приводится к одному виду.
// GET /lyrics?artist=&title=&dur=  — тексты песен (NetEase с таймингами, Genius без), кэш на сутки.
// GET /artist?name=  — фото исполнителя и число слушателей (Deezer), кэш на неделю.
const json = (obj, status, cors) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function hmacSha1Base64(secret, data) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
  let s = '';
  sig.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s);
}

async function viaAcr(file, env) {
  const ts = String(Math.floor(Date.now() / 1000));
  const sign = await hmacSha1Base64(env.ACR_SECRET, ['POST', '/v1/identify', env.ACR_KEY, 'audio', '1', ts].join('\n'));
  const out = new FormData();
  out.append('sample', file, 'clip.wav');
  out.append('sample_bytes', String(file.size));
  out.append('access_key', env.ACR_KEY);
  out.append('data_type', 'audio');
  out.append('signature_version', '1');
  out.append('signature', sign);
  out.append('timestamp', ts);
  const res = await fetch(`https://${env.ACR_HOST}/v1/identify`, { method: 'POST', body: out });
  const data = await res.json();
  const code = data.status && data.status.code;
  if (code === 0) {
    const m = data.metadata && data.metadata.music && data.metadata.music[0];
    return { status: 'success', result: m ? { title: m.title, artist: (m.artists || []).map((a) => a.name).join(', ') } : null };
  }
  if (code === 1001) return { status: 'success', result: null };   // песня не найдена
  return { status: 'error', error: { error_message: `ACRCloud ${code}: ${(data.status && data.status.msg) || 'ошибка'}` } };
}

async function viaAudd(file, env) {
  const out = new FormData();
  out.append('api_token', env.AUDD_TOKEN);
  out.append('file', file, 'clip');
  const res = await fetch('https://api.audd.io/', { method: 'POST', body: out });
  return res.json();
}

// Прокси для «Обхода РФ»: только превью и обложки с iTunes и Deezer. Любые другие адреса запрещены.
const PROXY_HOSTS = /(^|\.)(mzstatic\.com|itunes\.apple\.com|dzcdn\.net|deezer\.com|sndcdn\.com)$/i;
async function proxy(request, env) {
  const list = String(env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ref = request.headers.get('Referer') || request.headers.get('Origin') || '';
  const refOk = list.some((o) => ref === o || ref.startsWith(`${o}/`)) || ref.startsWith('http://localhost');
  if (!refOk) return new Response('forbidden', { status: 403 });
  let target;
  try { target = new URL(new URL(request.url).searchParams.get('u') || ''); } catch { return new Response('bad url', { status: 400 }); }
  if (target.protocol !== 'https:' || !PROXY_HOSTS.test(target.hostname)) return new Response('host not allowed', { status: 403 });
  const headers = {};
  const range = request.headers.get('Range');
  if (range) headers.Range = range;
  const up = await fetch(target.toString(), { headers, cf: { cacheEverything: true, cacheTtl: 3600 } });
  const out = new Headers();
  for (const h of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges']) { const v = up.headers.get(h); if (v) out.set(h, v); }
  out.set('Access-Control-Allow-Origin', '*');
  out.set('Cache-Control', 'public, max-age=3600');
  return new Response(up.body, { status: up.status, headers: out });
}


// ---------- Текст песен: NetEase (с таймингами) и Genius (без таймингов) ----------
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TRL = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const nrm = (s) => String(s || '').toLowerCase().replace(/[а-яё]/g, (c) => TRL[c] ?? c).replace(/[^a-z0-9]+/g, '');
const like = (a, b) => { const x = nrm(a), y = nrm(b); return Boolean(x && y && (x === y || x.includes(y) || y.includes(x))); };
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const unent = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m));

async function netease(artist, title, dur) {
  const hdr = { 'User-Agent': UA, Referer: 'https://music.163.com/' };
  const s = await (await fetch(`https://music.163.com/api/search/get/web?type=1&limit=10&s=${encodeURIComponent(`${artist} ${title}`)}`, { headers: hdr })).json();
  const songs = (s && s.result && s.result.songs) || [];
  const ok = songs.filter((x) => like(x.name, title) && (x.artists || []).some((a) => like(a.name, artist)));
  ok.sort((a, b) => Math.abs(a.duration / 1000 - dur) - Math.abs(b.duration / 1000 - dur));
  for (const song of ok.slice(0, 3)) {
    if (dur && Math.abs(song.duration / 1000 - dur) > 15) continue;
    const l = await (await fetch(`https://music.163.com/api/song/lyric?id=${song.id}&lv=1&kv=1&tv=-1`, { headers: hdr })).json();
    const lrc = l && l.lrc && l.lrc.lyric;
    if (lrc && /\[\d+:\d+/.test(lrc) && !/纯音乐|instrumental/i.test(lrc)) {
      // убираем служебные строки «作词/作曲» (автор слов/музыки)
      const clean = lrc.split('\n').filter((x) => !/^\[\d+:\d+(\.\d+)?\]\s*(作词|作曲|编曲|制作|词|曲)\s*[:：]/.test(x)).join('\n');
      return { synced: clean, source: 'NetEase', dur: song.duration / 1000 };
    }
  }
  return null;
}

async function genius(artist, title) {
  const s = await (await fetch(`https://genius.com/api/search/multi?per_page=5&q=${encodeURIComponent(`${artist} ${title}`)}`, { headers: { 'User-Agent': UA } })).json();
  const hits = [];
  for (const sec of (s && s.response && s.response.sections) || []) for (const hit of sec.hits || []) if (hit.type === 'song') hits.push(hit.result);
  const song = hits.find((r) => like(r.title, title) && like(r.primary_artist && r.primary_artist.name, artist));
  if (!song || !song.url) return null;
  const page = await fetch(song.url, { headers: { 'User-Agent': UA } });
  let out = '';
  await new HTMLRewriter()
    .on('div[data-lyrics-container="true"]', { text(t) { out += t.text; } })
    .on('div[data-lyrics-container="true"] br', { element() { out += '\n'; } })
    .on('div[data-lyrics-container="true"] [data-exclude-from-selection="true"]', { element(e) { e.remove(); } })
    .transform(page).text();
  const plain = unent(out).split('\n').map((x) => x.trim()).filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n').trim();
  return plain.length > 20 ? { plain, source: 'Genius' } : null;
}

async function lyrics(request) {
  const u = new URL(request.url);
  const artist = u.searchParams.get('artist') || '', title = u.searchParams.get('title') || '', dur = Number(u.searchParams.get('dur') || 0);
  const head = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=86400' };
  if (!title) return new Response('{}', { status: 400, headers: head });
  const cache = caches.default, key = new Request(`https://lyrics.cache/${encodeURIComponent(`${artist}|${title}|${Math.round(dur / 5)}`)}`);
  const hit = await cache.match(key);
  if (hit) return hit;
  let res = null;
  try { res = await netease(artist, title, dur); } catch { /* дальше */ }
  if (!res) { try { res = await genius(artist, title); } catch { /* дальше */ } }
  const out = new Response(JSON.stringify(res || {}), { headers: head });
  await cache.put(key, out.clone());
  return out;
}

// ---------- Фото исполнителя (Deezer), кэш на неделю ----------
async function artist(request) {
  const name = new URL(request.url).searchParams.get('name') || '';
  const head = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=604800' };
  if (!name) return new Response('{}', { status: 400, headers: head });
  const cache = caches.default, key = new Request(`https://artist.cache/${encodeURIComponent(name.toLowerCase())}`);
  const hit = await cache.match(key);
  if (hit) return hit;
  let res = {};
  try {
    const d = await (await fetch(`https://api.deezer.com/search/artist?limit=5&q=${encodeURIComponent(name)}`, { headers: { 'User-Agent': UA } })).json();
    const list = (d && d.data) || [];
    const a = list.find((x) => nrm(x.name) === nrm(name)) || list.find((x) => like(x.name, name));
    if (a) res = { name: a.name, picture: a.picture_xl || a.picture_big || '', fans: a.nb_fan || 0, albums: a.nb_album || 0, link: a.link || '' };
  } catch { /* пусто */ }
  const out = new Response(JSON.stringify(res), { headers: head });
  await cache.put(key, out.clone());
  return out;
}

// ---------- Полный трек звуком (для фона): ищем рабочее зеркало YouTube ----------
const INV_FALLBACK = ['https://inv.nadeko.net', 'https://invidious.nerdvpn.de', 'https://yewtu.be', 'https://invidious.f5.si', 'https://iv.melmac.space', 'https://invidious.privacyredirect.com', 'https://inv.tux.pizza', 'https://invidious.jing.rocks'];
const PIPED_API = ['https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de', 'https://api.piped.private.coffee'];
async function invInstances() {
  const cache = caches.default, key = new Request('https://yt.cache/instances');
  const hit = await cache.match(key);
  if (hit) return hit.json();
  let list = INV_FALLBACK;
  try {
    const j = await (await fetch('https://api.invidious.io/instances.json?sort_by=health', { headers: { 'User-Agent': UA } })).json();
    const fresh = j.filter(([, i]) => i && i.type === 'https' && i.api && (!i.monitor || !i.monitor.down)).map(([, i]) => i.uri).slice(0, 14);
    if (fresh.length) list = [...new Set([...fresh, ...INV_FALLBACK])];
  } catch { /* берём запасной список */ }
  await cache.put(key, new Response(JSON.stringify(list), { headers: { 'Cache-Control': 'max-age=21600' } }));
  return list;
}
const timed = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);
async function playable(url) {
  const r = await timed(fetch(url, { headers: { Range: 'bytes=0-1', 'User-Agent': UA } }), 5000);
  if (!(r.status === 206 || r.status === 200)) throw new Error(String(r.status));
  return url;
}

// Прямой запрос к плееру YouTube из Worker (клиенты без «подписи» ссылок). Ссылки привязаны к IP Worker,
// поэтому звук отдаём через /ytp (Worker пересылает байты, поддерживает перемотку Range).
const YT_CLIENTS = [
  { name: 'ANDROID_VR', id: 28, version: '1.60.19', ua: 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip', extra: { deviceMake: 'Oculus', deviceModel: 'Quest 3', androidSdkVersion: 32, osName: 'Android', osVersion: '12L' } },
  { name: 'IOS', id: 5, version: '20.10.4', ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)', extra: { deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82' } },
  { name: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', id: 85, version: '2.0', ua: 'Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko)', extra: {}, embed: true },
];
async function innertube(id, origin) {
  for (const c of YT_CLIENTS) {
    try {
      const body = { context: { client: { clientName: c.name, clientVersion: c.version, hl: 'ru', gl: 'US', ...c.extra }, ...(c.embed ? { thirdParty: { embedUrl: 'https://www.youtube.com/' } } : {}) }, videoId: id, contentCheckOk: true, racyCheckOk: true };
      const r = await timed(fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': c.ua, 'X-Youtube-Client-Name': String(c.id), 'X-Youtube-Client-Version': c.version, Origin: 'https://www.youtube.com' }, body: JSON.stringify(body),
      }), 7000);
      const j = await r.json();
      if (!j.playabilityStatus || j.playabilityStatus.status !== 'OK') continue;
      const fm = ((j.streamingData && j.streamingData.adaptiveFormats) || []).filter((f) => f.url && String(f.mimeType || '').startsWith('audio/'));
      if (!fm.length) continue;
      fm.sort((a, b) => ((/mp4/.test(b.mimeType) ? 1e7 : 0) + (b.bitrate || 0)) - ((/mp4/.test(a.mimeType) ? 1e7 : 0) + (a.bitrate || 0)));
      // проверяем, что ссылка правда отдаёт звук (иначе YouTube требует токен — пробуем следующий клиент)
      const t = await timed(fetch(fm[0].url, { headers: { Range: 'bytes=0-1', 'User-Agent': c.ua } }), 5000);
      if (!(t.status === 206 || t.status === 200)) continue;
      return fm.slice(0, 3).map((f) => `${origin}/ytp?c=${encodeURIComponent(c.name)}&u=${encodeURIComponent(f.url)}`);
    } catch { /* следующий клиент */ }
  }
  return [];
}
async function ytProxy(request) {
  const u = new URL(request.url);
  let target;
  try { target = new URL(u.searchParams.get('u') || ''); } catch { return new Response('bad url', { status: 400 }); }
  if (target.protocol !== 'https:' || !/(^|\.)googlevideo\.com$/.test(target.hostname)) return new Response('host not allowed', { status: 403 });
  const c = YT_CLIENTS.find((x) => x.name === u.searchParams.get('c')) || YT_CLIENTS[0];
  const headers = { 'User-Agent': c.ua };
  const range = request.headers.get('Range');
  headers.Range = range || 'bytes=0-';
  const up = await fetch(target.toString(), { headers });
  const out = new Headers();
  for (const h of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges']) { const v = up.headers.get(h); if (v) out.set(h, v); }
  if (!out.get('Accept-Ranges')) out.set('Accept-Ranges', 'bytes');
  out.set('Access-Control-Allow-Origin', '*');
  out.set('Cache-Control', 'private, max-age=3600');
  return new Response(up.body, { status: up.status, headers: out });
}

async function ytAudio(request) {
  const id = new URL(request.url).searchParams.get('id') || '';
  const head = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=1800' };
  if (!/^[\w-]{11}$/.test(id)) return new Response('{}', { status: 400, headers: head });
  const cache = caches.default, key = new Request(`https://yt.cache/a/${id}${new URL(request.url).searchParams.get('mirrors') === '1' ? 'm' : ''}`);
  const hit = await cache.match(key);
  if (hit) return hit;
  const rank = (fm) => fm.sort((a, b) => ((/mp4|m4a/.test(b.t) ? 1e7 : 0) + b.b) - ((/mp4|m4a/.test(a.t) ? 1e7 : 0) + a.b)).map((f) => f.u);
  const inv = (await invInstances()).slice(0, 10).map((inst) => timed((async () => {
    const j = await (await fetch(`${inst}/api/v1/videos/${id}?local=true&fields=adaptiveFormats`, { headers: { 'User-Agent': UA } })).json();
    const fm = (j.adaptiveFormats || []).filter((f) => String(f.type || '').startsWith('audio/') && f.url).map((f) => ({ t: f.type, b: Number(f.bitrate) || 0, u: f.url.startsWith('http') ? f.url : `${inst}${f.url}` }));
    if (!fm.length) throw new Error('нет');
    const urls = rank(fm);
    await playable(urls[0]);
    return urls;
  })(), 9000));
  const piped = PIPED_API.map((api) => timed((async () => {
    const j = await (await fetch(`${api}/streams/${id}`, { headers: { 'User-Agent': UA } })).json();
    const fm = (j.audioStreams || []).filter((f) => f.url).map((f) => ({ t: f.mimeType || '', b: Number(f.bitrate) || 0, u: f.url }));
    if (!fm.length) throw new Error('нет');
    const urls = rank(fm);
    await playable(urls[0]);
    return urls;
  })(), 9000));
  let urls = [];
  const origin = new URL(request.url).origin;
  const onlyMirrors = new URL(request.url).searchParams.get('mirrors') === '1';
  try { urls = await Promise.any([...(onlyMirrors ? [] : [timed(innertube(id, origin).then((l) => { if (!l.length) throw new Error('нет'); return l; }), 15000)]), ...inv, ...piped]); } catch { /* ничего не нашлось */ }
  const out = new Response(JSON.stringify({ urls }), { headers: head });
  if (urls.length) await cache.put(key, out.clone());
  return out;
}


// ---------- SoundCloud: полные треки обычным mp3 (огромный каталог, в т.ч. русский рэп и фонк) ----------
async function scClientId(force) {
  const cache = caches.default, key = new Request('https://sc.cache/cid');
  if (!force) { const hit = await cache.match(key); if (hit) return hit.text(); }
  const html = await (await fetch('https://soundcloud.com/', { headers: { 'User-Agent': UA } })).text();
  const scripts = [...html.matchAll(/<script crossorigin src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map((m) => m[1]).reverse();
  for (const src of scripts.slice(0, 8)) {
    const js = await (await fetch(src, { headers: { 'User-Agent': UA } })).text();
    const m = js.match(/client_id\s*[:=]\s*"([a-zA-Z0-9]{32})"/);
    if (m) { await cache.put(key, new Response(m[1], { headers: { 'Cache-Control': 'max-age=43200' } })); return m[1]; }
  }
  return '';
}
async function soundcloud(artist, title, dur, origin) {
  if (!title) return [];
  let cid = await scClientId();
  if (!cid) return [];
  const q = `${artist} ${title}`.trim();
  let r = await fetch(`https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(q)}&client_id=${cid}&limit=12`, { headers: { 'User-Agent': UA } });
  if (r.status === 401 || r.status === 403) { cid = await scClientId(true); r = await fetch(`https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(q)}&client_id=${cid}&limit=12`, { headers: { 'User-Agent': UA } }); }
  const j = await r.json();
  const bad = /remix|ремикс|cover|кавер|live|slowed|sped|speed up|nightcore|караоке|karaoke|minus|минус|instrumental/i;
  const wantBad = bad.test(title);
  const list = (j.collection || []).filter((t) => t.streamable !== false && t.policy !== 'SNIP' && t.policy !== 'BLOCK' && (t.full_duration || t.duration) > 40000)
    .map((t) => {
      const name = `${t.user && t.user.username} ${t.title}`;
      let sc = (like(t.title, title) ? 3 : 0) + (like(name, artist) ? 2 : 0) + (t.publisher_metadata && like(t.publisher_metadata.artist, artist) ? 2 : 0);
      if (dur) { const d = Math.abs((t.full_duration || t.duration) / 1000 - dur); sc += d < 3 ? 3 : d < 8 ? 1 : d > 25 ? -4 : -1; }
      if (!wantBad && bad.test(t.title)) sc -= 4;
      return { t, sc };
    }).filter((x) => x.sc >= 4).sort((a, b) => b.sc - a.sc);
  for (const { t } of list.slice(0, 3)) {
    const tr = ((t.media && t.media.transcodings) || []).find((x) => x.format && x.format.protocol === 'progressive');
    if (!tr) continue;
    const auth = t.track_authorization ? `&track_authorization=${t.track_authorization}` : '';
    const s = await (await fetch(`${tr.url}?client_id=${cid}${auth}`, { headers: { 'User-Agent': UA } })).json();
    if (s && s.url) return [s.url, `${origin}/proxy?u=${encodeURIComponent(s.url)}`];
  }
  return [];
}

// Всё сразу: YouTube напрямую, SoundCloud, зеркала. Побеждает первый, кто нашёл звук.
async function bgAudio(request) {
  const u = new URL(request.url);
  const id = u.searchParams.get('yt') || '', artist = u.searchParams.get('artist') || '', title = u.searchParams.get('title') || '', dur = Number(u.searchParams.get('dur') || 0);
  const head = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=1800' };
  const cache = caches.default, key = new Request(`https://bg.cache/${encodeURIComponent(`${id}|${artist}|${title}`)}`);
  const hit = await cache.match(key);
  if (hit) return hit;
  const origin = u.origin;
  const tries = [];
  if (/^[\w-]{11}$/.test(id)) {
    tries.push(timed(innertube(id, origin).then((l) => { if (!l.length) throw new Error('нет'); return { urls: l, src: 'youtube' }; }), 15000));
    tries.push(timed(ytAudio(new Request(`${origin}/yt?id=${id}&mirrors=1`)).then((r) => r.json()).then((j) => { if (!j.urls || !j.urls.length) throw new Error('нет'); return { urls: j.urls, src: 'mirror' }; }), 16000));
  }
  tries.push(timed(soundcloud(artist, title, dur, origin).then((l) => { if (!l.length) throw new Error('нет'); return { urls: l, src: 'soundcloud' }; }), 12000));
  let res = { urls: [], src: '' };
  try { res = await Promise.any(tries); } catch { /* ничего не нашлось */ }
  const out = new Response(JSON.stringify(res), { headers: head });
  if (res.urls.length) await cache.put(key, out.clone());
  return out;
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/ping') return new Response(JSON.stringify({ ok: true, proxy: true, lyrics: true, bg: 2 }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    if (request.method === 'GET' && path === '/geo') return new Response(JSON.stringify({ country: (request.cf && request.cf.country) || '' }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
    if (request.method === 'GET' && path === '/proxy') return proxy(request, env);
    if (request.method === 'GET' && path === '/lyrics') return lyrics(request);
    if (request.method === 'GET' && path === '/artist') return artist(request);
    if (request.method === 'GET' && path === '/yt') return ytAudio(request);
    if (request.method === 'GET' && path === '/ytp') return ytProxy(request);
    if (request.method === 'GET' && path === '/bg') return bgAudio(request);
    const origin = request.headers.get('Origin') || '';
    const list = String(env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
    const ok = list.includes(origin) || origin.startsWith('http://localhost');
    const cors = {
      'Access-Control-Allow-Origin': ok ? origin : (list[0] || ''),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST' || !ok) return new Response('forbidden', { status: 403, headers: cors });
    const acr = env.ACR_HOST && env.ACR_KEY && env.ACR_SECRET;
    if (!acr && !env.AUDD_TOKEN) return json({ status: 'error', error: { error_message: 'на сервере не задан ключ' } }, 500, cors);
    if (Number(request.headers.get('Content-Length') || 0) > 8 * 1024 * 1024) return json({ status: 'error', error: { error_message: 'файл слишком большой' } }, 413, cors);

    let incoming;
    try { incoming = await request.formData(); } catch { return new Response('bad form', { status: 400, headers: cors }); }
    const file = incoming.get('file');
    if (!file) return new Response('no file', { status: 400, headers: cors });
    try { return json(acr ? await viaAcr(file, env) : await viaAudd(file, env), 200, cors); }
    catch (e) { return json({ status: 'error', error: { error_message: 'сервис распознавания недоступен' } }, 502, cors); }
  },
};
