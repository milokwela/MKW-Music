// Текст песни: строки подсвечиваются в такт музыке (синхронный текст из LRCLIB), на текущей строке слова «заливаются».
import { $, h, toast } from './ui.js?v=0.13.2';
import * as player from './player.js?v=0.13.2';

const API = 'https://lrclib.net/api';
const cache = new Map();
let open = false, lines = [], plain = false, active = -1, token = 0, raf = 0;
let stamp = { t: 0, at: 0 };

const clean = (s) => String(s || '').replace(/\s*[(\[][^)\]]*(feat|ft|remaster|live|version|prod|из|from)[^)\]]*[)\]]/gi, '').replace(/\s*-\s*(remaster(ed)?|single|radio edit).*$/i, '').trim();
const firstArtist = (s) => String(s || '').split(/,|&| feat\.? | ft\.? | x /i)[0].trim();

function parseLrc(text) {
  const out = [];
  for (const raw of text.split('\n')) {
    const m = raw.match(/^((?:\[\d+:\d+(?:\.\d+)?\])+)\s*(.*)$/);
    if (!m) continue;
    for (const tm of m[1].matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)) out.push({ t: Number(tm[1]) * 60 + Number(tm[2]), text: m[2] });
  }
  return out.sort((a, b) => a.t - b.t);
}

async function getJson(url) {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 9000);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) return null; return await r.json(); } catch { return null; } finally { clearTimeout(to); }
}

