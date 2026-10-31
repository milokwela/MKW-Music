// Текст песни: строки подсвечиваются в такт музыке (синхронный текст из LRCLIB), на текущей строке слова «заливаются».
import { $, h, toast } from './ui.js?v=0.13.0';
import * as player from './player.js?v=0.13.0';

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
    const list = await getJson(`${API}/search?${new URLSearchParams({ track_name: title, artist_name: artist })}`);
    if (Array.isArray(list)) res = list.find((x) => x.syncedLyrics) || list.find((x) => x.plainLyrics) || null;
  }
  const val = res && res.syncedLyrics ? { synced: parseLrc(res.syncedLyrics) } : res && res.plainLyrics ? { plain: res.plainLyrics } : null;
  cache.set(key, val);
  return val;
}

function box() { return $('#fp-lyrics .ly-scroll'); }
function message(txt) { lines = []; box().replaceChildren(h('div', { class: 'ly-msg', text: txt })); $('#fp-lyrics').classList.remove('ly-plain'); }

function render(data) {
  const sc = box(); active = -1;
  if (!data) { message('Текст для этой песни не нашёлся'); return; }
  if (data.synced && data.synced.length) {
    plain = false; lines = data.synced;
    $('#fp-lyrics').classList.remove('ly-plain');
    sc.replaceChildren(...lines.map((l, i) => h('div', { class: 'ly-line', 'data-i': String(i), text: l.text || '♪', onclick: () => player.seek(Math.max(0, l.t)) })));
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
      if (active >= 0 && nodes[active]) { nodes[active].classList.remove('now'); nodes[active].style.removeProperty('--p'); }
      for (let k = 0; k < nodes.length; k++) nodes[k].classList.toggle('past', k < i);
      active = i;
      if (nodes[i]) { nodes[i].classList.add('now'); const sc = box(); sc.scrollTo({ top: nodes[i].offsetTop - sc.clientHeight / 2 + nodes[i].offsetHeight / 2, behavior: 'smooth' }); }
    }
    if (i >= 0 && nodes[i]) {
      const end = lines[i + 1] ? lines[i + 1].t : lines[i].t + 4;
      const len = Math.min(Math.max(end - lines[i].t, 0.5), 6);
      nodes[i].style.setProperty('--p', `${Math.min(100, ((t - lines[i].t) / len) * 100)}%`);
    }
  }
  raf = requestAnimationFrame(frame);
}

function setOpen(v) {
  open = v;
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
    else if (ev === 'track' && open) refresh();
    else if (ev === 'state' || ev === 'play' || ev === 'pause') stamp = { t: player.st.time, at: performance.now() };
  });
}
