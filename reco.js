// Рекомендации на данных Deezer (открытое API, без ключа): популярные треки исполнителя, «радио» похожих песен,
// похожие исполнители, чарт. Если Deezer недоступен напрямую — через сервер MKW.
import { jsonp } from './jsonp.js?v=0.35.1';
import { RECOGNIZE_URL } from './shazam-config.js?v=0.35.1';
import { mapDeezer } from './catalog.js?v=0.35.1';
import { ITUNES_COUNTRIES } from './config.js?v=0.35.1';

const W = () => String(RECOGNIZE_URL || '').replace(/\/$/, '');
const n = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, '');
const mem = new Map();
const LS = 'mkw.reco.v1';
const DAY = 86400000;
let disk = null;
const load = () => { if (!disk) { try { disk = JSON.parse(localStorage.getItem(LS) || '{}'); } catch { disk = {}; } } return disk; };
const save = () => { try { const e = Object.entries(disk).sort((a, b) => b[1].at - a[1].at).slice(0, 220); localStorage.setItem(LS, JSON.stringify(Object.fromEntries(e))); } catch { /* ignore */ } };

// если Deezer не отвечает (бывает без VPN), 10 минут не ждём его зря — сразу через сервер MKW или без него
let directDown = 0, proxyDown = 0;
const DOWN_MS = 600000;
export async function dz(path, ms = 4000) {
  const url = `https://api.deezer.com${path}`;
  if (Date.now() - directDown > DOWN_MS) {
    const d = await jsonp(url, ms).catch(() => null);
    if (d && !d.error) return d;
    if (!d) directDown = Date.now();
  }
  if (W() && Date.now() - proxyDown > DOWN_MS) {
    try {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), 5000);
      const r = await fetch(`${W()}/proxy?u=${encodeURIComponent(url)}`, { signal: c.signal }); clearTimeout(t);
      if (r.ok) { const j = await r.json(); if (j && !j.error) return j; } else proxyDown = Date.now();
    } catch { proxyDown = Date.now(); }
  }
  return null;
}
async function cached(key, ttl, fn) {
  if (mem.has(key)) return mem.get(key);
  const d = load()[key];
  if (d && Date.now() - d.at < ttl) { const p = Promise.resolve(d.v); mem.set(key, p); return p; }
  const p = fn().then((v) => {
    if (v && (!Array.isArray(v) || v.length)) { load()[key] = { v, at: Date.now() }; save(); }
    else setTimeout(() => mem.delete(key), 60000); // не получилось (нет сети) — через минуту попробуем снова
    return v;
  }).catch(() => { setTimeout(() => mem.delete(key), 60000); return null; });
  mem.set(key, p);
  return p;
}
const tracksOf = (d) => ((d && d.data) || []).filter((r) => r && r.id && r.title && r.artist).map(mapDeezer);

// исполнитель Deezer по имени (точное совпадение важнее популярности)
export function dzArtist(name) {
  const k = n(name);
  if (!k) return Promise.resolve(null);
  return cached(`a:${k}`, 14 * DAY, async () => {
    const d = await dz(`/search/artist?limit=6&q=${encodeURIComponent(name)}`);
    const list = (d && d.data) || [];
    const a = list.find((x) => n(x.name) === k) || list.find((x) => n(x.name).startsWith(k) || k.startsWith(n(x.name)));
    return a ? { id: a.id, name: a.name, picture: a.picture_xl || a.picture_big || '', fans: a.nb_fan || 0 } : null;
  });
}
// самые популярные треки исполнителя
export async function artistTop(name, limit = 12) {
  const a = await dzArtist(name);
  if (!a) return [];
  return (await cached(`t:${a.id}`, 3 * DAY, async () => tracksOf(await dz(`/artist/${a.id}/top?limit=25`)))) ?.slice(0, limit) || [];
}
// «радио» исполнителя: песни похожих исполнителей, подобранные Deezer
export async function artistRadio(name) {
  const a = await dzArtist(name);
  if (!a) return [];
  return (await cached(`r:${a.id}`, 1 * DAY, async () => tracksOf(await dz(`/artist/${a.id}/radio?limit=40`)))) || [];
}
// похожие исполнители
export async function relatedArtists(name) {
  const a = await dzArtist(name);
  if (!a) return [];
  return (await cached(`l:${a.id}`, 7 * DAY, async () => ((await dz(`/artist/${a.id}/related?limit=25`)) || { data: [] }).data.map((x) => ({ name: x.name, fans: x.nb_fan || 0, picture: x.picture_xl || '' })))) || [];
}
// чарт
export async function chartTracks() {
  return (await cached('chart', 1 * DAY, async () => tracksOf(await dz('/chart/0/tracks?limit=60')))) || [];
}

