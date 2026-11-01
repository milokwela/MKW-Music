// Живой фон большого плеера: цвет берётся с обложки, пульсация идёт в ритме, подобранном для трека.
// Это визуальный эффект: реальный звук YouTube страница анализировать не может.
import { queue, st, onPlayer } from './player.js?v=0.22.0';
import { $ } from './ui.js?v=0.22.0';
import { jsonp } from './jsonp.js?v=0.22.0';

export const liveBg = () => { try { return localStorage.getItem('mkw.livebg') !== '0'; } catch { return true; } };
export function setLiveBg(on) {
  try { localStorage.setItem('mkw.livebg', on ? '1' : '0'); } catch { /* ignore */ }
  document.documentElement.classList.toggle('no-live', !on);
}
let raf = 0;
let t0 = 0;
let bpm = 100;
let colorFor = '';

function hash(s) { let x = 0; for (const ch of String(s)) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return x; }

// Палитра обложки: 4 самых заметных и непохожих цвета + тёмная основа
function palette(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const N = 40, c = document.createElement('canvas'); c.width = c.height = N;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0, N, N);
        const d = x.getImageData(0, 0, N, N).data;
        const buckets = new Map();
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2];
          const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
          const e = buckets.get(k) || { n: 0, r: 0, g: 0, b: 0 };
          e.n += 1; e.r += r; e.g += g; e.b += b; buckets.set(k, e);
        }
        const cols = [...buckets.values()].map((e) => {
          const r = e.r / e.n, g = e.g / e.n, b = e.b / e.n;
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0, lum = (mx + mn) / 510;
          return { rgb: [r, g, b], n: e.n, sat, lum, score: e.n * (0.25 + sat * 1.6) * (lum < 0.08 || lum > 0.95 ? 0.15 : 1) };
        }).sort((a, b) => b.score - a.score);
        const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        const pick = [];
        for (const col of cols) { if (pick.every((p) => dist(p.rgb, col.rgb) > 70)) pick.push(col); if (pick.length === 4) break; }
        while (pick.length && pick.length < 4) pick.push({ ...pick[pick.length - 1], rgb: pick[pick.length - 1].rgb.map((v) => v * 0.7) });
        if (!pick.length) return resolve(null);
        const most = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
        const base = [most.r / most.n, most.g / most.n, most.b / most.n];
        resolve({ colors: pick.map((p) => p.rgb.map(Math.round)), base: base.map(Math.round) });
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// Настоящий темп трека из Deezer (если он там известен) — пульсация идёт в такт
const bpmCache = new Map();
async function realBpm(t) {
  if (bpmCache.has(t.id)) return bpmCache.get(t.id);
  let v = 0;
  try {
    const s = await jsonp(`https://api.deezer.com/search?limit=1&q=${encodeURIComponent(`artist:"${t.artist}" track:"${t.title}"`)}`, 5000);
    const hit = s && s.data && s.data[0];
    if (hit) { const tr = await jsonp(`https://api.deezer.com/track/${hit.id}`, 5000); v = Number(tr && tr.bpm) || 0; }
  } catch { /* нет */ }
  if (v > 180) v /= 2;
  bpmCache.set(t.id, v);
  return v;
}

const rgbs = (c, k = 1) => `rgb(${Math.round(c[0] * k)}, ${Math.round(c[1] * k)}, ${Math.round(c[2] * k)})`;
async function syncTrack() {
  const t = queue.current;
  const el = $('#fp-glow');
  const full = $('#full-player');
  if (!el || !t) return;
  while (el.children.length < 4) el.appendChild(document.createElement('i'));
  bpm = 84 + (hash(t.id) % 50);
  colorFor = t.id;
  const art = t.artwork && t.artwork.replace(/\/\d+x\d+(bb)?\./, '/100x100bb.');
  const [pal, real] = await Promise.all([palette(art), realBpm(t).catch(() => 0)]);
  if (colorFor !== t.id) return;
  if (real >= 60) bpm = real;
  if (pal) {
    pal.colors.forEach((c, i) => el.style.setProperty(`--c${i + 1}`, rgbs(c)));
    el.style.setProperty('--glow', rgbs(pal.colors[0]));
    full.style.setProperty('--pal-bg', rgbs(pal.base, 0.22));
    full.style.setProperty('--pal-bg2', rgbs(pal.colors[0], 0.38));
    full.classList.add('pal');
  } else {
    el.style.removeProperty('--glow');
    full.classList.remove('pal');
  }
}

function frame(now) {
  raf = requestAnimationFrame(frame);
  const full = $('#full-player');
  if (!liveBg() || (!full.classList.contains('open') && !full.classList.contains('dragging'))) return;
  const el = $('#fp-glow');
  const t = (now - t0) / 1000;
  let beat = 0;
  if (st.playing) {
    const ph = (t * bpm / 60) % 1;
    const ph2 = (t * bpm / 60 + 0.5) % 1;
    beat = Math.max(Math.exp(-ph * 5), 0.45 * Math.exp(-ph2 * 7));
  }
  el.style.setProperty('--beat', beat.toFixed(3));
  full.style.setProperty('--beat', beat.toFixed(3));
  const k = st.playing ? 1 : 0.3;
  el.style.setProperty('--dx1', `${Math.sin(t * 0.31) * 6 * k}vmax`);
  el.style.setProperty('--dy1', `${Math.cos(t * 0.27) * 5 * k}vmax`);
  el.style.setProperty('--dx2', `${Math.cos(t * 0.23) * 7 * k}vmax`);
  el.style.setProperty('--dy2', `${Math.sin(t * 0.37) * 6 * k}vmax`);
  el.style.setProperty('--dx3', `${Math.sin(t * 0.29 + 1) * 6 * k}vmax`);
  el.style.setProperty('--dy3', `${Math.cos(t * 0.33 + 2) * 5 * k}vmax`);
  el.style.setProperty('--dx4', `${Math.cos(t * 0.19 + 3) * 8 * k}vmax`);
  el.style.setProperty('--dy4', `${Math.sin(t * 0.21 + 1) * 6 * k}vmax`);
}

export function initViz() {
  document.documentElement.classList.toggle('no-live', !liveBg());
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  t0 = performance.now();
  onPlayer((what) => { if (what === 'track') syncTrack(); });
  raf = requestAnimationFrame(frame);
}