async function load(track, dur) {
  const key = track.id;
  if (cache.has(key)) return cache.get(key);
  const title = clean(track.title), artist = firstArtist(track.artist);
  const q = new URLSearchParams({ track_name: title, artist_name: artist });
  if (dur > 0) q.set('duration', String(Math.round(dur)));
  let res = await getJson(`${API}/get?${q}`);
  if (!res || (!res.syncedLyrics && !res.plainLyrics)) {
    const tries = [
      { track_name: title, artist_name: artist },
      { track_name: title },
      { q: `${artist} ${title}` },
      { q: title },
    ];
    for (const params of tries) {
      const list = await getJson(`${API}/search?${new URLSearchParams(params)}`);
      if (Array.isArray(list)) {
        res = list.find((x) => x.syncedLyrics) || list.find((x) => x.plainLyrics) || null;
        if (res) break;
      }
    }
  }
  let val = res && res.syncedLyrics ? { synced: parseLrc(res.syncedLyrics) } : res && res.plainLyrics ? { plain: res.plainLyrics } : null;
  if (!val) {
    const ov = await getJson(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
    if (ov && ov.lyrics) val = { plain: String(ov.lyrics).replace(/\r/g, ''), approx: true };
  }
  cache.set(key, val);
  return val;
}

function box() { return $('#fp-lyrics .ly-scroll'); }
function message(txt) { lines = []; box().replaceChildren(h('div', { class: 'ly-msg', text: txt })); $('#fp-lyrics').classList.remove('ly-plain'); }

function render(data) {  // eslint-disable-line complexity
  const sc = box(); active = -1;
  if (!data) { message('Текст для этой песни не нашёлся'); return; }
  if (data.synced && data.synced.length) {
    plain = false; lines = data.synced;
    $('#fp-lyrics').classList.remove('ly-plain');
    sc.replaceChildren(...lines.map((l, i) => {
      const words = String(l.text || '♪').split(/\s+/).filter(Boolean);
      return h('div', { class: 'ly-line', 'data-i': String(i), onclick: () => player.seek(Math.max(0, l.t)) },
        words.map((w, k) => h('span', { class: 'w', text: k < words.length - 1 ? `${w} ` : w })));
    }));
  } else if (data.approx && player.st.duration > 20) {
    // тайминги неизвестны: растягиваем строки равномерно по длине трека (приблизительно)
    const rows = String(data.plain).split('\n').map((s) => s.trim()).filter(Boolean);
    const span = Math.max(10, player.st.duration - 14) / rows.length;
    data = { synced: rows.map((text, n) => ({ t: 6 + n * span, text })), approx: true };
    plain = false; lines = data.synced;
    $('#fp-lyrics').classList.remove('ly-plain');
    sc.replaceChildren(...lines.map((ln, i) => {
      const words = ln.text.split(/\s+/).filter(Boolean);
      return h('div', { class: 'ly-line', 'data-i': String(i), onclick: () => player.seek(Math.max(0, ln.t)) }, words.map((w, k) => h('span', { class: 'w', text: k < words.length - 1 ? `${w} ` : w })));
    }));
    sc.appendChild(h('div', { class: 'ly-msg', text: 'Тайминги приблизительные' }));
  } else {
    plain = true; lines = [];
    $('#fp-lyrics').classList.add('ly-plain');
    sc.replaceChildren(...String(data.plain).split('\n').map((t) => h('div', { class: 'ly-line', text: t || ' ' })));
  }
}

async function refresh() {
  const t = player.queue.current;
  if (!open) return;
  const my = ++token;
  if (!t) { message('Включите песню, чтобы увидеть текст'); return; }
  message('Ищу текст…');
  const data = await load(t, player.st.duration);
  if (my !== token) return;
  render(data);
}

function now() { return stamp.t + (player.st.playing ? (performance.now() - stamp.at) / 1000 : 0); }

function frame() {
  raf = 0;
  if (!open) return;
  if (lines.length && !plain) {
    const t = now() + 0.15;
    let i = -1;
    for (let k = 0; k < lines.length; k++) { if (lines[k].t <= t) i = k; else break; }
    const nodes = box().children;
    if (i !== active) {
      if (active >= 0 && nodes[active]) {
        nodes[active].classList.remove('now');
        const done = i > active; // ушли вперёд: прошлая строка целиком «допета»
        for (const w of nodes[active].children) w.classList.toggle('on', done);
      }
      for (let k = 0; k < nodes.length; k++) {
        nodes[k].classList.toggle('past', k < i);
        // глубина резкости: чем дальше от текущей строки, тем сильнее размытие и слабее строка
        const d = Math.abs(k - (i < 0 ? 0 : i));
        if (k === i) { nodes[k].style.filter = ''; nodes[k].style.opacity = ''; }
        else if (k < i) { nodes[k].style.filter = `blur(${Math.min(3, .8 + d * .6).toFixed(2)}px)`; nodes[k].style.opacity = String(Math.max(.25, .6 - d * .08).toFixed(2)); }
        else { nodes[k].style.filter = `blur(${Math.min(7, 1.6 + d * 1.5).toFixed(2)}px)`; nodes[k].style.opacity = String(Math.max(.2, .85 - d * .2).toFixed(2)); }
      }
      active = i;
      if (nodes[i]) { nodes[i].classList.add('now'); const sc = box(); sc.scrollTo({ top: nodes[i].offsetTop - sc.clientHeight / 2 + nodes[i].offsetHeight / 2, behavior: 'smooth' }); }
    }
    if (i >= 0 && nodes[i]) {
      const end = lines[i + 1] ? lines[i + 1].t : lines[i].t + 4;
      const len = Math.min(Math.max(end - lines[i].t, 0.5), 6);
      const prog = Math.min(1, Math.max(0, (t - lines[i].t) / len));
      const ws = nodes[i].children, on = Math.floor(prog * ws.length + 0.0001);
      for (let k = 0; k < ws.length; k++) ws[k].classList.toggle('on', k < on || (k === on && prog > 0 && k === ws.length - 1 && prog >= 1));
    }
  }
  raf = requestAnimationFrame(frame);
}

function paintBg() {
  const t = player.queue.current;
  const el = $('#fp-lyrics');
  el.style.setProperty('--ly-art', t && t.artwork ? `url("${t.artwork}")` : 'none');
}

function setOpen(v) {
  open = v;
  if (v) paintBg();
  $('#full-player').classList.toggle('lyrics-on', v);
  $('#fp-lyrics').hidden = !v;
  $('#fp-lyrics-btn').classList.toggle('on', v);
  if (v) { refresh(); if (!raf) raf = requestAnimationFrame(frame); }
  else { token += 1; cancelAnimationFrame(raf); raf = 0; }
}

export function initLyrics() {
  $('#fp-lyrics-btn').addEventListener('click', () => { if (!player.queue.current) { toast('Сначала включите песню'); return; } setOpen(!open); });
  player.onPlayer((ev) => {
    if (ev === 'time') stamp = { t: player.st.time, at: performance.now() };
    else if (ev === 'track' && open) { paintBg(); refresh(); }
    else if (ev === 'state' || ev === 'play' || ev === 'pause') stamp = { t: player.st.time, at: performance.now() };
  });
}
