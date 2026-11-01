// Полный трек обычным аудиопотоком вместо видеоплеера YouTube.
// Зачем: видео браузер ставит на паузу, когда экран выключен или приложение свёрнуто, а обычный звук играет дальше.
// Откуда: ваш Cloudflare Worker (/bg: YouTube напрямую, SoundCloud, зеркала) и открытые зеркала YouTube (Invidious, Piped).
import { RECOGNIZE_URL } from './shazam-config.js?v=0.22.1';

const KEY = 'mkw.bgplay'; // «Слушать в фоне с выключенным экраном» — бета, по умолчанию выключено
const GKEY = 'mkw.stream.good';
const INV = [
  'https://inv.nadeko.net', 'https://invidious.nerdvpn.de', 'https://yewtu.be', 'https://invidious.f5.si',
  'https://iv.melmac.space', 'https://invidious.privacyredirect.com', 'https://inv.tux.pizza', 'https://invidious.jing.rocks',
  'https://yt.artemislena.eu', 'https://invidious.materialio.us', 'https://iv.datura.network', 'https://invidious.reallyaweso.me',
];
const PIPED = ['https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de', 'https://api.piped.private.coffee', 'https://pipedapi.reallyaweso.me'];

const memo = new Map();   // id видео → Promise<string[]>
const meta = new Map();   // ссылка → { src, label, id } — откуда звук и что за запись
const done = new Map();   // id видео → string[] (уже найдено)
let lastOk = (() => { try { return localStorage.getItem(GKEY) || ''; } catch { return ''; } })();

export const streamsOn = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
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
  return { urls: rank(fm), src: inst, label: 'зеркало YouTube', id: `yt${vid}` };
}

async function fromPiped(api, vid) {
  const j = await getJson(`${api}/streams/${vid}`, 7000);
  const fm = (j.audioStreams || []).filter((f) => f.url).map((f) => ({ type: f.mimeType || '', bitrate: f.bitrate, url: f.url }));
  if (!fm.length) throw new Error('нет звука');
  return { urls: rank(fm), src: api, label: 'зеркало YouTube', id: `yt${vid}` };
}

const W = () => RECOGNIZE_URL.replace(/\/$/, '');
// Worker ищет сразу везде: YouTube напрямую, SoundCloud, зеркала. Старый Worker без /bg — пробуем /yt.
async function fromWorker(vid, t) {
  if (!RECOGNIZE_URL) throw new Error('нет Worker');
  const q = new URLSearchParams({ yt: vid || '', artist: (t && t.artist) || '', title: (t && t.title) || '', dur: String(Math.round((t && t.duration) || 0)) });
  let j = null;
  try { j = await getJson(`${W()}/bg?${q}`, 17000); } catch (e) {
    if (!vid) throw e;
    j = await getJson(`${W()}/yt?id=${encodeURIComponent(vid)}`, 12000);
    if (j) j.src = 'mirror';
  }
  if (!j || !Array.isArray(j.urls) || !j.urls.length) throw new Error('пусто');
  // новый Worker отдаёт несколько кандидатов с уверенностью; убираем те, что вы пометили «не та песня»
  const bad = new Set(wrongFor(t && t.id));
  const cands = (Array.isArray(j.cands) && j.cands.length ? j.cands : [{ urls: j.urls, src: j.src || 'worker', label: '', id: j.src || 'w' }]).filter((c) => !bad.has(c.id));
  if (!cands.length) throw new Error('все варианты отклонены');
  const urls = [];
  for (const c of cands) for (const u of c.urls) { urls.push(u); meta.set(u, { src: c.src, label: c.label || '', id: c.id }); }
  return { urls, src: cands[0].src, label: cands[0].label, id: cands[0].id, worker: true };
}

