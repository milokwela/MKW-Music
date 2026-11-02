// Поиск видео на YouTube для трека и загрузка IFrame Player API.
import { db } from './firebase.js?v=0.27.1';
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { YOUTUBE_API_KEY } from './config.js?v=0.27.1';
import { RECOGNIZE_URL } from './shazam-config.js?v=0.27.1';

// Полные треки ищем без ключа и без дневного лимита: через сервер MKW (Worker) и открытые зеркала YouTube.
// Ключ YouTube Data API — запасной путь, если всё остальное недоступно.
export const youtubeEnabled = () => true;
const WK = () => String(RECOGNIZE_URL || '').replace(/\/$/, '');
const MIRRORS = ['https://inv.nadeko.net', 'https://invidious.nerdvpn.de', 'https://yewtu.be', 'https://invidious.f5.si', 'https://iv.melmac.space', 'https://inv.tux.pizza'];
async function getJ(url, ms = 8000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal }); if (!r.ok) throw new Error(String(r.status)); return await r.json(); } finally { clearTimeout(t); }
}
// единый вид результата: { id, title, channel, dur }
async function searchFree(q) {
  const tries = [];
  if (WK()) tries.push(getJ(`${WK()}/ytsearch?q=${encodeURIComponent(q)}`).then((j) => { const it = (j.items || []).filter((x) => x.id); if (!it.length) throw new Error('пусто'); return it; }));
  for (const m of [...MIRRORS].sort(() => Math.random() - 0.5).slice(0, 3)) {
    tries.push(getJ(`${m}/api/v1/search?q=${encodeURIComponent(q)}&type=video&fields=videoId,title,author,lengthSeconds`, 7000).then((j) => {
      const it = (Array.isArray(j) ? j : []).filter((x) => x.videoId).map((x) => ({ id: x.videoId, title: x.title || '', channel: x.author || '', dur: Number(x.lengthSeconds) || 0 }));
      if (!it.length) throw new Error('пусто'); return it;
    }));
  }
  return Promise.any(tries).catch(() => []);
}
function pickFree(items, track) {
  const want = Number(track.duration) || 0, tl = String(track.title || '').toLowerCase(), al = String(track.artist || '').toLowerCase().split(/[,&]/)[0].trim();
  const score = (it, idx) => {
    const t = `${it.title} ${it.channel}`.toLowerCase();
    let s = -idx * 0.6;
    if (want > 0 && it.dur > 0) { const diff = Math.abs(it.dur - want); s += diff <= 2 ? 6 : diff <= 5 ? 4 : diff <= 12 ? 1 : diff > 60 ? -4 : -1; }
    if (/ - topic$/.test(String(it.channel).toLowerCase())) s += 3;
    if (al && t.includes(al)) s += 1.5;
    if (/official audio|audio|аудио|lyric|текст/.test(t)) s += 1.5;
    for (const w of ['live', 'cover', 'remix', 'slowed', 'sped up', 'speed up', 'nightcore', 'karaoke', 'караоке', 'кавер', 'ремикс', 'reaction', 'реакция']) if (t.includes(w) && !tl.includes(w)) s -= 3;
    return s;
  };
  return items.slice(0, 10).map((it, i) => ({ id: it.id, s: score(it, i) })).sort((a, b) => b.s - a.s)[0].id;
}

const LS_KEY = 'mkw.ytcache';
let quotaOut = false;
export const youtubeQuotaOut = () => quotaOut;
let memo = null;

function loadMemo() {
  if (memo) return memo;
  try { memo = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { memo = {}; }
  return memo;
}
function saveMemo() {
  try {
    const keys = Object.keys(memo);
    if (keys.length > 500) keys.slice(0, keys.length - 500).forEach((k) => delete memo[k]);
    localStorage.setItem(LS_KEY, JSON.stringify(memo));
  } catch { /* хранилище недоступно, не страшно */ }
}

// Возвращает id видео (11 символов) или null.
export async function findYouTubeId(track) {
  const m = loadMemo();
  if (m[track.id]) return m[track.id];

  try {
    const snap = await getDoc(doc(db, 'trackCache', track.id));
    const id = snap.exists() ? snap.data().youtubeId : null;
    if (id) { m[track.id] = id; saveMemo(); return id; }
  } catch { /* кэш недоступен, идём в API */ }

  const q = `${track.artist} - ${track.title}`;
  // 1) без ключа и без лимита: сервер MKW или зеркала
  try {
    const items = await searchFree(q);
    if (items.length) {
      const id = pickFree(items, track);
      m[track.id] = id; saveMemo();
      setDoc(doc(db, 'trackCache', track.id), { youtubeId: id, cachedAt: Date.now() }).catch(() => {});
      return id;
    }
  } catch { /* дальше — ключ */ }
  // 2) запасной путь: официальный API с ключом (100 единиц квоты за поиск)
  if (!YOUTUBE_API_KEY || quotaOut) return null;
  const url = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10'
    + `&videoEmbeddable=true&maxResults=6&q=${encodeURIComponent(q)}&key=${YOUTUBE_API_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 403 || res.status === 429) quotaOut = true;
      return null;
    }
    const data = await res.json();
    const items = (data.items || []).filter((i) => i.id && i.id.videoId);
    if (!items.length) return null;
    const id = await pickBest(items, track);
    m[track.id] = id;
    saveMemo();
    setDoc(doc(db, 'trackCache', track.id), { youtubeId: id, cachedAt: Date.now() }).catch(() => {});
    return id;
  } catch {
    return null;
  }
}

// Из нескольких видео выбираем то, что точнее совпадает с треком: по длительности (тогда и текст идёт в такт),
// «аудио»-версии и каналы «- Topic» лучше клипов с вступлениями; live / cover / remix — только если они в названии трека.
const ISO = (d) => { const m = String(d || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };
async function pickBest(items, track) {
  let durs = {};
  try {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${items.map((i) => i.id.videoId).join(',')}&key=${YOUTUBE_API_KEY}`);
    if (r.ok) for (const v of (await r.json()).items || []) durs[v.id] = ISO(v.contentDetails && v.contentDetails.duration);
  } catch { /* без длительностей */ }
  const want = Number(track.duration) || 0;
  const tl = String(track.title || '').toLowerCase();
  const score = (it, idx) => {
    const t = `${it.snippet.title} ${it.snippet.channelTitle}`.toLowerCase();
    let s = -idx * 0.6;
    const d = durs[it.id.videoId] || 0;
    if (want > 0 && d > 0) { const diff = Math.abs(d - want); s += diff <= 2 ? 6 : diff <= 5 ? 4 : diff <= 12 ? 1 : diff > 60 ? -4 : -1; }
    if (/ - topic$/.test(it.snippet.channelTitle.toLowerCase())) s += 3;
    if (/official audio|audio|аудио|lyric|текст/.test(t)) s += 1.5;
    if (/official (music )?video|клип|mv\b/.test(t)) s -= 0.5;
    for (const w of ['live', 'cover', 'remix', 'slowed', 'sped up', 'speed up', 'nightcore', 'karaoke', 'караоке', 'кавер', 'ремикс', 'reaction', 'реакция']) if (t.includes(w) && !tl.includes(w)) s -= 3;
    return s;
  };
  return items.map((it, i) => ({ id: it.id.videoId, s: score(it, i) })).sort((a, b) => b.s - a.s)[0].id;
}

