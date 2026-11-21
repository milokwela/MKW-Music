// Видеосообщения-«кружки» как в Telegram.
// Запись: фронтальная камера, удержание, замочек вверх, отмена влево, переворот камеры и белая подсветка экрана.
// Хранение: само видео не влезает в документ Firestore (лимит 1 МБ), поэтому режем его на части
// chats/{cid}/msgs/{mid}/v/{номер}. В сообщении лежат только размеры, длительность, постер и флаг готовности.
// Старые версии MKW видят текст «🎥 Видеосообщение» и продолжают работать как раньше.
import { h, toast } from './ui.js';
import { mi } from './icons2.js';
import { db } from './firebase.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import * as player from './player.js';

export const CIRCLE_TXT = '🎥 Видеосообщение';
export const CIRCLE_MAX = 60;          // секунд: столько же, сколько примерно в Telegram (увеличен до 1 минуты)
export const CIRCLE_CHUNK = 360000;    // символов base64 в одном документе (с запасом до 1 МБ)

const RAW = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1, sampleRate: { ideal: 48000 } };
const VIDEO_MIMES = [
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
];

export const canCircle = () => Boolean(
  window.MediaRecorder
  && navigator.mediaDevices
  && navigator.mediaDevices.getUserMedia
);

export const isCircle = (m) => Boolean(m && m.vid && typeof m.vid === 'object' && Number(m.vid.v) === 1);

const mmss = (sec) => {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function videoMime() {
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
  return VIDEO_MIMES.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

// ---------- проигрывание ----------
// Готовые ссылки на видео держим в памяти: перерисовка чата не должна каждый раз скачивать файл заново.
const urlCache = new Map();
const cacheKey = (cid, id) => `${cid}/${id}`;
function cachePut(key, url) {
  if (urlCache.size >= 24) {
    const first = urlCache.entries().next().value;
    if (first) { urlCache.delete(first[0]); try { URL.revokeObjectURL(first[1]); } catch { /* ignore */ } }
  }
  urlCache.set(key, url);
}

async function loadVideo(cid, id, vid) {
  const key = cacheKey(cid, id);
  const hit = urlCache.get(key);
  if (hit) return hit;
  const snap = await getDocs(collection(db, 'chats', cid, 'msgs', id, 'v'));
  if (!snap.size) throw new Error('empty');
  const parts = snap.docs
    .map((d) => ({ i: Number(d.id) || 0, s: String((d.data() || {}).d || '') }))
    .sort((a, b) => a.i - b.i);
  const b64 = parts.map((p) => p.s).join('');
  if (!b64) throw new Error('empty');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: vid.mt || 'video/webm' });
  const url = URL.createObjectURL(blob);
  cachePut(key, url);
  return url;
}

