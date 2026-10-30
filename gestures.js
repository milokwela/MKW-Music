// Управление жестами через камеру (MediaPipe GestureRecognizer, модель грузится с CDN).
// ✌️ Victory — следующий, 👍 — лайк, 👎 — дизлайк, ✋ — пауза/пуск.
import { h, toast } from './ui.js?v=0.10.0';
import * as player from './player.js?v=0.10.0';
import * as store from './store.js?v=0.10.0';
import { dislike } from './wave.js?v=0.10.0';

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
  else if (name === 'Open_Palm') { player.toggle(); }
}

function loop() {
  if (!running) return;
  try {
    if (!document.hidden && video.readyState >= 2 && rec) {
      const res = rec.recognizeForVideo(video, performance.now());
      const g = res.gestures && res.gestures[0] && res.gestures[0][0];
      const name = g && g.score > 0.7 ? g.categoryName : '';
      const useful = ['Victory', 'Thumb_Up', 'Thumb_Down', 'Open_Palm'].includes(name) ? name : '';
      const now = Date.now();
      if (useful !== cand) { cand = useful; since = now; }
      else if (useful && now - since >= HOLD_MS) { act(useful); since = now + COOLDOWN_MS; }
      if (badge) badge.classList.toggle('seen', Boolean(useful));
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
  badge = h('div', { class: 'gest-badge' }, video, h('span', { text: '✌️' }));
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

export async function setGestures(v) {
  if (v === on) return;
  if (!v) { on = false; stop(); try { localStorage.setItem(KEY, '0'); } catch { /* ignore */ } return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('Браузер не даёт доступ к камере'); return; }
  toast('Включаю камеру и загружаю модель…');
  try { await start(); on = true; try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } toast('Жесты включены. Держите жест ~0,6 сек'); }
  catch (e) { console.error(e); stop(); on = false; toast('Не получилось включить жесты: нет камеры или модель не загрузилась'); }
}
