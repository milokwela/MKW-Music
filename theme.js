// Тема (авто/светлая/тёмная) и цвет акцента. Палитра считается из одного числа (оттенка).
export const ACCENTS = [
  { id: 'pink', name: 'Розовый', h: 335 },
  { id: 'violet', name: 'Сирень', h: 275 },
  { id: 'blue', name: 'Океан', h: 212 },
  { id: 'mint', name: 'Мята', h: 165 },
  { id: 'sun', name: 'Закат', h: 22 },
];

const KEY_T = 'mkw.theme';
const KEY_A = 'mkw.accent';

function read(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

export const getTheme = () => read(KEY_T, 'auto');
export const getAccent = () => (ACCENTS.some((a) => a.id === read(KEY_A, '')) ? read(KEY_A, 'pink') : 'pink');

export function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

const hsl = (h, s, l) => `hsl(${h} ${s}% ${l}%)`;

function palette(h, dark) {
  if (dark) {
    return {
      '--primary': hsl(h, 100, 83),
      '--on-primary': hsl(h, 60, 20),
      '--primary-container': hsl(h, 50, 30),
      '--on-primary-container': hsl(h, 100, 92),
      '--bg': hsl(h, 22, 7),
      '--on-bg': hsl(h, 20, 91),
      '--surface': hsl(h, 18, 12),
      '--surface-high': hsl(h, 16, 17),
      '--outline': hsl(h, 8, 58),
      '--on-surface-var': hsl(h, 20, 79),
    };
  }
  return {
    '--primary': hsl(h, 55, 40),
    '--on-primary': '#ffffff',
    '--primary-container': hsl(h, 100, 91),
    '--on-primary-container': hsl(h, 100, 12),
    '--bg': hsl(h, 100, 99),
    '--on-bg': hsl(h, 20, 10),
    '--surface': hsl(h, 60, 96),
    '--surface-high': hsl(h, 45, 92),
    '--outline': hsl(h, 8, 50),
    '--on-surface-var': hsl(h, 15, 30),
  };
}

export function applyTheme() {
  const mode = getTheme();
  const root = document.documentElement;
  if (mode === 'light' || mode === 'dark') root.dataset.theme = mode;
  else delete root.dataset.theme;
  const acc = ACCENTS.find((a) => a.id === getAccent()) || ACCENTS[0];
  const pal = palette(acc.h, isDark());
  for (const [k, v] of Object.entries(pal)) root.style.setProperty(k, v);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = isDark() ? '#0d0a0b' : '#ffffff';
  window.dispatchEvent(new CustomEvent('mkw-theme'));
}

export function setTheme(mode) { write(KEY_T, mode); applyTheme(); }
export function setAccent(id) { write(KEY_A, id); applyTheme(); }

export function initTheme() {
  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (getTheme() === 'auto') applyTheme(); });
}
