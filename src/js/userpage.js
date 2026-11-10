// Страница другого слушателя: баннер, фото, статус, значки, статистика, любимые исполнители и треки.
import { $, h, trackRow, animateIn } from './ui.js';
import * as player from './player.js';
import { openTrackMenu } from './menu.js';
import { getProfile } from './leaders.js';
import { ACH, ACHIEVEMENTS, achDone, viewAch, bannerCss, formatListened } from './profile.js';
import { artistPic } from './artistpic.js';
import { openArtist } from './artist.js';
import { mi } from './icons2.js';
import { plural } from './utils.js';
import { openImage } from './viewer.js';
import { isDev, devBadge, showDev, validFan, fanBadge, isContrib, contribBadge } from './dev.js';
import { friendState, addFriend, removeFriend, loadFriends, friendsLoaded, ONLINE_MS } from './friends.js';
import { openChat, chatActions } from './chat.js';
// удалить друга — двойное нажатие за 3 секунды, чтобы не убрать случайно
let rmAsk = '';
function confirmRemove(u) { if (rmAsk === u.uid) { rmAsk = ''; return true; } rmAsk = u.uid; setTimeout(() => { if (rmAsk === u.uid) rmAsk = ''; }, 3000); toast('Нажмите ещё раз, чтобы убрать из друзей'); return false; }
import { avSrc } from './avatar.js';
import { toast } from './ui.js';
import { searchTracks } from './catalog.js';
import { srvNow, realSeen, seenOnline } from './clock.js';
import { nickEmo, richText } from './stickers.js';

export function seenText(seen) {
  const t = realSeen(seen);
  if (!t) return '';
  const m = Math.max(0, Math.floor((srvNow() - t) / 60000));
  if (seenOnline(seen)) return 'в сети';
  if (m < 1) return 'был(а) в сети только что';
  if (m < 60) return `был(а) в сети ${m} ${plural(m, 'минуту', 'минуты', 'минут')} назад`;
  const hh = Math.floor(m / 60);
  if (hh < 24) return `был(а) в сети ${hh} ${plural(hh, 'час', 'часа', 'часов')} назад`;
  const d = Math.floor(hh / 24);
  if (d < 30) return `был(а) в сети ${d} ${plural(d, 'день', 'дня', 'дней')} назад`;
  return 'давно не заходил(а)';
}
export const isOnline = (seen) => seenOnline(seen);

let seq = 0;

export function favArtistsRow(names) {
  return h('div', { class: 'fav-artists' }, (names || []).map((name) => {
    const img = h('img', { alt: '', loading: 'lazy' });
    const av = h('span', { class: 'fa-av' }, img, mi('person'));
    artistPic(name).then((p) => { if (p && p.picture) { img.src = p.picture; av.classList.add('ok'); } });
    return h('button', { type: 'button', class: 'fa', onclick: () => openArtist(name) }, av, h('span', { class: 'fa-name', text: name }));
  }));
}

export function favTracksList(tracks) {
  const list = (tracks || []).filter((t) => t && t.id);
  if (!list.length) return h('div', { class: 'list fav-tracks' });
  const top = list[0];
  const hero = h('button', { type: 'button', class: 'fav-top', onclick: () => player.playTracks(list, 0) },
    h('img', { src: top.artwork || 'assets/mkw-logo.png', alt: '', loading: 'lazy' }),
    h('span', { class: 'fav-top-txt' }, h('small', {}, mi('star'), ' Самый любимый'), h('b', { text: top.title }), h('i', { text: top.artist })),
    h('span', { class: 'fav-top-play' }, mi('play')));
  const rows = list.slice(1).map((t, k) => {
    const r = trackRow(t, { onPlay: () => player.playTracks(list, k + 1), onMore: () => openTrackMenu(t), allowNoPreview: true, current: player.queue.current?.id === t.id });
    r.prepend(h('span', { class: 'fav-n', text: String(k + 2) }));
    return r;
  });
  return h('div', { class: 'list fav-tracks' }, hero, ...rows,
    list.length > 1 ? h('button', { type: 'button', class: 'chip fav-all', onclick: () => player.playTracks(list, 0) }, mi('play'), ' Слушать всю витрину') : null);
}

