// Итоги недели и месяца в стиле сторис: время, любимые исполнители и треки, привычки — и картинка «поделиться».
import { db } from './firebase.js?v=0.35.7';
import { collection, query, where, orderBy, limit, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { h, toast } from './ui.js?v=0.35.7';
import { mi } from './icons2.js?v=0.35.7';
import * as store from './store.js?v=0.35.7';
import * as player from './player.js?v=0.35.7';
import { artistPic } from './artistpic.js?v=0.35.7';
import { splitArtists } from './taste.js?v=0.35.7';
import { artUrl, plural } from './utils.js?v=0.35.7';

const DAY = 86400000;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtDate = (d) => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
function range(kind, back = 0) {
  const now = new Date();
  // неделя — последние 7 дней, месяц — последние 30 (а не «с 1-го числа»: иначе в начале месяца
  // итоги месяца выходили меньше недельных)
  const len = kind === 'month' ? 30 : 7;
  const e = new Date(now.getTime() - back * len * DAY);
  const s = new Date(e.getTime() - len * DAY);
  return { start: s, end: e, title: `${fmtDate(s)} — ${fmtDate(e)}` };
}
// Сколько реально слушали: число включений × среднее время одного включения (общее время ÷ все включения)
// или точное время по дням, если оно записано на этом устройстве. Итог не больше общего времени в профиле.
function secondsIn(r, plays) {
  const d = store.diaryDays();
  let diary = 0;
  for (let t = new Date(r.start); t < r.end; t = new Date(t.getTime() + DAY)) diary += d[ymd(t)] || 0;
  const total = store.listenedTotal();
  const n = Number((store.state.profile || {}).plays) || 0;
  const avg = n > 0 && total > 0 ? Math.min(210, total / n) : 45;
  // дневник ведётся на этом устройстве, история — на всех; берём большее
  const sec = Math.max(diary, plays.length * avg);
  return total > 0 ? Math.min(sec, total) : sec;
}
const hm = (sec) => { const m = Math.round(sec / 60); return m < 60 ? { big: String(m), unit: plural(m, 'минута', 'минуты', 'минут') } : { big: String(Math.floor(m / 60)), unit: `${plural(Math.floor(m / 60), 'час', 'часа', 'часов')}${m % 60 ? ` ${m % 60} мин` : ''}` }; };
const PARTS = ['ночью', 'утром', 'днём', 'вечером'];
const PART_EMO = ['🌙', '☀️', '🎧', '🌆'];

async function collect(kind) {
  const r = range(kind), prev = range(kind, 1);
  let plays = [];
  try {
    const s = await getDocs(query(collection(db, 'users', store.state.uid, 'history'), where('playedAt', '>=', prev.start.getTime()), orderBy('playedAt', 'desc'), limit(1500)));
    plays = s.docs.map((d) => d.data());
  } catch { plays = []; }
  if (!plays.length) plays = store.state.history.slice();
  const inR = plays.filter((p) => Number(p.playedAt) >= r.start.getTime() && Number(p.playedAt) < r.end.getTime());
  const before = plays.filter((p) => Number(p.playedAt) < r.start.getTime());
  const artists = new Map(), tracks = new Map(), parts = [0, 0, 0, 0];
  for (const p of inR) {
    for (const a of splitArtists(p.artist)) artists.set(a, (artists.get(a) || 0) + 1);
    const k = `${p.artist}|${p.title}`;
    const t = tracks.get(k) || { t: p, n: 0 }; t.n += 1; tracks.set(k, t);
    const hr = new Date(Number(p.playedAt)).getHours(); parts[hr < 6 ? 0 : hr < 12 ? 1 : hr < 18 ? 2 : 3] += 1;
  }
  const known = new Set(before.flatMap((p) => splitArtists(p.artist)));
  const topA = [...artists.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topT = [...tracks.values()].sort((a, b) => b.n - a.n).slice(0, 5);
  const newArtists = [...artists.keys()].filter((a) => !known.has(a)).length;
  const sec = secondsIn(r, inR);
  const prevSec = secondsIn(prev, plays.filter((p) => Number(p.playedAt) >= prev.start.getTime() && Number(p.playedAt) < prev.end.getTime()));
  const likes = store.state.likes.filter((t) => Number(t.likedAt) >= r.start.getTime()).length;
  const best = parts.indexOf(Math.max(...parts));
  return { kind, r, plays: inR.length, sec, prevSec, topA, topT, newArtists, likes, part: best, uniqueArtists: artists.size };
}

let box = null, timer = 0;
function close() {
  clearTimeout(timer);
  if (!box) return;
  const b = box; box = null;
  const bk = document.querySelector('.rc-back');
  b.classList.remove('show'); bk && bk.classList.remove('show');
  setTimeout(() => { b.remove(); bk && bk.remove(); }, 350);
}

function slides(d, pics) {
  const t = hm(d.sec);
  const diff = d.prevSec > 300 ? Math.round(((d.sec - d.prevSec) / d.prevSec) * 100) : null;
  const a1 = d.topA[0], t1 = d.topT[0];
  const S = [];
  S.push({ cls: 'rc-intro', html: [h('div', { class: 'rc-logo', text: 'MKW' }), h('h2', { text: d.kind === 'month' ? 'Твой месяц' : 'Твоя неделя' }), h('p', { text: d.r.title }), h('div', { class: 'rc-big', text: String(d.plays) }), h('small', { text: plural(d.plays, 'трек включён', 'трека включено', 'треков включено') })] });
  S.push({ cls: 'rc-time', html: [h('p', { text: `За ${d.kind === 'month' ? 'месяц' : 'неделю'} ты слушал(а) музыку` }), h('div', { class: 'rc-big', text: t.big }), h('h3', { text: t.unit }),
    diff != null ? h('div', { class: `rc-pill${diff >= 0 ? ' up' : ''}`, text: `${diff >= 0 ? '+' : ''}${diff}% ${d.kind === 'month' ? 'к прошлому месяцу' : 'к прошлой неделе'}` }) : null] });
  if (a1) S.push({ cls: 'rc-artist', bg: pics.get(a1[0]), html: [h('p', { text: `Исполнитель ${d.kind === 'month' ? 'месяца' : 'недели'}` }), h('div', { class: 'rc-ph' }, h('img', { src: pics.get(a1[0]) || 'mkw-logo.png', alt: '' })), h('h2', { text: a1[0] }), h('small', { text: `${a1[1]} ${plural(a1[1], 'включение', 'включения', 'включений')}` })] });
  if (d.topA.length > 1) S.push({ cls: 'rc-list', html: [h('p', { text: 'Твой топ исполнителей' }), h('ol', { class: 'rc-ol' }, ...d.topA.map(([n, c], i) => h('li', { style: `--d:${i * 90}ms` }, h('b', { text: String(i + 1) }), h('img', { src: pics.get(n) || 'mkw-logo.png', alt: '' }), h('span', { text: n }), h('small', { text: String(c) }))))] });
  if (t1) S.push({ cls: 'rc-track', bg: artUrl(t1.t.artwork, 600), html: [h('p', { text: `Песня ${d.kind === 'month' ? 'месяца' : 'недели'}` }), h('div', { class: 'rc-cover' }, h('img', { src: artUrl(t1.t.artwork, 600) || 'mkw-logo.png', alt: '' })), h('h2', { text: t1.t.title }), h('h3', { text: t1.t.artist }), h('small', { text: `${t1.n} ${plural(t1.n, 'раз', 'раза', 'раз')}` }),
    h('button', { type: 'button', class: 'rc-play', onclick: (e) => { e.stopPropagation(); player.playTracks(d.topT.map((x) => x.t), 0); close(); } }, mi('play'), ' Включить топ')] });
  if (d.topT.length > 1) S.push({ cls: 'rc-list', html: [h('p', { text: 'Твой топ треков' }), h('ol', { class: 'rc-ol' }, ...d.topT.map((x, i) => h('li', { style: `--d:${i * 90}ms` }, h('b', { text: String(i + 1) }), h('img', { src: artUrl(x.t.artwork, 120) || 'mkw-logo.png', alt: '' }), h('span', {}, h('i', { text: x.t.title }), h('small', { text: x.t.artist })), h('small', { text: String(x.n) }))))] });
  S.push({ cls: 'rc-habits', html: [h('p', { text: 'Твои привычки' }), h('div', { class: 'rc-grid' },
    h('div', {}, h('b', { text: PART_EMO[d.part] }), h('span', { text: `Чаще всего слушаешь ${PARTS[d.part]}` })),
    h('div', {}, h('b', { text: String(d.uniqueArtists) }), h('span', { text: plural(d.uniqueArtists, 'исполнитель', 'исполнителя', 'исполнителей') })),
    h('div', {}, h('b', { text: String(d.newArtists) }), h('span', { text: `${plural(d.newArtists, 'новый', 'новых', 'новых')} для тебя` })),
    h('div', {}, h('b', { text: String(d.likes) }), h('span', { text: plural(d.likes, 'лайк', 'лайка', 'лайков') })))] });
  S.push({ cls: 'rc-final', html: [h('h2', { text: d.kind === 'month' ? 'Это был твой месяц' : 'Это была твоя неделя' }), h('div', { class: 'rc-card' },
    h('div', { class: 'rc-card-l', text: 'MKW' }), h('div', {}, h('small', { text: 'Время' }), h('b', { text: `${t.big} ${t.unit}` })),
    a1 ? h('div', {}, h('small', { text: 'Исполнитель' }), h('b', { text: a1[0] })) : null,
    t1 ? h('div', {}, h('small', { text: 'Песня' }), h('b', { text: `${t1.t.title} — ${t1.t.artist}` })) : null),
    h('button', { type: 'button', class: 'rc-share', onclick: (e) => { e.stopPropagation(); shareImage(d, pics); } }, mi('send'), ' Поделиться')] });
  return S;
}

function show(d, pics) {
  const S = slides(d, pics);
  let i = 0;
  const bars = h('div', { class: 'rc-bars' }, ...S.map(() => h('i', {}, h('b'))));
  const stage = h('div', { class: 'rc-stage' });
  box = h('div', { class: 'rc', role: 'dialog', 'aria-label': 'Итоги' }, h('div', { class: 'rc-bgimg' }), bars, h('button', { type: 'button', class: 'rc-x', 'aria-label': 'Закрыть', onclick: close }, mi('close')), stage);
  const DUR = 6000;
  const go = (n) => {
    clearTimeout(timer);
    if (n < 0) n = 0;
    if (n >= S.length) { close(); return; }
    i = n;
    const s = S[i];
    [...bars.children].forEach((b, k) => { b.className = k < i ? 'done' : k === i ? 'now' : ''; });
    box.style.setProperty('--dur', `${DUR}ms`);
    box.querySelector('.rc-bgimg').style.backgroundImage = s.bg ? `url("${s.bg}")` : '';
    box.dataset.slide = s.cls;
    stage.replaceChildren(h('div', { class: `rc-s ${s.cls}` }, ...s.html.filter(Boolean)));
    timer = setTimeout(() => go(i + 1), i === S.length - 1 ? 60000 : DUR);
  };
  let hold = 0;
  box.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    if (hold && Date.now() - hold > 350) return; // долго держали — это была пауза, не листаем
    const r = box.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    go(x < 0.3 ? i - 1 : i + 1);
  });
  box.addEventListener('pointerdown', () => { hold = Date.now(); box.classList.add('paused'); clearTimeout(timer); });
  box.addEventListener('pointerup', () => { box.classList.remove('paused'); if (Date.now() - hold > 350) { timer = setTimeout(() => go(i + 1), 2500); } });
  document.addEventListener('keydown', function onKey(e) { if (!box) { document.removeEventListener('keydown', onKey); return; } if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') go(i + 1); if (e.key === 'ArrowLeft') go(i - 1); });
  const back = h('div', { class: 'rc-back', onclick: close });
  document.body.append(back, box);
  requestAnimationFrame(() => { back.classList.add('show'); box.classList.add('show'); go(0); });
}

export async function openRecap(kind = 'week') {
  if (!store.state.uid) return;
  toast(kind === 'month' ? 'Собираю итоги месяца…' : 'Собираю итоги недели…');
  const d = await collect(kind);
  if (d.plays < 3) { toast(kind === 'month' ? 'За этот месяц пока мало музыки — послушайте ещё' : 'За неделю пока мало музыки — послушайте ещё'); return; }
  const pics = new Map();
  await Promise.all(d.topA.map(async ([n]) => { const p = await artistPic(n).catch(() => null); if (p && p.picture) pics.set(n, p.picture); }));
  show(d, pics);
}

// картинка 1080×1920 для сторис
function loadImg(src) {
  return new Promise((res) => { if (!src) { res(null); return; } const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => res(null); im.src = src; setTimeout(() => res(null), 5000); });
}
async function shareImage(d, pics) {
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1920;
  const x = c.getContext('2d');
  // цвета — из палитры приложения (у кого чёрная — картинка тоже чёрная)
  const cs = getComputedStyle(document.documentElement);
  const neutral = document.documentElement.dataset.neutral === '1';
  const hue = (v) => { const m = /hsl\(\s*([\d.]+)/.exec(v || ''); return m ? Number(m[1]) : 330; };
  const H = hue(cs.getPropertyValue('--primary'));
  const g = x.createLinearGradient(0, 0, 1080, 1920);
  if (neutral) { g.addColorStop(0, '#111111'); g.addColorStop(0.5, '#070707'); g.addColorStop(1, '#000000'); }
  else { g.addColorStop(0, `hsl(${H} 35% 9%)`); g.addColorStop(0.5, `hsl(${H} 40% 12%)`); g.addColorStop(1, `hsl(${H} 30% 4%)`); }
  x.fillStyle = g; x.fillRect(0, 0, 1080, 1920);
  const rg = x.createRadialGradient(540, 520, 40, 540, 520, 700);
  rg.addColorStop(0, neutral ? 'rgba(255,255,255,.14)' : `hsl(${H} 100% 70% / .35)`); rg.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = rg; x.fillRect(0, 0, 1080, 1920);
  x.textAlign = 'center'; x.fillStyle = '#fff';
  x.font = '900 64px system-ui, sans-serif'; x.fillText('MKW', 540, 150);
  x.font = '600 42px system-ui, sans-serif'; x.fillStyle = 'rgba(255,255,255,.7)'; x.fillText(d.kind === 'month' ? 'Мой месяц в MKW Music' : 'Моя неделя в MKW Music', 540, 220);
  const t1 = d.topT[0], a1 = d.topA[0];
  const cover = await loadImg(t1 ? artUrl(t1.t.artwork, 600) : '');
  try { if (cover) { x.save(); x.beginPath(); x.roundRect(240, 300, 600, 600, 48); x.clip(); x.drawImage(cover, 240, 300, 600, 600); x.restore(); } } catch { /* картинка без разрешения — без обложки */ }
  x.fillStyle = '#fff'; x.font = '800 56px system-ui, sans-serif';
  const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  if (t1) { x.fillText(clip(t1.t.title, 26), 540, 1000); x.font = '500 40px system-ui, sans-serif'; x.fillStyle = 'rgba(255,255,255,.7)'; x.fillText(clip(t1.t.artist, 32), 540, 1060); }
  const t = hm(d.sec);
  const rows = [['Время', `${t.big} ${t.unit}`], ['Исполнитель', a1 ? a1[0] : '—'], ['Треков', String(d.plays)], ['Новых исполнителей', String(d.newArtists)]];
  rows.forEach(([k, v], i) => {
    const y = 1200 + i * 130;
    x.fillStyle = 'rgba(255,255,255,.08)'; x.beginPath(); x.roundRect(140, y - 70, 800, 110, 28); x.fill();
    x.textAlign = 'left'; x.fillStyle = 'rgba(255,255,255,.6)'; x.font = '500 34px system-ui, sans-serif'; x.fillText(k, 180, y);
    x.textAlign = 'right'; x.fillStyle = '#fff'; x.font = '800 38px system-ui, sans-serif'; x.fillText(clip(v, 22), 900, y);
  });
  x.textAlign = 'center'; x.fillStyle = 'rgba(255,255,255,.55)'; x.font = '500 34px system-ui, sans-serif'; x.fillText('mkwmusic.ru', 540, 1840);
  let blob = null;
  try { blob = await new Promise((res) => c.toBlob(res, 'image/png')); } catch { blob = null; }
  if (!blob) { toast('Не получилось сделать картинку'); return; }
  const file = new File([blob], `mkw-itogi-${d.kind}.png`, { type: 'image/png' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Мои итоги в MKW Music', text: 'Мои итоги в MKW Music — mkwmusic.ru' }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  toast('Картинка сохранена — выложите её в сторис');
}

// карточка на главной: «Итоги недели» и «Итоги месяца»
export function recapCard() {
  return h('div', { class: 'rc-entry' },
    h('button', { type: 'button', class: 'rc-btn', onclick: () => openRecap('week') }, h('span', { class: 'rc-ic' }, mi('story')), h('span', {}, h('b', { text: 'Итоги недели' }), h('small', { text: 'Время, топ исполнителей и треков' }))),
    h('button', { type: 'button', class: 'rc-btn m', onclick: () => openRecap('month') }, h('span', { class: 'rc-ic' }, mi('calendar')), h('span', {}, h('b', { text: 'Итоги месяца' }), h('small', { text: 'Последние 30 дней' }))));
}
