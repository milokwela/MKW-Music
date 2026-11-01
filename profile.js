// Экран «Профиль»: карточка с баннером, витрина (любимые исполнители и треки), вкладки Обзор / Слушатели / Настройки / О MKW.
import { $, $$, h, icon, openSheet, closeSheet, toast, sheetItem, trackRow } from './ui.js?v=0.18.0';
import * as store from './store.js?v=0.18.0';
import * as player from './player.js?v=0.18.0';
import { ACCENTS, getTheme, getAccent, getCustomHue, setCustomColor, setTheme, setAccent, hslHex, getNeutral } from './theme.js?v=0.18.0';
import { CHANGELOG, VERSION, STAGE, KNOWN_ISSUES } from './changelog.js?v=0.18.0';
import { plural, pickTrack } from './utils.js?v=0.18.0';
import { youtubeEnabled, youtubeQuotaOut } from './youtube.js?v=0.18.0';
import { audiusEnabled } from './audius.js?v=0.18.0';
import { SOURCE_MODES, getSourceMode, setSourceMode } from './sources.js?v=0.18.0';
import { gesturesOn, setGestures, showGestureGuide } from './gestures.js?v=0.18.0';
import { listenerStats } from './stats.js?v=0.18.0';
import { liveBg, setLiveBg } from './viz.js?v=0.18.0';
import { lowPower, setLowPower } from './perf.js?v=0.18.0';
import { logOut, changePassword, changeNick, authErrorText } from './auth.js?v=0.18.0';
import { connectionCountry } from './geo.js?v=0.18.0';
import { publishCard, publishProfile, myCard, getProfile, topListeners, hiddenFromBoard, setHidden, myUid } from './leaders.js?v=0.18.0';
import { mi } from './icons2.js?v=0.18.0';
import { artistPic } from './artistpic.js?v=0.18.0';
import { openArtist } from './artist.js?v=0.18.0';
import { openUserPage, favArtistsRow, favTracksList } from './userpage.js?v=0.18.0';
import { voiceOn, setVoice, showVoiceGuide, voiceSupported } from './voice.js?v=0.18.0';

// s: sec, likes, playlists, plays, days, artists, night, styled, showcase, rank
export const ACHIEVEMENTS = [
  { id: 'like1', i: 'heart', title: 'Первый лайк', hint: 'Лайкните любой трек', ok: (s) => s.likes >= 1 },
  { id: 'like10', i: 'hearts', title: 'Коллекционер', hint: '10 лайков', v: (s) => [s.likes, 10] },
  { id: 'like50', i: 'heart-plus', title: 'Сердцеед', hint: '50 лайков', v: (s) => [s.likes, 50] },
  { id: 'like100', i: 'heart-star', title: 'Фанат', hint: '100 лайков', v: (s) => [s.likes, 100] },
  { id: 'pl1', i: 'folder', title: 'Составитель', hint: 'Создайте плейлист', ok: (s) => s.playlists >= 1 },
  { id: 'pl5', i: 'folders', title: 'Куратор', hint: '5 плейлистов', v: (s) => [s.playlists, 5] },
  { id: 'h1', i: 'timer', title: 'Час музыки', hint: 'Послушайте 1 час', v: (s) => [Math.floor(s.sec / 3600), 1] },
  { id: 'h10', i: 'headphones', title: 'Меломан', hint: '10 часов музыки', v: (s) => [Math.floor(s.sec / 3600), 10] },
  { id: 'h24', i: 'day-night', title: 'Сутки в наушниках', hint: '24 часа музыки', v: (s) => [Math.floor(s.sec / 3600), 24] },
  { id: 'h100', i: 'trophy', title: 'Легенда', hint: '100 часов музыки', v: (s) => [Math.floor(s.sec / 3600), 100] },
  { id: 'p50', i: 'play-circle', title: 'Разогрев', hint: '50 треков', v: (s) => [s.plays, 50] },
  { id: 'p250', i: 'fire', title: 'В ритме', hint: '250 треков', v: (s) => [s.plays, 250] },
  { id: 'p1000', i: 'rocket', title: 'Тысячник', hint: '1000 треков', v: (s) => [s.plays, 1000] },
  { id: 'd7', i: 'calendar', title: 'Неделя с MKW', hint: '7 дней с нами', v: (s) => [s.days, 7] },
  { id: 'd30', i: 'calendar-month', title: 'Месяц с MKW', hint: '30 дней с нами', v: (s) => [s.days, 30] },
  { id: 'd100', i: 'diamond', title: 'Старожил', hint: '100 дней с нами', v: (s) => [s.days, 100] },
  { id: 'a10', i: 'mic', title: 'Открыватель', hint: '10 разных исполнителей', v: (s) => [s.artists, 10] },
  { id: 'a40', i: 'globe', title: 'Путешественник', hint: '40 разных исполнителей', v: (s) => [s.artists, 40] },
  { id: 'night', i: 'moon', title: 'Полуночник', hint: 'Музыка между 0:00 и 5:00', ok: (s) => s.night },
  { id: 'style', i: 'sparkle', title: 'Стиляга', hint: 'Настройте свой профиль', ok: (s) => s.styled },
  { id: 'show', i: 'star', title: 'Витрина', hint: 'Добавьте любимые треки или исполнителей', ok: (s) => s.showcase },
  { id: 'top3', i: 'medal', title: 'Топ-3', hint: 'Войдите в тройку слушателей', ok: (s) => s.rank > 0 && s.rank <= 3 },
  { id: 'top1', i: 'crown', title: 'Король эфира', hint: 'Станьте первым в рейтинге', ok: (s) => s.rank === 1 },
];
const achDone = (a, s) => (a.ok ? a.ok(s) : a.v(s)[0] >= a.v(s)[1]);
export const ACH = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