function render(u, isMe) {
  const t = formatListened(Number(u.sec) || 0);
  const stat = (ic, val, label) => h('div', { class: 'up-stat' }, mi(ic), h('b', { text: String(val) }), h('small', { text: label }));
  const kids = [
    h('div', { class: `phero up-hero${showDev(u) ? ' dev' : ''}`, 'data-frame': u.frame || 'none', 'data-shape': u.shape || 'circle', 'data-effect': u.effect || 'none', 'data-bimg': u.bannerImg ? '1' : '', style: `--banner:${bannerCss(u.banner === 'img' ? 'accent' : u.banner, u.bannerImg)}` },
      h('div', { class: 'phero-banner', onclick: () => u.bannerImg && openImage(u.bannerImg) }),
      h('div', { class: 'phero-fx' }, ...Array.from({ length: 10 }, () => h('i'))),
      h('div', { class: 'phero-row' }, h('button', { type: 'button', class: 'hero-avatar', 'aria-label': 'Открыть фото', onclick: () => openImage(avSrc(u.avatar), u.nick) }, h('img', { src: avSrc(u.avatar), alt: '' }), isOnline(u.seen) ? h('span', { class: 'online-dot' }) : null)),
      h('div', { class: 'phero-info' },
        h('div', { class: 'hero-nick', 'data-style': String(u.nickStyle || 'plain').split('~')[0], 'data-font': String(u.nickStyle || '').split('~')[1] || '', text: u.nick || 'Слушатель' }),
        showDev(u) || validFan(u) || nickEmo(u.nemo) || isContrib(u) ? h('div', { class: 'nick-marks' }, nickEmo(u.nemo, 'nick-emo big'), showDev(u) ? devBadge() : null, isContrib(u) ? contribBadge() : null, validFan(u) ? fanBadge(Number(u.fan)) : null) : null,
        u.seen ? h('div', { class: `hero-seen${isOnline(u.seen) ? ' on' : ''}`, text: seenText(u.seen) }) : null,
        u.status ? richText(h('div', { class: 'hero-status' }), u.status) : null,
        u.bio ? richText(h('div', { class: 'hero-bio' }), u.bio) : null,
        u.now && isOnline(u.seen) ? h('div', { class: 'hero-now' }, mi('note'), h('span', { text: `Слушает: ${u.now}` })) : null,
        u.days ? h('div', { class: 'hero-since', text: `С MKW ${u.days} ${plural(u.days, 'день', 'дня', 'дней')}` }) : null,
        h('div', { class: 'pbadges' }, ...(u.badges || []).filter((id) => ACH[id]).map((id) => h('span', { class: `pbadge${ACH[id].cls ? ` ${ACH[id].cls}` : ''}`, title: ACH[id].hint, role: 'button', tabindex: '0', onclick: () => viewAch(ACH[id], true, null, 1) }, mi(ACH[id].i), h('b', { text: ACH[id].title })))))),
    !isMe && u.uid ? (() => {
      const btn = h('button', { class: 'btn up-friend', type: 'button' });
      const chatBtn = h('button', { class: 'btn tonal up-friend', type: 'button', onclick: () => openChat(u.uid, u) }, mi('chat'), ' Написать');
      const LBL = { friend: ['check', ' В друзьях'], sent: ['hourglass', ' Заявка отправлена'], incoming: ['person-add', ' Принять заявку'], none: ['person-add', ' Добавить в друзья'] };
      const paint = () => { const st = friendState(u.uid); btn.classList.toggle('tonal', st === 'friend' || st === 'sent'); btn.replaceChildren(mi(LBL[st][0]), LBL[st][1]); chatBtn.hidden = st !== 'friend'; };
      btn.addEventListener('click', async () => {
        const st = friendState(u.uid);
        try {
          if (st === 'friend') { if (confirmRemove(u)) { await removeFriend(u.uid); toast('Убрано из друзей'); } }
          else if (st === 'sent') { await removeFriend(u.uid); toast('Заявка отменена'); }
          else if (st === 'incoming') { await addFriend(u.uid); toast(`Теперь вы друзья с ${u.nick}`); }
          else { await addFriend(u.uid); toast(`Заявка отправлена. ${u.nick} станет другом, когда примет её`); }
        } catch { toast('Не получилось. Админу нужно обновить правила Firestore'); }
        paint();
      });
      if (!friendsLoaded()) loadFriends().then(paint);
      paint();
      const play = u.now && isOnline(u.seen) ? h('button', { class: 'btn tonal up-friend', type: 'button', onclick: async () => {
        const f = await searchTracks(u.now).catch(() => []);
        if (f.length) player.playTracks(f.slice(0, 10), 0); else toast('Не нашла этот трек');
      } }, mi('play-circle'), ' Слушать то же') : null;
      return h('div', { class: 'up-actions' }, btn, chatBtn, play);
    })() : null,
    !isMe && u.uid && friendState(u.uid) === 'friend' ? chatActions(u.uid, u) : null,
    h('div', { class: 'up-stats' },
      stat('timer', t.value, t.unit), stat('play-circle', u.plays || 0, 'треков'), stat('heart', u.likes || 0, 'лайков'),
      u.achCount != null ? stat('medal', u.achCount, 'наград') : null),
  ];
  // достижения человека: то, что видно по его статистике, плюс выбранные им значки. Нажмите — откроется описание
  {
    const s = { sec: Number(u.sec) || 0, plays: Number(u.plays) || 0, likes: Number(u.likes) || 0, days: Number(u.days) || 0 };
    const byStats = ACHIEVEMENTS.filter((a) => a.v && /^(like|h|p|d)\d/.test(a.id) && achDone(a, { ...s, playlists: 0, artists: 0, friends: 0 }));
    const got = [...new Map([...(u.badges || []).filter((id) => ACH[id]).map((id) => [id, ACH[id]]), ...byStats.map((a) => [a.id, a])]).values()];
    if (got.length) kids.push(h('div', { class: 'section-title', text: `Достижения · ${got.length}` }),
      h('div', { class: 'ach-grid up-ach' }, got.map((a) => h('div', { class: `ach on${a.cls ? ` ${a.cls}` : ''}`, role: 'button', tabindex: '0', title: a.hint, onclick: () => viewAch(a, true, null, 1) },
        h('div', { class: 'ach-ico m' }, mi(a.i)), h('div', { class: 'ach-t', text: a.title }), h('div', { class: 'ach-h', text: a.hint })))));
  }
  if ((u.favArtists || []).length) kids.push(h('div', { class: 'section-title', text: 'Любимые исполнители' }), favArtistsRow(u.favArtists));
  if ((u.favTracks || []).length) {
    const list = favTracksList(u.favTracks);
    kids.push(h('div', { class: 'section-title', text: 'Любимые треки' }), list);
    setTimeout(() => animateIn(list), 0);
  }
  if (!(u.favArtists || []).length && !(u.favTracks || []).length && u.full) kids.push(h('p', { class: 'profile-note center', text: isMe ? 'Добавьте любимых исполнителей и треки: Профиль → Изменить.' : 'Витрина пока пустая.' }));
  if (isMe) kids.push(h('p', { class: 'profile-note center', text: 'Так ваш профиль видят другие слушатели.' }));
  return kids;
}

