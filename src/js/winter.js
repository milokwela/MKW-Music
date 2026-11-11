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

let raf = 0, cvs = null, ctx = null, flakes = [], W = 0, H = 0, dpr = 1, last = 0, dark = true;

function seed(f, top) {
  f.r = 0.8 + Math.random() * Math.random() * 3.2;           // больше мелких, редкие крупные
  f.x = Math.random() * W; f.y = top ? -8 - Math.random() * 40 : Math.random() * H;
  f.vy = 14 + f.r * 13 + Math.random() * 10; f.sw = 6 + Math.random() * 16; f.ph = Math.random() * 6.28; f.sp = 0.4 + Math.random() * 0.9;
  f.o = 0.35 + Math.random() * 0.55; f.star = f.r > 2.9;
  return f;
}
function size() {
  if (!cvs) return;
  W = window.innerWidth; H = window.innerHeight;
  // телефон: снег рисуем в обычном разрешении — мягкие снежинки выглядят так же, а работы в 4–9 раз меньше
  dpr = W < 700 ? 1 : Math.min(2, window.devicePixelRatio || 1);
  cvs.width = Math.round(W * dpr); cvs.height = Math.round(H * dpr);
  const phone = W < 700;
  const want = calm() ? 20 : lowPower() ? 14 : phone ? 34 : Math.min(80, Math.round((W * H) / 18000) + 18);
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
  // пока листают или переключают вкладки — снег замирает на долю секунды, телефон занят только прокруткой
  if (t < pauseUntil) { last = t; return; }
  // телефон и слабые устройства: 30 кадров в секунду на любом экране (и на 120 Гц) — снег так же плавный, а батарея и скорость целее
  if ((lowPower() || W < 700) && t - last < 30) return;
  const dt = Math.min(0.07, (t - last) / 1000 || 0.016); last = t;
  draw(dt);
}
let pauseUntil = 0;
const rest = (ms) => { pauseUntil = Math.max(pauseUntil, performance.now() + ms); };
const covered = () => root.classList.contains('fp-cover');
function run() { cancelAnimationFrame(raf); raf = 0; if (cvs && !document.hidden && !calm() && !covered()) { last = performance.now(); raf = requestAnimationFrame(tick); } }

// новогодняя нижняя панель: заснеженные домики с окошками
function navScene() {
  const nav = document.querySelector('#bottom-nav .nav-inner') || document.querySelector('#bottom-nav');
  if (!nav || nav.querySelector(':scope > .winter-nav')) return;
  const sc = el('div', 'winter-nav'); sc.setAttribute('aria-hidden', 'true');
  sc.innerHTML = `<svg viewBox="0 0 400 64" preserveAspectRatio="xMidYMax meet"><g class="wn-h">
<path d="M18 64V40l18-14 18 14v24z"/><path d="M70 64V34l24-18 24 18v30z"/><path d="M132 64V44l14-11 14 11v20z"/><path d="M236 64V38l20-15 20 15v26z"/><path d="M292 64V46l13-10 13 10v18z"/><path d="M330 64V32l26-19 26 19v32z"/></g>
<g class="wn-s"><path d="M14 41l22-17 22 17-4 2-18-13-18 13z"/><path d="M66 35l28-21 28 21-4 3-24-17-24 17z"/><path d="M128 45l18-14 18 14-4 2-14-10-14 10z"/><path d="M232 39l24-18 24 18-4 3-20-15-20 15z"/><path d="M288 47l17-13 17 13-4 2-13-9-13 9z"/><path d="M326 33l30-22 30 22-4 3-26-19-26 19z"/>
<path d="M0 64c40-8 80-6 120-2s90 5 140 0 100-6 140 2z"/></g>
<g class="wn-w"><rect x="30" y="46" width="7" height="7" rx="1"/><rect x="86" y="40" width="8" height="8" rx="1"/><rect x="100" y="40" width="8" height="8" rx="1"/><rect x="142" y="50" width="6" height="6" rx="1"/><rect x="250" y="44" width="7" height="7" rx="1"/><rect x="262" y="44" width="7" height="7" rx="1"/><rect x="300" y="52" width="6" height="6" rx="1"/><rect x="350" y="38" width="8" height="8" rx="1"/><rect x="350" y="50" width="8" height="8" rx="1"/></g>
<g class="wn-t"><path d="M190 64l-14-2 10-8h-6l9-9h-5l8-10 8 10h-5l9 9h-6l10 8-14 2z"/></g></svg>`;
  nav.prepend(sc);
}

function mount() {
  if (document.getElementById('winter-sky')) return;
  const sky = el('div', '', 'winter-sky'); sky.append(el('i'), el('i'), el('i')); sky.setAttribute('aria-hidden', 'true');
  cvs = el('canvas', '', 'winter-snow'); cvs.setAttribute('aria-hidden', 'true'); ctx = cvs.getContext('2d');
  document.body.prepend(sky); document.body.append(cvs);
  navScene();
  const hello = document.querySelector('.hello');
  if (hello && !hello.querySelector('.winter-hello')) { const im = el('img', 'winter-hello'); im.src = stSrc(49); im.alt = ''; im.draggable = false; hello.append(im); }
  dark = isDark(); flakes = []; size(); run();
}
function unmount() {
  cancelAnimationFrame(raf); raf = 0;
  ['winter-sky', 'winter-snow'].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); });
  document.querySelectorAll('.winter-nav, .winter-hello').forEach((e) => e.remove());
  cvs = null; ctx = null; flakes = [];
}

export function applyWinter() {
  const on = winterOn();
  if (on) { root.dataset.winter = '1'; mount(); } else { delete root.dataset.winter; unmount(); }
}
export function setWinter(on) { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignore */ } applyWinter(); }

export function initWinter() {
  applyWinter();
  window.addEventListener('resize', () => { if (cvs) size(); });
  document.addEventListener('visibilitychange', run);
  document.addEventListener('scroll', () => rest(220), { capture: true, passive: true });
  document.addEventListener('touchmove', () => rest(220), { passive: true });
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#bottom-nav, .ptab, #lib-tabs')) rest(480); }, { capture: true, passive: true });
  new MutationObserver(run).observe(root, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('mkw-theme', () => { dark = isDark(); if (cvs && calm()) draw(0); });
}