export const BANNERS = [
  { id: 'accent', name: 'Акцент', css: 'linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary) 40%, #120812))' },
  { id: 'sunset', name: 'Закат', css: 'linear-gradient(135deg, #ff7a59, #ff3d7f 50%, #7a2bff)' },
  { id: 'ocean', name: 'Океан', css: 'linear-gradient(135deg, #00d2ff, #3a47d5)' },
  { id: 'aurora', name: 'Сияние', css: 'linear-gradient(135deg, #43e97b, #38f9d7 40%, #6a5cff)' },
  { id: 'fire', name: 'Огонь', css: 'linear-gradient(135deg, #f9d423, #ff4e50)' },
  { id: 'night', name: 'Ночь', css: 'linear-gradient(135deg, #232526, #414345 50%, #1a1035)' },
  { id: 'candy', name: 'Конфета', css: 'linear-gradient(135deg, #f6a5ff, #a0c4ff)' },
  { id: 'mono', name: 'Графит', css: 'linear-gradient(135deg, #3a3a3a, #0d0d0d)' },
];
export const FRAMES = [
  { id: 'none', name: 'Без рамки' }, { id: 'glow', name: 'Свечение' }, { id: 'rainbow', name: 'Радуга' }, { id: 'gold', name: 'Золото' }, { id: 'neon', name: 'Неон' },
];
export const bannerCss = (id, img) => (img ? `center / cover no-repeat url("${img}")` : (BANNERS.find((b) => b.id === id) || BANNERS[0]).css);

let built = false, curNick = '', boardLoaded = 0, myRank = 0, restored = false;
const refs = {};

const CKEY = (n) => `mkw.pcustom.${n}`;
const DEF = { status: '', banner: 'accent', bannerImg: '', frame: 'glow', badges: [], favArtists: [], favTracks: [] };
function getCustom() {
  try { return { ...DEF, ...JSON.parse(localStorage.getItem(CKEY(curNick)) || '{}') }; } catch { return { ...DEF }; }
}
function setCustom(patch) {
  const c = { ...getCustom(), ...patch, styled: true };
  try { localStorage.setItem(CKEY(curNick), JSON.stringify(c)); }
  catch { toast('Картинка слишком большая для памяти браузера'); }
  paintHero(); pushCard(true);
}

export function formatListened(sec) {
  const m = Math.floor(sec / 60);
  if (m < 60) return { value: m, unit: plural(m, 'минута', 'минуты', 'минут') };
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return { value: hh, unit: `${plural(hh, 'час', 'часа', 'часов')}${mm ? ` ${mm} мин` : ''}` };
}

