// Просмотр фото на весь экран (фото в чате, аватар, баннер).
// Двумя пальцами — приблизить, двойное касание — приблизить/вернуть, пальцем — двигать приближенное фото,
// свайп вниз — закрыть, касание — спрятать/показать кнопки. «Сохранить» кладёт фото в галерею телефона.
import { h, toast } from './ui.js';
import { mi } from './icons2.js';

function save(src) {
  const n = window.MKWNative;
  const name = `MKW_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
  if (/MKWApp\//.test(navigator.userAgent)) {
    if (n && n.saveImage) { n.saveImage(src, name); return; }
    toast('Обновите приложение, чтобы сохранять фото'); return;
  }
  try {
    const a = document.createElement('a');
    a.href = src; a.download = `${name}.${/png/.test(src.slice(0, 30)) ? 'png' : 'jpg'}`;
    document.body.appendChild(a); a.click(); a.remove();
  } catch { toast('Не получилось сохранить'); }
}

export function openImage(src, caption = '') {
  if (!src) return;
  const img = h('img', { src, alt: '', draggable: 'false' });
  const bar = h('div', { class: 'iv2-bar' },
    h('button', { type: 'button', class: 'iv2-btn', 'aria-label': 'Закрыть', onclick: (e) => { e.stopPropagation(); close(); } }, mi('close')),
    h('span', { class: 'iv2-cap', text: caption || '' }),
    h('button', { type: 'button', class: 'iv2-btn', 'aria-label': 'Сохранить', onclick: (e) => { e.stopPropagation(); save(src); } }, mi('download')));
  const stage = h('div', { class: 'iv2-stage' }, img);
  const box = h('div', { class: 'iv2', role: 'dialog', 'aria-label': 'Фото' }, h('div', { class: 'iv2-bg' }), stage, bar);
  let closed = false;
  const step = window.__mkwStep;
  const close = (fromBack) => {
    if (closed) return; closed = true;
    box.classList.add('out'); setTimeout(() => box.remove(), 260); document.removeEventListener('keydown', key);
    if (step && fromBack !== true) step.close('photo-view');
  };
  const key = (e) => { if (e.key === 'Escape') close(); };

  // ---- жесты ----
  let z = 1, tx = 0, ty = 0;
  const apply = (anim) => { img.style.transition = anim ? 'transform .22s cubic-bezier(.2,.8,.2,1)' : 'none'; img.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`; };
  const clamp = () => {
    const r = stage.getBoundingClientRect(), w = img.offsetWidth * z, hh = img.offsetHeight * z;
    const mx = Math.max(0, (w - r.width) / 2), my = Math.max(0, (hh - r.height) / 2);
    tx = Math.max(-mx, Math.min(mx, tx)); ty = Math.max(-my, Math.min(my, ty));
  };
  const pts = new Map();
  let g = null, lastTap = 0, moved = false, downY = 0, downX = 0;
  const center = () => { const r = stage.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  box.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.iv2-bar')) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    try { box.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    moved = false; downX = e.clientX; downY = e.clientY;
    if (pts.size === 2) {
      const [a, b] = [...pts.values()], [cx, cy] = center();
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      g = { kind: 'pinch', d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, z0: z, tx0: tx, ty0: ty, m0: [m[0] - cx, m[1] - cy] };
    } else if (pts.size === 1) g = { kind: z > 1.01 ? 'pan' : 'drag', x: e.clientX, y: e.clientY, tx0: tx, ty0: ty };
  });
  box.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !g) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 8) moved = true;
    if (g.kind === 'pinch' && pts.size >= 2) {
      const [a, b] = [...pts.values()], [cx, cy] = center();
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, m = [(a[0] + b[0]) / 2 - cx, (a[1] + b[1]) / 2 - cy];
      const nz = Math.max(1, Math.min(6, g.z0 * (d / g.d)));
      // точка под пальцами остаётся под пальцами
      tx = m[0] - ((g.m0[0] - g.tx0) * nz) / g.z0; ty = m[1] - ((g.m0[1] - g.ty0) * nz) / g.z0;
      z = nz; clamp(); apply(false); return;
    }
    if (g.kind === 'pan') { tx = g.tx0 + (e.clientX - g.x); ty = g.ty0 + (e.clientY - g.y); clamp(); apply(false); return; }
    if (g.kind === 'drag') {
      const dy = Math.max(0, e.clientY - g.y);
      img.style.transition = 'none'; img.style.transform = `translateY(${dy}px) scale(${1 - Math.min(0.15, dy / 1600)})`;
      box.style.setProperty('--fade', String(Math.max(0.2, 1 - dy / 500)));
    }
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (!g) return;
    if (g.kind === 'pinch') {
      if (pts.size === 1) { const [p] = [...pts.values()]; g = { kind: z > 1.01 ? 'pan' : 'drag', x: p[0], y: p[1], tx0: tx, ty0: ty }; moved = true; return; }
      if (z < 1.05) { z = 1; tx = 0; ty = 0; apply(true); }
      g = null; return;
    }
    if (g.kind === 'drag') {
      const dy = e.clientY - g.y;
      box.style.removeProperty('--fade');
      if (dy > 110) { close(); g = null; return; }
      tx = 0; ty = 0; apply(true);
    }
    g = null;
    if (!moved) {
      const now = Date.now();
      if (now - lastTap < 280) {
        // двойное касание: приблизить к месту касания или вернуть
        lastTap = 0; clearTimeout(box._tt);
        if (z > 1.01) { z = 1; tx = 0; ty = 0; } else { const [cx, cy] = center(); z = 2.5; tx = -(e.clientX - cx) * 1.5; ty = -(e.clientY - cy) * 1.5; clamp(); }
        apply(true);
      } else {
        lastTap = now;
        box._tt = setTimeout(() => box.classList.toggle('bare'), 290);
      }
    }
  };
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  box.addEventListener('wheel', (e) => { e.preventDefault(); z = Math.max(1, Math.min(6, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); if (z === 1) { tx = 0; ty = 0; } clamp(); apply(true); }, { passive: false });

  document.addEventListener('keydown', key);
  // системный «Назад» в приложении закрывает фото, а не экран под ним
  if (step) step.open('photo-view', () => close(true));
  document.body.appendChild(box);
}
