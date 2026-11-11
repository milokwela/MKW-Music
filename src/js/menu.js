// Меню действий над треком и выбор плейлиста.
import { h, icon, openSheet, closeSheet, sheetItem, askText, toast } from './ui.js';
import { safeUrl, artUrl, plural } from './utils.js';
import { monthPlays } from './tplays.js';
import * as store from './store.js';
import { shareTrack } from './share.js';
import { openArtistFor, openArtist } from './artist.js';
import { splitArtists } from './taste.js';
import * as player from './player.js';
import { pickFriendFor } from './chat.js';
import { pickSharedFor } from './sharedui.js';
import { startWave } from './wave.js';
import { setRingtone } from './ringtone.js';

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
// Вид: карточка трека с обложкой, четыре крупные быстрые кнопки и остальные действия списком.
export function openTrackMenu(track, ctx = {}) {
  const liked = store.isLiked(track.id);
  const art = safeUrl(track.artwork);
  const stat = h('small', { class: 'tm-stat', hidden: '' });
  monthPlays(track).then((n) => { if (n === null || n === undefined) return; stat.hidden = false; stat.textContent = n ? `На MKW в этом месяце: ${n} ${plural(n, 'прослушивание', 'прослушивания', 'прослушиваний')}` : 'На MKW в этом месяце ещё не слушали'; });
  const head = h('div', { class: 'tm-head' },
    h('span', { class: 'tm-art', style: art ? `background-image:url("${artUrl(art, 200)}")` : '' }, art ? null : icon('music')),
    h('span', { class: 'tm-txt' }, h('b', { text: track.title }), h('em', { text: track.artist }), stat));
  const tile = (cls, ic, text, fn) => h('button', { type: 'button', class: `tm-tile ${cls}`, onclick: fn }, icon(ic), h('span', { text }));
  const tiles = h('div', { class: 'tm-tiles' },
    tile(`pink${liked ? ' on' : ''}`, liked ? 'heart-fill' : 'heart', liked ? 'В лайках' : 'Лайк', () => { closeSheet(); likeToggle(track); }),
    tile('blue', 'next-up', 'Следующим', () => { closeSheet(); player.playNext(track); toast('Сыграет следующим'); }),
    tile('mint', 'queue', 'В очередь', () => { closeSheet(); player.addToQueue(track); toast('Добавлено в очередь'); }),
    tile('peach', 'share', 'Поделиться', () => { closeSheet(); shareTrack(track); }));
  const names = splitArtists(track.artist);
  const list = h('div', { class: 'tm-list' },
    sheetItem('shuffle', 'Волна по этому треку', () => { closeSheet(); startWave(track); toast('Волна по треку: дальше — похожее'); }),
    sheetItem('plus', 'В плейлист…', () => pickPlaylist(track)),
    sheetItem('library', 'В общий плейлист с друзьями…', () => pickSharedFor(track)),
    sheetItem('chat', 'Отправить другу', () => { closeSheet(); setTimeout(() => pickFriendFor(track), 250); }),
    sheetItem('music', 'Поставить на звонок', () => { closeSheet(); setRingtone(track); }),
    ...(names.length > 1
      ? names.map((n) => sheetItem('user', `Исполнитель: ${n}`, () => { closeSheet(); openArtist(n); }))
      : [sheetItem('user', 'Перейти к исполнителю', () => { closeSheet(); openArtistFor(track.artist); })]));
  if (ctx.playlistId) {
    list.appendChild(sheetItem('trash', 'Убрать из плейлиста', async () => {
      closeSheet();
      try { await store.removeFromPlaylist(ctx.playlistId, track.id); toast('Убрано'); } catch (e) { fail(e); }
    }, true));
  }
  openSheet('', h('div', { class: 'tm' }, head, tiles, list));
}
