// Движок плеера: очередь, YouTube (полные треки) и превью iTunes (30 сек) как запасной вариант.
import { audiusStreamUrl } from './audius.js?v=0.13.0';
import { Queue } from './queue.js?v=0.13.0';
import { findYouTubeId, peekYouTubeId, loadYouTubeApi, youtubeEnabled } from './youtube.js?v=0.13.0';
import { logPlay, addListened } from './store.js?v=0.13.0';
import { artUrl } from './utils.js?v=0.13.0';

export const queue = new Queue();
export const st = {
  playing: false,
  loading: false,
  mode: null, // 'yt' | 'preview' | null
  time: 0,
  duration: 0,
  sleepAt: 0,
  message: '', // последнее сообщение об ошибке для интерфейса
};

const audio = document.getElementById('preview-player');
const subs = new Set();
let yt = null;
let ytPromise = null;
let loadId = 0;
let failChain = 0;
let sleepTimer = null;
let watchdog = null;
let userPaused = false; // пауза нажата пользователем, а не системой

// Тихая дорожка: пока играет YouTube, держим страницу «живой» и системный плеер активным,
// чтобы после выключения экрана можно было возобновить воспроизведение.
function silentWavUrl() {
  const rate = 8000;
  const n = rate;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, 'data'); v.setUint32(40, n, true);
  new Uint8Array(buf, 44).fill(128);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
let keep = null;
function keepOn() {
  try {
    if (!keep) { keep = new Audio(silentWavUrl()); keep.loop = true; keep.volume = 0.02; }
    keep.play().catch(() => {});
  } catch { /* ignore */ }
}
function keepOff() {
  try { if (keep) keep.pause(); } catch { /* ignore */ }
}

export function onPlayer(fn) { subs.add(fn); return () => subs.delete(fn); }
function emit(ev) { subs.forEach((fn) => { try { fn(ev); } catch (e) { console.error(e); } }); }

// ---------- YouTube ----------
async function ensureYT() {
  if (yt) return yt;
  if (!ytPromise) {
    ytPromise = loadYouTubeApi().then((YT) => new Promise((resolve) => {
      const p = new YT.Player('yt-target', {
        width: '200',
        height: '200',
        playerVars: { playsinline: 1, controls: 0, disablekb: 1, rel: 0, origin: location.origin },
        events: { onReady: () => resolve(p), onStateChange: onYtState, onError: onYtError },
      });
    }));
    ytPromise.catch(() => { ytPromise = null; });
  }
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('YouTube долго грузится')), 8000));
  yt = await Promise.race([ytPromise, timeout]);
  return yt;
}

function onYtState(e) {
  if (st.mode !== 'yt') return;
  const s = e.data;
  if (s === 1) { st.playing = true; st.loading = false; st.message = ''; clearTimeout(watchdog); failChain = 0; }
  else if (s === 2) {
    st.playing = false;
    // Телефон/YouTube поставили на паузу в фоне, а пользователь паузу не нажимал: пробуем продолжить.
    if (document.hidden && !userPaused) {
      [250, 1200, 3500].forEach((ms) => setTimeout(() => {
        if (st.mode === 'yt' && !userPaused && !st.playing && yt) { try { yt.playVideo(); } catch { /* ignore */ } }
      }, ms));
    }
  }
  else if (s === 3) { st.loading = true; }
  else if (s === 0) { handleEnded(); return; }
  emit('state');
  syncSession();
}

function onYtError() {
  if (st.mode !== 'yt') return;
  fallbackToPreview();
}

function fallbackToPreview() {
  const track = queue.current;
  clearTimeout(watchdog);
  if (yt) { try { yt.stopVideo(); } catch { /* ignore */ } }
  if (!track) return;
  const id = loadId;
  if (track.previewUrl) {
    st.message = 'Полный трек недоступен, играет фрагмент 30 сек';
    startPreview(track, id);
  } else {
    unavailable(id);
  }
}

// Заранее поднимаем YouTube-плеер, чтобы первый трек стартовал быстрее.
export function warmUp() {
  if (youtubeEnabled()) ensureYT().catch(() => {});
}

// Пока играет текущий трек, заранее ищем видео для следующего.
function prefetchNext() {
  if (!youtubeEnabled()) return;
  const nxt = queue.items[queue.index + 1];
  if (nxt && !nxt.ytId && !peekYouTubeId(nxt)) findYouTube(nxt);
}
function findYouTube(t) { findYouTubeId(t).catch(() => {}); }

// ---------- запуск трека ----------
function stopAll() {
  clearTimeout(watchdog);
  try { audio.pause(); } catch { /* ignore */ }
  if (yt) { try { yt.stopVideo(); } catch { /* ignore */ } }
  st.playing = false;
}

