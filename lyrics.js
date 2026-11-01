// Текст песни: синхронный (LRCLIB), слова заливаются цветом акцента, соседние строки размыты. Работает и в «Волне».
// Если синхронного текста нет, берётся обычный (lyrics.ovh): строки идут равномерно по длине трека (приблизительно).
import { $, h, toast } from './ui.js?v=0.16.0';
import * as player from './player.js?v=0.16.0';

const API = 'https://lrclib.net/api';
const MKEY = 'mkw.lyrics.mode';
const cache = new Map();
let open = false, lines = [], rawPlain = '', approx = false, active = -2, token = 0, raf = 0, userScrollUntil = 0;
let stamp = { t: 0, at: 0 };
let mode = (() => { try { return localStorage.getItem(MKEY) === 'static' ? 'static' : 'sync'; } catch { return 'sync'; } })();

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
    const tries = [{ track_name: title, artist_name: artist }, { track_name: title }, { q: `${artist} ${title}` }, { q: title }];
    for (const params of tries) {
      const list = await getJson(`${API}/search?${new URLSearchParams(params)}`);
      if (Array.isArray(list)) { res = list.find((x) => x.syncedLyrics) || list.find((x) => x.plainLyrics) || null; if (res) break; }
    }
  }
  let val = res && res.syncedLyrics ? { synced: parseLrc(res.syncedLyrics), plain: res.plainLyrics || '' } : res && res.plainLyrics ? { plain: res.plainLyrics } : null;
  if (!val) {
    const ov = await getJson(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
    if (ov && ov.lyrics) val = { plain: String(ov.lyrics).replace(/\r/g, ''), approx: true };
  }
  cache.set(key, val);
  return val;
}

const box = () => $('#fp-lyrics .ly-scroll');
const tools = () => $('#fp-lyrics .ly-tools');

function message(txt) {
  lines = []; rawPlain = ''; active = -2;
  box().replaceChildren(h('div', { class: 'ly-msg', text: txt }));
  tools().hidden = true;
}

function wordsOf(text) { return String(text || '♪').split(/\s+/).filter(Boolean); }

function paintTools() {
  const t = tools();
  t.hidden = !(lines.length && rawPlain) && !lines.length;
  for (const b of t.querySelectorAll('button')) b.classList.toggle('on', b.dataset.m === mode);
  // кнопка «Текстом» нужна, только если есть что показать
  t.hidden = !lines.length && !rawPlain;
}

function renderBody() {
  const sc = box(); active = -2;
  if (mode === 'static' || !lines.length) {
    const txt = rawPlain || lines.map((l) => l.text).join('\n');
    $('#fp-lyrics').classList.add('ly-static');
    sc.replaceChildren(...txt.split('\n').map((t) => h('div', { class: 'ly-line static', text: t || ' ' })));
    sc.scrollTop = 0;
  } else {
    $('#fp-lyrics').classList.remove('ly-static');
    sc.replaceChildren(...lines.map((l, i) => h('div', { class: 'ly-line', 'data-i': String(i), onclick: () => player.seek(Math.max(0, l.t)) },
      wordsOf(l.text).map((w, k, a) => h('span', { class: 'w', text: k < a.length - 1 ? `${w} ` : w })))));
    if (approx) sc.appendChild(h('div', { class: 'ly-msg small', text: 'Тайминги приблизительные' }));
  }
  paintTools();
}

