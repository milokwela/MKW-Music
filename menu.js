// Меню действий над треком и выбор плейлиста.
import { h, openSheet, closeSheet, sheetItem, askText, toast } from './ui.js';
import * as store from './store.js';
import { openArtistFor } from './artist.js';
import * as player from './player.js';

function fail(e) {
  console.error(e);
  const code = e && e.code ? ` (${e.code})` : '';
  toast(code.includes('permission-denied')
    ? 'Нет доступа к базе: опубликуйте правила Firestore (permission-denied)'
    : `Не получилось сохранить${code}`);
}

export async function likeToggle(track) {
  try {
    const liked = await store.toggleLike(track);
    toast(liked ? 'Добавлено в лайки' : 'Убрано из лайков');
    return liked;
  } catch (e) { fail(e); return null; }
}

export function pickPlaylist(track) {
  const box = h('div');
  box.appendChild(sheetItem('plus', 'Новый плейлист', async () => {
    const name = await askText('Новый плейлист', 'Название');
    if (!name) return;
    try {
      await store.createPlaylist(name, track);
      toast(`Создан «${name}»`);
    } catch (e) { fail(e); }
  }));
  for (const pl of store.state.playlists) {
    box.appendChild(sheetItem('library', `${pl.name} · ${pl.tracks.length}`, async () => {
      closeSheet();
      try {
        const r = await store.addToPlaylist(pl.pid, track);
        toast(r === 'added' ? `Добавлено в «${pl.name}»` : r === 'exists' ? 'Этот трек уже там' : 'Плейлист заполнен (300 треков)');
      } catch (e) { fail(e); }
    }));
  }
  openSheet('В плейлист', box);
}

// ctx: { playlistId } — если трек открыт из плейлиста, появляется пункт «Убрать из плейлиста».
export function openTrackMenu(track, ctx = {}) {
  const liked = store.isLiked(track.id);
  const box = h('div',
    h('div', { class: 'sheet-note', text: `${track.title} — ${track.artist}` }),
    sheetItem('next-up', 'Играть следующим', () => { closeSheet(); player.playNext(track); toast('Сыграет следующим'); }),
    sheetItem('queue', 'Добавить в очередь', () => { closeSheet(); player.addToQueue(track); toast('Добавлено в очередь'); }),
    sheetItem(liked ? 'heart-fill' : 'heart', liked ? 'Убрать из лайков' : 'В лайки', () => { closeSheet(); likeToggle(track); }),
    sheetItem('plus', 'В плейлист…', () => pickPlaylist(track)),
    sheetItem('user', 'Перейти к исполнителю', () => { closeSheet(); openArtistFor(track.artist); }));
  if (ctx.playlistId) {
    box.appendChild(sheetItem('trash', 'Убрать из плейлиста', async () => {
      closeSheet();
      try { await store.removeFromPlaylist(ctx.playlistId, track.id); toast('Убрано'); } catch (e) { fail(e); }
    }, true));
  }
  openSheet('', box);
}
