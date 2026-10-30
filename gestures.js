// Управление жестами через камеру (MediaPipe GestureRecognizer, модель грузится с CDN).
// ✌️ следующий, 👍 лайк, 👎 дизлайк, ✋ пауза, ☝️ продолжить.
import { h, toast, openSheet, closeSheet } from './ui.js?v=0.10.2';
import * as player from './player.js?v=0.10.2';
import * as store from './store.js?v=0.10.2';
import { dislike } from './wave.js?v=0.10.2';

const KEY = 'mkw.gestures';
const LIB = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';
const HOLD_MS = 600, COOLDOWN_MS = 2200, STEP_MS = 120;

let on = false, running = false, video = null, stream = null, rec = null, timer = 0;
let cand = '', since = 0, lastAct = 0, badge = null;

export const gesturesOn = () => on;

function act(name) {
  const now = Date.now();
  if (now - lastAct < COOLDOWN_MS) return;
  lastAct = now;
  if (name === 'Victory') { toast('✌️ Следующий'); player.next(); }
  else if (name === 'Thumb_Up') {
    const t = player.queue.current;
    if (t && !store.isLiked(t.id)) { store.toggleLike(t).catch(() => {}); toast('👍 В лайках'); }
  } else if (name === 'Thumb_Down') { toast('👎 Пропускаю'); dislike(); }
  else if (name === 'Open_Palm') { if (player.st.playing) { player.toggle(); toast('✋ Пауза'); } }
  else if (name === 'Pointing_Up') { if (!player.st.playing) { player.toggle(); toast('☝️ Играем'); } }
}

function loop() {
  if (!running) return;
  try {
    if (!document.hidden && video.readyState >= 2 && rec) {
      const res = rec.recognizeForVideo(video, performance.now());
      const g = res.gestures && res.gestures[0] && res.gestures[0][0];
      const name = g && g.score > 0.7 ? g.categoryName : '';
      const useful = ['Victory', 'Thumb_Up', 'Thumb_Down', 'Open_Palm', 'Pointing_Up'].includes(name) ? name : '';
      const now = Date.now();
      if (useful !== cand) { cand = useful; since = now; }
      else if (useful && now - since >= HOLD_MS) { act(useful); since = now + COOLDOWN_MS; }
    }
  } catch (e) { console.error(e); }
  timer = setTimeout(loop, STEP_MS);
}

async function start() {
  const vision = await import(`${LIB}/vision_bundle.mjs`);
  const fileset = await vision.FilesetResolver.forVisionTasks(`${LIB}/wasm`);
  rec = await vision.GestureRecognizer.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL }, runningMode: 'VIDEO', numHands: 1,
  });
  stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 320, height: 240 }, audio: false });
  video = h('video', { class: 'gest-video', playsinline: '', muted: '', autoplay: '' });
  video.srcObject = stream;
  badge = h('div', { class: 'gest-badge' }, video);
  document.body.appendChild(badge);
  await video.play();
  running = true;
  loop();
}

function stop() {
  running = false;
  clearTimeout(timer);
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  if (badge) badge.remove();
  badge = null;
  try { rec && rec.close(); } catch { /* ignore */ }
  rec = null;
}

const CKEY = 'mkw.gestures.consent';
const hasConsent = () => { try { return localStorage.getItem(CKEY) === '1'; } catch { return false; } };

function askConsent() {
  return new Promise((resolve) => {
    let ok = false;
    const chk = h('input', { type: 'checkbox', id: 'gest-ok' });
    const go = h('button', { class: 'btn', type: 'button', disabled: '' }, 'Включить жесты');
    chk.addEventListener('change', () => { if (chk.checked) go.removeAttribute('disabled'); else go.setAttribute('disabled', ''); });
    go.addEventListener('click', () => { ok = true; try { localStorage.setItem(CKEY, '1'); } catch { /* ignore */ } closeSheet(); resolve(true); });
    const no = h('button', { class: 'btn tonal', type: 'button' }, 'Отмена');
    no.addEventListener('click', () => { closeSheet(); });
    openSheet('Управление жестами', h('div', { class: 'pw-form' },
      h('p', { class: 'profile-note', text: 'Для жестов включается фронтальная камера. Картинка никуда не передаётся и не сохраняется: распознавание идёт прямо на вашем устройстве.' }),
      h('label', { class: 'consent' }, chk, h('span', { text: 'Я согласен: MKW не собирает мои данные с камеры и никуда их не передаёт' })),
      go, no));
    const t = setInterval(() => { if (!document.querySelector('#gest-ok')) { clearInterval(t); if (!ok) resolve(false); } }, 300);
  });
}

export async function setGestures(v) {
  if (v === on) return;
  if (v && !hasConsent() && !(await askConsent())) return;
  if (!v) { on = false; stop(); try { localStorage.setItem(KEY, '0'); } catch { /* ignore */ } return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('Браузер не даёт доступ к камере'); return; }
  toast('Включаю камеру и загружаю модель…');
  try { await start(); on = true; try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } toast('Жесты включены. Держите жест ~0,6 сек'); }
  catch (e) { console.error(e); stop(); on = false; toast('Не получилось включить жесты: нет камеры или модель не загрузилась'); }
}