// компьютер: две колонки — слева карточка человека и кнопки, справа статистика, исполнители и треки
function pcLayout(kids) {
  if (!matchMedia('(min-width: 980px) and (pointer: fine)').matches) return kids;
  const left = [], right = [];
  for (const k of kids.filter(Boolean)) (k.classList && (k.classList.contains('up-hero') || k.classList.contains('up-actions') || k.classList.contains('up-chat')) ? left : right).push(k);
  return [h('div', { class: 'up-cols' }, h('div', { class: 'up-left' }, ...left), h('div', { class: 'up-right' }, ...right))];
}

export async function openUserPage(uid, basic, isMe = false) {
  if (basic && !basic.uid) basic = { ...basic, uid };
  const page = $('#user-page'), body = $('#user-body');
  const fp = document.getElementById('full-player'); if (fp) { fp.classList.remove('open', 'dragging'); fp.style.transform = ''; }
  const mine = ++seq;
  const ch = document.getElementById('chat-page');
  page.classList.toggle('over-chat', Boolean(ch && ch.classList.contains('open')));
  page.classList.add('open');
  page.scrollTop = 0;
  body.replaceChildren(...pcLayout(basic ? render(basic, isMe) : [h('div', { class: 'phero up-hero sk' })]));
  const full = uid ? await getProfile(uid) : null;
  if (mine !== seq) return;
  if (full) body.replaceChildren(...pcLayout(render({ ...(basic || {}), ...full, uid, full: true }, isMe)));
  else if (!basic) body.replaceChildren(h('p', { class: 'profile-note center', text: isMe ? 'Профиль ещё не опубликован. Подождите несколько секунд и откройте снова.' : 'Профиль скрыт или недоступен.' }));
}

export function closeUserPage() { $('#user-page').classList.remove('open'); seq += 1; }
export function initUserPage() { $('#user-back').addEventListener('click', closeUserPage); }
