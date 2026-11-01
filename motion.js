// Движение в стиле Material 3: «общая ось» при смене вкладок и волна (ripple) при нажатии.
const ORDER = ['search', 'library', 'profile'];
let cur = 'search';

export function viewDirection(next) {
  const d = ORDER.indexOf(next) - ORDER.indexOf(cur);
  cur = next;
  return d === 0 ? 0 : d > 0 ? 1 : -1;
}

export function animateView(el, dir) {
  if (!el || document.documentElement.classList.contains('lowpower') || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.classList.remove('m3-in-l', 'm3-in-r', 'm3-in');
  void el.offsetWidth;
  el.classList.add(dir > 0 ? 'm3-in-r' : dir < 0 ? 'm3-in-l' : 'm3-in');
}

const SEL = '.btn, .chip, .icon-btn, .track-row .main, .set-row.tap, .nav-btn, .ptab, .swatch, .lb-row, .top-row, .fa, .pe-track, .pe-badge, .theme-card, .wave-btn, .seg button';
export function initMotion() {
  document.addEventListener('pointerdown', (e) => {
    if (document.documentElement.classList.contains('lowpower')) return;
    const t = e.target.closest(SEL);
    if (!t || t.disabled) return;
    const r = t.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2.2;
    const s = document.createElement('span');
    s.className = 'm3-ripple';
    s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
    if (getComputedStyle(t).position === 'static') t.style.position = 'relative';
    t.classList.add('m3-host');
    t.appendChild(s);
    const done = () => { s.classList.add('out'); setTimeout(() => s.remove(), 450); };
    window.addEventListener('pointerup', done, { once: true });
    window.addEventListener('pointercancel', done, { once: true });
  }, { passive: true });
}