function countTo(el, target) {
  const from = Number(el.dataset.v || 0);
  el.dataset.v = String(target);
  if (from === target || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = String(target); return; }
  const t0 = performance.now();
  const dur = 700;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const eased = 1 - (1 - k) ** 3;
    el.textContent = String(Math.round(from + (target - from) * eased));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function statCard(key, label, ic) {
  const num = h('span', { class: 'stat-num', text: '0' });
  const unit = h('span', { class: 'stat-unit' });
  refs[key] = { num, unit };
  return h('div', { class: 'stat-card' },
    h('div', { class: 'stat-ico m' }, mi(ic)),
    h('div', { class: 'stat-val' }, num, unit),
    h('div', { class: 'stat-label', text: label }));
}

function swatch(id, name, hue, onclick) {
  return h('button', { class: `swatch${id === 'mono' ? ' mono' : ''}`, type: 'button', 'data-id': id, style: `--h:${hue}`, 'aria-label': name, onclick },
    h('span', { class: 'sw-prev' }, h('i'), h('i'), h('i'), h('b', {}, mi('check'))),
    h('span', { class: 'sw-name', text: name }));
}

function syncControls() {
  $$('.theme-card').forEach((c) => c.classList.toggle('active', c.dataset.mode === getTheme()));
  $$('.src-chip').forEach((c) => c.classList.toggle('active', c.dataset.id === getSourceMode()));
  if (refs.srcnote) refs.srcnote.textContent = `iTunes: работает · YouTube: ${!youtubeEnabled() ? 'нет ключа' : youtubeQuotaOut() ? 'лимит на сегодня исчерпан' : 'работает'} · Audius: ${audiusEnabled() ? 'работает' : 'нет ключа'}`;
  const tog = (el, v) => { if (el) { el.classList.toggle('active', v); el.setAttribute('aria-checked', String(v)); } };
  tog(refs.gest, gesturesOn()); tog(refs.voice, voiceOn()); tog(refs.lowp, lowPower()); tog(refs.livebg, liveBg()); tog(refs.board, !hiddenFromBoard());
  $$('.swatch').forEach((c) => c.classList.toggle('active', c.dataset.id === getAccent()));
  if (refs.customSw) {
    const nt = getNeutral();
    refs.customSw.style.setProperty('--h', String(getCustomHue()));
    refs.customSw.classList.toggle('neutral-w', getAccent() === 'custom' && nt === 'w');
    refs.customSw.classList.toggle('neutral-b', getAccent() === 'custom' && nt === 'b');
    refs.customSw.classList.toggle('picked', getAccent() === 'custom');
  }
}

function themeCard(mode, label) {
  const card = h('button', { class: `theme-card tc-${mode}`, type: 'button', 'data-mode': mode, onclick: () => { setTheme(mode); syncControls(); } },
    h('div', { class: 'tc-prev' }, h('i'), h('i'), h('i')),
    h('span', { text: label }));
  return card;
}

function openColorPicker() {
  let hue = getCustomHue();
  const wrap = h('div', { class: 'cp' });
  const prev = h('div', { class: 'cp-prev', text: 'MKW Music' });
  const paint = (hex) => { wrap.style.setProperty('--c', hex); };
  const range = h('input', { class: 'cp-range hue', type: 'range', min: '0', max: '359', value: String(hue), 'aria-label': 'Оттенок' });
  range.addEventListener('input', () => { hue = Number(range.value); paint(hslHex(hue)); });
  range.addEventListener('change', () => { setCustomColor(hslHex(hue)); syncControls(); });
  const quick = [['#ffffff', 'Белый'], ['#1a1a1a', 'Графит'], ['#ff3b5c', ''], ['#ff8a00', ''], ['#ffd400', ''], ['#2bd96b', ''], ['#00c2ff', ''], ['#7a5cff', '']];
  const q = h('div', { class: 'cp-quick' }, quick.map(([hex, name]) => h('button', { type: 'button', style: `--q:${hex}`, title: name || hex, 'aria-label': name || hex, onclick: () => {
    setCustomColor(hex); paint(hex); if (!name) { hue = getCustomHue(); range.value = String(hue); } syncControls();
  } })));
  const done = h('button', { class: 'btn', type: 'button', onclick: () => { if (getAccent() !== 'custom') setCustomColor(hslHex(hue)); syncControls(); closeSheet(); } }, 'Готово');
  paint(getAccent() === 'custom' && getNeutral() ? (getNeutral() === 'w' ? '#ffffff' : '#1a1a1a') : hslHex(hue));
  wrap.append(prev, h('div', { class: 'cp-lbl', text: 'Проведите пальцем по радуге' }), range, h('div', { class: 'cp-lbl', text: 'Быстрый выбор' }), q, done);
  openSheet('Свой цвет', wrap);
}

function changelogEntry(entry, open) {
  const body = [];
  if (entry.new.length) body.push(h('div', { class: 'cl-h', text: 'Новое' }), h('ul', {}, entry.new.map((t) => h('li', { text: t }))));
  if (entry.fixed.length) body.push(h('div', { class: 'cl-h fix', text: 'Исправлено' }), h('ul', {}, entry.fixed.map((t) => h('li', { text: t }))));
  const d = h('details', { class: 'cl' }, h('summary', {}, h('b', { text: `v${entry.version}` }), h('span', { text: entry.date })), ...body);
  if (open) d.open = true;
  return d;
}

const AV = (n) => `mkw.avatar.${n}`;
export function getAvatar(nick) { try { return localStorage.getItem(AV(nick)) || 'mkw-logo.png'; } catch { return 'mkw-logo.png'; } }
function resizeToDataUrl(file, size = 320) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = size;
      const m = Math.min(img.width, img.height), sx = (img.width - m) / 2, sy = (img.height - m) / 2;
      c.getContext('2d').drawImage(img, sx, sy, m, m, 0, 0, size, size);
      URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img')); };
    img.src = url;
  });
}
function avatarMenu(nick) {
  const inp = h('input', { type: 'file', accept: 'image/*', hidden: '' });
  inp.addEventListener('change', async () => {
    const f = inp.files && inp.files[0]; if (!f) return;
    try { const d = await resizeToDataUrl(f); localStorage.setItem(AV(nick), d); refs.avatar.src = d; closeSheet(); toast('Фото обновлено'); pushCard(true); }
    catch { toast('Не получилось загрузить фото'); }
  });
  openSheet('Фото профиля', h('div', {}, inp,
    sheetItem('user', 'Выбрать фото из галереи', () => inp.click()),
    sheetItem('close', 'Вернуть логотип MKW', () => { try { localStorage.removeItem(AV(nick)); } catch { /* ignore */ } refs.avatar.src = 'mkw-logo.png'; closeSheet(); pushCard(true); }, true),
    h('p', { class: 'profile-note', text: 'Фото видно другим слушателям в рейтинге и в вашем профиле (если вы не скрыли себя во вкладке «Слушатели»).' })));
}

// картинка → JPEG нужного размера (обрезка по центру)
function imageTo(srcUrl, w, hgt, q = 0.72) {
  return new Promise((resolve) => {
    if (!srcUrl || !srcUrl.startsWith('data:')) { resolve(''); return; }
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = w; c.height = hgt;
      const k = Math.max(w / img.width, hgt / img.height), sw = w / k, sh = hgt / k;
      c.getContext('2d').drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, w, hgt);
      resolve(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => resolve('');
    img.src = srcUrl;
  });
}
const fileToDataUrl = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });

function statsNow() {
  const p = store.state.profile || {};
  const seen = new Set();
  for (const tr of [...store.state.likes, ...store.state.history]) if (tr.artist) seen.add(tr.artist.toLowerCase());
  const night = store.state.history.some((t) => t.playedAt && new Date(Number(t.playedAt)).getHours() < 5);
  const created = Number(p.createdAt) || 0;
  const c = getCustom();
  return {
    sec: store.listenedTotal(), likes: store.state.likes.length, playlists: store.state.playlists.length,
    plays: Number(p.plays) || store.state.history.length,
    days: created ? Math.max(1, Math.ceil((Date.now() - created) / 86400000)) : 1,
    artists: seen.size, night, styled: Boolean(c.styled), showcase: Boolean(c.favArtists.length || c.favTracks.length), rank: myRank,
  };
}

