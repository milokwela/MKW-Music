// Текст песни: синхронный (LRCLIB), слова заливаются цветом акцента, соседние строки размыты. Работает и в «Волне».
// Если синхронного текста нет, берётся обычный (lyrics.ovh): строки идут равномерно по длине трека (приблизительно).
import { $, h, toast } from './ui.js?v=0.17.0';
import * as player from './player.js?v=0.17.0';
import { RECOGNIZE_URL } from './shazam-config.js?v=0.17.0';

const API = 'https://lrclib.net/api';
const MKEY = 'mkw.lyrics.mode';
const cache = new Map();
let open = false, lines = [], rawPlain = '', approx = false, source = '', active = -2, token = 0, raf = 0, userScrollUntil = 0;
let stamp = { t: 0, at: 0 };
let mode = (() => { try { return localStorage.getItem(MKEY) === 'static' ? 'static' : 'sync'; } catch { return 'sync'; } })();

const clean = (s) => String(s || '').replace(/\s*[(\[][^)\]]*(feat|ft\.|remaster|live|version|prod|из|from|official|video|audio|lyric)[^)\]]*[)\]]/gi, '').replace(/\s*[-–—]\s*(remaster(ed)?|single|radio edit|official.*)$/i, '').trim();
// «голое» название: без скобок и хвостов вроде «- Slowed», «(Remix)», «sped up»
const bare = (s) => String(s || '').replace(/\s*[(\[][^)\]]*[)\]]/g, '').replace(/\s*[-–—|]\s*(slowed|sped|speed|remix|reverb|nightcore|bass|ремикс|instrumental|cover|кавер|mood|edit|mix|version|official).*$/i, '').replace(/\s+(slowed|sped up|speed up)(\s*\+\s*reverb)?$/i, '').trim();
const firstArtist = (s) => String(s || '').split(/,|&|\+| feat\.? | ft\.? | x | и | with /i)[0].trim();
const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const translit = (s) => String(s || '').toLowerCase().replace(/[а-яё]/g, (c) => TR[c] ?? c);
const norm = (s) => translit(s).replace(/[^a-z0-9]+/g, '');
const isInstrumental = (t) => /instrumental|инструментал|минус|karaoke|караоке/i.test(`${t.title} ${t.album || ''}`);

// насколько найденный текст похож на нашу песню
function score(x, title, artist, dur) {
  const tn = norm(bare(x.trackName || x.name || '')), want = norm(bare(title));
  const an = norm(x.artistName || ''), wa = norm(firstArtist(artist));
  const tOk = tn && want && (tn === want || tn.includes(want) || want.includes(tn));
  const aOk = an && wa && (an.includes(wa) || wa.includes(an));
  if (!tOk) return -1;
  let sc = (x.syncedLyrics ? 3 : 0) + (aOk ? 4 : 0) + (tn === want ? 1 : 0);
  if (dur > 0 && x.duration) { const d = Math.abs(x.duration - dur); sc += d < 4 ? 2 : d < 12 ? 1 : -2; }
  return aOk || (dur > 0 && x.duration && Math.abs(x.duration - dur) < 3) ? sc : -1;
}

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

async function lrclib(track, dur) {
  const T = clean(track.title), B = bare(track.title), A = firstArtist(track.artist);
  const gets = [[T, A]];
  if (B && B !== T) gets.push([B, A]);
  for (const [t, a] of gets) {
    const q = new URLSearchParams({ track_name: t, artist_name: a });
    if (dur > 0) q.set('duration', String(Math.round(dur)));
    const r = await getJson(`${API}/get?${q}`);
    if (r && (r.syncedLyrics || r.plainLyrics)) return r;
  }
  const tries = [{ track_name: B || T, artist_name: A }, { q: `${A} ${B || T}` }, { q: `${translit(A)} ${translit(B || T)}` }, { track_name: B || T }];
  let best = null, bs = -1;
  const seen = new Set();
  for (const params of tries) {
    const k = JSON.stringify(params); if (seen.has(k)) continue; seen.add(k);
    const list = await getJson(`${API}/search?${new URLSearchParams(params)}`);
    if (!Array.isArray(list)) continue;
    for (const x of list) { if (!x.syncedLyrics && !x.plainLyrics) continue; const sc = score(x, track.title, track.artist, dur); if (sc > bs) { bs = sc; best = x; } }
    if (best && best.syncedLyrics && bs >= 7) break;
  }
  return best;
}

