// Фото исполнителя: Deezer напрямую, потом через ваш Worker, потом Википедия. Кэш в браузере на 2 недели.
import { RECOGNIZE_URL } from './shazam-config.js?v=0.22.1';

const KEY = 'mkw.artistpic.v2';
const TTL = 14 * 86400000;
const mem = new Map();
let store = null;
const load = () => { if (!store) { try { store = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { store = {}; } } return store; };
const save = () => { try { const e = Object.entries(store).sort((a, b) => b[1].at - a[1].at).slice(0, 300); localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(e))); } catch { /* ignore */ } };
const n = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, '');

async function getJson(url, ms = 7000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal }); return r.ok ? await r.json() : null; } catch { return null; } finally { clearTimeout(t); }
}

import { jsonp } from './jsonp.js?v=0.22.1';

async function fetchInfo(name) {
  const d = await jsonp(`https://api.deezer.com/search/artist?limit=5&q=${encodeURIComponent(name)}`);
  const list = (d && d.data) || [];
  const a = list.find((x) => n(x.name) === n(name)) || list.find((x) => n(x.name).includes(n(name)) || n(name).includes(n(x.name)));
  if (a && a.picture_xl && !/\/artist\/\//.test(a.picture_xl)) return { picture: a.picture_xl, fans: a.nb_fan || 0, albums: a.nb_album || 0 };
  if (RECOGNIZE_URL) {
    const w = await getJson(`${RECOGNIZE_URL.replace(/\/$/, '')}/artist?name=${encodeURIComponent(name)}`);
    if (w && w.picture && !/\/artist\/\//.test(w.picture)) return { picture: w.picture, fans: w.fans || 0, albums: w.albums || 0 };
  }
  return null;
}

// { picture, fans, albums } или null
export function artistPic(name) {
  const k = n(name);
  if (!k) return Promise.resolve(null);
  if (mem.has(k)) return mem.get(k);
  const s = load()[k];
  if (s && Date.now() - s.at < TTL) { const p = Promise.resolve(s.v); mem.set(k, p); return p; }
  const p = fetchInfo(name).then((v) => { load()[k] = { v, at: Date.now() }; save(); return v; });
  mem.set(k, p);
  return p;
}
