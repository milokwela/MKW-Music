// Экран «Профиль»: карточка с баннером и значками, вкладки Обзор / Слушатели / Настройки / О MKW.
import { $, $$, h, icon, openSheet, closeSheet, toast, sheetItem } from './ui.js?v=0.16.0';
import * as store from './store.js?v=0.16.0';
import { ACCENTS, getTheme, getAccent, getCustomHue, setCustomColor, setTheme, setAccent, hslHex, getNeutral } from './theme.js?v=0.16.0';
import { CHANGELOG, VERSION, STAGE, KNOWN_ISSUES } from './changelog.js?v=0.16.0';
import { plural } from './utils.js?v=0.16.0';
import { youtubeEnabled, youtubeQuotaOut } from './youtube.js?v=0.16.0';
import { audiusEnabled } from './audius.js?v=0.16.0';
import { SOURCE_MODES, getSourceMode, setSourceMode } from './sources.js?v=0.16.0';
import { gesturesOn, setGestures, showGestureGuide } from './gestures.js?v=0.16.0';
import { listenerStats } from './stats.js?v=0.16.0';
import { liveBg, setLiveBg } from './viz.js?v=0.16.0';
import { lowPower, setLowPower } from './perf.js?v=0.16.0';
import { logOut, changePassword, changeNick, authErrorText } from './auth.js?v=0.16.0';
import { connectionCountry } from './geo.js?v=0.16.0';
import { publishCard, myCard, topListeners, hiddenFromBoard, setHidden, myUid } from './leaders.js?v=0.16.0';

// s: sec, likes, playlists, plays, days, artists, night, styled
const ACHIEVEMENTS = [
  { id: 'like1', e: '❤️', title: 'Первый лайк', hint: 'Лайкните любой трек', ok: (s) => s.likes >= 1 },
  { id: 'like10', e: '💕', title: 'Коллекционер', hint: '10 лайков', v: (s) => [s.likes, 10] },
  { id: 'like50', e: '💖', title: 'Сердцеед', hint: '50 лайков', v: (s) => [s.likes, 50] },
  { id: 'like100', e: '💘', title: 'Фанат', hint: '100 лайков', v: (s) => [s.likes, 100] },
  { id: 'pl1', e: '📁', title: 'Составитель', hint: 'Создайте плейлист', ok: (s) => s.playlists >= 1 },
  { id: 'pl5', e: '🗂️', title: 'Куратор', hint: '5 плейлистов', v: (s) => [s.playlists, 5] },
  { id: 'h1', e: '⏱️', title: 'Час музыки', hint: 'Послушайте 1 час', v: (s) => [Math.floor(s.sec / 3600), 1] },
  { id: 'h10', e: '🎧', title: 'Меломан', hint: '10 часов музыки', v: (s) => [Math.floor(s.sec / 3600), 10] },
  { id: 'h24', e: '🌗', title: 'Сутки в наушниках', hint: '24 часа музыки', v: (s) => [Math.floor(s.sec / 3600), 24] },
  { id: 'h100', e: '🏆', title: 'Легенда', hint: '100 часов музыки', v: (s) => [Math.floor(s.sec / 3600), 100] },
  { id: 'p50', e: '▶️', title: 'Разогрев', hint: '50 треков', v: (s) => [s.plays, 50] },
  { id: 'p250', e: '🔥', title: 'В ритме', hint: '250 треков', v: (s) => [s.plays, 250] },
  { id: 'p1000', e: '🚀', title: 'Тысячник', hint: '1000 треков', v: (s) => [s.plays, 1000] },
  { id: 'd7', e: '📅', title: 'Неделя с MKW', hint: '7 дней с нами', v: (s) => [s.days, 7] },
  { id: 'd30', e: '🗓️', title: 'Месяц с MKW', hint: '30 дней с нами', v: (s) => [s.days, 30] },
  { id: 'd100', e: '💎', title: 'Старожил', hint: '100 дней с нами', v: (s) => [s.days, 100] },
  { id: 'a10', e: '🎤', title: 'Открыватель', hint: '10 разных исполнителей', v: (s) => [s.artists, 10] },
  { id: 'a40', e: '🌍', title: 'Путешественник', hint: '40 разных исполнителей', v: (s) => [s.artists, 40] },
  { id: 'night', e: '🌙', title: 'Полуночник', hint: 'Музыка между 0:00 и 5:00', ok: (s) => s.night },
  { id: 'style', e: '✨', title: 'Стиляга', hint: 'Настройте свой профиль', ok: (s) => s.styled },
  { id: 'top3', e: '🥇', title: 'Топ-3', hint: 'Войдите в тройку слушателей', ok: (s) => s.rank > 0 && s.rank <= 3 },
];
const achDone = (a, s) => (a.ok ? a.ok(s) : a.v(s)[0] >= a.v(s)[1]);
const ACH = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

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
const bannerCss = (id) => (BANNERS.find((b) => b.id === id) || BANNERS[0]).css;