function render(data) {
  if (!data) { message('Текст для этой песни не нашёлся'); return; }
  approx = false; lines = []; rawPlain = '';
  if (data.synced && data.synced.length) { lines = data.synced; rawPlain = data.plain || ''; }
  else if (data.approx && player.st.duration > 20) {
    const rows = String(data.plain).split('\n').map((s) => s.trim()).filter(Boolean);
    const span = Math.max(10, player.st.duration - 14) / Math.max(1, rows.length);
    lines = rows.map((text, n) => ({ t: 6 + n * span, text })); rawPlain = String(data.plain); approx = true;
  } else { rawPlain = String(data.plain || ''); }
  renderBody();
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

function styleLines(nodes, i) {
  for (let k = 0; k < nodes.length; k++) {
    if (!nodes[k].classList.contains('ly-line')) continue;
    nodes[k].classList.toggle('past', k < i);
    nodes[k].classList.toggle('now', k === i);
    const d = Math.abs(k - Math.max(i, -1));
    if (k === i) { nodes[k].style.filter = ''; nodes[k].style.opacity = ''; }
    else if (k < i) { nodes[k].style.filter = `blur(${Math.min(3, .8 + d * .6).toFixed(2)}px)`; nodes[k].style.opacity = String(Math.max(.25, .6 - d * .08).toFixed(2)); }
    else { nodes[k].style.filter = `blur(${Math.min(7, (i < 0 ? .4 : 1.6) + d * 1.4).toFixed(2)}px)`; nodes[k].style.opacity = String(Math.max(.2, .85 - d * .2).toFixed(2)); }
  }
}

function frame() {
  raf = 0;
  if (!open) return;
  if (lines.length && mode === 'sync') {
    const sc = box(), nodes = sc.children;
    const t = now() + 0.15;
    let i = -1;
    for (let k = 0; k < lines.length; k++) { if (lines[k].t <= t) i = k; else break; }
    if (i !== active) {
      if (active >= 0 && nodes[active]) for (const w of nodes[active].children) w.classList.toggle('on', i > active);
      active = i;
      styleLines(nodes, i);
      const el = nodes[Math.max(i, 0)];
      if (el && Date.now() > userScrollUntil) sc.scrollTo({ top: el.offsetTop - sc.clientHeight * 0.38 + el.offsetHeight / 2, behavior: 'smooth' });
    }
    if (i >= 0 && nodes[i]) {
      const end = lines[i + 1] ? lines[i + 1].t : lines[i].t + 4;
      const len = Math.min(Math.max(end - lines[i].t, .5), 6);
      const prog = Math.min(1, Math.max(0, (t - lines[i].t) / len));
      const ws = nodes[i].children, on = Math.ceil(prog * ws.length - 0.001);
      for (let k = 0; k < ws.length; k++) ws[k].classList.toggle('on', k < on);
    }
  }
  raf = requestAnimationFrame(frame);
}

function setOpen(v) {
  open = v;
  $('#full-player').classList.toggle('lyrics-on', v);
  $('#fp-lyrics').hidden = !v;
  $('#fp-lyrics-btn').classList.toggle('on', v);
  if (v) {
    const t = player.queue.current;
    $('#fp-lyrics').style.setProperty('--ly-art', t && t.artwork ? `url("${t.artwork}")` : 'none');
    refresh(); if (!raf) raf = requestAnimationFrame(frame);
  } else { token += 1; cancelAnimationFrame(raf); raf = 0; }
}

function setMode(m) {
  mode = m;
  try { localStorage.setItem(MKEY, m); } catch { /* ignore */ }
  if (lines.length || rawPlain) renderBody();
}

export function initLyrics() {
  const root = $('#fp-lyrics');
  const tl = h('div', { class: 'ly-tools', hidden: '' },
    h('button', { type: 'button', 'data-m': 'sync', onclick: () => setMode('sync') }, 'Синхронно'),
    h('button', { type: 'button', 'data-m': 'static', onclick: () => setMode('static') }, 'Текстом'));
  root.prepend(tl);
  const sc = box();
  for (const ev of ['wheel', 'touchmove', 'pointerdown']) sc.addEventListener(ev, () => { userScrollUntil = Date.now() + 3500; }, { passive: true });
  $('#fp-lyrics-btn').addEventListener('click', () => { if (!player.queue.current) { toast('Сначала включите песню'); return; } setOpen(!open); });
  player.onPlayer((ev) => {
    if (ev === 'time' || ev === 'state') stamp = { t: player.st.time, at: performance.now() };
    if (ev === 'track' && open) {
      if (!player.queue.current) { setOpen(false); return; }
      root.style.setProperty('--ly-art', player.queue.current.artwork ? `url("${player.queue.current.artwork}")` : 'none');
      refresh();
    }
  });
}
