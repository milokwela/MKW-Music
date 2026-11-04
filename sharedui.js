// Экран общего плейлиста: треки, «играть», добавить то, что играет сейчас, убрать трек.
import { h, toast, openSheet, closeSheet, trackRow, askText } from './ui.js?v=0.34.1';
import { mi } from './icons2.js?v=0.34.1';
import * as player from './player.js?v=0.34.1';
import { getShared, onShared, watchShared, addToShared, removeFromShared, renameShared, sharedList } from './shared.js?v=0.34.1';
import { tracksWord } from './utils.js?v=0.34.1';
import { me, cardOf } from './friends.js?v=0.34.1';

export function openSharedSheet(id) {
  watchShared();
  const body = h('div', { class: 'sp-sheet' }, h('p', { class: 'profile-note', text: 'Загрузка…' }));
  let off = null;
  const paint = async () => {
    const pl = getShared(id);
    if (!pl) return;
    const tracks = pl.tracks || [];
    const names = new Map();
    await Promise.all([...new Set(tracks.map((t) => t.by).filter((x) => x && x !== me()))].slice(0, 10).map(async (u) => { const c = await cardOf(u).catch(() => null); names.set(u, (c && c.nick) || 'друг'); }));
    const head = h('div', { class: 'sp-head' },
      h('div', { class: 'sp-cov' }, ...tracks.slice(0, 4).map((t) => h('img', { src: t.artwork || 'mkw-logo.png', alt: '', loading: 'lazy' }))),
      h('div', { class: 'sp-info' }, h('b', { text: pl.name || 'Общий плейлист' }), h('small', { text: `${tracksWord(tracks.length)} · пополняют все участники` }),
        h('button', { type: 'button', class: 'sp-ren', onclick: async () => { const n = await askText('Название', 'Название плейлиста', pl.name || '', 'Сохранить'); if (n) renameShared(id, n).catch(() => toast('Не получилось')); } }, mi('edit'), 'Переименовать')));
    const acts = h('div', { class: 'lib-actions' },
      tracks.length ? h('button', { class: 'btn', type: 'button', onclick: () => { player.playTracks(tracks, 0); closeSheet(); } }, mi('play'), ' Играть') : null,
      h('button', { class: 'btn tonal', type: 'button', onclick: async () => {
        const t = player.queue.current;
        if (!t) { toast('Включите трек — и добавьте его сюда'); return; }
        try { const r = await addToShared(id, t); toast(r === 'added' ? 'Добавлено в общий плейлист' : r === 'exists' ? 'Этот трек уже здесь' : 'Плейлист заполнен'); } catch { toast('Не получилось'); }
      } }, mi('add'), ' Добавить текущий'));
    const rows = h('div', { class: 'list' }, ...tracks.map((t, i) => trackRow(t, {
      onPlay: () => { player.playTracks(tracks, i); },
      onMore: () => openSheet(t.title, h('div', {},
        h('button', { type: 'button', class: 'ch-sm', onclick: () => { closeSheet(); player.playNext(t); toast('Сыграет следующим'); } }, mi('play'), h('span', { text: 'Играть следующим' })),
        h('button', { type: 'button', class: 'ch-sm danger', onclick: async () => { closeSheet(); try { await removeFromShared(id, t.id); toast('Убрано из общего плейлиста'); } catch { toast('Не получилось'); } } }, mi('trash'), h('span', { text: 'Убрать из общего плейлиста' })))),
      sub: `${t.artist}${t.by ? ` · добавил(а) ${t.by === me() ? 'вы' : names.get(t.by) || 'друг'}` : ''}`,
    })));
    body.replaceChildren(head, acts, tracks.length ? rows : h('p', { class: 'profile-note center', text: 'Пока пусто. Добавляйте треки: ⋮ у трека → «В общий плейлист» или кнопкой выше.' }));
  };
  openSheet('Общий плейлист', body);
  off = onShared(() => { if (!body.isConnected) { off && off(); return; } paint(); });
  paint();
}

// из меню трека: выбрать общий плейлист
export function pickSharedFor(track) {
  watchShared();
  const lists = sharedList();
  if (!lists.length) { openSheet('В общий плейлист', h('p', { class: 'profile-note', text: 'Общих плейлистов пока нет. Откройте чат с другом или группу → ⋯ → «Общий плейлист».' })); return; }
  openSheet('В общий плейлист', h('div', {}, ...lists.map((pl) => h('button', { type: 'button', class: 'ch-sm', onclick: async () => {
    closeSheet();
    try { const r = await addToShared(pl.id, track); toast(r === 'added' ? `Добавлено в «${pl.name}»` : r === 'exists' ? 'Этот трек уже там' : 'Плейлист заполнен'); } catch { toast('Не получилось'); }
  } }, mi('group'), h('span', { text: `${pl.name} · ${(pl.tracks || []).length}` })))));
}
