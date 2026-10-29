// Стеклянная подсветка в списках: зажмите строку и ведите пальцем (мышью — просто наведите), отпустите, чтобы включить.
import { $ } from './ui.js';

export function initRowLens() {
  let timer = null, active = false, list = null, cur = null, sx = 0, sy = 0, lens = null, swallow = false;
  const ensure = (l) => {
    if (lens && lens.parentNode === l) return lens;
    if (lens) lens.remove();
    lens = document.createElement('span');
    lens.className = 'row-lens';
    if (getComputedStyle(l).position === 'static') l.style.position = 'relative';
    l.appendChild(lens);
    return lens;
  };
  const show = (row) => {
    if (!row || !list) return;
    const el = ensure(list);
    el.style.left = `${row.offsetLeft}px`;
    el.style.top = `${row.offsetTop}px`;
    el.style.width = `${row.offsetWidth}px`;
    el.style.height = `${row.offsetHeight}px`;
    el.classList.add('on');
    if (cur !== row) { if (cur) cur.classList.remove('lensed'); row.classList.add('lensed'); cur = row; if (navigator.vibrate && active) navigator.vibrate(5); }
  };
  const hide = () => {
    if (lens) lens.classList.remove('on');
    if (cur) cur.classList.remove('lensed');
    cur = null;
  };
  const rowAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const r = el && el.closest ? el.closest('.track-row') : null;
    return r && list && list.contains(r) ? r : null;
  };

  document.addEventListener('touchstart', (e) => {
    const row = e.target.closest && e.target.closest('.track-row');
    if (!row || e.target.closest('.icon-btn')) return;
    list = row.closest('.list');
    if (!list) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    clearTimeout(timer);
    timer = setTimeout(() => { active = true; document.body.classList.add('lens-on'); show(row); if (navigator.vibrate) navigator.vibrate(10); }, 260);
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (!active) {
      if (Math.abs(t.clientX - sx) > 8 || Math.abs(t.clientY - sy) > 8) clearTimeout(timer);
      return;
    }
    if (e.cancelable) e.preventDefault();
    const row = rowAt(t.clientX, t.clientY);
    if (row) show(row);
  }, { passive: false });

  const end = () => {
    clearTimeout(timer);
    if (!active) return;
    active = false;
    document.body.classList.remove('lens-on');
    const row = cur;
    hide();
    swallow = true;
    setTimeout(() => { swallow = false; }, 350);
    if (row) { const b = row.querySelector('.main'); if (b) b.click(); }
  };
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', () => { clearTimeout(timer); if (active) { active = false; document.body.classList.remove('lens-on'); hide(); } });
  document.addEventListener('click', (e) => { if (swallow && e.target.closest && e.target.closest('.track-row')) { e.stopPropagation(); e.preventDefault(); } }, true);
  document.addEventListener('contextmenu', (e) => { if (active || e.target.closest?.('.track-row')) { if (active) e.preventDefault(); } });

  // Мышь (компьютер): подсветка следует за курсором.
  document.addEventListener('mouseover', (e) => {
    if (active || e.pointerType === 'touch') return;
    const row = e.target.closest && e.target.closest('.track-row');
    if (!row) return;
    list = row.closest('.list');
    if (list && window.matchMedia('(hover: hover)').matches) show(row);
  });
  document.addEventListener('mouseout', (e) => {
    if (active) return;
    const to = e.relatedTarget;
    if (!to || !(to.closest && to.closest('.track-row'))) hide();
  });
  void $;
}
