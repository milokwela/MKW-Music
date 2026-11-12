// Анонимная статистика работы MKW: раз в сутки (точнее — когда приложение уходит в фон, не чаще раза в 15 минут)
// отправляет, как MKW работает на этом телефоне. Без ника, аккаунта и всего, что вы слушаете или пишете:
// только модель и характеристики телефона, плавность (сколько раз телефон не успевал рисовать кадры), нагрев,
// уровень графики, время запуска и число ошибок. Документ perf/{день}_{случайный номер установки}.
// Отключается: Настройки → Устройство → «Анонимная статистика».
import { db, auth } from './firebase.js';
import { doc, setDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { qStats, quality, qualityMode, inBg } from './quality.js';
import { envInfo } from './feedback.js';

const ON = 'mkw.tm.on';
const ID = 'mkw.tm.id';
const ACC = 'mkw.tm.acc';
const PREV = 'mkw.tm.prev'; // готовая статистика прошлого дня, ещё не отправленная
const FLUSH_MS = 15 * 60000;

const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ } };

export const telemetryOn = () => get(ON) !== '0';
export function setTelemetry(on) { put(ON, on ? null : '0'); if (!on) { put(ACC, null); put(PREV, null); } }

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function installId() {
  let id = get(ID);
  if (!id || id.length < 12) {
    const a = new Uint8Array(9); crypto.getRandomValues(a);
    id = [...a].map((x) => x.toString(36).padStart(2, '0')).join('').slice(0, 14);
    put(ID, id);
  }
  return id;
}

// счётчики текущих суток: то, что накопилось раньше в этот день (из памяти телефона) + этот запуск
let acc = null;
let base = { ...qStats };
let fgSince = 0;
let errs = 0, errList = [], lt = 0, ltms = 0, boot = 0, lastFlush = 0;

function load() {
  try { acc = JSON.parse(get(ACC) || 'null'); } catch { acc = null; }
  if (!acc || typeof acc !== 'object') acc = null;
}
function fresh(day) {
  return { day, sess: 0, fg: 0, pr: 0, bad: 0, med: 0, lost: 0, st: 0, th: 0, sv: false, mem: 0, err: 0, errs: [], lt: 0, ltms: 0, boot: 0, bootN: 0 };
}

/** Сложить накопленное за этот запуск в acc (и обнулить счётчики запуска). */
function fold() {
  const day = today();
  if (!acc) acc = fresh(day);
  const now = performance.now();
  if (fgSince) { acc.fg += Math.round((now - fgSince) / 1000); fgSince = inBg() ? 0 : now; }
  const d = (k) => (qStats[k] || 0) - (base[k] || 0);
  acc.pr += d('probes'); acc.bad += d('bad'); acc.med += d('medSum'); acc.lost += d('lostSum'); acc.st += d('steps'); acc.mem += d('memLow');
  acc.th = Math.max(acc.th, qStats.thMax || 0); acc.sv = acc.sv || Boolean(qStats.saver);
  base = { ...qStats };
  acc.err += errs; errs = 0;
  for (const m of errList) if (acc.errs.length < 5 && !acc.errs.includes(m)) acc.errs.push(m);
  errList = [];
  acc.lt += lt; acc.ltms += ltms; lt = 0; ltms = 0;
  if (boot) { acc.boot += boot; acc.bootN += 1; boot = 0; }
  put(ACC, JSON.stringify(acc));
}

function payload(a) {
  const e = envInfo();
  let heap = 0;
  try { heap = Math.round(((performance.memory && performance.memory.usedJSHeapSize) || 0) / 1048576); } catch { /* только Chrome */ }
  const net = (navigator.connection && navigator.connection.effectiveType) || '';
  return {
    day: a.day, v: e.app, s: e.site,
    dev: { model: e.model, brand: e.brand, os: e.os, ram: e.ram, cores: e.cores, hz: e.hz, wv: e.wv, tier: e.tier, scr: e.scr },
    q: quality(), m: qualityMode(),
    sess: a.sess, fg: a.fg, pr: a.pr, bad: a.bad,
    med: a.pr ? Math.round((a.med / a.pr) * 10) / 10 : 0,      // средний шаг кадра при прокрутке, мс
    lost: a.pr ? Math.round((a.lost / a.pr) * 1000) / 1000 : 0, // доля потерянного времени при прокрутке
    st: a.st, th: a.th, sv: a.sv, mem: a.mem, err: a.err, errs: a.errs.slice(0, 5), lt: a.lt, ltms: Math.round(a.ltms),
    boot: a.bootN ? Math.round(a.boot / a.bootN) : 0, heap, net: String(net).slice(0, 8), at: Date.now(),
  };
}

async function sendPrev() {
  const raw = get(PREV);
  if (!raw) return;
  try { const p = JSON.parse(raw); await setDoc(doc(db, 'perf', `${p.day}_${installId()}`), p); put(PREV, null); } catch { /* в следующий раз */ }
}

async function flush(force) {
  if (!telemetryOn() || !auth.currentUser) return;
  sendPrev();
  fold();
  if (!acc || (!force && Date.now() - lastFlush < FLUSH_MS)) return;
  lastFlush = Date.now();
  const a = acc;
  try {
    await setDoc(doc(db, 'perf', `${a.day}_${installId()}`), payload(a));
    if (a.day !== today() && acc === a) { acc = fresh(today()); put(ACC, JSON.stringify(acc)); }
  } catch { /* правила ещё не опубликованы или нет сети — отправим в следующий раз */ }
}

export function initTelemetry() {
  load();
  // остались данные прошлого дня — откладываем их на отправку и начинаем новый день
  const day = today();
  if (acc && acc.day !== day) { if (telemetryOn() && acc.sess) put(PREV, JSON.stringify(payload(acc))); acc = null; }
  if (!acc) acc = fresh(day);
  acc.sess += 1;
  boot = Math.round(performance.now());
  put(ACC, JSON.stringify(acc));
  fgSince = inBg() ? 0 : performance.now();

  window.addEventListener('error', (e) => { errs += 1; const m = String((e && e.message) || '').slice(0, 120); if (m && errList.length < 5) errList.push(m); });
  window.addEventListener('unhandledrejection', (e) => { errs += 1; const r = e && e.reason; const m = String((r && (r.code || r.message)) || r || '').slice(0, 120); if (m && errList.length < 5) errList.push(m); });
  try {
    new PerformanceObserver((l) => { if (inBg()) return; for (const x of l.getEntries()) if (x.duration >= 200) { lt += 1; ltms += x.duration; } }).observe({ type: 'longtask', buffered: false });
  } catch { /* не везде есть */ }

  window.addEventListener('mkw-vis', (e) => {
    if (e.detail) { if (!fgSince) fgSince = performance.now(); }
    else { flush(false); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(false); });
  // первая отправка за день — через минуту после запуска, чтобы уже были замеры
  setTimeout(() => { if (!lastFlush) flush(true); }, 60000);
}