async function startCurrent() {
  const track = queue.current;
  const id = ++loadId;
  userPaused = false;
  stopAll();
  if (track && youtubeEnabled() && !track.auId) keepOn(); else keepOff();
  if (!track) {
    st.mode = null; st.loading = false; st.time = 0; st.duration = 0;
    emit('track');
    return;
  }
  st.mode = null;
  st.loading = true;
  st.time = 0;
  st.duration = track.duration || 0;
  st.message = '';
  emit('track');
  setSession(track);

  if (track.auId) { startPreview(track, id); return; }

  // Если id видео уже известен, запускаем без единого ожидания: iPhone пускает звук только сразу после нажатия.
  let vid = track.ytId || peekYouTubeId(track);
  if (!vid && youtubeEnabled() && !track.noYt) vid = await findYouTubeId(track);
  if (id !== loadId) return;

  if (vid) {
    try {
      const p = yt || await ensureYT();
      if (id !== loadId) return;
      st.mode = 'yt';
      p.loadVideoById(vid);
      // Если за 7 секунд не заиграло (часто на телефоне без касания), падаем на превью.
      // Не заиграло само (iPhone просит нажать): не прыгаем на фрагмент, а просим нажать ▶.
      watchdog = setTimeout(() => {
        if (id !== loadId || st.mode !== 'yt' || st.playing) return;
        st.loading = false;
        st.message = 'Нажмите ▶, чтобы включить полный трек';
        emit('state');
        watchdog = setTimeout(() => { if (id === loadId && st.mode === 'yt' && !st.playing) fallbackToPreview(); }, 25000);
      }, 3500);
      logPlay(track);
      prefetchNext();
      emit('state');
      return;
    } catch (e) {
      console.warn('YouTube не сработал', e);
      if (id !== loadId) return;
    }
  }
  if (track.previewUrl) startPreview(track, id);
  else unavailable(id);
}

function startPreview(track, id) {
  if (id !== loadId) return;
  st.mode = 'preview';
  st.loading = true;
  audio.src = track.auId ? audiusStreamUrl(track.auId) : track.previewUrl;
  audio.play().then(() => { logPlay(track); prefetchNext(); }).catch((e) => {
    if (id !== loadId) return;
    st.loading = false;
    st.playing = false;
    if (e && e.name === 'NotAllowedError') st.message = 'Нажмите ▶, браузер не дал включить звук сам';
    else if (e && e.name !== 'AbortError') { unavailable(id); return; }
    emit('state');
  });
  emit('track');
}

function unavailable(id) {
  if (id !== loadId) return;
  st.message = 'Трек недоступен, пропускаю';
  st.loading = false;
  st.playing = false;
  failChain += 1;
  emit('error');
  if (failChain < Math.max(queue.length, 1)) {
    const t = queue.next(false);
    if (t) { startCurrent(); return; }
  }
  failChain = 0;
  emit('state');
}

function handleEnded() {
  st.playing = false;
  if (queue.repeat === 'one') { restart(); return; }
  st.last = { track: queue.current, time: st.time, duration: st.duration };
  emit('done');
  const t = queue.next(true);
  if (t) startCurrent();
  else { st.time = 0; keepOff(); emit('state'); }
}

function restart() {
  if (st.mode === 'yt' && yt) { yt.seekTo(0, true); yt.playVideo(); }
  else { audio.currentTime = 0; audio.play().catch(() => {}); }
}

// ---------- события аудио (превью) ----------
audio.addEventListener('playing', () => {
  if (st.mode !== 'preview') return;
  st.playing = true; st.loading = false; failChain = 0;
  emit('state'); syncSession();
});
audio.addEventListener('pause', () => {
  if (st.mode !== 'preview' || audio.ended) return;
  st.playing = false; emit('state'); syncSession();
});
audio.addEventListener('waiting', () => { if (st.mode === 'preview') { st.loading = true; emit('state'); } });
audio.addEventListener('ended', () => { if (st.mode === 'preview') handleEnded(); });
audio.addEventListener('error', () => { if (st.mode === 'preview' && audio.src) unavailable(loadId); });
audio.addEventListener('loadedmetadata', () => {
  if (st.mode === 'preview' && Number.isFinite(audio.duration)) { st.duration = audio.duration; emit('time'); }
});

// Обновление времени.
setInterval(() => {
  if (!st.mode || !st.playing) return;
  addListened(0.5);
  if (st.mode === 'yt' && yt && yt.getCurrentTime) {
    try {
      st.time = yt.getCurrentTime() || 0;
      const d = yt.getDuration();
      if (d > 0) st.duration = d;
    } catch { return; }
  } else if (st.mode === 'preview') {
    st.time = audio.currentTime || 0;
  }
  const cid = queue.current ? queue.current.id : '';
  if (cid !== volFor) { volFor = cid; applyVolume(); }
  emit('time');
}, 500);

