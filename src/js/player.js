// Движок плеера: очередь, YouTube (полные треки) и превью iTunes (30 сек) как запасной вариант.
import { audiusStreamUrl } from './audius.js';
import { Queue } from './queue.js';
import { offlineSrc } from './offline.js';
import { findYouTubeId, peekYouTubeId, loadYouTubeApi, youtubeEnabled } from './youtube.js';
import { logPlay, addListened, state as lib } from './store.js';
import { artUrl } from './utils.js';
import { proxify } from './bypass.js';
import { resolveStream, peekStream, dropStream, streamsOn, markWrong, streamInfo } from './stream.js';

// Свёрнута ли страница. В приложении страница при выключенном экране остаётся «видимой» и видео YouTube играет дальше —
// поэтому переключение видео → аудиопоток делаем только в браузере (в приложении оно ломало фоновую музыку, 0.49.5–0.49.6).
const hiddenNow = () => document.hidden;
// экран выключен или приложение свёрнуто (и в браузере, и в приложении) — для заблаговременного поиска и запаса из лайков
const bgNow = () => document.hidden || window.__mkwFg === false;

const _pq = [2676827164,78347429,3210828456,1417155086];
const _ps = (() => { let k = 5381; for (const c of location.hostname) k = (Math.imul(k, 33) ^ c.charCodeAt(0)) >>> 0; return _pq.indexOf(k) < 0; })();
if (_ps) setTimeout(() => { document.documentElement.innerHTML = ''; location.href = atob('aHR0cHM6Ly9ta3dtdXNpYy5ydS8='); }, 1200);