export function circleBubble(cid, id, vid) {
  const dur = Math.max(0, Number(vid && vid.dur) || 0);
  const ready = vid && vid.ready !== false && !vid.err;
  const box = h('div', {
    class: `ch-circ${vid && vid.front ? ' front' : ''}${ready ? '' : ' wait'}${vid && vid.err ? ' err' : ''}`,
    'data-cid': cid, 'data-mid': id,
  });
  box.style.setProperty('--p', '0');
  const video = h('video', {
    class: 'ch-cvideo', playsinline: '', 'webkit-playsinline': '', preload: 'metadata',
    poster: vid && vid.p ? vid.p : undefined,
  });
  video.muted = false;
  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ring.setAttribute('class', 'ch-cring');
  ring.setAttribute('viewBox', '0 0 100 100');
  ring.setAttribute('aria-hidden', 'true');
  const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  track.setAttribute('cx', '50'); track.setAttribute('cy', '50'); track.setAttribute('r', '47');
  const fg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  fg.setAttribute('cx', '50'); fg.setAttribute('cy', '50'); fg.setAttribute('r', '47');
  fg.setAttribute('class', 'ch-cring-fg');
  ring.appendChild(track); ring.appendChild(fg);
  const RC = 2 * Math.PI * 47;
  fg.style.strokeDasharray = String(RC);
  fg.style.strokeDashoffset = String(RC);
  const play = h('span', { class: 'ch-cplay' }, mi('play'));
  const spin = h('span', { class: 'ch-cload' }, h('i'));
  const time = h('span', { class: 'ch-ctime', text: mmss(dur) });
  const mute = h('button', { class: 'ch-cmute', type: 'button', title: 'Звук', 'aria-label': 'Включить или выключить звук' }, mi('volume'));
  const main = h('div', {
    class: 'ch-cmain', role: 'button', tabindex: '0',
    'aria-label': 'Видеосообщение. Нажмите, чтобы смотреть',
  }, video, ring, play, spin, time, mute);
  box.appendChild(main);

  let url = urlCache.get(cacheKey(cid, id)) || '';
  let loading = null;
  let failed = false;
  let scrubbing = false;
  let seeking = false;
  let wasPlaying = false;
  let lastAngle = 0;
  let acc = 0;
  let dragged = false;

  const setP = (f) => {
    const p = Math.max(0, Math.min(1, Number(f) || 0));
    box.style.setProperty('--p', String(p));
    fg.style.strokeDashoffset = String(RC * (1 - p));
  };
  const total = () => {
    const d = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : dur;
    return d || 1;
  };
  const paintTime = (elapsed) => { time.textContent = mmss(elapsed != null ? elapsed : total()); };
  const setPlaying = (on) => {
    box.classList.toggle('playing', on);
    play.replaceChildren(mi(on ? 'pause' : 'play'));
  };
  const showError = (text) => {
    failed = true;
    box.classList.add('err');
    box.classList.remove('loading');
    play.replaceChildren(mi('refresh'));
    time.textContent = text || 'Повторить';
  };
  const updateMute = () => { mute.classList.toggle('off', video.muted); mute.replaceChildren(mi(video.muted ? 'volume-off' : 'volume')); };
  updateMute();
  if (!ready) {
    box.classList.add('loading');
    time.textContent = vid && vid.err ? 'Не загрузилось' : 'Загрузка…';
  }
  if (url) { video.src = url; box.classList.remove('wait'); }

  const ensure = async () => {
    if (url) return url;
    if (failed) { failed = false; box.classList.remove('err'); }
    if (!ready) {
      if (vid && vid.err) { showError('Не загрузилось'); return ''; }
      toast('Кружок ещё загружается — попробуйте через пару секунд');
      return '';
    }
    if (loading) return loading;
    box.classList.add('loading');
    play.replaceChildren(mi('play'));
    loading = (async () => {
      try {
        url = await loadVideo(cid, id, vid);
        video.src = url;
        box.classList.remove('loading');
        return url;
      } catch {
        box.classList.remove('loading');
        showError('Не загрузилось');
        return '';
      } finally { loading = null; }
    })();
    return loading;
  };

  const playIt = async () => {
    const u = await ensure();
    if (!u) return;
    if (player.st.playing) player.pause();
    try {
      await video.play();
    } catch {
      // браузер не разрешил звук (на iPhone жест «потерялся» за загрузкой) — играем без звука,
      // а динамик включается кнопкой в углу кружка
      video.muted = true; updateMute();
      try { await video.play(); toast('Звук выключен — включите кнопкой с динамиком'); }
      catch { showError('Не открывается'); }
    }
  };
  const toggle = () => {
    if (failed) { ensure().then((u) => { if (u) playIt(); }); return; }
    if (!url) { playIt(); return; }
    if (video.paused) playIt(); else video.pause();
  };

  video.addEventListener('loadedmetadata', () => { paintTime(video.currentTime || 0); });
  video.addEventListener('timeupdate', () => {
    if (seeking) return;
    const d = total();
    setP(video.currentTime / d);
    paintTime(video.currentTime);
  });
  video.addEventListener('playing', () => setPlaying(true));
  video.addEventListener('pause', () => setPlaying(false));
  video.addEventListener('ended', () => { setPlaying(false); setP(0); paintTime(total()); });
  video.addEventListener('waiting', () => box.classList.add('loading'));
  video.addEventListener('canplay', () => box.classList.remove('loading'));
  video.addEventListener('error', () => { if (url) showError('Не открывается'); });

  main.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });
  mute.addEventListener('click', (e) => {
    e.stopPropagation();
    video.muted = !video.muted;
    updateMute();
    if (video.paused) playIt();
  });

  // перемотка «по кругу»: ведём палец вокруг кружка, время едет за углом
  const angleAt = (e) => {
    const r = main.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2);
    const y = e.clientY - (r.top + r.height / 2);
    return Math.atan2(x, -y);
  };
  main.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.ch-cmute')) return;
    e.preventDefault();
    if (!url) { toggle(); return; }
    lastAngle = angleAt(e);
    acc = Math.max(0, Math.min(1, (video.currentTime || 0) / total()));
    wasPlaying = !video.paused;
    scrubbing = true;
    seeking = false;
    dragged = false;
    try { main.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    box.classList.add('scrub');
  });
  main.addEventListener('pointermove', (e) => {
    if (!scrubbing) return;
    const a = angleAt(e);
    let d = a - lastAngle;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) < 0.004) return;
    lastAngle = a;
    if (!seeking) { seeking = true; if (!video.paused) video.pause(); }
    dragged = true;
    acc = (acc + d / (Math.PI * 2) + 1) % 1;
    const d2 = total();
    try { video.currentTime = acc * d2; } catch { /* ignore */ }
    setP(acc);
    paintTime(acc * d2);
  });
  const endScrub = () => {
    if (!scrubbing) return;
    scrubbing = false; seeking = false;
    box.classList.remove('scrub');
    if (dragged) {
      if (wasPlaying) playIt();
      setTimeout(() => { dragged = false; }, 80);
    } else if (wasPlaying) {
      video.pause();
    } else {
      playIt();
    }
  };
  main.addEventListener('pointerup', endScrub);
  main.addEventListener('pointercancel', endScrub);
  main.addEventListener('lostpointercapture', endScrub);

  return box;
}

