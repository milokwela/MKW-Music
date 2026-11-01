// Страница другого слушателя: баннер, фото, статус, значки, статистика, любимые исполнители и треки.
import { $, h, trackRow, animateIn } from './ui.js?v=0.18.0';
import * as player from './player.js?v=0.18.0';
import { openTrackMenu } from './menu.js?v=0.18.0';
import { getProfile } from './leaders.js?v=0.18.0';
import { ACH, bannerCss, formatListened } from './profile.js?v=0.18.0';
import { artistPic } from './artistpic.js?v=0.18.0';
import { openArtist } from './artist.js?v=0.18.0';
import { mi } from './icons2.js?v=0.18.0';
import { plural } from './utils.js?v=0.18.0';

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
    h('div', { class: 'phero up-hero', 'data-frame': u.frame || 'none', style: `--banner:${bannerCss(u.banner === 'img' ? 'accent' : u.banner, u.bannerImg)}` },
      h('div', { class: 'phero-banner' }),
      h('div', { class: 'phero-row' }, h('span', { class: 'hero-avatar' }, h('img', { src: u.avatar || 'mkw-logo.png', alt: '' }))),
      h('div', { class: 'phero-info' },
        h('div', { class: 'hero-nick', text: u.nick || 'Слушатель' }),
        u.status ? h('div', { class: 'hero-status', text: u.status }) : null,
        u.days ? h('div', { class: 'hero-since', text: `С MKW ${u.days} ${plural(u.days, 'день', 'дня', 'дней')}` }) : null,
        h('div', { class: 'pbadges' }, (u.badges || []).filter((id) => ACH[id]).map((id) => h('span', { class: 'pbadge' }, mi(ACH[id].i), h('b', { text: ACH[id].title })))))),
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
  const page = $('#user-page'), body = $('#user-body');
  const mine = ++seq;
  page.classList.add('open');
  page.scrollTop = 0;
  body.replaceChildren(...(basic ? render(basic, isMe) : [h('div', { class: 'phero up-hero sk' })]));
  const full = uid ? await getProfile(uid) : null;
  if (mine !== seq) return;
  if (full) body.replaceChildren(...render({ ...(basic || {}), ...full, full: true }, isMe));
  else if (!basic) body.replaceChildren(h('p', { class: 'profile-note center', text: isMe ? 'Профиль ещё не опубликован. Подождите несколько секунд и откройте снова.' : 'Профиль скрыт или недоступен.' }));
}

export function closeUserPage() { $('#user-page').classList.remove('open'); seq += 1; }
export function initUserPage() { $('#user-back').addEventListener('click', closeUserPage); }
