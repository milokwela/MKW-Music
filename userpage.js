// Страница другого слушателя: баннер, фото, статус, значки, статистика, любимые исполнители и треки.
import { $, h, trackRow, animateIn } from './ui.js?v=0.22.1';
import * as player from './player.js?v=0.22.1';
import { openTrackMenu } from './menu.js?v=0.22.1';
import { getProfile } from './leaders.js?v=0.22.1';
import { ACH, bannerCss, formatListened } from './profile.js?v=0.22.1';
import { artistPic } from './artistpic.js?v=0.22.1';
import { openArtist } from './artist.js?v=0.22.1';
import { mi } from './icons2.js?v=0.22.1';
import { plural } from './utils.js?v=0.22.1';
import { openImage } from './viewer.js?v=0.22.1';
import { isDev, devBadge } from './dev.js?v=0.22.1';
import { isFriend, addFriend, removeFriend, loadFriends, friendsLoaded } from './friends.js?v=0.22.1';
import { toast } from './ui.js?v=0.22.1';
import { searchTracks } from './catalog.js?v=0.22.1';

export function seenText(seen) {
  const t = Number(seen) || 0;
  if (!t) return '';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 6) return 'в сети';
  if (m < 60) return `был(а) в сети ${m} ${plural(m, 'минуту', 'минуты', 'минут')} назад`;
  const hh = Math.floor(m / 60);
  if (hh < 24) return `был(а) в сети ${hh} ${plural(hh, 'час', 'часа', 'часов')} назад`;
  const d = Math.floor(hh / 24);
  if (d < 30) return `был(а) в сети ${d} ${plural(d, 'день', 'дня', 'дней')} назад`;
  return 'давно не заходил(а)';
}
export const isOnline = (seen) => Date.now() - (Number(seen) || 0) < 6 * 60000;

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
    h('div', { class: `phero up-hero${isDev(u.nick) ? ' dev' : ''}`, 'data-frame': u.frame || 'none', 'data-shape': u.shape || 'circle', 'data-effect': u.effect || 'none', style: `--banner:${bannerCss(u.banner === 'img' ? 'accent' : u.banner, u.bannerImg)}` },
      h('div', { class: 'phero-banner', onclick: () => u.bannerImg && openImage(u.bannerImg) }),
      h('div', { class: 'phero-fx' }, h('i'), h('i'), h('i'), h('i'), h('i'), h('i')),
      h('div', { class: 'phero-row' }, h('button', { type: 'button', class: 'hero-avatar', 'aria-label': 'Открыть фото', onclick: () => openImage(u.avatar || 'mkw-logo.png', u.nick) }, h('img', { src: u.avatar || 'mkw-logo.png', alt: '' }), isOnline(u.seen) ? h('span', { class: 'online-dot' }) : null)),
      h('div', { class: 'phero-info' },
        h('div', { class: 'hero-nick', 'data-style': u.nickStyle || 'plain', text: u.nick || 'Слушатель' }),
        isDev(u.nick) ? devBadge() : null,
        u.seen ? h('div', { class: `hero-seen${isOnline(u.seen) ? ' on' : ''}`, text: seenText(u.seen) }) : null,
        u.status ? h('div', { class: 'hero-status', text: u.status }) : null,
        u.bio ? h('div', { class: 'hero-bio', text: u.bio }) : null,
        u.now && isOnline(u.seen) ? h('div', { class: 'hero-now' }, mi('note'), h('span', { text: `Слушает: ${u.now}` })) : null,
        u.days ? h('div', { class: 'hero-since', text: `С MKW ${u.days} ${plural(u.days, 'день', 'дня', 'дней')}` }) : null,
        h('div', { class: 'pbadges' }, ...(isDev(u.nick) ? [h('span', { class: 'pbadge dev-ach' }, mi('crown'), h('b', { text: 'Создатель MKW' }))] : []), ...(u.badges || []).filter((id) => ACH[id]).map((id) => h('span', { class: 'pbadge' }, mi(ACH[id].i), h('b', { text: ACH[id].title })))))),
    !isMe && u.uid ? (() => {
      const btn = h('button', { class: 'btn up-friend', type: 'button' });
      const paint = () => { const f = isFriend(u.uid); btn.classList.toggle('tonal', f); btn.replaceChildren(mi(f ? 'check' : 'add'), f ? ' В друзьях' : ' Добавить в друзья'); };
      btn.addEventListener('click', async () => {
        try { if (isFriend(u.uid)) { await removeFriend(u.uid); toast('Убрано из друзей'); } else { await addFriend(u.uid); toast(`${u.nick} теперь у вас в друзьях`); } }
        catch { toast('Не получилось. Админу нужно обновить правила Firestore'); }
        paint();
      });
      if (!friendsLoaded()) loadFriends().then(paint);
      paint();
      const play = u.now && isOnline(u.seen) ? h('button', { class: 'btn tonal up-friend', type: 'button', onclick: async () => {
        const f = await searchTracks(u.now).catch(() => []);
        if (f.length) player.playTracks(f.slice(0, 10), 0); else toast('Не нашла этот трек');
      } }, mi('play-circle'), ' Слушать то же') : null;
      return h('div', { class: 'up-actions' }, btn, play);
    })() : null,
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

export async function openUserPage(uid, basic, isMe = false) {
  if (basic && !basic.uid) basic = { ...basic, uid };
  const page = $('#user-page'), body = $('#user-body');
  const mine = ++seq;
  page.classList.add('open');
  page.scrollTop = 0;
  body.replaceChildren(...(basic ? render(basic, isMe) : [h('div', { class: 'phero up-hero sk' })]));
  const full = uid ? await getProfile(uid) : null;
  if (mine !== seq) return;
  if (full) body.replaceChildren(...render({ ...(basic || {}), ...full, uid, full: true }, isMe));
  else if (!basic) body.replaceChildren(h('p', { class: 'profile-note center', text: isMe ? 'Профиль ещё не опубликован. Подождите несколько секунд и откройте снова.' : 'Профиль скрыт или недоступен.' }));
}

export function closeUserPage() { $('#user-page').classList.remove('open'); seq += 1; }
export function initUserPage() { $('#user-back').addEventListener('click', closeUserPage); }
