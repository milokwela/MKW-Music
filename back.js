// «Назад» как в обычном приложении.
// Каждый открытый экран (чат, профиль друга, исполнитель, большой плеер, шторка) — это шаг в истории браузера.
// Поэтому системный жест «назад» на Android (свайп от края экрана) и кнопка «назад» закрывают верхний экран,
// а не всё приложение. На iPhone, где у приложения на домашнем экране нет такого жеста, свайп от левого
// края делаем сами: экран тянется за пальцем и закрывается.
import { closeChat } from './chat.js?v=0.35.7';
import { closeUserPage } from './userpage.js?v=0.35.7';
import { closeArtist } from './artist.js?v=0.35.7';
import { closeSheet } from './ui.js?v=0.35.7';
import { closeFull } from './playerui.js?v=0.35.7';

const SCREENS = {
  sheet: closeSheet,
  'user-page': closeUserPage,
  'chat-page': closeChat,
  'artist-page': closeArtist,
  'full-player': closeFull,
};
const stack = [];     // открытые экраны в порядке открытия
let skip = 0;         // сколько «назад» сделали мы сами (экран закрыли кнопкой) — их не обрабатываем

const isOpen = (el) => el.classList.contains('open');

// что поменялось у экрана: 1 — открылся, -1 — закрылся (кнопкой), 0 — ничего
function change(el) {
  const id = el.id;
  if (!SCREENS[id]) return 0;
  const open = isOpen(el), i = stack.indexOf(id);
  if (open && i < 0) { stack.push(id); return 1; }
  if (!open && i >= 0) { stack.splice(i, 1); return -1; }
  return 0;
}
// одно закрылось и сразу открылось другое (шторка → чат) — просто заменяем шаг истории, без «назад»+«вперёд»
function apply(opened, closed) {
  const swap = Math.min(opened, closed);
  for (let k = 0; k < swap; k++) { try { history.replaceState({ mkw: stack.length }, '', location.href); } catch { /* ignore */ } }
  for (let k = swap; k < opened; k++) { try { history.pushState({ mkw: stack.length }, '', location.href); } catch { /* ignore */ } }
  for (let k = swap; k < closed; k++) { skip += 1; try { history.back(); } catch { skip -= 1; } }
}

function onPop() {
  if (skip > 0) { skip -= 1; return; }
  const id = stack.pop();
  if (!id) return;
  const el = document.getElementById(id);
  try { SCREENS[id](); } catch { if (el) el.classList.remove('open'); }
  // если экран почему-то не закрылся — уберём класс сами
  if (el && isOpen(el)) el.classList.remove('open');
}

export const backDepth = () => stack.length;
export function goBack() { if (stack.length) history.back(); }

// ---------- свайп от левого края (iPhone, приложение на домашнем экране) ----------
function edgeSwipe() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!ios) return;
  let el = null, x0 = 0, y0 = 0, dx = 0, t0 = 0, active = false, decided = false;
  const SWIPEABLE = ['user-page', 'chat-page', 'artist-page'];
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (t.clientX > 26) return;
    const top = [...stack].reverse().find((id) => SWIPEABLE.includes(id) || id === 'sheet');
    if (!top || !SWIPEABLE.includes(top)) return;
    el = document.getElementById(top); if (!el) return;
    x0 = t.clientX; y0 = t.clientY; dx = 0; t0 = Date.now(); active = true; decided = false;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!active || !el) return;
    const t = e.touches[0]; const mx = t.clientX - x0, my = t.clientY - y0;
    if (!decided) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      decided = true;
      if (Math.abs(my) > Math.abs(mx) || mx < 0) { active = false; return; }
      el.style.transition = 'none';
    }
    dx = Math.max(0, mx);
    el.style.transform = `translate3d(${dx}px,0,0)`;
    e.preventDefault();
  }, { passive: false });
  const end = () => {
    if (!active || !el) return;
    active = false;
    const w = window.innerWidth, v = dx / Math.max(1, Date.now() - t0);
    const target = el;
    target.style.transition = 'transform .26s cubic-bezier(.2,.8,.2,1)';
    if (decided && (dx > w * 0.33 || v > 0.6)) {
      target.style.transform = `translate3d(${w}px,0,0)`;
      setTimeout(() => { target.style.transition = ''; target.style.transform = ''; history.back(); }, 240);
    } else {
      target.style.transform = '';
      setTimeout(() => { target.style.transition = ''; }, 280);
    }
    el = null;
  };
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', end, { passive: true });
}

export function initBack() {
  window.addEventListener('popstate', onPop);
  const mo = new MutationObserver((list) => {
    const seen = new Set(); let opened = 0, closed = 0;
    for (const m of list) {
      const t = m.target;
      if (m.type === 'attributes' && t.id && SCREENS[t.id] && !seen.has(t)) { seen.add(t); const c = change(t); if (c > 0) opened += 1; if (c < 0) closed += 1; }
      if (m.type === 'childList') m.addedNodes.forEach((n) => { if (n.nodeType === 1 && n.id && SCREENS[n.id]) mo.observe(n, { attributes: true, attributeFilter: ['class'] }); });
    }
    if (opened || closed) apply(opened, closed);
  });
  Object.keys(SCREENS).forEach((id) => { const el = document.getElementById(id); if (el) mo.observe(el, { attributes: true, attributeFilter: ['class'] }); });
  mo.observe(document.body, { childList: true }); // чат создаётся при первом открытии
  edgeSwipe();
}
