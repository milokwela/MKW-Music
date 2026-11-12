// Движок плавности. Сам подбирает качество графики под телефон и следит, чтобы интерфейс не терял кадры и не грел устройство.
//
// Уровни:
//   3 — максимум: всё как задумано (мощные телефоны и компьютеры);
//   2 — сбалансированно: размытие только у нижнего меню и мини-плеера, меньше украшений;
//   1 — лёгкий: без размытия и декоративных анимаций, переходы между экранами остаются;
//   0 — экономия: без анимаций вовсе.
//
// Откуда берётся уровень в режиме «Авто»:
//   1) что за устройство — память, процессор (в приложении это сообщает сам Android, в браузере — прикидка);
//   2) реальная плавность — во время прокрутки меряем кадры; если телефон не успевает, уровень снижается и запоминается;
//   3) нагрев и режим энергосбережения — пока телефон горячий или экономит заряд, эффекты убавляются (и экран идёт в 60 Гц).
//
// Кроме уровня движок сообщает остальным модулям, что приложение свёрнуто (inBg) или человек давно ничего не трогал (isIdle):
// в это время украшения стоят на паузе, и экран в покое не тратит ни процессор, ни батарею.

const MODE = 'mkw.q.mode'; // выбор человека: 'auto' | '0' … '3'
const CAP = 'mkw.q.cap';   // чему научились по реальной плавности: { v, at }
const LAST = 'mkw.q.last'; // последний уровень: при запуске включается сразу, до загрузки скриптов (см. index.html)
const CAP_DAYS = 7;        // через неделю пробуем уровень повыше снова — вдруг в тот день телефон просто был занят
const IDLE_MS = 20000;

const root = document.documentElement;
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ } };
const fire = (name, detail) => { try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch { /* ignore */ } };

export const device = () => (window.__MKW_APP && window.__MKW_APP.dev) || null;

let level = 3;
let thermal = 0;
let saver = false;
let memLow = false; // Android сообщил, что памяти мало: до конца сеанса обходимся без лишних слоёв размытия
let hzMax = null;

export const quality = () => level;
// для анонимной статистики (telemetry.js): как часто телефон не успевал, сколько раз пришлось убавить графику, нагрев
export const qStats = { probes: 0, bad: 0, medSum: 0, lostSum: 0, steps: 0, thMax: 0, saver: false, memLow: 0, batt: 0 };
export const qualityMode = () => { const m = get(MODE); return m === '0' || m === '1' || m === '2' || m === '3' ? m : 'auto'; };
export function setQualityMode(m) {
  put(MODE, m === 'auto' ? null : String(m));
  if (m === 'auto') put(CAP, null); // «Авто» выбрали заново — подбираем с чистого листа
  samples.length = 0;
  apply();
}

function baseLevel() {
  const d = device();
  // Huawei и Honor рисуют страницы своим движком (Huawei WebView), он заметно сильнее греет телефон на эффектах — максимум не включаем
  const hw = /huawei|honor/i.test((d && d.brand) || '') || /HUAWEI|HONOR|HarmonyOS/i.test(navigator.userAgent);
  if (d && typeof d.tier === 'number') return Math.max(1, Math.min(hw ? 2 : 3, d.tier + 1));
  if (!matchMedia('(pointer: coarse)').matches) return 3; // компьютер
  const mem = Number(navigator.deviceMemory) || 8;
  const cores = Number(navigator.hardwareConcurrency) || 8;
  if (mem <= 2 || cores <= 4) return 1;
  if (mem <= 4 || cores <= 6) return 2;
  return 3;
}

function learned() {
  try {
    const c = JSON.parse(get(CAP) || 'null');
    if (!c || typeof c.v !== 'number') return 3;
    if (Date.now() - (c.at || 0) > CAP_DAYS * 86400000) { put(CAP, null); return 3; }
    return Math.max(0, Math.min(3, c.v));
  } catch { return 3; }
}