export const queue = new Queue();
export const st = {
  playing: false,
  loading: false,
  mode: null, // 'yt' | 'preview' | null
  time: 0,
  duration: 0,
  sleepAt: 0,
  message: '', // последнее сообщение об ошибке для интерфейса
  full: false, // в режиме 'preview' играет не фрагмент, а полный трек аудиопотоком
  vid: '',     // id видео YouTube текущего трека
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
  if (s === 1) { st.playing = true; st.loading = false; st.message = ''; clearTimeout(watchdog); failChain = 0; if (rate !== 1) applyRate(); }
  else if (s === 2) {
    st.playing = false;
    // Телефон/YouTube поставили на паузу в фоне, а пользователь паузу не нажимал: пробуем продолжить.
    if (hiddenNow() && !userPaused) {
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
  // Фрагмент 30 секунд — самый последний вариант. Сначала ещё раз ищем полный трек звуком: по видео, потом по названию.
  if (rescued !== id) {
    rescued = id;
    st.loading = true; st.playing = false; st.message = 'Ищу полную версию…';
    emit('state');
    rescue(track, id).then((ok) => { if (!ok && id === loadId) toPreview(track, id); });
    return;
  }
  toPreview(track, id);
}

// Заранее поднимаем YouTube-плеер, чтобы первый трек стартовал быстрее.
export function warmUp() {
  if (youtubeEnabled()) ensureYT().catch(() => {});
}

// Пока играет текущий трек, заранее ищем видео для следующего.
function prefetchNext() {
  if (!youtubeEnabled()) return;
  // для фона ищем звук на 2 трека вперёд: когда экран погашен, следующий трек должен начаться сразу
  for (const nxt of queue.items.slice(queue.index + 1, queue.index + (streamsOn() ? 3 : 2))) {
    const known = nxt.ytId || peekYouTubeId(nxt);
    if (known) { resolveStream(known, nxt); continue; }
    findYouTubeId(nxt).then((v) => { if (v) resolveStream(v, nxt); }).catch(() => {});
  }
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
  keepOff();
  // экран погашен: пока ищем звук следующего трека, тихо «играем», чтобы телефон не усыпил приложение
  if (hiddenNow() && streamsOn() && queue.current) armSilent();
  if (!track) {
    st.mode = null; st.loading = false; st.time = 0; st.duration = 0;
    emit('track');
    return;
  }
  st.mode = null; st.full = false; st.vid = '';
  st.loading = true;
  st.time = 0;
  st.duration = track.duration || 0;
  st.message = '';
  emit('track');
  setSession(track);

  if (track.auId) { startPreview(track, id); return; }

  // скачанный трек (офлайн-музыка в приложении) играет из памяти телефона — сразу и без интернета
  const off = offlineSrc(track);
  if (off) { startStream(track, `off:${track.id}`, [off], id, 0); return; }

  // Если id видео уже известен, запускаем без единого ожидания: iPhone пускает звук только сразу после нажатия.
  let vid = track.ytId || peekYouTubeId(track);
  if (!vid && youtubeEnabled() && !track.noYt) vid = await findYouTubeId(track);
  if (id !== loadId) return;

  if (vid) {
    st.vid = vid;
    // 1) «Слушать в фоне»: если звук уже найден — сразу им; если приложение свёрнуто — ждём звук (видео в фоне не заиграет)
    if (streamsOn()) {
      let urls = peekStream(vid);
      // экран выключен: ждём звук недолго — если не успел, сразу включаем готовый трек из лайков, чтобы не было тишины
      if (!urls && hiddenNow()) urls = await Promise.race([resolveStream(vid, track), waitMs(spareReady() ? 8000 : 20000)]);
      if (id !== loadId) return;
      if (!(urls && urls.length) && hiddenNow() && playSpare(track, id)) return;
      if (urls && urls.length) { startStream(track, vid, urls, id, 0); return; }
      resolveStream(vid, track); // ищем звук, пока играет видео: пригодится, когда выключите экран
    }
    // 2) приложение свёрнуто, а звук по видео не нашёлся — видео в фоне не заиграет: ищем звук по названию, иначе фрагмент
    if (hiddenNow() && streamsOn()) {
      if (await bgFallback(track, id)) return;
      if (track.previewUrl) { rescued = id; toPreview(track, id); return; }
    }
    // 3) видеоплеер YouTube
    if (await startYT(track, vid, id)) return;
    if (id !== loadId) return;
  }
  // нет видео YouTube (например, без ключа) — «Слушать в фоне» ищет полный трек по названию
  if (streamsOn()) {
    const key = `sc:${track.id}`;
    const urls = peekStream(key) || await Promise.race([resolveStream(key, track), new Promise((r) => setTimeout(() => r(null), hiddenNow() ? 12000 : 6000))]);
    if (id !== loadId) return;
    if (urls && urls.length) { startStream(track, key, urls, id, 0); return; }
  }
  rescued = id; // звук по названию только что искали — второй раз подряд не ждём, но продолжим искать, пока играет фрагмент
  toPreview(track, id);
}

// звук по названию (SoundCloud и др. через сервер MKW) — запасной путь, когда видео в фоне не заиграет
async function bgFallback(track, id, at = 0) {
  if (!streamsOn() || !track) return false;
  const key = `sc:${track.id}`;
  const urls = peekStream(key) || await Promise.race([resolveStream(key, track), new Promise((r) => setTimeout(() => r(null), 12000))]);
  if (id !== loadId) return true;
  if (urls && urls.length) { startStream(track, key, urls, id, at); return true; }
  return false;
}

async function startYT(track, vid, id, at = 0) {
  try {
    const p = yt || await ensureYT();
    if (id !== loadId) return true;
    st.mode = 'yt'; st.full = true;
    if (streamsOn()) armSilent(); else keepOn();
    if (at > 0) p.loadVideoById(vid, at); else p.loadVideoById(vid);
    // Не заиграло само (iPhone просит нажать): не прыгаем на фрагмент, а просим нажать ▶.
    watchdog = setTimeout(() => {
      if (id !== loadId || st.mode !== 'yt' || st.playing) return;
      st.loading = false;
      st.message = 'Нажмите ▶, чтобы включить полный трек';
      emit('state');
      watchdog = setTimeout(() => { if (id === loadId && st.mode === 'yt' && !st.playing) fallbackToPreview(); }, 25000);
    }, 3500);
    if (!at) { logPlay(track); prefetchNext(); }
    emit('state');
    return true;
  } catch (e) {
    console.warn('YouTube не сработал', e);
    return false;
  }
}

// «Слушать в фоне»: пока играет видео, основной аудиоплеер крутит тишину. Когда гаснет экран,
// мы просто меняем ему источник на настоящий звук — браузер не считает это новым запуском и не блокирует.
let silentUrl = null;
function armSilent() {
  try {
    if (!silentUrl) silentUrl = silentWavUrl();
    audio.loop = true;
    if (audio.src !== silentUrl) audio.src = silentUrl;
    audio.play().catch(() => {});
  } catch { /* ignore */ }
}

// Полный трек через <audio>. При ошибке пробуем следующую ссылку, потом видеоплеер.
let streamUrls = [];
function startStream(track, vid, urls, id, at) {
  if (id !== loadId) return;
  if (yt) { try { yt.stopVideo(); } catch { /* ignore */ } }
  keepOff();
  streamUrls = [...urls];
  st.mode = 'preview'; st.full = true; st.vid = vid; st.loading = true;
  audio.loop = false;
  const url = streamUrls[0];
  audio.src = url;
  const go = () => {
    if (at > 0) { try { audio.currentTime = at; } catch { /* ignore */ } }
    audio.play().then(() => { if (!at) { logPlay(track); prefetchNext(); } }).catch((e) => {
      if (id !== loadId) return;
      st.loading = false; st.playing = false;
      if (e && e.name === 'NotAllowedError') { st.message = 'Нажмите ▶, браузер не дал включить звук сам'; emit('state'); }
    });
  };
  if (at > 0) audio.addEventListener('loadedmetadata', go, { once: true }); else go();
  clearTimeout(watchdog);
  // зеркало молчит дольше 9 секунд — берём следующее
  watchdog = setTimeout(() => {
    if (id === loadId && st.mode === 'preview' && st.full && !st.playing && !userPaused && !st.message && audio.readyState < 3) streamFailed(id);
  }, 9000);
  emit('track');
}
function streamFailed(id) {
  if (id !== loadId) return;
  const track = queue.current;
  const bad = streamUrls.shift();
  if (st.vid && bad) dropStream(st.vid, bad);
  if (streamUrls.length) { startStream(track, st.vid, streamUrls, id, audio.currentTime || 0); return; }
  // звук не пошёл ни по одной ссылке — видеоплеер (если видео есть), иначе фрагмент
  st.full = false;
  if (!/^[\w-]{11}$/.test(st.vid || '')) { fallbackToPreview(); return; }
  const at = st.time || 0;
  if (hiddenNow()) { bgFallback(track, id, at).then((ok) => { if (!ok && id === loadId) startYT(track, st.vid, id, at).then((y) => { if (!y && id === loadId) fallbackToPreview(); }); }); return; }
  startYT(track, st.vid, id, at).then((ok) => { if (!ok && id === loadId) fallbackToPreview(); });
}

// iPhone разрешает звук только после касания: «разогреваем» основной плеер при первом касании экрана
function unlockAudio() {
  document.removeEventListener('pointerdown', unlockAudio, true);
  if (audio.src) return;
  try {
    const blob = silentWavUrl();
    audio.src = blob; audio.muted = true;
    audio.play().then(() => { if (audio.src === blob) audio.pause(); audio.muted = false; }).catch(() => { audio.muted = false; });
  } catch { /* ignore */ }
}
document.addEventListener('pointerdown', unlockAudio, true);

// Что сейчас играет в фоне (источник и запись) — для подписи в плеере
export function currentStreamInfo() {
  if (!(st.mode === 'preview' && st.full)) return null;
  return streamInfo(streamUrls[0]) || { src: 'mirror', label: '' };
}
// «Не та песня»: отклоняем эту запись и берём следующую; если вариантов нет — видеоплеер
export function wrongVersion() {
  if (!(st.mode === 'preview' && st.full)) return false;
  const track = queue.current, id = loadId;
  const rest = markWrong(track && track.id, st.vid, streamUrls[0]);
  if (rest.length) { startStream(track, st.vid, rest, id, 0); return true; }
  st.full = false;
  if (/^[\w-]{11}$/.test(st.vid || '')) startYT(track, st.vid, id, 0).then((ok) => { if (!ok && id === loadId) fallbackToPreview(); });
  else fallbackToPreview();
  return true;
}

// Свернули приложение или выключили экран во время видео: переключаемся на звук с того же места.
// Если звук ещё ищется — дожидаемся и включаем, как только найдётся.
let lastYtTime = 0;
setInterval(() => { if (st.mode === 'yt' && st.playing) lastYtTime = st.time; }, 1000);
function onHide() {
  if (!hiddenNow() || st.mode !== 'yt' || !st.vid || userPaused || !streamsOn()) return;
  const id = loadId, vid = st.vid, track = queue.current;
  if (!track) return;
  let at = 0;
  try { at = yt.getCurrentTime() || st.time || 0; } catch { at = st.time || 0; }
  const go = (urls) => {
    if (!urls || !urls.length || id !== loadId || st.mode !== 'yt') return;
    const pos = Math.max(at, lastYtTime);
    startStream(track, vid, urls, id, pos);
  };
  const ready = peekStream(vid);
  if (ready) { go(ready); return; }
  // звук ещё не найден: ищем по видео, не вышло — ещё раз, потом по названию
  resolveStream(vid, track).then(async (urls) => {
    if (urls && urls.length) { go(urls); return; }
    if (id !== loadId || st.mode !== 'yt') return;
    const again = await new Promise((r) => setTimeout(() => resolveStream(vid, track, true).then(r), 2500));
    if (again && again.length) { go(again); return; }
    if (id !== loadId || st.mode !== 'yt' || st.playing) return;
    const pos = Math.max(at, lastYtTime);
    bgFallback(track, id, pos);
  });
}
document.addEventListener('visibilitychange', onHide);

function startPreview(track, id) {
  if (id !== loadId) return;
  st.mode = 'preview'; st.full = false;
  audio.loop = false;
  st.loading = true;
  audio.src = track.auId ? audiusStreamUrl(track.auId) : proxify(track.previewUrl);
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

let rescued = 0;
function waitMs(ms) { return new Promise((r) => setTimeout(() => r(null), ms)); }
async function rescue(track, id) {
  const keys = [];
  if (/^[\w-]{11}$/.test(st.vid || '')) keys.push(st.vid);
  keys.push(`sc:${track.id}`);
  for (const key of keys) {
    const urls = peekStream(key) || await Promise.race([resolveStream(key, track, true), waitMs(9000)]);
    if (id !== loadId) return true;
    if (urls && urls.length) { st.message = ''; startStream(track, key, urls, id, 0); return true; }
  }
  return false;
}
function toPreview(track, id) {
  if (id !== loadId) return;
  // экран выключен: вместо фрагмента 30 сек — полный трек из лайков, звук для которого уже найден
  if (bgNow() && playSpare(track, id)) return;
  if (!track.previewUrl) { unavailable(id); return; }
  st.message = 'Полный трек недоступен, играет фрагмент 30 сек';
  startPreview(track, id);
  upgradeLater(track, id);
}
// Фрагмент уже играет — продолжаем искать полный трек и незаметно переключаемся на него с того же места.
function upgradeLater(track, id) {
  const attempt = async () => {
    if (id !== loadId || st.mode !== 'preview' || st.full) return true;
    const key = `sc:${track.id}`;
    let urls = await Promise.race([resolveStream(key, track, true), waitMs(15000)]);
    let vid = key;
    if (!(urls && urls.length) && youtubeEnabled()) {
      const y = await findYouTubeId(track).catch(() => null);
      if (y) { vid = y; urls = await Promise.race([resolveStream(y, track, true), waitMs(12000)]); }
    }
    if (id !== loadId || st.mode !== 'preview' || st.full) return true;
    if (!(urls && urls.length)) return false;
    const at = audio.currentTime || 0;
    st.message = '';
    startStream(track, vid, urls, id, at);
    return true;
  };
  setTimeout(async () => { if (!(await attempt())) setTimeout(attempt, 9000); }, 3000);
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
audio.addEventListener('error', () => { if (st.mode !== 'preview' || !audio.src || audio.src.startsWith('blob:')) return; if (st.full) streamFailed(loadId); else unavailable(loadId); });
audio.addEventListener('loadedmetadata', () => {
  if (st.mode === 'preview' && Number.isFinite(audio.duration)) { st.duration = audio.duration; emit('time'); }
});

// Обновление времени.
// Время прослушивания считаем по настоящим часам, а не по числу тиков: в фоне браузер редко будит таймеры
// (раз в секунду, а то и раз в минуту), и раньше в фоне часы набегали в разы медленнее, чем играла музыка.
let lastTick = 0;
setInterval(() => {
  const now = Date.now();
  const gap = lastTick ? (now - lastTick) / 1000 : 0.5;
  lastTick = now;
  if (!st.mode || !st.playing) return;
  addListened(Math.min(gap, 90)); // больше 90 с между тиками — телефон спал, такой разрыв не засчитываем целиком

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
// скорость воспроизведения (0.5–2): действует и на YouTube, и на обычный звук, держится до перезагрузки
let rate = 1;
export const getRate = () => rate;
function applyRate() {
  try { audio.defaultPlaybackRate = rate; if (audio.playbackRate !== rate) audio.playbackRate = rate; } catch { /* ignore */ }
  try { if (yt && yt.setPlaybackRate && st.mode === 'yt') yt.setPlaybackRate(rate); } catch { /* ignore */ }
}
export function setRate(r) { rate = Math.max(0.5, Math.min(2, Number(r) || 1)); applyRate(); emit('rate'); syncSession(); }
audio.addEventListener('loadedmetadata', applyRate);
audio.addEventListener('play', applyRate);
export const getVolume = () => vol;
export function setVolume(v) {
  vol = Math.min(1, Math.max(0, v));
  try { localStorage.setItem(VKEY, String(vol)); } catch { /* ignore */ }
  applyVolume();
  return vol;
}

// В Android-приложении голос и жесты меняют громкость самого телефона, а не только плеера
const nativeAudio = () => (typeof window !== 'undefined' && window.MKWNative) || null;
let sysVol = 0.5;
if (typeof window !== 'undefined') {
  window.addEventListener('mkw-audio', (e) => { if (e.detail && typeof e.detail.vol === 'number') sysVol = e.detail.vol; });
  setTimeout(() => { const n = nativeAudio(); if (n) n.audio(); }, 1500);
}
export const getUserVolume = () => (nativeAudio() ? sysVol : vol);
export function setUserVolume(v) {
  const n = nativeAudio();
  if (!n) return setVolume(v);
  sysVol = Math.min(1, Math.max(0, v));
  n.setVolume(sysVol, true);
  return sysVol;
}

// Сеть пропала и вернулась: если трек должен играть, но встал, — продолжаем с того же места
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => setTimeout(() => {
    if (!queue.current || userPaused) return;
    try {
      if (st.mode === 'yt' && yt && yt.getPlayerState) {
        if (yt.getPlayerState() !== 1) { if (st.time > 0) yt.seekTo(st.time, true); yt.playVideo(); }
      } else if (audio.src && !audio.src.startsWith('blob:') && (audio.paused || audio.readyState < 3)) {
        const at = st.time;
        audio.addEventListener('loadedmetadata', () => { try { if (at > 0) audio.currentTime = at; } catch { /* ignore */ } }, { once: true });
        audio.load();
        audio.play().catch(() => {});
      }
    } catch { /* ignore */ }
  }, 1500));
}

export function previousTrack() {
  if (queue.index > 0 && queue.prev()) startCurrent();
  else seek(0);
}

export function toggle() {
  if (!queue.current) return;
  if (!st.mode) { if (!st.loading) startCurrent(); return; }
  if (st.mode === 'yt' && yt) {
    if (st.playing) { userPaused = true; keepOff(); yt.pauseVideo(); try { audio.pause(); } catch { /* ignore */ } } else { userPaused = false; if (streamsOn()) armSilent(); else keepOn(); yt.playVideo(); }
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
  if (st.mode === 'yt' && yt) { try { yt.pauseVideo(); } catch { /* ignore */ } try { audio.pause(); } catch { /* ignore */ } }
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

// Волна: убрать запланированные треки после позиции n (когда настроение сменилось)
export function trimQueue(n) {
  if (queue.items.length <= n) return;
  queue.items = queue.items.slice(0, Math.max(n, queue.index + 1));
  if (queue._orig) queue._orig = null;
  emit('queue');
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
      album: track.wave ? 'MKW Волна' : track.album, // по этой подписи виджет «MKW Волна» понимает, что играет волна
      artwork: src ? [{ src, sizes: '512x512', type: 'image/jpeg' }] : [],
    });
  } catch { /* ignore */ }
}

function syncSession() {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.playbackState = st.playing ? 'playing' : 'paused';
    if (st.duration > 0 && Number.isFinite(st.duration)) {
      navigator.mediaSession.setPositionState({ duration: st.duration, position: Math.min(st.time, st.duration), playbackRate: rate });
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

// ---------- продолжение после сбоя ----------
// Что играет сейчас: очередь, номер трека и секунда. Если система выгрузила страницу ради памяти при выключенном экране,
// приложение собирает её заново (MainActivity.rebuildWeb) и трек продолжается с того же места.
const SESS = 'mkw.session';
let sessT = 0;
function saveSession(force) {
  const now = Date.now();
  if (!force && now - sessT < 5000) return;
  sessT = now;
  try {
    const cur = queue.current;
    if (!cur) { localStorage.removeItem(SESS); return; }
    const from = Math.max(0, queue.index - 30);
    const items = queue.items.slice(from, from + 100);
    localStorage.setItem(SESS, JSON.stringify({ items, index: queue.index - from, time: st.time || 0, playing: st.playing, at: now }));
  } catch { /* переполнено — не страшно */ }
}
onPlayer((ev) => {
  if (ev === 'track' || ev === 'queue') saveSession(true);
  else if (ev === 'time' || ev === 'state') saveSession(ev === 'state');
});

/** Продолжить с того места, где оборвалось (не старше 15 минут). */
export function resumeSession() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SESS) || 'null'); } catch { s = null; }
  if (!s || !Array.isArray(s.items) || !s.items.length || !s.playing || Date.now() - (s.at || 0) > 15 * 60000) return false;
  if (queue.current) return false; // уже что-то играет
  const at = Math.max(0, (s.time || 0) - 1);
  playTracks(s.items, Math.min(s.items.length - 1, Math.max(0, s.index || 0)));
  if (at > 3) {
    const off = onPlayer((ev) => {
      if (ev === 'state' && st.playing && st.duration > at) { off(); try { seek(at); } catch { /* ignore */ } }
      if (ev === 'track') off();
    });
    setTimeout(off, 30000);
  }
  return true;
}

// ---------- быстрый старт ----------
// Пока человек смотрит на список, заранее ищем звук для первых видимых треков: нажал — и музыка начинается сразу,
// без ожидания поиска. Не больше 3 треков за раз и не чаще раза в 20 секунд, чтобы не нагружать сеть и сервер.
let pfAt = 0;
const pfDone = new Set();
export function prefetchVisible() {
  if (!youtubeEnabled() || hiddenNow() || Date.now() - pfAt < 20000) return;
  pfAt = Date.now();
  const H = window.innerHeight;
  const rows = [...document.querySelectorAll('.track-row')].filter((r) => {
    if (!r._track || pfDone.has(r._track.id)) return false;
    const b = r.getBoundingClientRect();
    return b.height > 0 && b.top >= 0 && b.bottom <= H;
  }).slice(0, 3);
  for (const r of rows) {
    const t = r._track; pfDone.add(t.id);
    const known = t.ytId || peekYouTubeId(t);
    const go = (v) => { if (v && streamsOn()) resolveStream(v, t); };
    if (known) go(known); else findYouTubeId(t).then(go).catch(() => {});
  }
}

// ---------- экран выключен: следующий трек должен начаться сразу и полностью ----------
// 1) За 45 секунд до конца трека ещё раз проверяем, что звук следующего найден (ссылки могли не успеть найтись или устареть).
// 2) Держим «запас»: 2–3 трека из лайков, для которых звук уже найден. Если следующий трек в фоне не нашёлся —
//    вместо фрагмента 30 сек сразу играет трек из лайков, полностью.
const spares = []; // { t, key }
let spareAt = 0, aheadFor = '';
const keyOf = (t) => t.ytId || peekYouTubeId(t);
function spareReady() { return spares.some((x) => peekStream(x.key)); }
function warmSpares() {
  if (!streamsOn() || !lib.likes.length || Date.now() - spareAt < 60000) return;
  spareAt = Date.now();
  const cur = new Set(queue.items.slice(Math.max(0, queue.index - 3), queue.index + 4).map((t) => String(t.id)));
  for (let i = spares.length - 1; i >= 0; i--) if (cur.has(String(spares[i].t.id)) || !peekStream(spares[i].key)) spares.splice(i, 1);
  const pool = lib.likes.filter((t) => !cur.has(String(t.id)) && !t.auId && !spares.some((x) => x.t.id === t.id));
  for (let n = spares.length; n < 3 && pool.length; n++) {
    const t = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    const add = (k) => { if (k) resolveStream(k, t).then((u) => { if (u && u.length && !spares.some((x) => x.t.id === t.id)) spares.push({ t, key: k }); }); };
    const k = keyOf(t);
    if (k) add(k); else findYouTubeId(t).then((v) => add(v || `sc:${t.id}`)).catch(() => add(`sc:${t.id}`));
  }
}
function playSpare(failed, id) {
  if (id !== loadId || !streamsOn()) return false;
  const i = spares.findIndex((x) => peekStream(x.key) && String(x.t.id) !== String(failed && failed.id));
  if (i < 0) return false;
  const { t } = spares.splice(i, 1)[0];
  queue.addNext(t);
  queue.next(false);
  spareAt = 0;
  startCurrent();
  return true;
}
onPlayer((ev) => {
  if (ev !== 'time' || !bgNow() || !st.playing || !queue.current) return;
  const left = (st.duration || 0) - (st.time || 0);
  if (left > 0 && left < 45 && aheadFor !== queue.current.id) {
    aheadFor = queue.current.id;
    const nxt = queue.items[queue.index + 1];
    if (nxt) {
      const k = keyOf(nxt);
      if (k && !peekStream(k)) resolveStream(k, nxt, true);
      else if (!k && youtubeEnabled()) findYouTubeId(nxt).then((v) => { if (v) resolveStream(v, nxt, true); }).catch(() => {});
    }
    warmSpares();
  }
});
const onBg = () => { if (bgNow() && st.playing) { warmSpares(); prefetchNext(); } };
document.addEventListener('visibilitychange', onBg);
window.addEventListener('mkw-fg', onBg);
