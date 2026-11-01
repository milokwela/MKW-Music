// Живой фон большого плеера: цвет берётся с обложки, пульсация идёт в ритме, подобранном для трека.
// Это визуальный эффект: реальный звук YouTube страница анализировать не может.
import { queue, st, onPlayer } from './player.js?v=0.16.0';
import { $ } from './ui.js?v=0.16.0';

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

function dominant(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 24;
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0, 24, 24);
        const d = x.getImageData(0, 0, 24, 24).data;
        let best = null, bs = -1;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2];
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          const s = (mx - mn) * (0.4 + mx / 400);   // яркие насыщенные цвета в приоритете
          if (s > bs) { bs = s; best = [r, g, b]; }
        }
        resolve(best);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function syncTrack() {
  const t = queue.current;
  const el = $('#fp-glow');
  if (!el) return;
  if (!t) return;
  bpm = 84 + (hash(t.id) % 50);
  colorFor = t.id;
  const rgb = await dominant(t.artwork && t.artwork.replace(/\/\d+x\d+(bb)?\./, '/100x100bb.'));
  if (colorFor !== t.id) return;
  if (rgb) el.style.setProperty('--glow', `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`);
  else el.style.removeProperty('--glow');
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
}

export function initViz() {
  document.documentElement.classList.toggle('no-live', !liveBg());
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  t0 = performance.now();
  onPlayer((what) => { if (what === 'track') syncTrack(); });
  raf = requestAnimationFrame(frame);
}
