// Полный трек обычным аудиопотоком вместо видеоплеера YouTube.
// Зачем: видео браузер ставит на паузу, когда экран выключен или приложение свёрнуто, а обычный звук играет дальше.
// Откуда: открытые зеркала YouTube (Invidious, Piped) — напрямую и через ваш Cloudflare Worker (/yt).
import { RECOGNIZE_URL } from './shazam-config.js?v=0.19.0';

const KEY = 'mkw.stream';
const GKEY = 'mkw.stream.good';
const INV = [
  'https://inv.nadeko.net', 'https://invidious.nerdvpn.de', 'https://yewtu.be', 'https://invidious.f5.si',
  'https://iv.melmac.space', 'https://invidious.privacyredirect.com', 'https://inv.tux.pizza', 'https://invidious.jing.rocks',
  'https://yt.artemislena.eu', 'https://invidious.materialio.us', 'https://iv.datura.network', 'https://invidious.reallyaweso.me',
];
const PIPED = ['https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de', 'https://api.piped.private.coffee', 'https://pipedapi.reallyaweso.me'];

const memo = new Map();   // id видео → Promise<string[]>
const done = new Map();   // id видео → string[] (уже найдено)
let lastOk = (() => { try { return localStorage.getItem(GKEY) || ''; } catch { return ''; } })();

export const streamsOn = () => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } };
export function setStreams(v) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ } }
export const peekStream = (vid) => done.get(vid) || null;

async function getJson(url, ms) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal }); if (!r.ok) throw new Error(String(r.status)); return await r.json(); }
  finally { clearTimeout(t); }
}

// Сначала m4a (играет везде, включая iPhone), потом opus/webm; внутри — по битрейту
function rank(list) {
  const score = (f) => (/mp4|m4a/.test(f.type) ? 1e7 : 0) + (Number(f.bitrate) || 0);
  return list.sort((a, b) => score(b) - score(a)).map((f) => f.url);
}

async function fromInvidious(inst, vid) {
  const j = await getJson(`${inst}/api/v1/videos/${vid}?local=true&fields=adaptiveFormats`, 7000);
  const fm = (j.adaptiveFormats || []).filter((f) => String(f.type || '').startsWith('audio/') && f.url)
    .map((f) => ({ type: f.type, bitrate: f.bitrate, url: f.url.startsWith('http') ? f.url : `${inst}${f.url}` }));
  if (!fm.length) throw new Error('нет звука');
  return { urls: rank(fm), src: inst };
}

async function fromPiped(api, vid) {
  const j = await getJson(`${api}/streams/${vid}`, 7000);
  const fm = (j.audioStreams || []).filter((f) => f.url).map((f) => ({ type: f.mimeType || '', bitrate: f.bitrate, url: f.url }));
  if (!fm.length) throw new Error('нет звука');
  return { urls: rank(fm), src: api };
}

async function fromWorker(vid) {
  if (!RECOGNIZE_URL) throw new Error('нет Worker');
  const j = await getJson(`${RECOGNIZE_URL.replace(/\/$/, '')}/yt?id=${encodeURIComponent(vid)}`, 9000);
  if (!j || !Array.isArray(j.urls) || !j.urls.length) throw new Error('пусто');
  return { urls: j.urls, src: 'worker' };
}

// Список ссылок на звук (лучшая первой) или null. Повторные вызовы для одного видео не делают новых запросов.
export function resolveStream(vid) {
  if (!vid || !streamsOn()) return Promise.resolve(null);
  if (done.has(vid)) return Promise.resolve(done.get(vid));
  if (memo.has(vid)) return memo.get(vid);
  const inv = [...INV].sort((a, b) => (b === lastOk) - (a === lastOk) || Math.random() - 0.5);
  const tries = [fromWorker(vid), ...inv.slice(0, 7).map((i) => fromInvidious(i, vid)), ...PIPED.map((p) => fromPiped(p, vid))];
  const p = Promise.any(tries).then((r) => {
    done.set(vid, r.urls);
    if (r.src !== 'worker') { lastOk = r.src; try { localStorage.setItem(GKEY, r.src); } catch { /* ignore */ } }
    if (done.size > 60) done.delete(done.keys().next().value);
    return r.urls;
  }).catch(() => null).finally(() => memo.delete(vid));
  memo.set(vid, p);
  return p;
}

export function dropStream(vid, url) {
  const l = done.get(vid);
  if (!l) return;
  const rest = l.filter((u) => u !== url);
  if (rest.length) done.set(vid, rest); else done.delete(vid);
}
