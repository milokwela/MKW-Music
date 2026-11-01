// Экран «Библиотека»: лайки, плейлисты, история.
import { $, $$, h, icon, trackRow, emptyState, askText, toast, openSheet, closeSheet, sheetItem, animateIn } from './ui.js?v=0.22.1';
import * as store from './store.js?v=0.22.1';
import * as player from './player.js?v=0.22.1';
import { openTrackMenu } from './menu.js?v=0.22.1';
import { tracksWord, timeAgo, artUrl } from './utils.js?v=0.22.1';

let tab = 'likes';
let openPid = null;

function playButtons(tracks) {
  return h('div', { class: 'lib-actions' },
    h('button', { class: 'btn', type: 'button', onclick: () => player.playTracks(tracks, 0) }, icon('play', 'filled'), 'Играть'),
    h('button', { class: 'btn tonal', type: 'button', onclick: () => {
      if (!player.queue.shuffle) player.toggleShuffle();
      player.playTracks(tracks, Math.floor(Math.random() * tracks.length));
    } }, icon('shuffle'), 'Вперемешку'));
}

function rows(tracks, ctx = {}, subFn) {
  const cur = player.queue.current?.id;
  return h('div', { class: 'list' }, tracks.map((t, i) => trackRow(t, {
    onPlay: () => player.playTracks(tracks, i),
    onMore: () => openTrackMenu(t, ctx),
    current: cur === t.id,
    sub: subFn ? subFn(t) : undefined,
  })));
}

function renderLikes(box) {
  const list = store.state.likes;
  if (!list.length) { box.replaceChildren(emptyState('heart', 'Пока нет лайков. Нажмите ⋮ у трека → «В лайки»')); return; }
  box.replaceChildren(h('div', { class: 'section-title', text: tracksWord(list.length) }), playButtons(list), rows(list));
}

function renderHistory(box) {
  const list = store.state.history;
  if (!list.length) { box.replaceChildren(emptyState('clock', 'История пуста. Включите что-нибудь')); return; }
  box.replaceChildren(rows(list, {}, (t) => `${t.artist} · ${timeAgo(t.playedAt)}`));
}

function cover(pl) {
  const art = pl.tracks[0]?.artwork;
  return h('div', { class: 'pl-cover' }, art ? h('img', { src: artUrl(art, 200), alt: '', loading: 'lazy' }) : icon('music'));
}

function renderPlaylists(box) {
  const pls = store.state.playlists;
  const create = h('button', { class: 'btn tonal', type: 'button', onclick: async () => {
    const name = await askText('Новый плейлист', 'Название');
    if (!name) return;
    try { await store.createPlaylist(name); toast('Плейлист создан'); } catch (e) { console.error(e); toast('Не получилось создать'); }
  } }, icon('plus'), 'Новый плейлист');
  if (!pls.length) { box.replaceChildren(h('div', { class: 'lib-actions' }, create), emptyState('library', 'Плейлистов нет')); return; }
  box.replaceChildren(
    h('div', { class: 'lib-actions' }, create),
    ...pls.map((pl) => h('button', { class: 'pl-card', type: 'button', onclick: () => { openPid = pl.pid; render(); } },
      cover(pl),
      h('div', { class: 'track-info' }, h('div', { class: 'track-title', text: pl.name }), h('div', { class: 'track-sub', text: tracksWord(pl.tracks.length) })))));
}

function renderPlaylistPage(box) {
  const pl = store.getPlaylist(openPid);
  if (!pl) { openPid = null; render(); return; }
  const more = () => openSheet(pl.name, h('div',
    sheetItem('edit', 'Переименовать', async () => {
      const name = await askText('Переименовать', 'Название', pl.name, 'Сохранить');
      if (name) store.renamePlaylist(pl.pid, name).catch(() => toast('Не получилось'));
    }),
    sheetItem('trash', 'Удалить плейлист', () => {
      closeSheet();
      store.deletePlaylist(pl.pid).then(() => { openPid = null; toast('Плейлист удалён'); }).catch(() => toast('Не получилось'));
    }, true)));
  box.replaceChildren(
    h('div', { class: 'pl-head' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Назад', onclick: () => { openPid = null; render(); } }, icon('back')),
      h('h2', { text: pl.name }),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Ещё', onclick: more }, icon('more'))),
    h('div', { class: 'section-title', text: tracksWord(pl.tracks.length) }),
    ...(pl.tracks.length ? [playButtons(pl.tracks), rows(pl.tracks, { playlistId: pl.pid })] : [emptyState('music', 'Пусто. Добавляйте треки через ⋮ → «В плейлист»')]));
}

let lastKey = '';
export function render() {
  const box = $('#lib-content');
  const key = `${tab}:${openPid || ''}`;
  const tabs = ['likes', 'playlists', 'history'];
  $('#lib-tabs').style.setProperty('--i', String(tabs.indexOf(tab)));
  $$('#lib-tabs [data-tab]').forEach((c) => c.classList.toggle('active', c.dataset.tab === tab));
  const lc = $('#lib-tabs [data-cnt="likes"]'), pc = $('#lib-tabs [data-cnt="playlists"]');
  try { if (lc) lc.textContent = store.state.likes.length || ''; if (pc) pc.textContent = store.state.playlists.length || ''; } catch { /* ignore */ }
  if (tab === 'likes') renderLikes(box);
  else if (tab === 'history') renderHistory(box);
  else if (openPid) renderPlaylistPage(box);
  else renderPlaylists(box);
  if (key !== lastKey) { lastKey = key; animateIn(box); }
}

function initSegDrag() {
  const seg = $('#lib-tabs');
  const tabs = ['likes', 'playlists', 'history'];
  let drag = false, moved = false, sx = 0, pid = 0, just = false;
  const idx = (e) => { const r = seg.getBoundingClientRect(); return Math.min(2, Math.max(0, (e.clientX - r.left) / r.width * 3 - 0.5)); };
  seg.addEventListener('pointerdown', (e) => { drag = true; moved = false; sx = e.clientX; pid = e.pointerId; });
  seg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!moved && Math.abs(e.clientX - sx) > 14) { moved = true; seg.classList.add('drag'); try { seg.setPointerCapture(pid); } catch { /* ignore */ } }
    if (moved) seg.style.setProperty('--i', String(idx(e)));
  });
  const end = (e) => {
    if (!drag) return;
    drag = false; seg.classList.remove('drag');
    if (!moved) return;
    const i = Math.round(idx(e));
    tab = tabs[i]; openPid = null; render();
    just = true; setTimeout(() => { just = false; }, 300);
    if (navigator.vibrate) navigator.vibrate(8);
  };
  seg.addEventListener('pointerup', end);
  seg.addEventListener('pointercancel', () => { drag = false; moved = false; seg.classList.remove('drag'); render(); });
  seg.addEventListener('click', (e) => { if (just) { e.stopPropagation(); e.preventDefault(); } }, true);
}

export function initLibrary() {
  initSegDrag();
  $('#lib-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    openPid = null;
    render();
  });
  store.onStore(() => { if (!$('#view-library').hidden) render(); });
}

export function resetLibrary() { tab = 'likes'; openPid = null; }