let pushTimer = 0, lastCardAt = 0;
// бережём бесплатный лимит Firestore: рейтинг пишется не чаще раза в 3 минуты, страница профиля — при изменениях и раз в 15 минут
function pushCard(full) {
  if (full !== true && Date.now() - lastCardAt < 180000) return;
  lastCardAt = Date.now();
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    const c = getCustom(), s = statsNow(), av = getAvatar(curNick);
    const small = await imageTo(av, 72, 72, 0.7);
    publishCard({ nick: curNick, sec: s.sec, plays: s.plays, likes: s.likes, status: c.status, banner: c.bannerImg ? 'img' : c.banner, frame: c.frame, badges: c.badges, avatar: small });
    if (full !== false) {
      publishProfile({
        nick: curNick, status: c.status, banner: c.banner, bannerImg: c.bannerImg, frame: c.frame, badges: c.badges,
        avatar: await imageTo(av, 240, 240, 0.78), favArtists: c.favArtists, favTracks: c.favTracks.map(pickTrack),
        sec: s.sec, plays: s.plays, likes: s.likes, days: s.days, achCount: ACHIEVEMENTS.filter((a) => achDone(a, s)).length,
      });
    }
  }, 1500);
}

function badgeChips(ids) {
  return h('div', { class: 'pbadges' }, (ids || []).filter((id) => ACH[id]).map((id) => h('span', { class: 'pbadge', title: ACH[id].hint }, mi(ACH[id].i), h('b', { text: ACH[id].title }))));
}

function paintHero() {
  if (!refs.hero) return;
  const c = getCustom();
  refs.hero.style.setProperty('--banner', bannerCss(c.banner, c.bannerImg));
  refs.hero.dataset.frame = c.frame;
  refs.status.textContent = c.status || 'Добавьте статус — нажмите «Изменить»';
  refs.status.classList.toggle('st-empty', !c.status);
  refs.heroBadges.replaceChildren(...badgeChips(c.badges).children);
  const has = c.favArtists.length || c.favTracks.length;
  refs.showcase.hidden = !has;
  refs.favA.replaceChildren(...(c.favArtists.length ? [h('div', { class: 'section-title', text: 'Любимые исполнители' }), favArtistsRow(c.favArtists)] : []));
  refs.favT.replaceChildren(...(c.favTracks.length ? [h('div', { class: 'section-title', text: 'Любимые треки' }), favTracksList(c.favTracks)] : []));
}

