// Управление жестами через камеру (MediaPipe GestureRecognizer, модель грузится с CDN).
// Два пальца: следующий. Рок: предыдущий. Большой вверх: лайк. Средний палец: снять лайк. Большой вниз: дизлайк.
// Ладонь: пауза. Палец вверх: продолжить. Кулак: тише. Три пальца: громче.
import { h, toast, openSheet, closeSheet } from './ui.js?v=0.18.0';
import { mi } from './icons2.js?v=0.18.0';
import * as player from './player.js?v=0.18.0';
import * as store from './store.js?v=0.18.0';
import { dislike } from './wave.js?v=0.18.0';

const KEY = 'mkw.gestures';
const LIB = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';
export const GESTURES = [
  ['hand-peace', 'Два пальца', 'Следующий трек'],
  ['hand-rock', 'Большой, указательный и мизинец', 'Предыдущий трек'],
  ['thumb-up', 'Большой палец вверх', 'Лайк'],
  ['hand-middle', 'Средний палец', 'Снять лайк'],
  ['thumb-down', 'Большой палец вниз', 'Дизлайк и следующий'],
  ['hand-open', 'Открытая ладонь', 'Пауза'],
  ['hand-point', 'Указательный вверх', 'Продолжить'],
  ['hand-fist', 'Кулак', 'Тише'],
  ['hand-three', 'Три пальца: указательный, средний, безымянный', 'Громче'],
];
export function gestureList() {
  return h('div', { class: 'gest-list' }, GESTURES.map(([e, how, what]) => h('div', { class: 'gest-item' },
    h('span', { class: 'ge' }, mi(e)), h('div', {}, h('b', { text: what }), h('small', { text: how })))));
}
export function showGestureGuide() {
  openSheet('Жесты', h('div', {}, gestureList(), h('p', { class: 'profile-note', text: 'Держите жест около секунды на расстоянии вытянутой руки, чтобы рука была видна целиком. Должно быть светло.' })));
}

const COOLDOWN_MS = 2000, STEP_MS = 90;

let on = false, running = false, video = null, stream = null, rec = null, timer = 0;
let lastAct = 0, badge = null;

export const gesturesOn = () => on;

function act(name) {
  const now = Date.now();
  const repeat = name === 'vol-up' || name === 'vol-down';
  if (now - lastAct < (repeat ? 900 : COOLDOWN_MS)) return;
  lastAct = now;
  const t = player.queue.current;
  if (name === 'Victory') { toast('Следующий трек'); player.next(); }
  else if (name === 'ILoveYou') { toast('Предыдущий трек'); player.previousTrack(); }
  else if (name === 'Thumb_Up') { if (t && !store.isLiked(t.id)) { store.toggleLike(t).catch(() => {}); toast('Добавлено в лайки'); } }
  else if (name === 'middle') { if (t && store.isLiked(t.id)) { store.toggleLike(t).catch(() => {}); toast('Лайк снят'); } }
  else if (name === 'Thumb_Down') { toast('Дизлайк, пропускаю'); dislike(); }
  else if (name === 'Open_Palm') { player.pause(); toast('Пауза'); }
  else if (name === 'Pointing_Up') { if (!player.st.playing) { player.toggle(); toast('Продолжаем'); } }
  else if (name === 'vol-down') { const v = player.setVolume(player.getVolume() - 0.15); toast(`Громкость ${Math.round(v * 100)}%`); }
  else if (name === 'vol-up') { const v = player.setVolume(player.getVolume() + 0.15); toast(`Громкость ${Math.round(v * 100)}%`); }
}

