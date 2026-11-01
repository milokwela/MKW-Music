// Страница исполнителя: треки, слушать, перемешать, «не рекомендовать».
import { searchTracks, mapItunes, mapDeezer } from './catalog.js?v=0.22.1';
import { jsonp } from './jsonp.js?v=0.22.1';
import { prefetchYouTubeIds } from './youtube.js?v=0.22.1';
import { $, h, icon, trackRow, skeleton, animateIn, toast, openSheet, closeSheet, sheetItem } from './ui.js?v=0.22.1';
import { openTrackMenu } from './menu.js?v=0.22.1';
import * as player from './player.js?v=0.22.1';
import { splitArtists, isArtistBlocked, blockArtist, unblockArtist, norm } from './taste.js?v=0.22.1';
import { shuffled, plural } from './utils.js?v=0.22.1';
import { artistPic } from './artistpic.js?v=0.22.1';
import { mi } from './icons2.js?v=0.22.1';

let seq = 0;
const infoCache = new Map();
const MUSIC = /музык|певец|певиц|рэп|реп-|хип-хоп|групп|исполнител|композитор|диджей|диджей|продюсер|singer|rapper|band|musician|songwriter|dj\b/i;

// Справка об исполнителе из Википедии (если нашлась и это правда музыкант).
async function getJ(url) { try { const r = await fetch(url); return r.ok ? await r.json() : null; } catch { return null; } }
async function ruSummary(title) {
  const sum = await getJ(`https://ru.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
  if (sum && sum.type !== 'disambiguation' && sum.extract && MUSIC.test(`${sum.description || ''} ${sum.extract.slice(0, 300)}`)) {
    return { text: sum.extract, desc: sum.description || '', photo: sum.thumbnail && sum.thumbnail.source, url: sum.content_urls && sum.content_urls.desktop && sum.content_urls.desktop.page };
  }
  return null;
}
// Справка только на русском: 1) статья в русской Википедии; 2) английская статья → её русская версия
async function artistInfo(name) {
  if (infoCache.has(name)) return infoCache.get(name);
  let out = null;
  const nn = (x) => String(x || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, '');
  const want = nn(name);
  const same = (title) => { const t = nn(String(title).replace(/\s*\(.*\)\s*$/, '')); return t === want || (t.startsWith(want) && t.length - want.length <= 3); };
  const s = await getJ(`https://ru.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(name)}&limit=5`);
  for (const p of (s && s.pages) || []) { if (!same(p.title)) continue; out = await ruSummary(p.key); if (out) break; }
  if (!out) {
    // поиск по смыслу (если название статьи с уточнением, например «Луна (певица)»)
    const q = await getJ(`https://ru.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`${name} исполнитель`)}&srlimit=5&format=json&origin=*`);
    for (const p of (q && q.query && q.query.search) || []) { if (!same(p.title)) continue; out = await ruSummary(p.title); if (out) break; }
  }
  if (!out) {
    const e = await getJ(`https://en.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(name)}&limit=5`);
    for (const p of (e && e.pages) || []) {
      if (!same(p.title)) continue;
      const ll = await getJ(`https://en.wikipedia.org/w/api.php?action=query&prop=langlinks&lllang=ru&titles=${encodeURIComponent(p.title)}&format=json&origin=*`);
      const pg = ll && ll.query && Object.values(ll.query.pages || {})[0];
      const ru = pg && pg.langlinks && pg.langlinks[0] && pg.langlinks[0]['*'];
      if (ru) { out = await ruSummary(ru); if (out) break; }
    }
  }
  infoCache.set(name, out);
  return out;
}

// Треки исполнителя: популярное из Deezer + полный каталог iTunes по id исполнителя
async function artistTracks(name) {
  const n = norm(name);
  const own = (t) => splitArtists(t.artist).some((a) => norm(a) === n || norm(a).includes(n) || n.includes(norm(a)));
  const out = new Map();
  const key = (t) => `${norm(t.title).replace(/\s*[(\[].*?[)\]]/g, '').replace(/[^a-zа-яё0-9]/gi, '')}`;
  const add = (t) => { if (!t.title) return; const k = key(t); if (!out.has(k)) out.set(k, t); else if (!out.get(k).previewUrl && t.previewUrl) out.set(k, { ...t, ...out.get(k), previewUrl: t.previewUrl }); };
  let dz = null, albums = [];
  const deezer = (async () => {
    const s = await jsonp(`https://api.deezer.com/search/artist?limit=5&q=${encodeURIComponent(name)}`, 7000);
    const list = (s && s.data) || [];
    dz = list.find((x) => norm(x.name) === n) || null;
    if (!dz) return [];
    const [top, al] = await Promise.all([
      jsonp(`https://api.deezer.com/artist/${dz.id}/top?limit=50`, 8000),
      jsonp(`https://api.deezer.com/artist/${dz.id}/albums?limit=40`, 8000),
    ]);
    albums = ((al && al.data) || []).filter((x) => x.title).map((x) => ({ id: x.id, title: x.title, cover: x.cover_medium || x.cover, year: String(x.release_date || '').slice(0, 4), type: x.record_type }));
    return ((top && top.data) || []).map(mapDeezer);
  })().catch(() => []);
  const itunes = (async () => {
    const found = await searchTracks(name).catch(() => []);
    const first = found.find(own);
    const res = [];
    if (first) {
      try {
        const art = await fetch(`https://itunes.apple.com/lookup?id=${encodeURIComponent(first.id)}&country=RU`).then((r) => r.json());
        const aid = art && art.results && art.results[0] && art.results[0].artistId;
        if (aid) {
          const all = await fetch(`https://itunes.apple.com/lookup?id=${aid}&entity=song&limit=200&country=RU`).then((r) => r.json());
          for (const r of (all && all.results) || []) if (r.wrapperType === 'track' && r.kind === 'song') res.push(mapItunes(r));
        }
      } catch { /* ничего */ }
    }
    return [...found.filter(own), ...res];
  })().catch(() => []);
  const [dzt, it] = await Promise.all([deezer, itunes]);
  dzt.forEach(add);           // сначала популярное
  it.forEach(add);
  let tracks = [...out.values()];
  if (tracks.length < 3) tracks = await searchTracks(name).catch(() => tracks);
  return { tracks, dz, albums };
}

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
  let tracks = [], dz = null, albums = [];
  try { ({ tracks, dz, albums } = await artistTracks(name)); } catch (e) { console.error(e); }
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
  const row = (t, i) => trackRow(t, { onPlay: () => player.playTracks(tracks, i), onMore: () => openTrackMenu(t), current: player.queue.current?.id === t.id, allowNoPreview: true });
  const FIRST = 20;
  const list = h('div', { class: 'list' }, tracks.slice(0, FIRST).map(row));
  const moreBtn = tracks.length > FIRST ? h('div', { style: 'text-align:center;margin:14px 0' }, h('button', { class: 'chip', type: 'button', onclick: (e) => {
    list.append(...tracks.slice(FIRST).map((t, k) => row(t, FIRST + k))); e.currentTarget.parentNode.remove(); animateIn(list);
  } }, `Показать все (${tracks.length})`)) : null;
  // альбомы (Deezer): нажали — играет весь альбом
  const albumsBox = albums.length ? h('div', {},
    h('div', { class: 'section-title', text: `Альбомы и синглы · ${albums.length}` }),
    h('div', { class: 'al-row' }, albums.map((a) => h('button', { type: 'button', class: 'al-card', onclick: async () => {
      toast(`Включаю «${a.title}»`);
      const r = await jsonp(`https://api.deezer.com/album/${a.id}/tracks?limit=100`, 8000);
      const list2 = ((r && r.data) || []).map((x) => ({ ...mapDeezer(x), album: a.title, artwork: a.cover }));
      if (list2.length) player.playTracks(list2, 0); else toast('Не получилось открыть альбом');
    } }, h('img', { src: a.cover, alt: '', loading: 'lazy' }), h('b', { text: a.title }), h('small', { text: [a.year, a.type === 'single' ? 'сингл' : a.type === 'ep' ? 'EP' : 'альбом'].filter(Boolean).join(' · ') }))))) : null;
  const genres = [...new Set(tracks.map((t) => t.genre).filter(Boolean))].slice(0, 3);
  const years = tracks.map((t) => Number(String(t.year || t.releaseDate || '').slice(0, 4))).filter((y) => y > 1950);
  const meta = h('div', { class: 'artist-meta' },
    h('span', { class: 'chip', text: `${tracks.length} треков в подборке` }),
    ...genres.map((g) => h('span', { class: 'chip', text: g })),
    years.length ? h('span', { class: 'chip', text: Math.min(...years) === Math.max(...years) ? String(years[0]) : `${Math.min(...years)}–${Math.max(...years)}` }) : null);
  const photo = h('img', { class: 'ah-img', alt: '' });
  const fans = h('div', { class: 'artist-fans' });
  const bio = h('div', { class: 'artist-bio', hidden: '' });
  const hero = h('div', { class: 'artist-hero' },
    h('div', { class: 'ah-bg' }),
    h('div', { class: 'ah-photo' }, photo, h('span', { class: 'ah-ph' }, mi('person'))),
    h('div', { class: 'ah-txt' }, h('div', { class: 'ah-kind' }, mi('verified'), 'Исполнитель'), h('h1', { class: 'artist-name', text: name }), fans, meta));
  const headBox = hero;
  const setPhoto = (url) => {
    if (!url || mine !== seq) return;
    const img = new Image();
    img.onload = () => { if (mine !== seq) return; photo.src = url; hero.style.setProperty('--ah-img', `url("${url}")`); hero.classList.add('has-photo'); };
    img.src = url;
  };
  if (dz && dz.picture_xl && !/\/artist\/\//.test(dz.picture_xl)) setPhoto(dz.picture_xl);
  if (dz && dz.nb_fan) fans.textContent = `${dz.nb_fan.toLocaleString('ru-RU')} ${plural(dz.nb_fan, 'поклонник', 'поклонника', 'поклонников')} на Deezer`;
  artistPic(name).then((p) => {
    if (mine !== seq) return;
    if (hero.classList.contains('has-photo') && fans.textContent) return;
    if (p && p.picture) setPhoto(p.picture);
    else if (tracks[0] && tracks[0].artwork) setPhoto(tracks[0].artwork);
    if (p && p.fans) fans.textContent = `${p.fans.toLocaleString('ru-RU')} ${plural(p.fans, 'поклонник', 'поклонника', 'поклонников')} на Deezer`;
  });
  artistInfo(name).then((info) => {
    if (mine !== seq) return;
    if (!info) {
      // в Википедии нет — короткая справка по данным каталога
      const g = genres.length ? ` в жанре ${genres.join(', ').toLowerCase()}` : '';
      const y = years.length ? ` Выпускает музыку с ${Math.min(...years)} года.` : '';
      const f = dz && dz.nb_fan ? ` На Deezer у исполнителя ${dz.nb_fan.toLocaleString('ru-RU')} ${plural(dz.nb_fan, 'поклонник', 'поклонника', 'поклонников')}` : '';
      const al = dz && dz.nb_album ? `${f ? ' и' : ' В каталоге'} ${dz.nb_album} ${plural(dz.nb_album, 'релиз', 'релиза', 'релизов')}.` : f ? '.' : '';
      bio.append(h('b', { class: 'bio-h', text: 'Коротко' }), h('span', { text: `${name} — исполнитель${g}.${y}${f}${al} В MKW доступно ${tracks.length} ${plural(tracks.length, 'трек', 'трека', 'треков')}.` }));
      bio.hidden = false;
      return;
    }
    if (info.photo && !hero.classList.contains('has-photo')) setPhoto(info.photo);
    if (info.desc) { const d = h('span', { class: 'chip', text: info.desc.length > 40 ? `${info.desc.slice(0, 40)}…` : info.desc }); meta.prepend(d); }
    const short = info.text.length > 280 ? `${info.text.slice(0, 280).replace(/\s+\S*$/, '')}…` : info.text;
    const txt = h('span', { text: short });
    bio.append(h('b', { class: 'bio-h', text: 'Об исполнителе' }), txt);
    if (short !== info.text) { const more = h('button', { class: 'more', type: 'button', text: 'Ещё' }); more.addEventListener('click', () => { txt.textContent = info.text; more.remove(); }); bio.append(more); }
    if (info.url) bio.append(h('div', { style: 'margin-top:8px;font-size:12px' }, 'Источник: ', h('a', { href: info.url, target: '_blank', rel: 'noopener', text: 'Википедия' })));
    bio.hidden = false;
  });
  body.replaceChildren(
    headBox, bar, bio,
    h('div', { class: 'section-title', text: tracks.length ? `Популярное · ${tracks.length}` : '' }),
    tracks.length ? list : h('div', { class: 'empty' }, h('div', { text: 'Треков не нашлось' })),
    moreBtn, albumsBox);
  if (tracks.length) { animateIn(list); prefetchYouTubeIds(tracks); }
}

export function initArtist() {
  $('#artist-back').addEventListener('click', closeArtist);
}
