// Буст плавности (особенно на телефонах).
// 1) Пока вы листаете или переключаете вкладки, бесконечные декоративные анимации (звёзды, переливы, свечения)
//    ставятся на паузу — телефон тратит силы только на прокрутку и переход.
// 2) Анимации, которые сейчас за краем экрана, тоже стоят на паузе и оживают, когда появляются.
// Пауза ставится атрибутом data-zz на сами анимированные элементы (см. v30.css) — это дешевле,
// чем пересчитывать стили всей страницы, и не ломает анимации, которые CSS сам включает и выключает.
import { awake, isIdle } from './quality.js';

const ATTR = 'data-zz';
let holding = false;
let holdT = 0;
const held = new Set();       // элементы, остановленные на время прокрутки / перехода
const offscreen = new Set();  // элементы за краем экрана
const slept = new Set();      // украшения, уснувшие, пока экран никто не трогает (см. quality.js)
const watched = new WeakSet();
let io = null;

const infinite = (a) => {
  try { return a.effect && a.effect.getComputedTiming().iterations === Infinity; } catch { return false; }
};
const hostOf = (a) => { const t = a.effect && a.effect.target; return t && t.nodeType === 1 ? t : null; };

function paint(el) {
  const stop = held.has(el) || offscreen.has(el) || slept.has(el);
  if (stop) { if (!el.hasAttribute(ATTR)) el.setAttribute(ATTR, ''); } else if (el.hasAttribute(ATTR)) el.removeAttribute(ATTR);
}

function liveHosts() {
  const out = new Set();
  let list = [];
  try { list = document.getAnimations(); } catch { return out; }
  for (const a of list) if (a.playState === 'running' && infinite(a)) { const el = hostOf(a); if (el) out.add(el); }
  return out;
}

// Анимации «по делу» не засыпают никогда: эквалайзер играющего трека, загрузка, набор текста, запись голоса, звонок, обновление.
const WORKING = /^(eq|tgEq|hnEq|tyDot|rec[A-Z]|call[A-Z]|ci[A-Z]|upd[A-Z]|out[A-Z]|offDl|spin|shimmer|skel|sk$|sp\d|vGlow)/;
function sleepAll() {
  let list = [];
  try { list = document.getAnimations(); } catch { return; }
  for (const a of list) {
    if (a.playState !== 'running' || !infinite(a) || WORKING.test(a.animationName || '')) continue;
    const el = hostOf(a);
    if (el && !slept.has(el)) { slept.add(el); paint(el); }
  }
}
function wakeAll() {
  const list = [...slept]; slept.clear();
  for (const el of list) paint(el);
}

// остановить декоративные анимации на ms миллисекунд (продлевается, пока идёт прокрутка)
export function hold(ms = 260) {
  if (!holding) {
    holding = true;
    for (const el of liveHosts()) { held.add(el); paint(el); }
  }
  clearTimeout(holdT);
  holdT = setTimeout(release, ms);
}

function release() {
  holding = false;
  const list = [...held]; held.clear();
  for (const el of list) paint(el);
  idle(scan);
}

const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 200));

// следим, какие анимированные элементы видны на экране
function scan() {
  if (!io || holding) return;
  for (const el of liveHosts()) if (!watched.has(el)) { watched.add(el); io.observe(el); }
  for (const el of [...offscreen]) if (!el.isConnected) { offscreen.delete(el); io.unobserve(el); }
}

export function initBoost() {
  const root = document.documentElement;
  const coarse = matchMedia('(pointer: coarse)').matches;
  root.classList.toggle('touch', coarse);
  // слабое железо: меньше размытия и эффектов (не путать с ручным «Режимом для слабых устройств»)
  const mem = Number(navigator.deviceMemory) || 8;
  const cores = Number(navigator.hardwareConcurrency) || 8;
  if (coarse && (mem <= 4 || cores <= 4)) root.classList.add('lite');

  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) offscreen.delete(e.target); else offscreen.add(e.target);
        paint(e.target);
      }
    }, { rootMargin: '120px' });
  }
  document.addEventListener('scroll', () => hold(240), { capture: true, passive: true });
  document.addEventListener('touchmove', () => hold(240), { passive: true });
  // новые экраны и карточки появляются постоянно — раз в несколько секунд в простое подхватываем их анимации
  setInterval(() => { if (awake()) idle(scan); }, 3000);
  // 20 секунд никто не трогал экран — украшения засыпают; первое же касание будит их
  window.addEventListener('mkw-idle', () => { if (isIdle()) sleepAll(); else wakeAll(); });
  idle(scan);
}