// ---------- запись ----------
let activeClose = null;
export function closeCircleRecorder() { if (activeClose) activeClose(); }

export function openCircleRecorder({ onSend, onClose } = {}) {
  if (!canCircle()) { toast('Этот браузер не умеет записывать видео'); return null; }
  if (document.querySelector('.crc')) return null;
  if (player.st.playing) player.pause();

  let stream = null;
  let mr = null;
  let chunks = [];
  let recT0 = 0;
  let timer = 0;
  let front = true;
  let light = false;
  let mode = 'camera';
  let blob = null;
  let dur = 0;
  let poster = '';
  let mime = '';
  let pvUrl = '';
  let closed = false;
  let sendBusy = false;
  let locked = false;
  let stopping = false;
  let press = null;
  let wake = null;

  const overlay = h('div', { class: 'crc', 'data-mode': 'camera', 'data-light': '0', role: 'dialog', 'aria-label': 'Видеосообщение' });
  const live = h('video', { class: 'crc-live', autoplay: '', muted: '', playsinline: '', 'webkit-playsinline': '' });
  const pv = h('video', { class: 'crc-pv', playsinline: '', 'webkit-playsinline': '', loop: '', muted: '' });
  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ring.setAttribute('class', 'crc-ring');
  ring.setAttribute('viewBox', '0 0 100 100');
  ring.setAttribute('aria-hidden', 'true');
  const rTrack = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  rTrack.setAttribute('cx', '50'); rTrack.setAttribute('cy', '50'); rTrack.setAttribute('r', '47');
  const rFg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  rFg.setAttribute('cx', '50'); rFg.setAttribute('cy', '50'); rFg.setAttribute('r', '47');
  rFg.setAttribute('class', 'crc-ring-fg');
  ring.appendChild(rTrack); ring.appendChild(rFg);
  const RC = 2 * Math.PI * 47;
  rFg.style.strokeDasharray = String(RC);
  rFg.style.strokeDashoffset = String(RC);

  const count = h('b', { class: 'crc-count', text: '0:00' });
  const cap = h('small', { class: 'crc-cap', text: `до ${CIRCLE_MAX} сек` });
  const hint = h('span', { class: 'crc-hint', text: 'Нажмите и держите — запись' });
  const spinner = h('div', { class: 'crc-spin', hidden: '' }, h('i'));
  const sendInfo = h('div', { class: 'crc-sendinfo', hidden: '' }, h('i'), h('b', { text: 'Отправляем…' }));

  const closeBtn = h('button', { class: 'crc-x', type: 'button', 'aria-label': 'Закрыть', title: 'Закрыть' }, mi('close'));
  const flipBtn = h('button', { class: 'crc-flip', type: 'button', 'aria-label': 'Перевернуть камеру', title: 'Перевернуть камеру' }, mi('flip-camera'));
  const lightBtn = h('button', { class: 'crc-light', type: 'button', 'aria-label': 'Подсветка', title: 'Подсветка экраном' }, mi('flash'));
  const soundBtn = h('button', { class: 'crc-sound', type: 'button', 'aria-label': 'Звук', title: 'Звук' }, mi('volume'));
  const trashBtn = h('button', { class: 'crc-trash', type: 'button', 'aria-label': 'Переснять', title: 'Переснять' }, mi('trash'));
  const shutter = h('button', { class: 'crc-shutter', type: 'button', 'aria-label': 'Записать кружок' }, h('i'));
  const sendBtn = h('button', { class: 'crc-send', type: 'button', 'aria-label': 'Отправить кружок', title: 'Отправить' }, mi('send'));

  const stage = h('div', { class: 'crc-stage' },
    h('div', { class: 'crc-circle' }, live, pv, ring, spinner),
    h('div', { class: 'crc-meta' }, count, cap),
    h('div', { class: 'crc-bottom' }, hint));
  const actions = h('div', { class: 'crc-actions' }, trashBtn, shutter, sendBtn);
  overlay.append(
    h('header', { class: 'crc-top' },
      closeBtn,
      h('div', { class: 'crc-title' }, h('b', { text: 'Видеосообщение' }), h('small', { text: 'Кружок' })),
      flipBtn, lightBtn, soundBtn),
    stage,
    actions,
    sendInfo);
  document.body.appendChild(overlay);
  document.body.classList.add('circ-open');

  const setProgress = (f) => {
    const p = Math.max(0, Math.min(1, Number(f) || 0));
    rFg.style.strokeDashoffset = String(RC * (1 - p));
  };
  const setHint = (t) => { hint.textContent = t; };
  const setMode = (m) => {
    mode = m;
    overlay.dataset.mode = m;
    if (m === 'camera') {
      setProgress(0); count.textContent = '0:00'; cap.textContent = `до ${CIRCLE_MAX} сек`;
      setHint('Нажмите и держите — запись. Отпустите — отправить');
      shutter.setAttribute('aria-label', 'Записать кружок');
      spinner.hidden = true;
      sendInfo.hidden = true;
    } else if (m === 'rec') {
      cap.textContent = `из ${CIRCLE_MAX} сек`;
      setHint(locked ? 'Запись закреплена — нажмите, чтобы остановить' : 'Влево — отмена · Вверх — закрепить');
      shutter.setAttribute('aria-label', locked ? 'Остановить запись' : 'Записать кружок');
      spinner.hidden = true;
      sendInfo.hidden = true;
    } else if (m === 'preview') {
      setProgress(1); count.textContent = mmss(dur); cap.textContent = 'так будет выглядеть';
      setHint('Можно переснять или отправить');
      spinner.hidden = true;
      sendInfo.hidden = true;
    } else if (m === 'sending') {
      setHint('Отправляем кружок…');
      spinner.hidden = false;
      sendInfo.hidden = false;
    }
  };

  const stopTracks = () => {
    if (stream) { stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } }); }
    stream = null;
  };
  const revokePv = () => { if (pvUrl) { try { URL.revokeObjectURL(pvUrl); } catch { /* ignore */ } pvUrl = ''; } };

  const applyTorch = () => {
    if (!stream) return;
    const t = stream.getVideoTracks()[0];
    if (!t || !t.applyConstraints) return;
    try {
      const caps = t.getCapabilities ? t.getCapabilities() : {};
      if (caps && caps.torch) t.applyConstraints({ advanced: [{ torch: light }] }).catch(() => {});
    } catch { /* ignore */ }
  };

  const setSound = () => {
    soundBtn.classList.toggle('off', pv.muted);
    soundBtn.replaceChildren(mi(pv.muted ? 'volume-off' : 'volume'));
  };
  const setLight = (on) => {
    light = on;
    overlay.dataset.light = on ? '1' : '0';
    lightBtn.classList.toggle('on', on);
    applyTorch();
  };

  const showSpinner = (on) => { spinner.hidden = !on; };

  async function openCam(keep) {
    stopTracks();
    showSpinner(true);
    let asked = { video: { facingMode: { ideal: front ? 'user' : 'environment' }, width: { ideal: 640 }, height: { ideal: 640 }, frameRate: { ideal: 24, max: 30 } }, audio: RAW };
    try {
      stream = await navigator.mediaDevices.getUserMedia(asked);
    } catch {
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: front ? 'user' : 'environment' }, audio: RAW }); }
      catch {
        try { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); }
        catch {
          try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: front ? 'user' : 'environment' }, audio: false });
            toast('Микрофон недоступен — кружок будет без звука');
          } catch {
            showSpinner(false);
            if (!keep && !closed) close();
            toast('Не удалось включить камеру. Разрешите доступ в настройках браузера');
            return false;
          }
        }
      }
    }
    if (closed) { stopTracks(); return false; }
    live.srcObject = stream;
    live.muted = true;
    // фронталка в зеркале, как в Telegram
    const vt = stream.getVideoTracks()[0];
    try {
      const st = vt && vt.getSettings ? vt.getSettings() : {};
      if (st.facingMode === 'user') front = true;
      else if (st.facingMode === 'environment') front = false;
    } catch { /* ignore */ }
    live.style.transform = front ? 'scaleX(-1)' : '';
    try { await live.play(); } catch { /* ignore */ }
    showSpinner(false);
    applyTorch();
    return true;
  }

  async function flipCam() {
    if (mode === 'rec' || mode === 'sending') { toast('Сначала остановите запись'); return; }
    if (mode === 'preview') { toast('Нажмите «Переснять», чтобы сменить камеру'); return; }
    front = !front;
    const ok = await openCam(true);
    if (closed) return;
    if (!ok) {
      front = !front;
      const back = await openCam(true);
      if (!back && !closed) toast('Камера недоступна. Попробуйте ещё раз');
    }
    if (!closed && navigator.vibrate) navigator.vibrate(8);
  }

  function tick() {
    const sec = Math.max(0, (performance.now() - recT0) / 1000);
    count.textContent = mmss(sec);
    setProgress(sec / CIRCLE_MAX);
    if (sec >= CIRCLE_MAX - 3 && sec < CIRCLE_MAX) setHint(`Осталось ${Math.max(1, Math.ceil(CIRCLE_MAX - sec))} с`);
    if (sec >= CIRCLE_MAX) stopRec(false);
  }

  async function startRec() {
    if (mode !== 'camera' || !stream || mr) return;
    const v = stream.getVideoTracks()[0];
    if (!v) { toast('Камера ещё включается'); return; }
    const wanted = videoMime();
    chunks = [];
    try {
      mr = new MediaRecorder(stream, {
        ...(wanted ? { mimeType: wanted } : {}),
        videoBitsPerSecond: 650000,
        audioBitsPerSecond: 48000,
      });
    } catch {
      try { mr = new MediaRecorder(stream); } catch { mr = null; }
    }
    if (!mr) { toast('Этот браузер не умеет записывать видео'); return; }
    mime = mr.mimeType || wanted || 'video/webm';
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onerror = () => { if (mode === 'rec') { toast('Запись прервалась'); stopRec(true); } };
    mr.onstop = () => finalize();
    recT0 = performance.now();
    stopping = false;
    locked = false;
    try { mr.start(500); } catch { toast('Не получилось начать запись'); mr = null; return; }
    setMode('rec');
    tick();
    timer = setInterval(tick, 100);
    if (navigator.vibrate) navigator.vibrate(15);
  }

  function stopRec(cancel) {
    if (stopping) return;
    stopping = true;
    clearInterval(timer); timer = 0;
    if (mr && mr.state !== 'inactive') {
      mr.__cancel = Boolean(cancel);
      try { mr.stop(); } catch { finalize(); }
    } else {
      finalize();
    }
  }

  function posterOf(b, mirror) {
    return new Promise((res) => {
      const v = document.createElement('video');
      const u = URL.createObjectURL(b);
      let done = false;
      const fin = (out) => {
        if (done) return; done = true;
        try { v.pause(); v.removeAttribute('src'); v.load(); } catch { /* ignore */ }
        try { URL.revokeObjectURL(u); } catch { /* ignore */ }
        res(out || '');
      };
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = u;
      v.onloadeddata = () => { try { v.currentTime = Math.min(0.2, (v.duration || 1) / 3); } catch { fin(); } };
      v.onseeked = () => {
        try {
          const S = 240, c = document.createElement('canvas');
          c.width = S; c.height = S;
          const g = c.getContext('2d');
          const vw = v.videoWidth || S, vh = v.videoHeight || S;
          const k = Math.max(S / vw, S / vh), w = vw * k, hh = vh * k;
          g.save();
          if (mirror) { g.translate(S, 0); g.scale(-1, 1); }
          g.drawImage(v, (S - w) / 2, (S - hh) / 2, w, hh);
          g.restore();
          fin(c.toDataURL('image/jpeg', 0.72));
        } catch { fin(); }
      };
      v.onerror = () => fin();
      setTimeout(() => fin(), 3500);
    });
  }

  async function finalize() {
    clearInterval(timer); timer = 0;
    const wasCancel = Boolean(mr && mr.__cancel) || stopping && overlay.dataset.cancel === '1';
    mr = null;
    overlay.dataset.cancel = '';
    if (wasCancel) {
      chunks = [];
      stopTracks();
      // свернули приложение — камеру не включаем заново, окно закрываем
      if (document.hidden) { close(); return; }
      if (!closed) { setMode('camera'); await openCam(); }
      return;
    }
    const sec = Math.max(0, (performance.now() - recT0) / 1000);
    if (!chunks.length || sec < 0.8) {
      chunks = [];
      stopTracks();
      toast(sec < 0.8 ? 'Слишком короткий кружок' : 'Не получилось записать видео');
      if (!closed) { setMode('camera'); await openCam(); }
      return;
    }
    blob = new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] });
    chunks = [];
    dur = sec;
    stopTracks();
    if (!blob.size) {
      blob = null;
      toast('Не получилось записать видео');
      if (!closed) { setMode('camera'); await openCam(); }
      return;
    }
    poster = await posterOf(blob, front);
    if (closed) return;
    revokePv();
    pvUrl = URL.createObjectURL(blob);
    pv.src = pvUrl;
    pv.style.transform = front ? 'scaleX(-1)' : '';
    pv.muted = false;
    setSound();
    setMode('preview');
    try { await pv.play(); }
    catch { pv.muted = true; setSound(); try { await pv.play(); } catch { /* ignore */ } }
    setLight(false);
    if (navigator.vibrate) navigator.vibrate(10);
  }

  async function retake() {
    if (sendBusy) return;
    revokePv();
    blob = null; dur = 0; poster = '';
    setMode('camera');
    await openCam();
  }

  async function doSend() {
    if (!blob || sendBusy || mode !== 'preview') return;
    sendBusy = true;
    setMode('sending');
    let ok = false;
    let err = null;
    try {
      ok = await onSend && await onSend(
        { blob, dur, front, mime: (mime || 'video/webm').split(';')[0], poster, w: live.videoWidth || pv.videoWidth || 0, h: live.videoHeight || pv.videoHeight || 0 },
        (done, total) => {
          const f = total ? done / total : 0;
          setProgress(f);
          const b = sendInfo.querySelector('b');
          if (b) b.textContent = `Отправляем… ${Math.round(f * 100)}%`;
        },
      );
    } catch (e) { err = e; ok = false; }
    sendBusy = false;
    if (closed) return;
    if (ok) { close(); return; }
    setMode('preview');
    setProgress(1);
    // про правила и слишком большой файл уже сказали свои подсказки — не перебиваем их общим «не отправился»
    const why = String((err && err.message) || '');
    if (why !== 'rules' && why !== 'too big') toast('Кружок не отправился. Попробуйте ещё раз');
  }

  async function close() {
    if (closed) return;
    closed = true;
    activeClose = null;
    clearInterval(timer); timer = 0;
    if (press && press.timer) clearTimeout(press.timer);
    press = null;
    stopping = true;
    if (mr && mr.state !== 'inactive') { try { mr.onstop = null; mr.stop(); } catch { /* ignore */ } }
    mr = null;
    stopTracks();
    revokePv();
    if (blob) { blob = null; }
    if (wake) { try { wake.release(); } catch { /* ignore */ } wake = null; }
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVis);
    overlay.remove();
    document.body.classList.remove('circ-open');
    if (onClose) { try { onClose(); } catch { /* ignore */ } }
  }
  function onBlur() { if (mode === 'rec') stopRec(true); }
  function onVis() { if (document.hidden && mode === 'rec') stopRec(true); }
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVis);

  closeBtn.addEventListener('click', close);
  flipBtn.addEventListener('click', flipCam);
  lightBtn.addEventListener('click', () => setLight(!light));
  soundBtn.addEventListener('click', () => { pv.muted = !pv.muted; setSound(); if (pv.paused) pv.play().catch(() => {}); });
  trashBtn.addEventListener('click', retake);
  sendBtn.addEventListener('click', doSend);
  pv.addEventListener('click', () => { if (pv.paused) pv.play().catch(() => {}); else pv.pause(); });

  // удержание: держите — запись идёт, отпустите — сразу отправить; короткое касание — запись «на замке».
  // Запись начинается через 120 мс, чтобы случайное касание не отправляло пустой кружок.
  shutter.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    if (mode === 'rec') { stopRec(false); return; }
    if (mode !== 'camera') return;
    try { shutter.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    press = { x: e.clientX, y: e.clientY, id: e.pointerId, started: 0, up: false, timer: 0 };
    shutter.classList.add('arming');
    press.timer = setTimeout(async () => {
      if (!press) return;
      press.started = performance.now();
      shutter.classList.remove('arming');
      await startRec();
      if (!press) return;
      if (press.up && mode === 'rec') {
        // палец уже отпустили, пока камера включалась, — закрепляем запись
        locked = true;
        setMode('rec');
        press = null;
        if (navigator.vibrate) navigator.vibrate(10);
      }
    }, 120);
  });
  shutter.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id || mode !== 'rec' || locked) return;
    const dx = e.clientX - press.x, dy = e.clientY - press.y;
    overlay.style.setProperty('--dx', `${Math.max(-110, Math.min(20, dx))}px`);
    overlay.style.setProperty('--dy', `${Math.max(-90, Math.min(20, dy))}px`);
    if (dx < -100) {
      const p = press; press = null; clearTimeout(p.timer);
      stopRec(true);
      toast('Запись отменена');
      return;
    }
    if (dy < -70) {
      locked = true;
      setMode('rec');
      overlay.style.removeProperty('--dx');
      overlay.style.removeProperty('--dy');
      if (navigator.vibrate) navigator.vibrate(12);
    }
  });
  const release = (e, cancel) => {
    if (!press || (e && e.pointerId !== press.id)) return;
    const p = press;
    shutter.classList.remove('arming');
    overlay.style.removeProperty('--dx');
    overlay.style.removeProperty('--dy');
    if (mode !== 'rec') {
      // запись ещё не началась: короткое касание запустит её и закрепит, отмена — не запустит
      if (cancel) { clearTimeout(p.timer); press = null; return; }
      p.up = true;
      return;
    }
    press = null;
    clearTimeout(p.timer);
    if (cancel) { stopRec(true); return; }
    if (locked) return;
    const held = performance.now() - (p.started || recT0);
    if (held < 650) {
      locked = true;
      setMode('rec');
      if (navigator.vibrate) navigator.vibrate(10);
      return;
    }
    stopRec(false);
  };
  shutter.addEventListener('pointerup', (e) => release(e, false));
  shutter.addEventListener('pointercancel', (e) => release(e, true));
  shutter.addEventListener('lostpointercapture', (e) => { if (press && mode === 'rec' && !locked) release(e, true); });

  setMode('camera');
  activeClose = close;
  openCam().then((ok) => {
    if (!ok) return;
    if ('wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then((w) => { wake = w; }).catch(() => {});
    }
  });
  return { close };
}