function compute() {
  const mode = qualityMode();
  if (mode !== 'auto') return thermal >= 3 ? Math.min(Number(mode), 1) : Number(mode);
  let l = Math.min(baseLevel(), learned());
  if (saver) l = Math.min(l, 1);
  if (memLow) l = Math.min(l, 2);
  if (thermal >= 3) l = Math.min(l, 1); else if (thermal >= 2) l = Math.min(l, 2);
  return l;
}

function apply() {
  const l = compute();
  const changed = l !== level;
  level = l;
  root.classList.toggle('q3', l === 3);
  root.classList.toggle('q2', l === 2);
  root.classList.toggle('q1', l === 1);
  root.classList.toggle('lite', l <= 1);
  root.classList.toggle('lowpower', l === 0);
  put(LAST, String(l));
  // Частота экрана: всегда самая высокая и постоянная (без переключений — от них моргает экран).
  // Горячий телефон или энергосбережение — спокойные 60 Гц.
  const n = window.MKWNative;
  const hot = saver || thermal >= 3;
  if (n && n.refreshMode) {
    // В покое частоту больше не отдаём телефону: Pixel и другие экраны с переменной частотой начинают сами прыгать
    // 120↔60 Гц (строка текста поехала — остановилась), и на тёмном экране это видно как моргание.
    const mode = hot ? 'low' : 'max';
    if (mode !== hzMax) { hzMax = mode; try { n.refreshMode(mode); } catch { /* ignore */ } }
  } else {
    const want = !hot; // старые версии приложения умеют только «максимум» или «60 Гц» — в покое оставляем максимум
    if (want !== hzMax) { hzMax = want; try { if (n && n.refresh) n.refresh(want); } catch { /* старая версия приложения */ } }
  }
  if (changed) fire('mkw-q', l);
}

// ---------- свёрнуто / давно не трогали ----------

export const inBg = () => document.hidden || window.__mkwFg === false;
let idle = false;
let lastAct = Date.now();
let idleT = 0;
export const isIdle = () => idle;
/** Украшениям можно двигаться: приложение на экране и им недавно пользовались. */
export const awake = () => !idle && !inBg();

function syncBg() {
  root.classList.toggle('app-bg', inBg());
  fire('mkw-vis', !inBg());
  if (!inBg()) act();
}
function checkIdle() {
  idleT = 0;
  const left = IDLE_MS - (Date.now() - lastAct);
  if (left > 50) { idleT = setTimeout(checkIdle, left); return; }
  if (!idle) { idle = true; root.classList.add('app-idle'); fire('mkw-idle', true); apply(); }
}
function act() {
  lastAct = Date.now();
  if (idle) { idle = false; root.classList.remove('app-idle'); fire('mkw-idle', false); apply(); }
  if (!idleT) idleT = setTimeout(checkIdle, IDLE_MS);
}

// ---------- замер плавности ----------
// Меряем только пока человек листает (короткими окнами по 0,7 с), поэтому сам замер ничего не стоит в покое.

const samples = [];
let probing = false;
let quietUntil = 0;
let lastProbe = 0;
const bootAt = performance.now();

function stepDown() {
  const to = Math.max(0, level - 1);
  if (to === level) return;
  put(CAP, JSON.stringify({ v: to, at: Date.now() }));
  qStats.steps += 1;
  quietUntil = performance.now() + 20000; // даём новому уровню показать себя
  apply();
}

