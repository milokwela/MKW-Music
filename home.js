// Главная: «Друзья в сети» и умные миксы, которые собираются из вашей музыки, времени суток и друзей.
import { $, h, toast } from './ui.js?v=0.22.1';
import * as store from './store.js?v=0.22.1';
import * as player from './player.js?v=0.22.1';
import { searchTracks } from './catalog.js?v=0.22.1';
import { shuffled } from './utils.js?v=0.22.1';
import { splitArtists, norm } from './taste.js?v=0.22.1';
import { mi } from './icons2.js?v=0.22.1';
import { loadFriends, friendIds, friendCards, onFriends } from './friends.js?v=0.22.1';
import { getProfile, communityTaste } from './leaders.js?v=0.22.1';
import { openUserPage, isOnline } from './userpage.js?v=0.22.1';

const part = () => { const hr = new Date().getHours(); return hr < 6 ? 0 : hr < 12 ? 1 : hr < 18 ? 2 : 3; };
const PARTS = [
  { title: 'Ночной вайб', icon: 'moon', hue: 255 },
  { title: 'Утренний заряд', icon: 'fire', hue: 35 },
  { title: 'Дневной поток', icon: 'headphones', hue: 190 },
  { title: 'Вечерний микс', icon: 'sparkle', hue: 300 },
];