let built = false, curNick = '', boardLoaded = 0, myRank = 0, restored = false;
const refs = {};

const CKEY = (n) => `mkw.pcustom.${n}`;
function getCustom() {
  try { return { status: '', banner: 'accent', frame: 'glow', badges: [], ...JSON.parse(localStorage.getItem(CKEY(curNick)) || '{}') }; }
  catch { return { status: '', banner: 'accent', frame: 'glow', badges: [] }; }
}
function setCustom(patch) {
  const c = { ...getCustom(), ...patch, styled: true };
  try { localStorage.setItem(CKEY(curNick), JSON.stringify(c)); } catch { /* ignore */ }
  paintHero(); pushCard();
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

function statCard(key, label, emoji) {
  const num = h('span', { class: 'stat-num', text: '0' });
  const unit = h('span', { class: 'stat-unit' });
  refs[key] = { num, unit };
  return h('div', { class: 'stat-card' },
    h('div', { class: 'stat-ico e', text: emoji }),
    h('div', { class: 'stat-val' }, num, unit),
    h('div', { class: 'stat-label', text: label }));
}

function themeCard(mode, label) {
  const card = h('button', { class: `theme-card tc-${mode}`, type: 'button', 'data-mode': mode, onclick: () => { setTheme(mode); syncControls(); } },
    h('div', { class: 'tc-prev' }, h('i'), h('i'), h('i')),
    h('span', { text: label }));
  return card;
}

function syncControls() {
  $$('.theme-card').forEach((c) => c.classList.toggle('active', c.dataset.mode === getTheme()));
  $$('.src-chip').forEach((c) => c.classList.toggle('active', c.dataset.id === getSourceMode()));
  if (refs.srcnote) refs.srcnote.textContent = `iTunes: работает · YouTube: ${!youtubeEnabled() ? 'нет ключа' : youtubeQuotaOut() ? 'лимит на сегодня исчерпан' : 'работает'} · Audius: ${audiusEnabled() ? 'работает' : 'нет ключа'}`;
  const tog = (el, v) => { if (el) { el.classList.toggle('active', v); el.setAttribute('aria-checked', String(v)); } };
  tog(refs.gest, gesturesOn()); tog(refs.lowp, lowPower()); tog(refs.livebg, liveBg()); tog(refs.board, !hiddenFromBoard());
  $$('.accent-dot').forEach((c) => c.classList.toggle('active', c.dataset.id === getAccent()));
  if (refs.customDot) refs.customDot.style.setProperty('--dot', getNeutral() === 'w' ? '#f2f2f2' : getNeutral() === 'b' ? '#2a2a2a' : hslHex(getCustomHue()));
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
    try { const d = await resizeToDataUrl(f); localStorage.setItem(AV(nick), d); refs.avatar.src = d; closeSheet(); toast('Фото обновлено'); pushCard(); }
    catch { toast('Не получилось загрузить фото'); }
  });
  openSheet('Фото профиля', h('div', {}, inp,
    sheetItem('user', 'Выбрать фото из галереи', () => inp.click()),
    sheetItem('close', 'Вернуть логотип MKW', () => { try { localStorage.removeItem(AV(nick)); } catch { /* ignore */ } refs.avatar.src = 'mkw-logo.png'; closeSheet(); pushCard(); }, true),
    h('p', { class: 'profile-note', text: 'Фото хранится только на этом устройстве и никуда не отправляется.' })));
}