function finish(ds, total) {
  probing = false;
  if (inBg() || total <= 0) return;
  let bad;
  qStats.probes += 1;
  if (ds.length < 8) { bad = true; qStats.medSum += total / Math.max(1, ds.length); qStats.lostSum += 1; } // меньше ~12 кадров в секунду
  else {
    const sorted = ds.slice().sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    const base = Math.min(median, 16.7); // шаг кадра экрана (8,3 мс на 120 Гц, 16,7 на 60)
    let lost = 0;
    for (const d of ds) if (d > base * 1.6) lost += d - base;
    bad = lost / total > 0.22 || median > 24;
    qStats.medSum += median; qStats.lostSum += Math.min(1, lost / total);
  }
  if (bad) qStats.bad += 1;
  samples.push(bad);
  if (samples.length > 6) samples.shift();
  if (samples.length < 4) return;
  const n = samples.filter(Boolean).length;
  // до «экономии» (без анимаций вовсе) опускаемся только при совсем плохой картине
  if (n >= (level === 1 ? 6 : 4)) { samples.length = 0; stepDown(); }
}

function probe() {
  const now = performance.now();
  if (probing || now - lastProbe < 1500 || now < quietUntil || now - bootAt < 8000) return;
  if (qualityMode() !== 'auto' || level === 0 || inBg()) return;
  probing = true; lastProbe = now;
  const ds = [];
  let t0 = 0, last = 0;
  const step = (t) => {
    ds.push(t - last); last = t;
    if (t - t0 < 700) requestAnimationFrame(step); else finish(ds, t - t0);
  };
  requestAnimationFrame((t) => { t0 = last = t; requestAnimationFrame(step); });
}

// ---------- запуск ----------

export function initQuality() {
  const d = device();
  if (d) { thermal = Number(d.thermal) || 0; saver = Boolean(d.saver); qStats.thMax = thermal; qStats.saver = saver; }
  // раньше «режим для слабых устройств» включался сам на телефонах с 4 ядрами — теперь это делает «Авто», и мягче
  if (get('mkw.lowpower') !== null) {
    if (get('mkw.lowpower') === '1' && get(MODE) === null && get(CAP) === null) put(CAP, JSON.stringify({ v: 1, at: Date.now() }));
    put('mkw.lowpower', null);
  }
  // приложение сообщает о нагреве, энергосбережении и нехватке памяти
  window.__mkwPerf = (o) => {
    if (!o) return;
    if ('thermal' in o) { thermal = Number(o.thermal) || 0; qStats.thMax = Math.max(qStats.thMax, thermal); }
    if ('saver' in o) { saver = Boolean(o.saver); if (saver) qStats.saver = true; }
    if (o.batt) qStats.batt = Math.max(qStats.batt, Number(o.batt) || 0);
    if (o.mem) { if (o.mem === 10 || o.mem === 15) { memLow = true; qStats.memLow += 1; } fire('mkw-mem', o.mem); }
    apply();
  };
  apply();

  document.addEventListener('visibilitychange', syncBg);
  window.addEventListener('mkw-fg', syncBg);
  syncBg();

  const opt = { capture: true, passive: true };
  for (const ev of ['pointerdown', 'pointermove', 'touchstart', 'keydown', 'wheel']) window.addEventListener(ev, act, opt);
  window.addEventListener('touchmove', () => { act(); probe(); }, opt);
  window.addEventListener('wheel', probe, opt);
  document.addEventListener('scroll', probe, opt); // любая прокрутка, в том числе по инерции после касания
  act();
}

/** Для отладки (localStorage mkw.debug = 1): что видит движок. */
export const qualityDebug = () => ({ level, mode: qualityMode(), base: baseLevel(), learned: learned(), thermal, saver, memLow, idle, bg: inBg(), samples: samples.slice(), probing, lastProbe: Math.round(lastProbe) });

/** Для экрана настроек: что сейчас включено и почему. */
export function qualityInfo() {
  const names = ['Экономия', 'Лёгкий', 'Сбалансированно', 'Максимум'];
  let why = '';
  if (qualityMode() === 'auto') {
    if (saver) why = 'включено энергосбережение';
    else if (thermal >= 2) why = 'телефон нагрелся';
    else if (memLow && baseLevel() > 2 && learned() > 2) why = 'мало свободной памяти';
    else if (learned() < baseLevel()) why = 'подстроено под плавность';
  }
  return { level, name: names[level] || '', why, auto: qualityMode() === 'auto' };
}