function topArtists(n) {
  const c = new Map();
  for (const t of [...store.state.likes, ...store.state.history]) for (const a of splitArtists(t.artist)) c.set(a, (c.get(a) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map((x) => x[0]);
}
function uniq(list) {
  const seen = new Set();
  return list.filter((t) => { const k = `${norm(t.title)}|${norm(t.artist)}`; if (!t || !t.id || seen.has(k)) return false; seen.add(k); return true; });
}
// перемешиваем так, чтобы один исполнитель не шёл подряд
function spread(list) {
  const out = [], rest = [...list];
  while (rest.length) { const last = out.length ? norm(out[out.length - 1].artist) : ''; let i = rest.findIndex((t) => norm(t.artist) !== last); if (i < 0) i = 0; out.push(rest.splice(i, 1)[0]); }
  return out;
}
async function byArtists(names, per) {
  const res = await Promise.all(names.map((a) => searchTracks(a).then((f) => f.filter((t) => norm(t.artist).includes(norm(a))).slice(0, per)).catch(() => [])));
  return res.flat();
}

const MIXES = [
  { id: 'day', title: 'Микс дня', sub: 'Любимое вперемешку с новым', icon: 'sparkle', hue: 330,
    build: async () => { const liked = shuffled(store.state.likes).slice(0, 8); const more = await byArtists(shuffled(topArtists(8)).slice(0, 4), 4); return spread(uniq(shuffled([...liked, ...more]))).slice(0, 25); } },
  { id: 'part', get title() { return PARTS[part()].title; }, sub: 'То, что вы слушаете в это время', get icon() { return PARTS[part()].icon; }, get hue() { return PARTS[part()].hue; },
    build: async () => {
      const now = part();
      const hist = store.state.history.filter((t) => t.playedAt && (() => { const hr = new Date(Number(t.playedAt)).getHours(); return (hr < 6 ? 0 : hr < 12 ? 1 : hr < 18 ? 2 : 3) === now; })());
      const arts = [...new Set(hist.flatMap((t) => splitArtists(t.artist)))].slice(0, 4);
      const more = await byArtists(arts.length ? arts : topArtists(3), 5);
      return spread(uniq(shuffled([...hist.slice(0, 10), ...more]))).slice(0, 25);
    } },
  { id: 'forgot', title: 'Забытые лайки', sub: 'Давно не включали', icon: 'heart', hue: 350,
    build: async () => { const recent = new Set(store.state.history.slice(0, 50).map((t) => t.id)); const f = store.state.likes.filter((t) => !recent.has(t.id)); return shuffled(f.length >= 5 ? f : store.state.likes).slice(0, 30); } },
  { id: 'friends', title: 'Друзья слушают', sub: 'Любимое ваших друзей', icon: 'group', hue: 200,
    build: async () => {
      let ids = friendIds(); if (!ids.length) ids = await loadFriends();
      const profs = await Promise.all(ids.slice(0, 12).map((u) => getProfile(u).catch(() => null)));
      let tracks = profs.flatMap((p) => (p && p.favTracks) || []);
      const arts = profs.flatMap((p) => (p && p.favArtists) || []);
      if (!tracks.length && !arts.length) { const com = await communityTaste().catch(() => []); arts.push(...shuffled(com.flat()).slice(0, 4)); }
      tracks = [...tracks, ...(await byArtists(shuffled([...new Set(arts)]).slice(0, 4), 4))];
      return spread(uniq(shuffled(tracks))).slice(0, 25);
    } },
  { id: 'fresh', title: 'Новое от ваших', sub: 'Свежие релизы любимых исполнителей', icon: 'rocket', hue: 150,
    build: async () => {
      const y = new Date().getFullYear();
      const all = await byArtists(topArtists(6), 30);
      const fresh = all.filter((t) => Number(t.year) >= y - 1).sort((a, b) => Number(b.year) - Number(a.year));
      return uniq(fresh.length >= 4 ? fresh : all.sort((a, b) => Number(b.year || 0) - Number(a.year || 0))).slice(0, 25);
    } },
];

let busy = false;
function renderMixes() {
  const box = $('#smart-mixes');
  if (!box) return;
  if (!store.state.likes.length && !store.state.history.length) { box.hidden = true; return; }
  box.hidden = false;
  const covers = shuffled(store.state.likes.filter((t) => t.artwork)).slice(0, 12);
  box.replaceChildren(
    h('div', { class: 'section-title', text: 'Умные миксы' }),
    h('div', { class: 'mx-row' }, MIXES.map((m, i) => h('button', { type: 'button', class: 'mx-card', style: `--h:${m.hue}`, onclick: async (e) => {
      if (busy) return; busy = true;
      const card = e.currentTarget; card.classList.add('loading');
      toast(`Собираю «${m.title}»…`);
      try { const list = await m.build(); if (list.length) { player.playTracks(list, 0); toast(`${m.title}: ${list.length} треков`); } else toast('Пока мало данных для этого микса — послушайте ещё'); }
      catch { toast('Не получилось собрать микс'); }
      finally { busy = false; card.classList.remove('loading'); }
    } },
    h('span', { class: 'mx-art' }, ...(covers.slice(i * 2, i * 2 + 2).map((t) => h('img', { src: t.artwork, alt: '', loading: 'lazy' })))),
    h('span', { class: 'mx-ic' }, mi(m.icon)),
    h('b', { text: m.title }), h('small', { text: m.sub })))));
}

let stripTimer = 0;
async function renderStrip() {
  const box = $('#friends-strip');
  if (!box) return;
  if (!friendIds().length) await loadFriends();
  const ids = friendIds();
  if (!ids.length) { box.hidden = true; return; }
  const cards = (await friendCards(ids.slice(0, 40))).filter((u) => !u.hidden);
  const on = cards.filter((u) => isOnline(u.seen));
  if (!on.length) { box.hidden = true; return; }
  box.hidden = false;
  box.replaceChildren(h('div', { class: 'section-title', text: `Друзья в сети · ${on.length}` }),
    h('div', { class: 'fs-row' }, on.map((u) => h('button', { type: 'button', class: 'fs-item', onclick: () => openUserPage(u.uid, u) },
      h('span', { class: 'fs-av' }, h('img', { src: u.avatar || 'mkw-logo.png', alt: '' }), h('i', { class: 'online-dot' })),
      h('b', { text: u.nick }), h('small', { text: u.now ? u.now : 'в сети' })))));
}

let inited = false, mixT = 0;
export function initHome() {
  renderMixes();
  if (!inited) {
    inited = true;
    store.onStore((w) => { if (w === 'likes' || w === 'history') { clearTimeout(mixT); mixT = setTimeout(renderMixes, 1500); } });
    onFriends(() => renderStrip());
  }
  renderStrip();
  clearInterval(stripTimer);
  // друзья в сети обновляются раз в 2 минуты, пока открыта главная
  stripTimer = setInterval(() => { if (!document.hidden && !$('#view-search').hidden) renderStrip(); }, 120000);
}
