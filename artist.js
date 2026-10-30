// Страница исполнителя: треки, слушать, перемешать, «не рекомендовать».
import { searchTracks } from './catalog.js?v=0.9.3';
import { prefetchYouTubeIds } from './youtube.js?v=0.9.3';
import { $, h, icon, trackRow, skeleton, animateIn, toast, openSheet, closeSheet, sheetItem } from './ui.js?v=0.9.3';
import { openTrackMenu } from './menu.js?v=0.9.3';
import * as player from './player.js?v=0.9.3';
import { splitArtists, isArtistBlocked, blockArtist, unblockArtist, norm } from './taste.js?v=0.9.3';
import { shuffled } from './utils.js?v=0.9.3';

let seq = 0;

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
  body.replaceChildren(
    h('h1', { class: 'artist-name', text: name }),
    h('div', { class: 'section-title', text: tracks.length ? `Популярное · ${tracks.length}` : '' }),
    bar,
    tracks.length ? list : h('div', { class: 'empty' }, h('div', { text: 'Треков не нашлось' })));
  if (tracks.length) { animateIn(list); prefetchYouTubeIds(tracks); }
}

export function initArtist() {
  $('#artist-back').addEventListener('click', closeArtist);
}