function topArtists(n = 12) {
  const counts = new Map();
  for (const tr of [...store.state.likes, ...store.state.history]) {
    for (const a of String(tr.artist || '').split(/,|&| feat\.? | ft\.? /i).map((x) => x.trim()).filter(Boolean)) counts.set(a, (counts.get(a) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map((x) => x[0]);
}

function editProfile() {
  const c = getCustom();
  let banner = c.banner, bannerImg = c.bannerImg, frame = c.frame, badges = [...c.badges], favA = [...c.favArtists], favT = [...c.favTracks];
  const st = h('input', { type: 'text', maxlength: '60', class: 'sheet-input', placeholder: 'Статус, например: слушаю ночной вайб', value: c.status });

  const prev = h('div', { class: 'pe-prev' });
  const paintPrev = () => prev.style.setProperty('--b', bannerCss(banner, bannerImg));
  const upl = h('input', { type: 'file', accept: 'image/*', hidden: '' });
  upl.addEventListener('change', async () => {
    const f = upl.files && upl.files[0]; if (!f) return;
    try { bannerImg = await imageTo(await fileToDataUrl(f), 900, 300, 0.72); paintPrev(); paintB(); } catch { toast('Не получилось загрузить картинку'); }
  });
  const bWrap = h('div', { class: 'pe-banners' });
  const paintB = () => bWrap.replaceChildren(
    h('button', { type: 'button', class: `pe-banner own${bannerImg ? ' on' : ''}`, onclick: () => upl.click() }, mi('image'), h('span', { text: bannerImg ? 'Сменить' : 'Своё фото' })),
    ...BANNERS.map((b) => h('button', { type: 'button', class: `pe-banner${!bannerImg && b.id === banner ? ' on' : ''}`, style: `--b:${b.css}`, title: b.name, onclick: () => { banner = b.id; bannerImg = ''; paintB(); paintPrev(); } }, h('span', { text: b.name }))));

  const fWrap = h('div', { class: 'pe-frames' });
  const paintF = () => fWrap.replaceChildren(...FRAMES.map((f) => h('button', { type: 'button', class: `chip${f.id === frame ? ' active' : ''}`, onclick: () => { frame = f.id; paintF(); } }, f.name)));

  const s = statsNow();
  const earned = ACHIEVEMENTS.filter((a) => achDone(a, s));
  const aWrap = h('div', { class: 'pe-badges' });
  const paintA = () => aWrap.replaceChildren(...(earned.length ? earned.map((a) => h('button', { type: 'button', class: `pe-badge${badges.includes(a.id) ? ' on' : ''}`, onclick: () => {
    if (badges.includes(a.id)) badges = badges.filter((x) => x !== a.id);
    else if (badges.length < 3) badges.push(a.id); else toast('Можно закрепить до 3 значков');
    paintA();
  } }, mi(a.i), a.title)) : [h('p', { class: 'profile-note', text: 'Пока нет полученных достижений.' })]));

  // любимые исполнители (до 4)
  const artWrap = h('div', { class: 'pe-badges' });
  const artInput = h('input', { type: 'text', class: 'sheet-input', placeholder: 'Имя исполнителя', maxlength: '80' });
  const addArtist = (name) => {
    name = String(name || '').trim(); if (!name) return;
    if (favA.some((x) => x.toLowerCase() === name.toLowerCase())) { favA = favA.filter((x) => x.toLowerCase() !== name.toLowerCase()); paintArt(); return; }
    if (favA.length >= 4) { toast('Можно выбрать до 4 исполнителей'); return; }
    favA.push(name); paintArt();
  };
  const paintArt = () => {
    const sugg = [...new Set([...favA, ...topArtists(14)])];
    artWrap.replaceChildren(...sugg.map((n) => h('button', { type: 'button', class: `pe-badge${favA.includes(n) ? ' on' : ''}`, onclick: () => addArtist(n) }, mi(favA.includes(n) ? 'check' : 'person'), n)));
  };
  const artAdd = h('div', { class: 'pe-add' }, artInput, h('button', { class: 'btn tonal', type: 'button', onclick: () => { addArtist(artInput.value); artInput.value = ''; } }, 'Добавить'));

  // любимые треки (до 10) из лайков
  const trWrap = h('div', { class: 'pe-tracks' });
  const paintTr = () => {
    const pool = [...favT, ...store.state.likes.filter((t) => !favT.some((x) => x.id === t.id))].slice(0, 40);
    trWrap.replaceChildren(...(pool.length ? pool.map((t) => {
      const on = favT.some((x) => x.id === t.id);
      return h('button', { type: 'button', class: `pe-track${on ? ' on' : ''}`, onclick: () => {
        if (on) favT = favT.filter((x) => x.id !== t.id);
        else if (favT.length >= 10) { toast('Можно выбрать до 10 треков'); return; } else favT.push(pickTrack(t));
        paintTr();
      } }, h('img', { src: t.artwork || 'mkw-logo.png', alt: '', loading: 'lazy' }), h('span', {}, h('b', { text: t.title }), h('small', { text: t.artist })), h('i', {}, mi(on ? 'check' : 'add')));
    }) : [h('p', { class: 'profile-note', text: 'Лайкните треки, и их можно будет добавить сюда.' })]));
  };

  paintB(); paintF(); paintA(); paintArt(); paintTr(); paintPrev();
  const save = h('button', { class: 'btn', type: 'button', onclick: () => {
    setCustom({ status: st.value.trim(), banner, bannerImg, frame, badges, favArtists: favA, favTracks: favT });
    closeSheet(); toast('Профиль обновлён'); updateProfile();
  } }, 'Сохранить');
  openSheet('Мой профиль', h('div', { class: 'pw-form pe' }, upl,
    prev,
    h('div', { class: 'pe-h' }, mi('image'), 'Фон карточки'), bWrap,
    h('button', { class: 'btn tonal', type: 'button', onclick: () => avatarMenu(curNick) }, mi('person'), ' Сменить фото профиля'),
    h('div', { class: 'pe-h' }, mi('edit'), 'Статус'), st,
    h('div', { class: 'pe-h' }, mi('sparkle'), 'Рамка фото'), fWrap,
    h('div', { class: 'pe-h' }, mi('medal'), 'Значки в профиле (до 3)'), aWrap,
    h('div', { class: 'pe-h' }, mi('mic'), 'Любимые исполнители (до 4)'), artWrap, artAdd,
    h('div', { class: 'pe-h' }, mi('star'), 'Любимые треки (до 10)'), trWrap,
    h('div', { class: 'pe-save' }, save)));
}

async function loadBoard(force) {
  if (!refs.board) return;
  if (!force && Date.now() - boardLoaded < 60000) return;
  boardLoaded = Date.now();
  refs.boardList.replaceChildren(...[0, 1, 2, 3].map(() => h('div', { class: 'lb-row sk' })));
  const list = await topListeners(50);
  if (!list) { refs.boardList.replaceChildren(h('p', { class: 'profile-note center', text: 'Рейтинг пока недоступен. Админу нужно обновить правила Firestore (файл firestore.rules).' })); return; }
  const me = myUid();
  myRank = 0;
  list.forEach((u, i) => { if (u.uid === me) myRank = i + 1; });
  if (!list.length) { refs.boardList.replaceChildren(h('p', { class: 'profile-note center', text: 'Пока никого нет. Вы будете первым!' })); return; }
  refs.boardList.replaceChildren(...list.map((u, i) => {
    const t = formatListened(Number(u.sec) || 0);
    return h('button', { type: 'button', class: `lb-row${u.uid === me ? ' me' : ''}${i < 3 ? ` top${i + 1}` : ''}`, style: `--banner:${bannerCss(u.banner === 'img' ? 'accent' : u.banner)};animation-delay:${Math.min(i, 12) * 35}ms`, onclick: () => openUserPage(u.uid, u) },
      h('span', { class: 'lb-rank' }, i < 3 ? mi('medal') : String(i + 1)),
      h('span', { class: 'lb-av', 'data-frame': u.frame || 'none' }, h('img', { src: u.avatar || 'mkw-logo.png', alt: '', loading: 'lazy' })),
      h('div', { class: 'lb-body' },
        h('div', { class: 'lb-nick', text: u.uid === me ? `${u.nick} · вы` : u.nick }),
        u.status ? h('div', { class: 'lb-status', text: u.status }) : null,
        (u.badges || []).length ? h('div', { class: 'lb-badges' }, (u.badges || []).filter((id) => ACH[id]).map((id) => mi(ACH[id].i))) : null),
      h('div', { class: 'lb-time' }, h('b', { text: String(t.value) }), h('small', { text: t.unit })),
      h('span', { class: 'chev', text: '›' }));
  }));
  if (myRank) refs.myRank.textContent = `Ваше место: ${myRank} из ${list.length}`;
  else refs.myRank.textContent = hiddenFromBoard() ? 'Вы скрыты из рейтинга' : 'Вас пока нет в топе. Послушайте ещё!';
  updateAch();
}

function setTab(name) {
  refs.tab = name;
  $$('.ptab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.ppane').forEach((p) => { p.hidden = p.dataset.pane !== name; });
  refs.tabs.style.setProperty('--i', String(['main', 'board', 'set', 'about'].indexOf(name)));
  if (name === 'board') loadBoard();
}

export function buildProfile(nick) {
  curNick = nick;
  const root = $('#view-profile');
  refs.nick = h('div', { class: 'hero-nick', text: nick });
  refs.since = h('div', { class: 'hero-since', text: '' });
  refs.status = h('div', { class: 'hero-status' });
  refs.heroBadges = h('div', { class: 'pbadges' });
  refs.top = h('div', { class: 'top-list' });
  refs.ach = h('div', { class: 'ach-grid' });
  refs.achCount = h('span', { class: 'ach-count' });
  refs.favA = h('div'); refs.favT = h('div');
  refs.showcase = h('div', { class: 'showcase' }, refs.favA, refs.favT);
  const sw = (on) => h('button', { class: 'switch', type: 'button', role: 'switch', onclick: on }, h('i'));
  refs.livebg = sw(() => { setLiveBg(!liveBg()); syncControls(); });
  refs.lowp = sw(() => { setLowPower(!lowPower()); syncControls(); });
  refs.gest = sw(async () => { await setGestures(!gesturesOn()); syncControls(); });
  refs.voice = sw(() => { setVoice(!voiceOn()); syncControls(); });
  refs.board = sw(async () => { await setHidden(!hiddenFromBoard()); syncControls(); if (!hiddenFromBoard()) pushCard(true); setTimeout(() => loadBoard(true), 1800); });
  refs.boardList = h('div', { class: 'lb-list' });
  refs.myRank = h('div', { class: 'lb-me' });
  refs.srcnote = h('small', { class: 'src-note' });
  refs.listeners = h('div', { class: 'listeners' }, mi('headphones'), h('span', { text: 'Слушателей: считаем…' }));
  listenerStats().then((s) => { refs.listeners.lastChild.textContent = s ? `Слушателей: ${s.total} · новых в этом месяце: ${s.month}` : 'Счётчик слушателей пока недоступен'; });
  connectionCountry().then((c) => { if (refs.country) refs.country.textContent = c || 'не удалось определить'; });
  const row = (title, desc, ctrl, onclick, ic) => h('div', { class: `set-row${onclick ? ' tap' : ''}`, onclick },
    ic ? h('span', { class: 'set-ic' }, mi(ic)) : null,
    h('div', { class: 'set-txt' }, h('b', { text: title }), desc ? h('small', { text: desc }) : null), ctrl);
  const group = (title, ...kids) => h('div', { class: 'set-group' }, h('div', { class: 'set-gt', text: title }), h('div', { class: 'set-card' }, ...kids));
  const chev = () => h('span', { class: 'chev', text: '›' });

  refs.hero = h('div', { class: 'phero' },
    h('div', { class: 'phero-banner' }),
    h('div', { class: 'phero-row' },
      h('button', { class: 'hero-avatar', type: 'button', 'aria-label': 'Сменить фото', onclick: () => avatarMenu(nick) }, refs.avatar = h('img', { src: getAvatar(nick), alt: '' })),
      h('div', { class: 'phero-btns' },
        h('button', { class: 'btn tonal phero-edit', type: 'button', onclick: () => openUserPage(myUid(), null, true), title: 'Как видят другие' }, mi('person')),
        h('button', { class: 'btn tonal phero-edit', type: 'button', onclick: editProfile }, mi('edit'), ' Изменить'))),
    h('div', { class: 'phero-info' }, refs.nick, refs.status, refs.since, refs.heroBadges));

  const tabBtn = (id, label, ic) => h('button', { class: 'ptab', type: 'button', 'data-tab': id, onclick: () => setTab(id) }, mi(ic), h('span', { text: label }));
  refs.tabs = h('div', { class: 'ptabs' }, h('i', { class: 'ptab-lens' }), tabBtn('main', 'Обзор', 'person'), tabBtn('board', 'Слушатели', 'group'), tabBtn('set', 'Настройки', 'palette'), tabBtn('about', 'О MKW', 'note'));

  root.replaceChildren(
    refs.hero,
    refs.tabs,
    h('div', { class: 'ppane', 'data-pane': 'main' },
      h('div', { class: 'stats-grid' },
        statCard('time', 'Прослушано', 'timer'), statCard('plays', 'Треков сыграно', 'play-circle'),
        statCard('likes', 'В избранном', 'heart'), statCard('playlists', 'Плейлистов', 'playlist')),
      refs.showcase,
      h('div', { class: 'section-title', text: 'Чаще всего слушаете' }), refs.top,
      h('div', { class: 'section-title' }, 'Достижения ', refs.achCount), refs.ach),
    h('div', { class: 'ppane', 'data-pane': 'board', hidden: '' },
      h('div', { class: 'lb-head' }, h('div', { class: 'lb-hic' }, mi('trophy')), h('div', {}, h('b', { text: 'Топ слушателей' }), h('small', { text: 'По времени прослушивания. Нажмите на человека, чтобы открыть профиль' }))),
      refs.myRank, refs.boardList,
      h('div', { class: 'set-card', style: 'margin-top:14px' }, row('Показывать меня в рейтинге', 'Ник, фото, баннер, статус, значки, витрина и часы видят другие слушатели', refs.board, null, 'group'))),
    h('div', { class: 'ppane', 'data-pane': 'set', hidden: '' },
      group('Внешний вид',
        h('div', { class: 'set-block' }, h('b', { text: 'Тема' }),
          h('div', { class: 'theme-cards' }, themeCard('auto', 'Авто'), themeCard('light', 'Светлая'), themeCard('dark', 'Тёмная'), themeCard('black', 'Чёрная'))),
        h('div', { class: 'set-block' }, h('b', { text: 'Цвет акцента' }),
          h('div', { class: 'swatch-row' }, ACCENTS.map((a) => swatch(a.id, a.name, a.h, () => { setAccent(a.id); syncControls(); })),
            refs.customSw = h('button', { class: 'swatch custom', type: 'button', 'data-id': 'custom', 'aria-label': 'Свой цвет', onclick: openColorPicker },
              h('span', { class: 'sw-prev' }, h('i'), h('i'), h('i'), h('b', {}, mi('palette'))), h('span', { class: 'sw-name', text: 'Свой' })))),
        row('Живой фон плеера', 'Цвета обложки двигаются в такт', refs.livebg, null, 'sparkle')),
      group('Музыка',
        h('div', { class: 'set-block' }, h('b', { text: 'Где искать музыку' }),
          h('div', { class: 'src-row' }, SOURCE_MODES.map((m) => h('button', { class: 'chip src-chip', type: 'button', 'data-id': m.id, onclick: () => { setSourceMode(m.id); syncControls(); } }, m.name))),
          refs.srcnote),
        row('Страна подключения', 'С VPN покажет страну VPN', refs.country = h('span', { class: 'conn-country', text: '…' }), null, 'globe'),
        h('div', { class: 'vpn-note' }, h('span', { class: 'set-ic' }, mi('shield')), h('div', {}, h('b', { text: 'Нет звука или обложек из России?' }), h('small', { text: 'Провайдеры блокируют часть музыкальных серверов. Включите любой VPN, и всё заработает.' })))),
      group('Устройство',
        row('Оптимизация для слабых устройств', 'Отключает размытие и тяжёлые анимации', refs.lowp, null, 'rocket'),
        row('Жесты (бета)', 'Управление рукой через камеру', refs.gest, null, 'hand-open'),
        row('Какие жесты показывать', 'Список жестов и что они делают', chev(), showGestureGuide, 'hand-peace'),
        row('Голосовое управление (бета)', voiceSupported() ? '«MKW, следующая», «MKW, громче», «MKW, лайк»' : 'Этот браузер не поддерживает', refs.voice, null, 'mic'),
        row('Какие команды говорить', 'Все голосовые команды', chev(), showVoiceGuide, 'note')),
      group('Аккаунт',
        row('Изменить профиль', 'Фото, баннер, статус, витрина', chev(), editProfile, 'edit'),
        row('Сменить ник', 'Имя в приложении и вход', chev(), openNickSheet, 'person'),
        row('Сменить пароль', '', chev(), openPasswordSheet, 'shield'),
        row('Выйти', '', h('span', { class: 'chev' }, icon('logout')), () => logOut()))),
    h('div', { class: 'ppane', 'data-pane': 'about', hidden: '' },
      h('div', { class: 'about-card' },
        h('div', { class: 'about-top' }, h('img', { src: 'mkw-logo.png', alt: '', class: 'about-logo' }), h('div', {}, h('b', { text: 'MKW Music' }), h('span', { class: 'beta-badge', text: `${STAGE} · v${VERSION}` }))),
        refs.listeners,
        h('p', { class: 'profile-note', text: 'MKW Music — название сервиса. MiloKwel — его создатель: он делает все обновления и разработку. Бета-версия: что-то может ломаться, всё чиним.' }),
        CHANGELOG.map((e, i) => changelogEntry(e, i === 0)),
        h('div', { class: 'cl-h warn', text: 'Известные проблемы' }),
        h('ul', {}, KNOWN_ISSUES.map((t) => h('li', { text: t }))))));

  built = true;
  setTab(refs.tab || 'main');
  paintHero();
  syncControls();
  updateProfile();
  setTimeout(() => pushCard(true), 5000);
  if (!restored) {
    restored = true;
    // на новом устройстве подтягиваем оформление профиля с сервера
    let local = null; try { local = localStorage.getItem(CKEY(curNick)); } catch { /* ignore */ }
    if (!local) {
      getProfile(myUid()).then((p) => {
        if (!p) return myCard().then((c) => c && setLocal(c));
        setLocal(p);
        if (p.avatar && getAvatar(curNick).startsWith('')) { try { localStorage.setItem(AV(curNick), p.avatar); refs.avatar.src = p.avatar; } catch { /* ignore */ } }
        return null;
      });
    }
  }
}
function setLocal(p) {
  try { localStorage.setItem(CKEY(curNick), JSON.stringify({ ...DEF, status: p.status || '', banner: p.banner && p.banner !== 'img' ? p.banner : 'accent', bannerImg: p.bannerImg || '', frame: p.frame || 'glow', badges: p.badges || [], favArtists: p.favArtists || [], favTracks: p.favTracks || [], styled: true })); } catch { /* ignore */ }
  paintHero();
}

function updateAch() {
  const s = statsNow();
  let got = 0;
  refs.ach.replaceChildren(...ACHIEVEMENTS.map((a) => {
    const ok = achDone(a, s); if (ok) got += 1;
    const v = a.v ? a.v(s) : null;
    const pr = v ? Math.min(1, v[0] / v[1]) : (ok ? 1 : 0);
    return h('div', { class: `ach${ok ? ' on' : ''}`, title: a.hint },
      h('div', { class: 'ach-ico m' }, mi(a.i)),
      h('div', { class: 'ach-t', text: a.title }),
      h('div', { class: 'ach-h', text: ok ? 'Получено' : v ? `${a.hint} · ${Math.min(v[0], v[1])}/${v[1]}` : a.hint }),
      ok ? null : h('div', { class: 'ach-bar' }, h('i', { style: `width:${Math.round(pr * 100)}%` })));
  }));
  refs.achCount.textContent = `${got} из ${ACHIEVEMENTS.length}`;
}

export function updateProfile() {
  if (!built) return;
  const s = statsNow();
  const t = formatListened(s.sec);
  countTo(refs.time.num, t.value);
  refs.time.unit.textContent = ` ${t.unit}`;
  countTo(refs.plays.num, s.plays);
  countTo(refs.likes.num, s.likes);
  countTo(refs.playlists.num, s.playlists);
  refs.since.textContent = `С нами ${s.days} ${plural(s.days, 'день', 'дня', 'дней')}`;

  const top = topArtists(5);
  const counts = new Map();
  for (const tr of [...store.state.likes, ...store.state.history]) if (tr.artist) counts.set(tr.artist, (counts.get(tr.artist) || 0) + 1);
  if (!top.length) refs.top.replaceChildren(h('p', { class: 'profile-note', text: 'Послушайте пару треков, и здесь появится ваш топ.' }));
  else if (refs.top.dataset.sig !== top.join('|')) {
    refs.top.dataset.sig = top.join('|');
    refs.top.replaceChildren(...top.map((name, i) => {
      const img = h('img', { alt: '', loading: 'lazy' });
      artistPic(name).then((p) => { if (p && p.picture) { img.src = p.picture; img.parentNode.classList.add('ok'); } });
      return h('button', { type: 'button', class: 'top-row', onclick: () => openArtist(name) },
        h('span', { class: 'top-rank', text: String(i + 1) }),
        h('span', { class: 'top-av' }, img, mi('person')),
        h('div', { class: 'top-body' }, h('div', { class: 'top-name', text: name })),
        h('span', { class: 'chev', text: '›' }));
    }));
  }
  updateAch();
  pushCard(false);
}

export function resetProfile() {
  built = false; restored = false; boardLoaded = 0; refs.tab = 'main';
}

setInterval(() => { if (built) pushCard(true); }, 900000);
setInterval(() => { if (built && !$('#view-profile').hidden) updateProfile(); }, 10000);

function openPasswordSheet() {
  const cur = h('input', { type: 'password', placeholder: 'Текущий пароль (можно пусто)', autocomplete: 'current-password', class: 'sheet-input' });
  const nxt = h('input', { type: 'password', placeholder: 'Новый пароль (от 6 символов)', autocomplete: 'new-password', class: 'sheet-input' });
  const err = h('div', { class: 'sheet-note' });
  const btn = h('button', { class: 'btn', type: 'button' }, 'Сохранить');
  btn.addEventListener('click', async () => {
    err.textContent = '';
    btn.disabled = true;
    try {
      await changePassword(cur.value, nxt.value);
      closeSheet();
      toast('Пароль изменён');
    } catch (e) {
      err.textContent = e.userText || authErrorText(e);
    } finally { btn.disabled = false; }
  });
  openSheet('Смена пароля', h('div', { class: 'pw-form' }, cur, nxt, err, btn));
}

function openNickSheet() {
  const nk = h('input', { type: 'text', placeholder: 'Новый ник (латиница и цифры)', autocomplete: 'off', autocapitalize: 'none', class: 'sheet-input' });
  const pw = h('input', { type: 'password', placeholder: 'Текущий пароль', autocomplete: 'current-password', class: 'sheet-input' });
  const err = h('div', { class: 'sheet-note' });
  const btn = h('button', { class: 'btn', type: 'button' }, 'Сохранить');
  btn.addEventListener('click', async () => {
    err.textContent = '';
    btn.disabled = true;
    try {
      const r = await changeNick(nk.value, pw.value);
      closeSheet();
      toast(r.loginChanged ? 'Ник изменён. Входите по новому нику' : 'Имя изменено. Вход остаётся по прежнему нику');
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      err.textContent = e.userText || authErrorText(e);
    } finally { btn.disabled = false; }
  });
  openSheet('Смена ника', h('div', { class: 'pw-form' }, nk, pw, err, btn));
}
