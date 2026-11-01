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
const PROXY_HOSTS = /(^|\.)(mzstatic\.com|itunes\.apple\.com|dzcdn\.net|deezer\.com)$/i;
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
      return { synced: clean, source: 'NetEase' };
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

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/ping') return new Response(JSON.stringify({ ok: true, proxy: true, lyrics: true }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    if (request.method === 'GET' && path === '/geo') return new Response(JSON.stringify({ country: (request.cf && request.cf.country) || '' }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
    if (request.method === 'GET' && path === '/proxy') return proxy(request, env);
    if (request.method === 'GET' && path === '/lyrics') return lyrics(request);
    if (request.method === 'GET' && path === '/artist') return artist(request);
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