// Запасные источники через ваш Cloudflare Worker (NetEase с таймингами, Genius без таймингов)
async function viaWorker(track, dur) {
  if (!RECOGNIZE_URL) return null;
  const q = new URLSearchParams({ artist: firstArtist(track.artist), title: bare(track.title) || clean(track.title) });
  if (dur > 0) q.set('dur', String(Math.round(dur)));
  return getJson(`${RECOGNIZE_URL.replace(/\/$/, '')}/lyrics?${q}`);
}

async function load(track, dur) {
  const key = track.id;
  if (cache.has(key)) return cache.get(key);
  let val = null;
  const res = await lrclib(track, dur);
  if (res && res.syncedLyrics) val = { synced: parseLrc(res.syncedLyrics), plain: res.plainLyrics || '', src: 'LRCLIB' };
  let plainFallback = res && res.plainLyrics ? { plain: res.plainLyrics, approx: true, src: 'LRCLIB' } : null;
  if (!val) {
    const w = await viaWorker(track, dur);
    if (w && w.synced) val = { synced: parseLrc(w.synced), plain: w.plain || '', src: w.source || 'MKW' };
    else if (w && w.plain && !plainFallback) plainFallback = { plain: w.plain, approx: true, src: w.source || 'MKW' };
  }
  if (!val && !plainFallback) {
    const A = firstArtist(track.artist), T = bare(track.title) || clean(track.title);
    const ov = await getJson(`https://api.lyrics.ovh/v1/${encodeURIComponent(A)}/${encodeURIComponent(T)}`);
    if (ov && ov.lyrics) plainFallback = { plain: String(ov.lyrics).replace(/\r/g, ''), approx: true, src: 'lyrics.ovh' };
  }
  if (!val) val = plainFallback;
  if (!val && isInstrumental(track)) val = { instrumental: true };
  if (val && val.synced && !val.synced.some((l) => l.text.trim())) val = null;
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
    if (source) sc.appendChild(h('div', { class: 'ly-src', text: `Текст: ${source}` }));
  }
  paintTools();
}

function render(data) {
  if (!data) { message('Текст для этой песни пока не нашёлся. Мы ищем в LRCLIB, NetEase, Genius и lyrics.ovh'); return; }
  if (data.instrumental) { message('Похоже, это инструментал: слов нет ♪'); return; }
  approx = false; lines = []; rawPlain = ''; source = data.src || '';
  if (data.synced && data.synced.length) { lines = data.synced; rawPlain = data.plain || ''; }
  else if (data.approx && player.st.duration > 20) {
    // строки без таймингов: раскладываем по длине трека пропорционально длине строки
    const rows = String(data.plain).split('\n').map((s) => s.trim()).filter((s) => s && !/^\[.*\]$/.test(s));
    const start = Math.min(12, player.st.duration * .06), span = Math.max(10, player.st.duration - start - 10);
    const wts = rows.map((r) => 6 + r.length), sum = wts.reduce((x, y) => x + y, 0) || 1;
    let acc = start;
    lines = rows.map((text, n) => { const l = { t: acc, text }; acc += (wts[n] / sum) * span; return l; });
    rawPlain = String(data.plain); approx = true;
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
    else if (k < i) { nodes[k].style.filter = `blur(${Math.min(2.2, .6 + d * .4).toFixed(2)}px)`; nodes[k].style.opacity = String(Math.max(.32, .62 - d * .08).toFixed(2)); }
    else { nodes[k].style.filter = d <= 1 ? 'none' : `blur(${Math.min(3, (d - 1) * .7).toFixed(2)}px)`; nodes[k].style.opacity = String(Math.max(.34, (i < 0 ? .9 : .82) - d * .1).toFixed(2)); }
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