// Свои жесты по 21 точке руки (в MediaPipe их нет): считаем, какие пальцы вытянуты.
// Палец вытянут, если его кончик заметно дальше от запястья, чем основание. Это не зависит от поворота руки.
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function fingerState(lm) {
  const w = lm[0];
  const ext = (tip, mcp) => dist(lm[tip], w) / Math.max(1e-6, dist(lm[mcp], w));
  const r = { index: ext(8, 5), middle: ext(12, 9), ring: ext(16, 13), pinky: ext(20, 17) };
  const up = (v) => v > 1.55, down = (v) => v < 1.35;
  return { r, up, down };
}
export function customGesture(lm) {
  if (!lm || lm.length < 21) return '';
  const { r, up, down } = fingerState(lm);
  if (up(r.middle) && down(r.index) && down(r.ring) && down(r.pinky)) return 'middle';
  if (up(r.index) && up(r.middle) && up(r.ring) && down(r.pinky)) return 'vol-up';
  return '';
}

const USEFUL = ['Victory', 'Thumb_Up', 'Thumb_Down', 'Open_Palm', 'Pointing_Up', 'ILoveYou', 'Closed_Fist'];
const win = [];   // последние кадры: голосуем, чтобы редкие пропуски распознавания не мешали

function loop() {
  if (!running) return;
  try {
    if (!document.hidden && video.readyState >= 2 && rec) {
      const res = rec.recognizeForVideo(video, performance.now());
      const g = res.gestures && res.gestures[0] && res.gestures[0][0];
      let name = g && g.score > 0.5 && USEFUL.includes(g.categoryName) ? g.categoryName : '';
      const custom = res.landmarks && res.landmarks[0] ? customGesture(res.landmarks[0]) : '';
      if (custom) name = custom;
      else if (name === 'Closed_Fist') name = 'vol-down';
      win.push(name);
      if (win.length > 8) win.shift();
      const counts = {};
      win.forEach((n) => { if (n) counts[n] = (counts[n] || 0) + 1; });
      const best = Object.entries(counts).sort((x, y) => y[1] - x[1])[0];
      // ладони хватает 4 кадров из 8, остальным нужно 5
      if (best && best[1] >= (best[0] === 'Open_Palm' ? 4 : 5)) { act(best[0]); win.length = 0; }
    }
  } catch (e) { console.error(e); }
  timer = setTimeout(loop, STEP_MS);
}

async function start() {
  // сначала камера (браузеры, особенно Яндекс, любят запрашивать доступ сразу после нажатия), потом тяжёлая модель
  stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
  const vision = await import(`${LIB}/vision_bundle.mjs`);
  const fileset = await vision.FilesetResolver.forVisionTasks(`${LIB}/wasm`);
  rec = await vision.GestureRecognizer.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL }, runningMode: 'VIDEO', numHands: 1,
  });
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
      gestureList(),
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
  try { await start(); on = true; try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } toast('Жесты включены. Держите жест около секунды'); }
  catch (e) {
    console.error(e); stop(); on = false;
    const n = e && e.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') cameraHelp();
    else if (n === 'NotFoundError' || n === 'OverconstrainedError') toast('Камера не найдена');
    else if (n === 'NotReadableError') toast('Камеру занимает другое приложение. Закройте его и повторите');
    else toast('Не загрузилась модель распознавания. Проверьте интернет и повторите');
  }
}

function cameraHelp() {
  openSheet('Нужен доступ к камере', h('div', {},
    h('p', { class: 'profile-note', text: 'Браузер не дал доступ к камере. Разрешите её для mkwmusic.ru и включите жесты снова:' }),
    h('p', { class: 'profile-note', text: 'Яндекс Браузер и Chrome на телефоне: значок слева от адреса (замок или настройки) → Разрешения → Камера → Разрешить. Если значка нет: меню ⋮ → Настройки → Настройки сайтов → Камера.' }),
    h('p', { class: 'profile-note', text: 'На iPhone: Настройки → Safari → Камера → Спросить или Разрешить. Если стоит «Запретить», доступа не будет.' }),
    h('p', { class: 'profile-note', text: 'Если приложение установлено на экран, проверьте разрешение камеры в настройках телефона для этого приложения или браузера.' }),
    h('button', { class: 'btn', type: 'button', onclick: closeSheet }, 'Понятно')));
}
