// Поиск видео на YouTube для трека и загрузка IFrame Player API.
import { db } from './firebase.js';
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { YOUTUBE_API_KEY } from './config.js';

export const youtubeEnabled = () => Boolean(YOUTUBE_API_KEY);

const LS_KEY = 'mkw.ytcache';
let quotaOut = false;
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
  if (!YOUTUBE_API_KEY || quotaOut) return null;
  const m = loadMemo();
  if (m[track.id]) return m[track.id];

  try {
    const snap = await getDoc(doc(db, 'trackCache', track.id));
    const id = snap.exists() ? snap.data().youtubeId : null;
    if (id) { m[track.id] = id; saveMemo(); return id; }
  } catch { /* кэш недоступен, идём в API */ }

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
