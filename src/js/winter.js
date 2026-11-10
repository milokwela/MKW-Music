// Зимнее оформление: снег, гирлянда, северное сияние и сугробы.
// Включено по умолчанию, выключается в Настройках → Внешний вид. Сам цвет акцента не меняет.
import { isDark } from './theme.js';
import { stSrc } from './stickers.js';

const KEY = 'mkw.winter';
export const winterOn = () => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } };

const root = document.documentElement;
const el = (tag, cls, id) => { const e = document.createElement(tag); if (cls) e.className = cls; if (id) e.id = id; return e; };
const lowPower = () => { try { return localStorage.getItem('mkw.lowpower') === '1'; } catch { return false; } };
const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let raf = 0, cvs = null, ctx = null, flakes = [], W = 0, H = 0, dpr = 1, last = 0, skip = false, dark = true;

function seed(f, top) {
  f.r = 0.8 + Math.random() * Math.random() * 3.2;           // больше мелких, редкие крупные
  f.x = Math.random() * W; f.y = top ? -8 - Math.random() * 40 : Math.random() * H;
  f.vy = 14 + f.r * 13 + Math.random() * 10; f.sw = 6 + Math.random() * 16; f.ph = Math.random() * 6.28; f.sp = 0.4 + Math.random() * 0.9;
  f.o = 0.35 + Math.random() * 0.55; f.star = f.r > 2.9;
  return f;
}
function size() {
  if (!cvs) return;
  dpr = Math.min(2, window.devicePixelRatio || 1); W = window.innerWidth; H = window.innerHeight;
  cvs.width = Math.round(W * dpr); cvs.height = Math.round(H * dpr);
  const want = calm() ? 26 : lowPower() ? 16 : Math.min(90, Math.round((W * H) / 16000) + 18);
  while (flakes.length < want) flakes.push(seed({}, false));
  flakes.length = want;
  if (calm()) draw(0);
}
function draw(dt) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const col = dark ? '255,255,255' : '96,150,214';
  for (const f of flakes) {
    f.ph += f.sp * dt; f.y += f.vy * dt; const x = f.x + Math.sin(f.ph) * f.sw;
    if (f.y > H + 10) seed(f, true);
    ctx.globalAlpha = f.o;
    if (f.star) {                                              // крупная снежинка — шесть лучей
      ctx.strokeStyle = `rgb(${col})`; ctx.lineWidth = 1.1; ctx.beginPath();
      for (let k = 0; k < 3; k += 1) { const a = f.ph * 0.3 + k * 1.047, cx = Math.cos(a) * f.r * 1.9, cy = Math.sin(a) * f.r * 1.9; ctx.moveTo(x - cx, f.y - cy); ctx.lineTo(x + cx, f.y + cy); }
      ctx.stroke();
    } else { ctx.fillStyle = `rgb(${col})`; ctx.beginPath(); ctx.arc(x, f.y, f.r, 0, 6.2832); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
}
function tick(t) {
  raf = requestAnimationFrame(tick);
  if (lowPower()) { skip = !skip; if (skip) return; }           // слабым устройствам — вдвое реже
  const dt = Math.min(0.05, (t - last) / 1000 || 0.016); last = t;
  draw(dt);
}
function run() { cancelAnimationFrame(raf); raf = 0; if (cvs && !document.hidden && !calm()) { last = performance.now(); raf = requestAnimationFrame(tick); } }

function garland() {
  const g = document.getElementById('winter-garland'); if (!g) return;
  const n = Math.max(5, Math.ceil(window.innerWidth / 58));
  if (g.childElementCount === n) return;
  g.replaceChildren(...Array.from({ length: n }, (_, i) => { const b = el('i'); b.style.setProperty('--i', i); b.dataset.c = String(i % 5); return b; }));
}

function mount() {
  if (document.getElementById('winter-sky')) return;
  const sky = el('div', '', 'winter-sky'); sky.append(el('i'), el('i'), el('i')); sky.setAttribute('aria-hidden', 'true');
  const gar = el('div', '', 'winter-garland'); gar.setAttribute('aria-hidden', 'true');
  cvs = el('canvas', '', 'winter-snow'); cvs.setAttribute('aria-hidden', 'true'); ctx = cvs.getContext('2d');
  document.body.prepend(sky); document.body.append(gar, cvs);
  // сугробы на панели внизу, мини-плеере и поиске; котики у ёлки — в шапке главной
  [['#bottom-nav', ''], ['#mini-player', ' sm'], ['#search-form', ' sm']].forEach(([sel, cls]) => { const host = document.querySelector(sel); if (host && !host.querySelector(':scope > .snowcap')) host.append(el('i', `snowcap${cls}`)); });
  const hello = document.querySelector('.hello');
  if (hello && !hello.querySelector('.winter-hello')) { const im = el('img', 'winter-hello'); im.src = stSrc(49); im.alt = ''; im.draggable = false; hello.append(im); }
  dark = isDark(); flakes = []; size(); garland(); run();
}
function unmount() {
  cancelAnimationFrame(raf); raf = 0;
  ['winter-sky', 'winter-garland', 'winter-snow'].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); });
  document.querySelectorAll('.snowcap, .winter-hello').forEach((e) => e.remove());
  cvs = null; ctx = null; flakes = [];
}

export function applyWinter() {
  const on = winterOn();
  if (on) { root.dataset.winter = '1'; mount(); } else { delete root.dataset.winter; unmount(); }
}
export function setWinter(on) { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignore */ } applyWinter(); }

export function initWinter() {
  applyWinter();
  window.addEventListener('resize', () => { if (cvs) { size(); garland(); } });
  document.addEventListener('visibilitychange', run);
  window.addEventListener('mkw-theme', () => { dark = isDark(); if (cvs && calm()) draw(0); });
}
