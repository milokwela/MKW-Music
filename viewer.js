// Просмотр фото на весь экран (аватар, баннер). Закрывается касанием, свайпом вниз или Esc.
import { h } from './ui.js?v=0.21.0';

export function openImage(src, caption = '') {
  if (!src) return;
  const img = h('img', { src, alt: '' });
  const box = h('div', { class: 'iv', role: 'dialog', 'aria-label': 'Фото' }, h('div', { class: 'iv-bg' }), h('figure', {}, img, caption ? h('figcaption', { text: caption }) : null));
  const close = () => { box.classList.add('out'); setTimeout(() => box.remove(), 280); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  let y0 = null;
  box.addEventListener('pointerdown', (e) => { y0 = e.clientY; });
  box.addEventListener('pointermove', (e) => { if (y0 != null && e.clientY - y0 > 0) img.style.transform = `translateY(${e.clientY - y0}px) scale(${1 - Math.min(0.2, (e.clientY - y0) / 1500)})`; });
  box.addEventListener('pointerup', (e) => { const d = y0 == null ? 0 : e.clientY - y0; y0 = null; img.style.transform = ''; if (d > 90 || Math.abs(d) < 6) close(); });
  document.addEventListener('keydown', key);
  document.body.appendChild(box);
}
