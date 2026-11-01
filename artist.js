// Страница исполнителя: треки, слушать, перемешать, «не рекомендовать».
import { searchTracks } from './catalog.js?v=0.13.1';
import { prefetchYouTubeIds } from './youtube.js?v=0.13.1';
import { $, h, icon, trackRow, skeleton, animateIn, toast, openSheet, closeSheet, sheetItem } from './ui.js?v=0.13.1';
import { openTrackMenu } from './menu.js?v=0.13.1';
import * as player from './player.js?v=0.13.1';
import { splitArtists, isArtistBlocked, blockArtist, unblockArtist, norm } from './taste.js?v=0.13.1';
import { shuffled } from './utils.js?v=0.13.1';

let seq = 0;
const infoCache = new Map();
const MUSIC = /музык|певец|певиц|рэп|реп-|хип-хоп|групп|исполнител|композитор|диджей|диджей|продюсер|singer|rapper|band|musician|songwriter|dj\b/i;

// Справка об исполнителе из Википедии (если нашлась и это правда музыкант).
async function artistInfo(name) {
  if (infoCache.has(name)) return infoCache.get(name);
  let out = null;
  for (const lang of ['ru', 'en']) {
    try {
      const s = await fetch(`https://${lang}.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(name)}&limit=3`).then((r) => r.ok ? r.json() : null);
      for (const p of (s && s.pages) || []) {
        const sum = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(p.key)}`).then((r) => r.ok ? r.json() : null);
        if (sum && sum.extract && MUSIC.test(`${sum.description || ''} ${sum.extract.slice(0, 220)}`) && norm(sum.title).includes(norm(name).slice(0, 4))) {
          out = { text: sum.extract, desc: sum.description || '', photo: sum.thumbnail && sum.thumbnail.source, url: sum.content_urls && sum.content_urls.desktop && sum.content_urls.desktop.page };
          break;
        }
      }
    } catch { /* нет сети или CORS */ }
    if (out) break;
  }
  infoCache.set(name, out);
  return out;
}

export function closeArtist() {
  const p = $('#artist-page');
  p.classList.remove('open');
  seq += 1;
}

export function openArtistFor(artistString) {
  const names = splitArtists(artistString);
  if (!names.length) return;
  if (names.length === 1) { openArtist(names[0]); return; }
  openSheet('Исполнители', h('div', names.map((n) => sheetItem('user', n, () => { closeSheet(); openArtist(n); }))));
}

export async function openArtist(name) {
  const page = $('#artist-page');
  const mine = ++seq;
  const body = $('#artist-body');
  page.classList.add('open');
  page.scrollTop = 0;
  body.replaceChildren(h('h1', { class: 'artist-name', text: name }), skeleton(6));
  let tracks = [];
  try {
    const found = await searchTracks(name);
    const n = norm(name);
    tracks = found.filter((t) => norm(t.artist).includes(n));
    if (tracks.length < 3) tracks = found;
  } catch (e) { console.error(e); }
  if (mine !== seq) return;

  const blocked = () => isArtistBlocked(name);
  const blockBtn = h('button', { class: 'btn tonal', type: 'button' });
  const paintBlock = () => { blockBtn.textContent = blocked() ? 'Вернуть в рекомендации' : 'Не рекомендовать'; };
  paintBlock();
  blockBtn.addEventListener('click', () => {
    if (blocked()) { unblockArtist(name); toast('Исполнитель снова в рекомендациях'); }
    else { blockArtist(name); toast('Больше не буду рекомендовать'); }
    paintBlock();
  });
  const bar = h('div', { class: 'artist-actions' },
    h('button', { class: 'btn', type: 'button', onclick: () => tracks.length && player.playTracks(tracks, 0) }, icon('play'), ' Слушать'),
    h('button', { class: 'btn tonal', type: 'button', onclick: () => { if (tracks.length) player.playTracks(shuffled(tracks), 0); } }, icon('shuffle'), ' Вперемешку'),
    blockBtn);
  const list = h('div', { class: 'list' }, tracks.map((t, i) => trackRow(t, {
    onPlay: () => player.playTracks(tracks, i),
    onMore: () => openTrackMenu(t),
    current: player.queue.current?.id === t.id,
  })));
  const genres = [...new Set(tracks.map((t) => t.genre).filter(Boolean))].slice(0, 3);
  const years = tracks.map((t) => Number(String(t.year || t.releaseDate || '').slice(0, 4))).filter((y) => y > 1950);
  const meta = h('div', { class: 'artist-meta' },
    h('span', { class: 'chip', text: `${tracks.length} треков в подборке` }),
    ...genres.map((g) => h('span', { class: 'chip', text: g })),
    years.length ? h('span', { class: 'chip', text: Math.min(...years) === Math.max(...years) ? String(years[0]) : `${Math.min(...years)}–${Math.max(...years)}` }) : null);
  const photo = h('img', { class: 'artist-photo', alt: '', hidden: '' });
  const bio = h('div', { class: 'artist-bio', hidden: '' });
  const headBox = h('div', { class: 'artist-head' }, photo, h('div', {}, h('h1', { class: 'artist-name', text: name }), meta));
  artistInfo(name).then((info) => {
    if (mine !== seq || !info) return;
    if (info.photo) { photo.src = info.photo; photo.hidden = false; }
    const short = info.text.length > 280 ? `${info.text.slice(0, 280).replace(/\s+\S*$/, '')}…` : info.text;
    const txt = h('span', { text: short });
    bio.append(txt);
    if (short !== info.text) { const more = h('button', { class: 'more', type: 'button', text: 'Ещё' }); more.addEventListener('click', () => { txt.textContent = info.text; more.remove(); }); bio.append(more); }
    if (info.url) bio.append(h('div', { style: 'margin-top:8px;font-size:12px' }, 'Источник: ', h('a', { href: info.url, target: '_blank', rel: 'noopener', text: 'Википедия' })));
    bio.hidden = false;
  });
  body.replaceChildren(
    headBox, bio,
    h('div', { class: 'section-title', text: tracks.length ? `Популярное · ${tracks.length}` : '' }),
    bar,
    tracks.length ? list : h('div', { class: 'empty' }, h('div', { text: 'Треков не нашлось' })));
  if (tracks.length) { animateIn(list); prefetchYouTubeIds(tracks); }
}

export function initArtist() {
  $('#artist-back').addEventListener('click', closeArtist);
}
