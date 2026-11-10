// Второй вид плеера (0.37): крупная обложка, волнистая полоса перемотки, кнопки-пилюли, скорость воспроизведения.
// По умолчанию выключен, включается в Настройках → Внешний вид → «Новый вид плеера».
import * as player from './player.js';
import { $, h } from './ui.js';
import { safeUrl } from './utils.js';

const KEY = 'mkw.player.skin';
const { st, queue } = player;
export const player2On = () => { try { return localStorage.getItem(KEY) === '2'; } catch { return false; } };

const RATES = [1, 1.25, 1.5, 2, 0.75];
const rateText = (r) => `${String(r).replace('.', ',')}x`;
let cvs = null, ctx = null, raf = 0, amp = 0, phase = 0, last = 0, dragging = false;

function size() {
  if (!cvs) return;
  const dpr = Math.min(3, window.devicePixelRatio || 1), w = cvs.clientWidth, hh = cvs.clientHeight;
  if (!w || !hh) return;
  if (cvs.width !== Math.round(w * dpr) || cvs.height !== Math.round(hh * dpr)) { cvs.width = Math.round(w * dpr); cvs.height = Math.round(hh * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function draw() {
  if (!cvs || !ctx) return;
  size();
  const w = cvs.clientWidth, hh = cvs.clientHeight, mid = hh / 2;
  if (!w) return;
  const seek = $('#fp-seek');
  const frac = dragging && seek ? Number(seek.value) / 1000 : (st.duration > 0 ? Math.min(1, st.time / st.duration) : 0);
  const x = 3 + frac * (w - 6);
  ctx.clearRect(0, 0, w, hh);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 3;
  // сколько осталось — ровная тусклая линия
  if (x < w - 8) { ctx.strokeStyle = 'rgba(255,255,255,.26)'; ctx.beginPath(); ctx.moveTo(x + 7, mid); ctx.lineTo(w - 2, mid); ctx.stroke(); }
  // сыгранное — волна; у бегунка и в самом начале она сглаживается, на паузе выпрямляется
  if (x > 4) {
    ctx.strokeStyle = '#fff'; ctx.beginPath();
    for (let px = 2; px <= x - 5; px += 1.5) {
      const a = 3.6 * amp * Math.min(1, (x - 5 - px) / 20) * Math.min(1, px / 12);
      const y = mid + Math.sin((px / 30) * 6.2832 - phase) * a;
      if (px === 2) ctx.moveTo(px, y); else ctx.lineTo(px, y);
    }
    ctx.stroke();
  }
  // бегунок
  ctx.fillStyle = '#fff'; const bw = 4, bh = 20, bx = x - bw / 2, by = mid - bh / 2;
  ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 2); else ctx.rect(bx, by, bw, bh); ctx.fill();
}
const visible = () => player2On() && !document.hidden && $('#full-player').classList.contains('open');
function tick(t) {
  raf = 0;
  if (!visible()) return;
  const dt = Math.min(0.05, (t - last) / 1000 || 0.016); last = t;
  const target = st.playing ? 1 : 0;
  amp += (target - amp) * Math.min(1, dt * 6);
  if (st.playing) phase += dt * 4.2;
  draw();
  if (st.playing || Math.abs(target - amp) > 0.01) raf = requestAnimationFrame(tick);
}
function kick() { if (!raf && visible()) { last = performance.now(); raf = requestAnimationFrame(tick); } }

function paintTrack() {
  const t = queue.current, m = $('#fp-mini-art');
  if (m) m.style.backgroundImage = t && safeUrl(t.artwork) ? `url("${safeUrl(t.artwork)}")` : 'none';
}
function paintRate() { const b = $('#fp-speed'); if (b) { b.textContent = rateText(player.getRate()); b.classList.toggle('on', player.getRate() !== 1); } }

export function applyPlayer2() {
  const on = player2On();
  $('#full-player').classList.toggle('fp2', on);
  if (!on && player.getRate() !== 1) player.setRate(1);   // в классическом плеере кнопки скорости нет — возвращаем обычную
  // в новом виде кнопка текста всегда живёт в нижнем ряду
  if (on) { const b = $('#fp-lyrics-btn'), extra = $('#full-player .fp-extra'); if (b && extra && b.parentElement !== extra) extra.prepend(b); }
  paintRate(); draw(); kick();
}
export function setPlayer2(on) { try { localStorage.setItem(KEY, on ? '2' : '1'); } catch { /* ignore */ } applyPlayer2(); }

export function initPlayer2() {
  const seekBox = $('#full-player .fp-seek'), seek = $('#fp-seek'), meta = $('#full-player .fp-meta'), extra = $('#full-player .fp-extra');
  if (!seekBox || !seek || !meta || !extra) return;
  cvs = h('canvas', { id: 'fp-wave', 'aria-hidden': 'true' }); ctx = cvs.getContext('2d');
  seekBox.prepend(cvs);
  meta.prepend(h('span', { id: 'fp-mini-art', 'aria-hidden': 'true' }));
  extra.prepend(h('button', { id: 'fp-speed', type: 'button', 'aria-label': 'Скорость воспроизведения', title: 'Скорость воспроизведения', onclick: () => {
    const i = RATES.indexOf(player.getRate()); player.setRate(RATES[(i + 1) % RATES.length]);
  } }, '1x'));
  seek.addEventListener('input', () => { dragging = true; draw(); });
  seek.addEventListener('change', () => { dragging = false; draw(); });
  player.onPlayer((ev) => {
    if (ev === 'rate') paintRate();
    if (ev === 'track') paintTrack();
    if (!player2On()) return;
    if (ev === 'time') { if (!raf) draw(); } else if (ev === 'state' || ev === 'track') kick();
  });
  // открытие плеера и возвращение на вкладку — перерисовать и запустить волну
  new MutationObserver(() => { if (player2On()) { draw(); kick(); } }).observe($('#full-player'), { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', kick);
  window.addEventListener('resize', () => { if (player2On()) draw(); });
  paintTrack(); applyPlayer2();
}
