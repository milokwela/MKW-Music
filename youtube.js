// Поиск видео на YouTube для трека и загрузка IFrame Player API.
import { db } from './firebase.js?v=0.18.0';
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { YOUTUBE_API_KEY } from './config.js?v=0.18.0';

export const youtubeEnabled = () => Boolean(YOUTUBE_API_KEY);

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
  if (!YOUTUBE_API_KEY) return null;
  const m = loadMemo();
  if (m[track.id]) return m[track.id];

  try {
    const snap = await getDoc(doc(db, 'trackCache', track.id));
    const id = snap.exists() ? snap.data().youtubeId : null;
    if (id) { m[track.id] = id; saveMemo(); return id; }
  } catch { /* кэш недоступен, идём в API */ }

  if (quotaOut) return null;   // лимит кончился: играем только то, что уже в общем кэше
  const q = `${track.artist} - ${track.title}`;
  const url = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10'
    + `&videoEmbeddable=true&maxResults=1&q=${encodeURIComponent(q)}&key=${YOUTUBE_API_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 403 || res.status === 429) quotaOut = true;
      return null;
    }
    const data = await res.json();
    const id = data.items?.[0]?.id?.videoId;
    if (!id) return null;
    m[track.id] = id;
    saveMemo();
    setDoc(doc(db, 'trackCache', track.id), { youtubeId: id, cachedAt: Date.now() }).catch(() => {});
    return id;
  } catch {
    return null;
  }
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
  if (!YOUTUBE_API_KEY) throw new Error('Нет ключа YouTube');
  if (quotaOut) throw new Error('Лимит YouTube на сегодня закончился');
  const ckey = `mkw.ytsearch.${term.toLowerCase()}`;
  try {
    const c = sessionStorage.getItem(ckey);
    if (c) return JSON.parse(c);
  } catch { /* ignore */ }
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
  if (!YOUTUBE_API_KEY) return;
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