function smallAvatar() {
  return new Promise((resolve) => {
    const src = getAvatar(curNick);
    if (!src.startsWith('data:')) { resolve(''); return; }
    const img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 72; c.getContext('2d').drawImage(img, 0, 0, 72, 72); resolve(c.toDataURL('image/jpeg', 0.7)); };
    img.onerror = () => resolve('');
    img.src = src;
  });
}

function statsNow() {
  const p = store.state.profile || {};
  const seen = new Set();
  for (const tr of [...store.state.likes, ...store.state.history]) if (tr.artist) seen.add(tr.artist.toLowerCase());
  const night = store.state.history.some((t) => { const d = new Date(Number(t.playedAt) || 0); return t.playedAt && d.getHours() < 5; });
  const created = Number(p.createdAt) || 0;
  return {
    sec: store.listenedTotal(), likes: store.state.likes.length, playlists: store.state.playlists.length,
    plays: Number(p.plays) || store.state.history.length,
    days: created ? Math.max(1, Math.ceil((Date.now() - created) / 86400000)) : 1,
    artists: seen.size, night, styled: Boolean(getCustom().styled), rank: myRank,
  };
}

let pushTimer = 0;
function pushCard() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    const c = getCustom(), s = statsNow();
    publishCard({ nick: curNick, sec: s.sec, plays: s.plays, likes: s.likes, status: c.status, banner: c.banner, frame: c.frame, badges: c.badges, avatar: await smallAvatar() });
  }, 1500);
}

function badgeChips(ids) {
  return h('div', { class: 'pbadges' }, (ids || []).filter((id) => ACH[id]).map((id) => h('span', { class: 'pbadge', title: ACH[id].title }, ACH[id].e, h('b', { text: ACH[id].title }))));
}

function paintHero() {
  if (!refs.hero) return;
  const c = getCustom();
  refs.hero.style.setProperty('--banner', bannerCss(c.banner));
  refs.hero.dataset.frame = c.frame;
  refs.status.textContent = c.status || 'Нажмите «Изменить», чтобы добавить статус';
  refs.status.classList.toggle('st-empty', !c.status);
  refs.heroBadges.replaceChildren(...badgeChips(c.badges).children);
}

function editProfile() {
  const c = getCustom();
  let banner = c.banner, frame = c.frame, badges = [...c.badges];
  const st = h('input', { type: 'text', maxlength: '60', class: 'sheet-input', placeholder: 'Статус, например: слушаю ночной вайб 🌙', value: c.status });
  const bWrap = h('div', { class: 'pe-banners' });
  const paintB = () => bWrap.replaceChildren(...BANNERS.map((b) => h('button', { type: 'button', class: `pe-banner${b.id === banner ? ' on' : ''}`, style: `--b:${b.css}`, title: b.name, onclick: () => { banner = b.id; paintB(); } }, h('span', { text: b.name }))));
  const fWrap = h('div', { class: 'pe-frames' });
  const paintF = () => fWrap.replaceChildren(...FRAMES.map((f) => h('button', { type: 'button', class: `chip${f.id === frame ? ' active' : ''}`, onclick: () => { frame = f.id; paintF(); } }, f.name)));
  const s = statsNow();
  const earned = ACHIEVEMENTS.filter((a) => achDone(a, s));
  const aWrap = h('div', { class: 'pe-badges' });
  const paintA = () => aWrap.replaceChildren(...(earned.length ? earned.map((a) => h('button', { type: 'button', class: `pe-badge${badges.includes(a.id) ? ' on' : ''}`, onclick: () => {
    if (badges.includes(a.id)) badges = badges.filter((x) => x !== a.id);
    else if (badges.length < 3) badges.push(a.id); else toast('Можно закрепить до 3 значков');
    paintA();
  } }, h('span', { class: 'e', text: a.e }), a.title)) : [h('p', { class: 'profile-note', text: 'Пока нет полученных достижений. Слушайте музыку, и они появятся.' })]));
  paintB(); paintF(); paintA();
  const save = h('button', { class: 'btn', type: 'button', onclick: () => { setCustom({ status: st.value.trim(), banner, frame, badges }); closeSheet(); toast('Профиль обновлён'); updateProfile(); } }, 'Сохранить');
  openSheet('Мой профиль', h('div', { class: 'pw-form pe' },
    h('b', { class: 'pe-h', text: 'Статус' }), st,
    h('b', { class: 'pe-h', text: 'Фон карточки' }), bWrap,
    h('b', { class: 'pe-h', text: 'Рамка фото' }), fWrap,
    h('b', { class: 'pe-h', text: 'Значки в профиле (до 3)' }), aWrap,
    h('button', { class: 'btn tonal', type: 'button', onclick: () => avatarMenu(curNick) }, 'Сменить фото'),
    save));
}