// «Не та песня»: запоминаем отклонённую запись для этого трека
const WKEY = 'mkw.bg.wrong';
const wrongAll = () => { try { return JSON.parse(localStorage.getItem(WKEY) || '{}'); } catch { return {}; } };
const wrongFor = (tid) => (tid && wrongAll()[tid]) || [];
export const streamInfo = (url) => meta.get(url) || null;
export function markWrong(tid, vid, url) {
  const m = meta.get(url);
  const cid = m ? m.id : url;
  if (tid) { const all = wrongAll(); all[tid] = [...new Set([...(all[tid] || []), cid])].slice(-10); try { localStorage.setItem(WKEY, JSON.stringify(all)); } catch { /* ignore */ } }
  const l = done.get(vid) || [];
  const rest = l.filter((u) => (meta.get(u) ? meta.get(u).id !== cid : u !== url));
  if (rest.length) done.set(vid, rest); else done.delete(vid);
  return rest;
}

// Список ссылок на звук (лучшая первой) или null. Повторные вызовы для одного видео не делают новых запросов.
export const streamSource = new Map(); // id видео → откуда звук (youtube / soundcloud / mirror)
export function resolveStream(vid, t, force) {
  if (!vid || (!streamsOn() && !force)) return Promise.resolve(null);
  if (done.has(vid)) return Promise.resolve(done.get(vid));
  if (memo.has(vid)) return memo.get(vid);
  const inv = [...INV].sort((a, b) => (b === lastOk) - (a === lastOk) || Math.random() - 0.5);
  const isYt = /^[\w-]{11}$/.test(vid); // «sc:…» — трека нет на YouTube, ищем по названию (SoundCloud)
  const tries = [fromWorker(isYt ? vid : '', t), ...(isYt ? [...inv.slice(0, 7).map((i) => fromInvidious(i, vid)), ...PIPED.map((p) => fromPiped(p, vid))] : [])];
  const p = Promise.any(tries).then((r) => {
    if (!r.worker) for (const u of r.urls) meta.set(u, { src: 'mirror', label: r.label || 'зеркало YouTube', id: r.id || `yt${vid}` });
    done.set(vid, r.urls);
    streamSource.set(vid, /^https?:/.test(r.src) ? 'mirror' : r.src);
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

// Проверка «работает ли фон у меня»: что доступно с этого телефона и этой сети
export async function checkBackground(vid, t) {
  const out = [];
  const add = (ok, text) => out.push({ ok, text });
  if (!RECOGNIZE_URL) add(false, 'Сервер MKW (Worker) не указан');
  else {
    try {
      const p = await getJson(`${W()}/ping`, 7000);
      add(true, 'Сервер MKW доступен');
      add(Boolean(p && p.bg >= 3), p && p.bg >= 3 ? 'Сервер обновлён (YouTube, SoundCloud, Audius, точная сверка версии)' : 'Сервер старый: вставьте новый recognize-worker.js в Cloudflare и нажмите Deploy');
    } catch { add(false, 'Сервер MKW недоступен из этой сети (включите VPN)'); }
  }
  const t0 = performance.now();
  const urls = await Promise.race([resolveStream(vid, t, true), new Promise((r) => setTimeout(() => r(null), 20000))]);
  if (urls && urls.length) {
    const m = meta.get(urls[0]) || {};
    const names = { youtube: 'YouTube', soundcloud: 'SoundCloud', audius: 'Audius', cobalt: 'YouTube через cobalt', mirror: 'зеркало YouTube' };
    add(true, `Звук найден за ${((performance.now() - t0) / 1000).toFixed(1)} с: ${names[m.src] || 'зеркало YouTube'}${m.label && m.src !== 'youtube' ? ` · ${m.label}` : ''}`);
    const ok = await new Promise((res) => {
      const a = new Audio(); a.muted = true; a.preload = 'auto';
      const end = (v) => { clearTimeout(tm); a.src = ''; res(v); };
      const tm = setTimeout(() => end(false), 12000);
      a.addEventListener('canplay', () => end(true), { once: true });
      a.addEventListener('error', () => end(false), { once: true });
      a.src = urls[0];
    });
    add(ok, ok ? 'Телефон может играть этот звук — фон должен работать' : 'Звук нашёлся, но не открывается в этой сети (попробуйте с VPN)');
  } else add(false, 'Звук для этого трека не нашёлся ни на одном источнике');
  return out;
}
