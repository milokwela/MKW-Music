// «Жидкое стекло» в нижнем меню: подсветка идёт за пальцем, при отпускании выбирает ближайшую вкладку.
import { $, $$ } from './ui.js?v=0.13.1';

export function initLiquidNav() {
  const nav = $('#bottom-nav .nav-inner');
  if (!nav) return;
  const lens = document.createElement('span');
  lens.className = 'nav-lens';
  nav.prepend(lens);
  const btns = () => $$('#bottom-nav .nav-btn');
  let drag = false, moved = false, startX = 0, pid = 0, w = 0, justDragged = false;

  const geom = (i) => {
    const b = btns()[i];
    const r = b.getBoundingClientRect(), n = nav.getBoundingClientRect();
    return { x: r.left - n.left + 4, w: r.width - 8, cx: r.left - n.left + r.width / 2 };
  };
  const activeIndex = () => Math.max(0, btns().findIndex((b) => b.classList.contains('active')));
  const setX = (x) => lens.style.setProperty('--x', `${x}px`);
  const rest = () => {
    const g = geom(activeIndex());
    lens.style.width = `${g.w}px`;
    setX(g.x);
    btns().forEach((b) => { if (b.classList.contains('hot')) b.classList.remove('hot'); });
  };
  const nearest = (px) => {
    let best = 0, bd = 1e9;
    btns().forEach((_, i) => { const d = Math.abs(geom(i).cx - px); if (d < bd) { bd = d; best = i; } });
    return best;
  };

  nav.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = true; moved = false; startX = e.clientX; pid = e.pointerId;
    w = geom(activeIndex()).w;
    nav.classList.add('touch');
  });
  nav.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!moved && Math.abs(e.clientX - startX) > 6) {
      moved = true;
      try { nav.setPointerCapture(pid); } catch { /* ignore */ }
    }
    if (!moved) return;
    const n = nav.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - n.left - w / 2, 2), n.width - w - 2);
    setX(x);
    const i = nearest(x + w / 2);
    btns().forEach((b, k) => b.classList.toggle('hot', k === i));
  });
  const end = (e) => {
    if (!drag) return;
    drag = false;
    nav.classList.remove('touch');
    if (moved) {
      const n = nav.getBoundingClientRect();
      const x = Math.min(Math.max(e.clientX - n.left, 0), n.width);
      const i = nearest(x);
      btns()[i].click();
      justDragged = true;
      setTimeout(() => { justDragged = false; }, 300);
      rest();
      if (navigator.vibrate) navigator.vibrate(8);
    }
  };
  nav.addEventListener('pointerup', end);
  nav.addEventListener('pointercancel', (e) => { end(e); rest(); });
  nav.addEventListener('click', (e) => { if (justDragged) { e.stopPropagation(); e.preventDefault(); } }, true);

  let last = -1;
  new MutationObserver(() => { const i = activeIndex(); if (!drag && i !== last) { last = i; rest(); } }).observe(nav, { attributes: true, subtree: true, attributeFilter: ['class'] });
  const app = $('#app');
  if (app) new MutationObserver(() => setTimeout(rest, 30)).observe(app, { attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('resize', rest);
  setTimeout(rest, 0);
  requestAnimationFrame(rest);
}