async function loadBoard(force) {
  if (!refs.board) return;
  if (!force && Date.now() - boardLoaded < 60000) return;
  boardLoaded = Date.now();
  refs.boardList.replaceChildren(h('p', { class: 'profile-note center', text: 'Загружаю рейтинг…' }));
  const list = await topListeners(50);
  if (!list) { refs.boardList.replaceChildren(h('p', { class: 'profile-note center', text: 'Рейтинг пока недоступен. Админу нужно обновить правила Firestore (файл firestore.rules).' })); return; }
  const me = myUid();
  myRank = 0;
  list.forEach((u, i) => { if (u.uid === me) myRank = i + 1; });
  if (!list.length) { refs.boardList.replaceChildren(h('p', { class: 'profile-note center', text: 'Пока никого нет. Вы будете первым!' })); return; }
  refs.boardList.replaceChildren(...list.map((u, i) => {
    const t = formatListened(Number(u.sec) || 0);
    return h('div', { class: `lb-row${u.uid === me ? ' me' : ''}${i < 3 ? ` top${i + 1}` : ''}`, style: `--banner:${bannerCss(u.banner)}` },
      h('span', { class: 'lb-rank', text: i < 3 ? ['🥇', '🥈', '🥉'][i] : String(i + 1) }),
      h('span', { class: 'lb-av', 'data-frame': u.frame || 'none' }, h('img', { src: u.avatar || 'mkw-logo.png', alt: '' })),
      h('div', { class: 'lb-body' },
        h('div', { class: 'lb-nick', text: u.uid === me ? `${u.nick} · вы` : u.nick }),
        u.status ? h('div', { class: 'lb-status', text: u.status }) : null,
        (u.badges || []).length ? h('div', { class: 'lb-badges', text: u.badges.filter((id) => ACH[id]).map((id) => ACH[id].e).join(' ') }) : null),
      h('div', { class: 'lb-time' }, h('b', { text: String(t.value) }), h('small', { text: t.unit })));
  }));
  if (myRank) refs.myRank.textContent = `Ваше место: ${myRank} из ${list.length}`;
  else refs.myRank.textContent = hiddenFromBoard() ? 'Вы скрыты из рейтинга' : 'Вас пока нет в топе. Послушайте ещё!';
  updateAch();
}