let apiPromise = null;
export function loadYouTubeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { apiPromise = null; reject(new Error('YouTube не загрузился')); };
    document.head.appendChild(s);
  });
  return apiPromise;
}

function decodeHtml(s) {
  const t = document.createElement('textarea');
  t.innerHTML = s;
  return t.value;
}

// Поиск прямо по YouTube (для того, чего нет в iTunes). Один запрос = 100 единиц дневной квоты.
export async function searchYouTube(term) {
  const ckey = `mkw.ytsearch.${term.toLowerCase()}`;
  try {
    const c = sessionStorage.getItem(ckey);
    if (c) return JSON.parse(c);
  } catch { /* ignore */ }
  const free = await searchFree(term).catch(() => []);
  if (free.length) {
    const out = free.map((i) => ({ id: `yt_${i.id}`, ytId: i.id, title: i.title, artist: String(i.channel).replace(/ - Topic$/, ''), album: '', artwork: `https://i.ytimg.com/vi/${i.id}/mqdefault.jpg`, previewUrl: '', duration: i.dur || 0, genre: '' }));
    try { sessionStorage.setItem(ckey, JSON.stringify(out)); } catch { /* ignore */ }
    return out;
  }
  if (!YOUTUBE_API_KEY) throw new Error('YouTube сейчас недоступен');
  if (quotaOut) throw new Error('Лимит YouTube на сегодня закончился');
  const url = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10'
    + `&videoEmbeddable=true&maxResults=15&q=${encodeURIComponent(term)}&key=${YOUTUBE_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 403 || res.status === 429) quotaOut = true;
    throw new Error(`YouTube ${res.status}`);
  }
  const data = await res.json();
  const out = (data.items || []).filter((i) => i.id && i.id.videoId).map((i) => ({
    id: `yt_${i.id.videoId}`,
    ytId: i.id.videoId,
    title: decodeHtml(i.snippet.title),
    artist: decodeHtml(i.snippet.channelTitle).replace(/ - Topic$/, ''),
    album: '',
    artwork: i.snippet.thumbnails?.medium?.url || '',
    previewUrl: '',
    duration: 0,
    genre: '',
  }));
  try { sessionStorage.setItem(ckey, JSON.stringify(out)); } catch { /* ignore */ }
  return out;
}

// Id видео из памяти (мгновенно, без сети). Нужен, чтобы запустить трек сразу по нажатию.
export function peekYouTubeId(track) {
  return loadMemo()[track.id] || null;
}

// Заранее подтягиваем из общего кэша id видео для показанных треков (дешёвое чтение, без квоты YouTube).
export async function prefetchYouTubeIds(tracks) {
  const m = loadMemo();
  let changed = false;
  const todo = tracks.filter((t) => !t.ytId && !m[t.id] && /^\d+$/.test(t.id)).slice(0, 15);
  await Promise.allSettled(todo.map(async (t) => {
    try {
      const snap = await getDoc(doc(db, 'trackCache', t.id));
      const id = snap.exists() ? snap.data().youtubeId : null;
      if (id) { m[t.id] = id; changed = true; }
    } catch { /* ignore */ }
  }));
  if (changed) saveMemo();
}

// Настройка: при отправке поиска сразу искать и на YouTube (быстрый старт, но тратит дневной лимит).
export function autoYouTube() {
  try { return localStorage.getItem('mkw.autoyt3') !== '0'; } catch { return true; }
}
export function setAutoYouTube(on) {
  try { localStorage.setItem('mkw.autoyt3', on ? '1' : '0'); } catch { /* ignore */ }
}
