// Тема (авто/светлая/тёмная) и цвет акцента. Палитра считается из одного числа (оттенка).
export const ACCENTS = [
  { id: 'pink', name: 'Розовый', h: 335 },
  { id: 'violet', name: 'Сирень', h: 275 },
  { id: 'blue', name: 'Океан', h: 212 },
  { id: 'mint', name: 'Мята', h: 165 },
  { id: 'sun', name: 'Закат', h: 22 },
  { id: 'mono', name: 'Чёрный', h: 0, mono: true },
];

const KEY_T = 'mkw.theme';
const KEY_A = 'mkw.accent';
const KEY_H = 'mkw.accent.hue';
const KEY_N = 'mkw.accent.neutral'; // 'w' | 'b' | '' — серый/чёрный/белый без оттенка

function read(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

export const getTheme = () => read(KEY_T, 'auto');
export const getAccent = () => (read(KEY_A, '') === 'custom' ? 'custom' : ACCENTS.some((a) => a.id === read(KEY_A, '')) ? read(KEY_A, 'pink') : 'pink');
export const getCustomHue = () => Number(read(KEY_H, '335')) || 335;
export function hexToHue(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 335;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round(((h * 60) + 360) % 360);
}
export function setCustomColor(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, sat = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
  write(KEY_N, sat < 0.14 ? (l < 0.5 ? 'b' : 'w') : '');
  write(KEY_H, String(hexToHue(hex))); write(KEY_A, 'custom'); applyTheme();
}
const neutral = () => (getAccent() === 'custom' ? read(KEY_N, '') : getAccent() === 'mono' ? 'b' : '');

export function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

const hsl = (h, s, l) => `hsl(${h} ${s}% ${l}%)`;

function neutralPalette(kind, dark) {
  // серый акцент без розового оттенка; «чёрный» на тёмной теме превращается в светло-серый, чтобы быть видимым
  const lightAccent = dark ? (kind === 'w' ? 96 : 84) : (kind === 'w' ? 60 : 14);
  return dark ? {
    '--primary': hsl(0, 0, lightAccent), '--on-primary': hsl(0, 0, 10), '--primary-container': hsl(0, 0, 24),
    '--on-primary-container': hsl(0, 0, 94), '--bg': hsl(0, 0, 6), '--on-bg': hsl(0, 0, 92),
    '--surface': hsl(0, 0, 11), '--surface-high': hsl(0, 0, 16), '--outline': hsl(0, 0, 58), '--on-surface-var': hsl(0, 0, 78),
  } : {
    '--primary': hsl(0, 0, lightAccent), '--on-primary': '#ffffff', '--primary-container': hsl(0, 0, 90),
    '--on-primary-container': hsl(0, 0, 10), '--bg': hsl(0, 0, 99), '--on-bg': hsl(0, 0, 10),
    '--surface': hsl(0, 0, 96), '--surface-high': hsl(0, 0, 92), '--outline': hsl(0, 0, 50), '--on-surface-var': hsl(0, 0, 30),
  };
}

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
  else if (mode === 'black') root.dataset.theme = 'dark';
  else delete root.dataset.theme;
  const acc = getAccent() === 'custom' ? { h: getCustomHue() } : (ACCENTS.find((a) => a.id === getAccent()) || ACCENTS[0]);
  const nk = neutral();
  const pal = nk ? neutralPalette(nk, isDark()) : palette(acc.h, isDark());
  if (mode === 'black') { pal['--bg'] = '#000000'; pal['--surface'] = hsl(acc.h, nk ? 0 : 14, 7); pal['--surface-high'] = hsl(acc.h, nk ? 0 : 12, 12); }
  root.dataset.neutral = nk ? '1' : '';
  root.style.setProperty('--mix2', nk ? '#8a8a8a' : '#8f6bff');
  for (const [k, v] of Object.entries(pal)) root.style.setProperty(k, v);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = mode === 'black' ? '#000000' : isDark() ? '#0d0a0b' : '#ffffff';
  window.dispatchEvent(new CustomEvent('mkw-theme'));
}

export function setTheme(mode) { write(KEY_T, mode); applyTheme(); }
export function setAccent(id) { write(KEY_A, id); applyTheme(); }

export function initTheme() {
  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (getTheme() === 'auto') applyTheme(); });
}

export const getNeutral = () => neutral();
export function hslHex(h, s = 80, l = 62) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))).toString(16).padStart(2, '0');
  return `#${f(0)}${f(8)}${f(4)}`;
}
