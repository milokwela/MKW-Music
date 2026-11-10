// Второй вид плеера (0.37): крупная обложка, волнистая полоса перемотки, кнопки-пилюли, скорость воспроизведения.
// С 0.37.2 включён по умолчанию; классический вид возвращается в Настройках → Внешний вид → «Новый вид плеера».
import * as player from './player.js';
import { $, h, icon } from './ui.js';
import { mi } from './icons2.js';
import { safeUrl, plural } from './utils.js';

const KEY = 'mkw.player.skin';
const { st, queue } = player;
export const player2On = () => { try { return localStorage.getItem(KEY) !== '1'; } catch { return true; } };

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

// ---------- «сцена» (телефон и компьютер): обложка, текст и очередь живут в одном месте, название и кнопки не двигаются ----------
let stage = null, qBox = null, qFind = null, anim = null, collapsed = false;
const calmUI = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const fpEl = () => $('#full-player');
const panelOpen = () => { const fp = fpEl(); return fp.classList.contains('lyrics-on') || fp.classList.contains('queue-on'); };
const useStage = () => player2On();

function mountStage(on) {
  const art = $('#fp-art'), lyr = $('#fp-lyrics');
  if (!art || !lyr) return;
  if (on && !stage) {
    stage = h('div', { id: 'fp-stage' });
    art.parentNode.insertBefore(stage, art);
    stage.append(art, lyr, qBox);
  } else if (!on && stage) {
    stage.parentNode.insertBefore(art, stage); stage.parentNode.insertBefore(lyr, stage); stage.remove(); stage = null;
    if (anim) { anim.cancel(); anim = null; } art.style.transform = ''; collapsed = false;
    fpEl().classList.remove('queue-on'); $('#fp-queue').classList.remove('on');
  }
  // на компьютере очередь стоит справа, на месте текста
  if (!on && qBox && lyr.parentNode && qBox.parentNode !== lyr.parentNode) lyr.after(qBox);
}

// куда «улетает» обложка: маленький квадрат слева от названия
function miniTarget() {
  // считаем от самой обложки (без анимации): она квадратом по центру сцены
  const art = $('#fp-art'), meta = $('#full-player .fp-meta'), mr = meta.getBoundingClientRect();
  const ax = art.offsetLeft, ay = art.offsetTop, aw = art.offsetWidth || 1, sr = stage.getBoundingClientRect();
  const sz = 48, x = mr.left - sr.left - ax, y = mr.top - sr.top - ay + (mr.height - sz) / 2;
  return { s: sz / aw, x, y };
}
// обложка двигается сама (без копий): от текущего положения к цели. Можно нажимать сколько угодно — каждый раз продолжает с того места, где была
function moveArt(toMini, instant) {
  const art = $('#fp-art'); if (!art || !stage) return;
  const cur = getComputedStyle(art).transform, rad = getComputedStyle(art).borderRadius;
  const t = miniTarget();
  const end = toMini ? `translate(${t.x}px, ${t.y}px) scale(${t.s})` : 'translate(0px, 0px) scale(1)';
  const endRad = toMini ? `${12 / t.s}px` : '28px';
  if (anim) anim.cancel();
  anim = art.animate([{ transform: cur === 'none' ? 'translate(0px, 0px) scale(1)' : cur, borderRadius: rad }, { transform: end, borderRadius: endRad }],
    { duration: instant || calmUI() ? 0 : 560, easing: 'cubic-bezier(.22,.8,.18,1)', fill: 'forwards' });
  fpEl().classList.toggle('art-mini', toMini);
}
function syncStage(instant) {
  if (!stage) return;
  const want = panelOpen();
  if (want !== collapsed || instant) { collapsed = want; moveArt(want, instant); }
}

