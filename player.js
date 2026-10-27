// Движок плеера: очередь, YouTube (полные треки) и превью iTunes (30 сек) как запасной вариант.
import { Queue } from './queue.js';
import { findYouTubeId, loadYouTubeApi, youtubeEnabled } from './youtube.js';
import { logPlay } from './store.js';
import { artUrl } from './utils.js';

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
  if (s === 1) { st.playing = true; st.loading = false; clearTimeout(watchdog); failChain = 0; }
  else if (s === 2) { st.playing = false; }
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
  stopAll();
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

  let vid = null;
  if (youtubeEnabled()) vid = await findYouTubeId(track);
  if (id !== loadId) return;

  if (vid) {
    try {
      const p = await ensureYT();
      if (id !== loadId) return;
      st.mode = 'yt';
      p.loadVideoById(vid);
      // Если за 7 секунд не заиграло (часто на телефоне без касания), падаем на превью.
      watchdog = setTimeout(() => { if (id === loadId && st.mode === 'yt' && !st.playing) fallbackToPreview(); }, 7000);
      logPlay(track);
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
  audio.src = track.previewUrl;
  audio.play().then(() => { logPlay(track); }).catch((e) => {
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
  const t = queue.next(true);
  if (t) startCurrent();
  else { st.time = 0; emit('state'); }
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
  if (st.mode === 'yt' && yt && yt.getCurrentTime) {
    try {
      st.time = yt.getCurrentTime() || 0;
      const d = yt.getDuration();
      if (d > 0) st.duration = d;
    } catch { return; }
  } else if (st.mode === 'preview') {
    st.time = audio.currentTime || 0;
  }
  emit('time');
}, 500);

// ---------- управление ----------
export function toggle() {
  if (!queue.current) return;
  if (!st.mode) { if (!st.loading) startCurrent(); return; }
  if (st.mode === 'yt' && yt) {
    if (st.playing) yt.pauseVideo(); else yt.playVideo();
  } else if (audio.paused) {
    audio.play().catch(() => {});
  } else {
    audio.pause();
  }
}

export function pause() {
  if (st.mode === 'yt' && yt) { try { yt.pauseVideo(); } catch { /* ignore */ } }
  else if (st.mode === 'preview') audio.pause();
}

export function next() {
  const t = queue.next(false);
  if (t) startCurrent();
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