function setTab(name) {
  refs.tab = name;
  $$('.ptab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.ppane').forEach((p) => { p.hidden = p.dataset.pane !== name; });
  const i = ['main', 'board', 'set', 'about'].indexOf(name);
  refs.tabs.style.setProperty('--i', String(i));
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
  const sw = (on) => h('button', { class: 'switch', type: 'button', role: 'switch', onclick: on }, h('i'));
  refs.livebg = sw(() => { setLiveBg(!liveBg()); syncControls(); });
  refs.lowp = sw(() => { setLowPower(!lowPower()); syncControls(); });
  refs.gest = sw(async () => { await setGestures(!gesturesOn()); syncControls(); });
  refs.board = sw(async () => { await setHidden(!hiddenFromBoard()); syncControls(); if (!hiddenFromBoard()) pushCard(); setTimeout(() => loadBoard(true), 1800); });
  refs.boardList = h('div', { class: 'lb-list' });
  refs.myRank = h('div', { class: 'lb-me' });
  refs.srcnote = h('small', { class: 'src-note' });
  refs.listeners = h('div', { class: 'listeners', text: 'Слушателей: считаем…' });
  listenerStats().then((s) => { refs.listeners.textContent = s ? `🎧 Слушателей: ${s.total} · в этом месяце новых: ${s.month}` : '🎧 Счётчик слушателей пока недоступен'; });
  connectionCountry().then((c) => { if (refs.country) refs.country.textContent = c || 'не удалось определить'; });
  const row = (title, desc, ctrl, onclick) => h('div', { class: `set-row${onclick ? ' tap' : ''}`, onclick },
    h('div', { class: 'set-txt' }, h('b', { text: title }), desc ? h('small', { text: desc }) : null), ctrl);
  const group = (title, ...kids) => h('div', { class: 'set-group' }, h('div', { class: 'set-gt', text: title }), h('div', { class: 'set-card' }, ...kids));
  const chev = () => h('span', { class: 'chev', text: '›' });

  refs.hero = h('div', { class: 'phero' },
    h('div', { class: 'phero-banner' }),
    h('div', { class: 'phero-row' },
      h('button', { class: 'hero-avatar', type: 'button', 'aria-label': 'Сменить фото', onclick: () => avatarMenu(nick) }, refs.avatar = h('img', { src: getAvatar(nick), alt: '' })),
      h('button', { class: 'btn tonal phero-edit', type: 'button', onclick: editProfile }, '✏️ Изменить')),
    h('div', { class: 'phero-info' }, refs.nick, refs.status, refs.since, refs.heroBadges));

  const tabBtn = (id, label) => h('button', { class: 'ptab', type: 'button', 'data-tab': id, onclick: () => setTab(id) }, label);
  refs.tabs = h('div', { class: 'ptabs' }, h('i', { class: 'ptab-lens' }), tabBtn('main', 'Обзор'), tabBtn('board', 'Слушатели'), tabBtn('set', 'Настройки'), tabBtn('about', 'О MKW'));

  root.replaceChildren(
    refs.hero,
    refs.tabs,
    h('div', { class: 'ppane', 'data-pane': 'main' },
      h('div', { class: 'stats-grid' },
        statCard('time', 'Прослушано', '⏱️'), statCard('plays', 'Треков сыграно', '▶️'),
        statCard('likes', 'В избранном', '❤️'), statCard('playlists', 'Плейлистов', '📁')),
      h('div', { class: 'section-title', text: 'Любимые исполнители' }), refs.top,
      h('div', { class: 'section-title' }, 'Достижения ', refs.achCount), refs.ach),
    h('div', { class: 'ppane', 'data-pane': 'board', hidden: '' },
      h('div', { class: 'lb-head' }, h('b', { text: '🏆 Топ слушателей' }), h('small', { text: 'По времени прослушивания. Обновляется раз в минуту' })),
      refs.myRank, refs.boardList,
      h('div', { class: 'set-card', style: 'margin-top:14px' }, row('Показывать меня в рейтинге', 'Ник, статус, значки, часы и маленькое фото видят другие слушатели', refs.board))),
    h('div', { class: 'ppane', 'data-pane': 'set', hidden: '' },
      group('Внешний вид',
        h('div', { class: 'set-block' }, h('b', { text: 'Тема' }),
          h('div', { class: 'theme-cards' }, themeCard('auto', 'Авто'), themeCard('light', 'Светлая'), themeCard('dark', 'Тёмная'), themeCard('black', 'Чёрная'))),
        h('div', { class: 'set-block' }, h('b', { text: 'Цвет' }),
          h('div', { class: 'accent-row' }, ACCENTS.map((a) => h('button', {
            class: 'accent-dot', type: 'button', 'data-id': a.id, 'aria-label': a.name, title: a.name,
            style: `--dot:hsl(${a.h} 80% 62%)`, onclick: () => { setAccent(a.id); syncControls(); },
          })).concat([refs.customDot = h('button', { class: 'accent-dot custom', type: 'button', 'data-id': 'custom', title: 'Свой цвет', 'aria-label': 'Свой цвет', onclick: openColorPicker }, '+')]))),
        row('Живой фон плеера', 'Цвета обложки двигаются в такт', refs.livebg)),
      group('Музыка',
        h('div', { class: 'set-block' }, h('b', { text: 'Где искать музыку' }),
          h('div', { class: 'src-row' }, SOURCE_MODES.map((m) => h('button', { class: 'chip src-chip', type: 'button', 'data-id': m.id, onclick: () => { setSourceMode(m.id); syncControls(); } }, m.name))),
          refs.srcnote),
        row('Страна подключения', 'С VPN покажет страну VPN', refs.country = h('span', { class: 'conn-country', text: '…' })),
        h('div', { class: 'vpn-note' }, h('span', { text: '🛡️' }), h('div', {}, h('b', { text: 'Нет звука или обложек из России?' }), h('small', { text: 'Провайдеры блокируют часть музыкальных серверов. Включите любой VPN, и всё заработает.' })))),
      group('Устройство',
        row('Оптимизация для слабых устройств', 'Отключает размытие и тяжёлые анимации', refs.lowp),
        row('Жесты (бета)', 'Управление рукой через камеру', refs.gest),
        row('Какие жесты показывать', '✌️ 🤟 👍 👎 ✋ ☝️ ✊', chev(), showGestureGuide)),
      group('Аккаунт',
        row('Изменить профиль', 'Статус, фон, рамка, значки', chev(), editProfile),
        row('Сменить ник', 'Имя в приложении и вход', chev(), openNickSheet),
        row('Сменить пароль', '', chev(), openPasswordSheet),
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
  if (!restored) {
    restored = true;
    myCard().then((c) => {
      if (!c) return;
      let local = null; try { local = localStorage.getItem(CKEY(curNick)); } catch { /* ignore */ }
      if (!local) { try { localStorage.setItem(CKEY(curNick), JSON.stringify({ status: c.status || '', banner: c.banner || 'accent', frame: c.frame || 'glow', badges: c.badges || [], styled: true })); } catch { /* ignore */ } paintHero(); }
    });
  }
}

function updateAch() {
  const s = statsNow();
  let got = 0;
  refs.ach.replaceChildren(...ACHIEVEMENTS.map((a) => {
    const ok = achDone(a, s); if (ok) got += 1;
    const pr = a.v ? Math.min(1, a.v(s)[0] / a.v(s)[1]) : (ok ? 1 : 0);
    return h('div', { class: `ach${ok ? ' on' : ''}`, title: a.hint },
      h('div', { class: 'ach-ico e', text: a.e }),
      h('div', { class: 'ach-t', text: a.title }),
      h('div', { class: 'ach-h', text: ok ? 'Получено' : a.v ? `${a.hint} · ${Math.min(a.v(s)[0], a.v(s)[1])}/${a.v(s)[1]}` : a.hint }),
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

  const counts = new Map();
  for (const tr of [...store.state.likes, ...store.state.history]) if (tr.artist) counts.set(tr.artist, (counts.get(tr.artist) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!top.length) refs.top.replaceChildren(h('p', { class: 'profile-note', text: 'Послушайте пару треков, и здесь появится ваш топ.' }));
  else {
    const max = top[0][1];
    refs.top.replaceChildren(...top.map(([name, n], i) => h('div', { class: 'top-row' },
      h('span', { class: 'top-rank', text: String(i + 1) }),
      h('div', { class: 'top-body' }, h('div', { class: 'top-name', text: name }),
        h('div', { class: 'top-bar' }, h('i', { style: `width:${Math.max(12, (n / max) * 100)}%` }))))));
  }
  updateAch();
  pushCard();
}

export function resetProfile() {
  built = false; restored = false; boardLoaded = 0; refs.tab = 'main';
}

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
