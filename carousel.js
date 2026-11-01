// Карусель обложек в большом плеере: тянете пальцем (или мышью) влево/вправо, чтобы переключить трек.
import * as player from './player.js?v=0.13.2';
import { $, h, icon } from './ui.js?v=0.13.2';

const GAP = 32;
const big = (u) => u.replace(/\/\d+x\d+(bb)?\./, '/600x600bb.');
let down = false, lock = null, sx = 0, sy = 0, dx = 0, t0 = 0, pid = 0, moved = false, busy = false;

function slide(t, cls) {
  const d = h('div', { class: `car-slide ${cls}` });
  d.appendChild(t && t.artwork ? h('img', { src: big(t.artwork), alt: '', draggable: 'false' }) : icon('music'));
  return d;
}

export function renderCarousel() {
  const art = $('#fp-art');
  const q = player.queue;
  const items = q.items, i = q.index;
  const wrap = q.repeat === 'all' && items.length > 1;
  const wave = Boolean(q.current && q.current.wave) || window.matchMedia('(min-width: 900px)').matches;
  const prev = wave ? null : items[i - 1] || (wrap ? items[items.length - 1] : null);
  const next = wave ? null : items[i + 1] || (wrap ? items[0] : null);
  art._off = wave;
  art._p = Boolean(prev);
  art._n = Boolean(next);
  busy = false;
  art.replaceChildren(h('div', { class: 'car-track' }, slide(prev, 'prev'), slide(q.current, 'cur'), slide(next, 'next')));
}

function setX(px) {
  const tr = $('#fp-art .car-track');
  if (tr) tr.style.transform = `translateX(${px}px)`;
}

export function initCarousel() {
  const art = $('#fp-art');
  art.addEventListener('pointerdown', (e) => {
    if (art._off || busy || (e.pointerType === 'mouse' && e.button !== 0)) return;
    down = true; lock = null; moved = false; sx = e.clientX; sy = e.clientY; dx = 0; t0 = Date.now(); pid = e.pointerId;
  });
  art.addEventListener('pointermove', (e) => {
    if (!down) return;
    dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (!lock && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      lock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (lock === 'x') {
        try { art.setPointerCapture(pid); } catch { /* ignore */ }
        const tr = $('#fp-art .car-track');
        if (tr) tr.style.transition = 'none';
      }
    }
    if (lock === 'x') {
      moved = true;
      let v = dx;
      if ((v > 0 && !art._p) || (v < 0 && !art._n)) v *= 0.3;   // упругий край
      setX(v);
    }
  });
  const end = () => {
    if (!down) return;
    down = false;
    if (lock !== 'x') return;
    const w = art.clientWidth || 300;
    const v = Math.abs(dx) / Math.max(1, Date.now() - t0);
    const go = Math.abs(dx) > Math.max(50, w * 0.2) || v > 0.5;
    const tr = $('#fp-art .car-track');
    if (tr) tr.style.transition = '';
    if (go && dx < 0 && art._n) { busy = true; setX(-(w + GAP)); setTimeout(() => player.next(), 190); }
    else if (go && dx > 0 && art._p) { busy = true; setX(w + GAP); setTimeout(() => player.prev(), 190); }
    else setX(0);
  };
  art.addEventListener('pointerup', end);
  art.addEventListener('pointercancel', end);
  art.addEventListener('click', (e) => {
    if (moved) { moved = false; return; }
    if (e.target.closest('.car-slide.next')) player.next();
    else if (e.target.closest('.car-slide.prev')) player.prev();
  });
  document.addEventListener('keydown', (e) => {
    if (!$('#full-player').classList.contains('open')) return;
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowRight') player.next();
    else if (e.key === 'ArrowLeft') player.prev();
  });
}