// ---------- очередь прямо в плеере (как в видео) ----------
function drawQueue() {
  if (!qBox) return;
  const q = (qFind && qFind.value || '').trim().toLowerCase();
  const list = qBox.querySelector('.p2q-list');
  const rows = [];
  queue.items.forEach((t, i) => {
    if (q && !`${t.title} ${t.artist}`.toLowerCase().includes(q)) return;
    rows.push(h('div', { class: `p2q-row${i === queue.index ? ' cur' : ''}`, role: 'button', tabindex: '0', onclick: () => player.jumpTo(i) },
      h('span', { class: 'p2q-art', style: safeUrl(t.artwork) ? `background-image:url("${safeUrl(t.artwork)}")` : '' }, i === queue.index ? mi('note') : null),
      h('span', { class: 'p2q-txt' }, h('b', { text: t.title }), h('small', { text: t.artist })),
      h('button', { type: 'button', class: 'icon-btn p2q-x', 'aria-label': 'Убрать из очереди', onclick: (e) => { e.stopPropagation(); player.removeFromQueue(i); } }, icon('close'))));
  });
  list.replaceChildren(...(rows.length ? rows : [h('p', { class: 'p2q-empty', text: q ? 'Ничего не нашлось' : 'Очередь пуста' })]));
  if (!q) { const c = list.querySelector('.cur'); if (c) requestAnimationFrame(() => { list.scrollTop = Math.max(0, c.offsetTop - list.clientHeight / 2 + c.offsetHeight / 2); }); }
}
function toggleQueue() {
  const fp = fpEl();
  const on = !fp.classList.contains('queue-on');
  if (on && fp.classList.contains('lyrics-on')) $('#fp-lyrics-btn').click();
  fp.classList.toggle('queue-on', on);
  $('#fp-queue').classList.toggle('on', on);
  if (on) { if (qFind) qFind.value = ''; drawQueue(); }
}

// шапка: «MKW» и номер трека в очереди
function paintHead() {
  const n = $('#fp2-head .p2-n'); if (!n) return;
  n.textContent = queue.length ? `Трек ${queue.index + 1} из ${queue.length}` : '';
  const q = $('#fp2-head .p2-q'); if (q) q.textContent = queue.length ? `Очередь · ${queue.length} ${plural(queue.length, 'трек', 'трека', 'треков')}` : 'Очередь';
}

export function applyPlayer2() {
  const on = player2On();
  fpEl().classList.toggle('fp2', on);
  // в новом виде кнопка текста всегда в нижнем ряду, а таймер — рядом с лайком и дизлайком
  const b = $('#fp-lyrics-btn'), extra = $('#full-player .fp-extra'), sleep = $('#fp-sleep'), like = $('#fp-like');
  if (on) {
    if (b && extra && b.parentElement !== extra) extra.prepend(b);
    if (sleep && like && sleep.parentElement !== like.parentElement) like.parentElement.insertBefore(sleep, like);
  } else if (sleep && extra && sleep.parentElement !== extra) extra.append(sleep);
  mountStage(useStage());
  syncStage(true);
  paintRate(); paintHead(); draw(); kick();
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
  // очередь внутри плеера
  qFind = h('input', { type: 'search', class: 'p2q-find', placeholder: 'Поиск по очереди', 'aria-label': 'Поиск по очереди' });
  qFind.addEventListener('input', drawQueue);
  qBox = h('div', { id: 'fp-q2' }, h('label', { class: 'p2q-search' }, icon('search'), qFind), h('div', { class: 'p2q-list' }));
  const top = $('#full-player .fp-top');
  if (top) top.insertBefore(h('div', { id: 'fp2-head' }, h('b', { text: 'MKW' }), h('small', {}, h('span', { class: 'p2-n' }), h('span', { class: 'p2-q' }))), $('#fp-more'));
  // в новом виде кнопка очереди открывает очередь прямо в плеере на месте обложки
  document.addEventListener('click', (e) => {
    if (!e.target.closest || !player2On()) return;
    if (!e.target.closest('#fp-queue')) return;
    e.preventDefault(); e.stopImmediatePropagation(); toggleQueue();
  }, true);
  // текст включили — очередь закрываем; любое переключение — обложка плавно едет
  new MutationObserver(() => {
    const fp = fpEl();
    if (fp.classList.contains('lyrics-on') && fp.classList.contains('queue-on')) { fp.classList.remove('queue-on'); $('#fp-queue').classList.remove('on'); }
    if (useStage()) syncStage(false);
  }).observe(fpEl(), { attributes: true, attributeFilter: ['class'] });
  let rz = 0;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { mountStage(useStage()); syncStage(true); }, 120); });
  seek.addEventListener('input', () => { dragging = true; draw(); });
  seek.addEventListener('change', () => { dragging = false; draw(); });
  player.onPlayer((ev) => {
    if (ev === 'rate') paintRate();
    if (ev === 'track') paintTrack();
    if (ev === 'track' || ev === 'queue') { paintHead(); if (fpEl().classList.contains('queue-on')) drawQueue(); }
    if (!player2On()) return;
    if (ev === 'time') { if (!raf) draw(); } else if (ev === 'state' || ev === 'track') kick();
  });
  // открытие плеера и возвращение на вкладку — перерисовать и запустить волну
  new MutationObserver(() => { if (player2On()) { draw(); kick(); } }).observe($('#full-player'), { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', kick);
  window.addEventListener('resize', () => { if (player2On()) draw(); });
  paintTrack(); applyPlayer2();
}