// ---------- популярное в жанре (чарты iTunes) — работает и там, где Deezer недоступен ----------
const GENRES = [
  [/hip|rap|рэп|хип|trap|drill|phonk|фонк/i, 18], [/r&b|rnb|soul/i, 15], [/k-?pop/i, 51], [/dance|танц/i, 17],
  [/electr|house|techno|edm|электр/i, 7], [/metal|метал/i, 1153], [/alternative|indie|альтерн|инди/i, 20],
  [/rock|рок/i, 21], [/latin/i, 12], [/jazz|джаз/i, 11], [/classical|класс/i, 5], [/soundtrack|саундтр/i, 16],
  [/reggae/i, 24], [/country/i, 6], [/pop|поп/i, 14],
];
export const genreId = (name) => { for (const [re, id] of GENRES) if (re.test(String(name || ''))) return id; return 0; };
async function getJson(url) {
  try { const c = new AbortController(); const t = setTimeout(() => c.abort(), 6000); const r = await fetch(url, { signal: c.signal }); clearTimeout(t); if (r.ok) return await r.json(); } catch { /* без CORS или нет сети */ }
  if (!W()) return null;
  try { const c = new AbortController(); const t = setTimeout(() => c.abort(), 7000); const r = await fetch(`${W()}/proxy?u=${encodeURIComponent(url)}`, { signal: c.signal }); clearTimeout(t); if (r.ok) return await r.json(); } catch { /* ignore */ }
  return null;
}
const lbl = (x) => (x && x.label) || '';
export async function genreChart(gid, country) {
  const cc = String(country || ITUNES_COUNTRIES[0] || 'US').toLowerCase();
  return (await cached(`g:${cc}:${gid}`, 1 * DAY, async () => {
    const d = await getJson(`https://itunes.apple.com/${cc}/rss/topsongs/limit=60${gid ? `/genre=${gid}` : ''}/json`);
    const list = (d && d.feed && d.feed.entry) || [];
    return list.map((e) => {
      const id = e.id && e.id.attributes && e.id.attributes['im:id'];
      const links = Array.isArray(e.link) ? e.link : [e.link];
      const prev = links.find((l) => l && l.attributes && /audio/.test(l.attributes.type || ''));
      const imgs = e['im:image'] || [];
      return id ? {
        id: String(id), title: lbl(e['im:name']), artist: lbl(e['im:artist']), album: lbl(e['im:collection'] && e['im:collection']['im:name']),
        artwork: String(lbl(imgs[imgs.length - 1]) || '').replace(/\/\d+x\d+bb\./, '/100x100bb.'), previewUrl: (prev && prev.attributes.href) || '',
        duration: Math.round((Number(prev && prev.attributes['im:duration'] && prev.attributes['im:duration'].label) || 0) / 1000),
        genre: (e.category && e.category.attributes && e.category.attributes.label) || '', year: String(lbl(e['im:releaseDate'])).slice(0, 4),
      } : null;
    }).filter((t) => t && t.title && t.artist);
  })) || [];
}
