// Страница другого слушателя: баннер, фото, статус, значки, статистика, любимые исполнители и треки.
import { $, h, trackRow, animateIn } from './ui.js?v=0.35.7';
import * as player from './player.js?v=0.35.7';
import { openTrackMenu } from './menu.js?v=0.35.7';
import { getProfile } from './leaders.js?v=0.35.7';
import { ACH, bannerCss, formatListened } from './profile.js?v=0.35.7';
import { artistPic } from './artistpic.js?v=0.35.7';
import { openArtist } from './artist.js?v=0.35.7';
import { mi } from './icons2.js?v=0.35.7';
import { plural } from './utils.js?v=0.35.7';
import { openImage } from './viewer.js?v=0.35.7';
import { isDev, devBadge, showDev, validFan, fanBadge } from './dev.js?v=0.35.7';
import { friendState, addFriend, removeFriend, loadFriends, friendsLoaded, ONLINE_MS } from './friends.js?v=0.35.7';
import { openChat, chatActions } from './chat.js?v=0.35.7';
// удалить друга — двойное нажатие за 3 секунды, чтобы не убрать случайно
let rmAsk = '';
function confirmRemove(u) { if (rmAsk === u.uid) { rmAsk = ''; return true; } rmAsk = u.uid; setTimeout(() => { if (rmAsk === u.uid) rmAsk = ''; }, 3000); toast('Нажмите ещё раз, чтобы убрать из друзей'); return false; }
import { avSrc } from './avatar.js?v=0.35.7';
import { toast } from './ui.js?v=0.35.7';
import { searchTracks } from './catalog.js?v=0.35.7';
import { srvNow, realSeen, seenOnline } from './clock.js?v=0.35.7';
import { nickEmo } from './stickers.js?v=0.35.7';

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
  const box = h('div', { class: 'list fav-tracks' }, list.map((t, i) => trackRow(t, {
    onPlay: () => player.playTracks(list, i), onMore: () => openTrackMenu(t), allowNoPreview: true,
    current: player.queue.current?.id === t.id,
  })));
  return box;
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
        h('div', { class: 'hero-nick', 'data-style': u.nickStyle || 'plain', text: u.nick || 'Слушатель' }),
        showDev(u) || validFan(u) || nickEmo(u.nemo) ? h('div', { class: 'nick-marks' }, nickEmo(u.nemo, 'nick-emo big'), showDev(u) ? devBadge() : null, validFan(u) ? fanBadge(Number(u.fan)) : null) : null,
        u.seen ? h('div', { class: `hero-seen${isOnline(u.seen) ? ' on' : ''}`, text: seenText(u.seen) }) : null,
        u.status ? h('div', { class: 'hero-status', text: u.status }) : null,
        u.bio ? h('div', { class: 'hero-bio', text: u.bio }) : null,
        u.now && isOnline(u.seen) ? h('div', { class: 'hero-now' }, mi('note'), h('span', { text: `Слушает: ${u.now}` })) : null,
        u.days ? h('div', { class: 'hero-since', text: `С MKW ${u.days} ${plural(u.days, 'день', 'дня', 'дней')}` }) : null,
        h('div', { class: 'pbadges' }, ...(u.badges || []).filter((id) => ACH[id]).map((id) => h('span', { class: `pbadge${ACH[id].cls ? ` ${ACH[id].cls}` : ''}`, title: ACH[id].hint }, mi(ACH[id].i), h('b', { text: ACH[id].title })))))),
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