// ---------- управление ----------
// ---------- громкость ----------
const VKEY = 'mkw.vol';
let vol = (() => { try { const v = parseFloat(localStorage.getItem(VKEY)); return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1; } catch { return 1; } })();
let volFor = '';
function applyVolume() {
  try { audio.volume = vol; } catch { /* ignore */ }
  try { if (yt && yt.setVolume) yt.setVolume(Math.round(vol * 100)); } catch { /* ignore */ }
}
export const getVolume = () => vol;
export function setVolume(v) {
  vol = Math.min(1, Math.max(0, v));
  try { localStorage.setItem(VKEY, String(vol)); } catch { /* ignore */ }
  applyVolume();
  return vol;
}

export function previousTrack() {
  if (queue.index > 0 && queue.prev()) startCurrent();
  else seek(0);
}

export function toggle() {
  if (!queue.current) return;
  if (!st.mode) { if (!st.loading) startCurrent(); return; }
  if (st.mode === 'yt' && yt) {
    if (st.playing) { userPaused = true; keepOff(); yt.pauseVideo(); } else { userPaused = false; keepOn(); yt.playVideo(); }
  } else if (audio.paused) {
    userPaused = false;
    audio.play().catch(() => {});
  } else {
    userPaused = true;
    audio.pause();
  }
}

export function pause() {
  userPaused = true;
  keepOff();
  if (st.mode === 'yt' && yt) { try { yt.pauseVideo(); } catch { /* ignore */ } }
  else if (st.mode === 'preview') audio.pause();
}

export function next() {
  st.last = { track: queue.current, time: st.time, duration: st.duration };
  const t = queue.next(false);
  if (t) { emit('skip'); startCurrent(); }
  else emit('end');
}

export function prev() {
  if (st.time > 3 || queue.index <= 0 && queue.repeat === 'off') { seek(0); return; }
  if (queue.prev()) startCurrent();
}

export function seek(sec) {
  const s = Math.max(0, sec);
  if (st.mode === 'yt' && yt) yt.seekTo(s, true);
  else if (st.mode === 'preview') audio.currentTime = s;
  st.time = s;
  emit('time');
}

export function playTracks(tracks, start = 0) {
  if (!tracks.length) return;
  failChain = 0;
  queue.set(tracks, start);
  emit('queue');
  startCurrent();
}

export function addToQueue(track) {
  const wasEmpty = queue.length === 0;
  queue.add(track);
  emit('queue');
  if (wasEmpty) startCurrent();
}

export function playNext(track) {
  const wasEmpty = queue.length === 0;
  queue.addNext(track);
  emit('queue');
  if (wasEmpty) startCurrent();
}

export function jumpTo(i) {
  if (queue.jump(i)) { failChain = 0; emit('queue'); startCurrent(); }
}

export function removeFromQueue(i) {
  const r = queue.remove(i);
  emit('queue');
  if (r.removedCurrent) startCurrent();
}

export function stop() {
  keepOff();
  queue.clear();
  setSleep(0);
  startCurrent();
  emit('queue');
}

export function toggleShuffle() { queue.setShuffle(!queue.shuffle); emit('queue'); }
export function cycleRepeat() { queue.cycleRepeat(); emit('queue'); }

// ---------- таймер сна ----------
export function setSleep(minutes) {
  clearTimeout(sleepTimer);
  sleepTimer = null;
  st.sleepAt = 0;
  if (minutes > 0) {
    st.sleepAt = Date.now() + minutes * 60000;
    sleepTimer = setTimeout(() => { pause(); st.sleepAt = 0; emit('sleep'); }, minutes * 60000);
  }
  emit('sleep');
}

// ---------- системные кнопки (Media Session) ----------
function setSession(track) {
  if (!('mediaSession' in navigator)) return;
  try {
    const src = artUrl(track.artwork, 512);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: src ? [{ src, sizes: '512x512', type: 'image/jpeg' }] : [],
    });
  } catch { /* ignore */ }
}

function syncSession() {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.playbackState = st.playing ? 'playing' : 'paused';
    if (st.duration > 0 && Number.isFinite(st.duration)) {
      navigator.mediaSession.setPositionState({ duration: st.duration, position: Math.min(st.time, st.duration), playbackRate: 1 });
    }
  } catch { /* ignore */ }
}

if ('mediaSession' in navigator) {
  const set = (name, fn) => { try { navigator.mediaSession.setActionHandler(name, fn); } catch { /* не поддерживается */ } };
  set('play', () => { if (!st.playing) toggle(); });
  set('pause', () => pause());
  set('previoustrack', () => prev());
  set('nexttrack', () => next());
  set('seekto', (d) => { if (d && typeof d.seekTime === 'number') seek(d.seekTime); });
}
