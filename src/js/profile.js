// Экран «Профиль»: карточка с баннером, витрина (любимые исполнители и треки), вкладки Обзор / Слушатели / Настройки / О MKW.
import { seenOnline, realSeen } from './clock.js';
import { nickEmo, richText, plainRich, emojiPicker, catSrc } from './stickers.js';
import { betaCard } from './poll.js';
import { $, $$, h, icon, openSheet, closeSheet, toast, sheetItem, trackRow } from './ui.js';
import * as store from './store.js';
import * as player from './player.js';
import { winterOn, setWinter } from './winter.js';
import { player2On, setPlayer2 } from './player2.js';
import { ACCENTS, getTheme, getAccent, getCustomHue, setCustomColor, setTheme, setAccent, hslHex, getNeutral } from './theme.js';
import { CHANGELOG, VERSION, STAGE, KNOWN_ISSUES } from './changelog.js';
import { plural, pickTrack, safeUrl } from './utils.js';
import { youtubeEnabled, youtubeQuotaOut } from './youtube.js';
import { audiusEnabled } from './audius.js';
import { SOURCE_MODES, getSourceMode, setSourceMode } from './sources.js';
import { gesturesOn, setGestures, showGestureGuide } from './gestures.js';
import { listenerStats } from './stats.js';
import { liveBg, setLiveBg } from './viz.js';
import { lowPower, setLowPower } from './perf.js';
import { logOut, changePassword, changeNick, authErrorText } from './auth.js';
import { connectionCountry } from './geo.js';
import { goOffline, publishCard, publishProfile, myCard, getProfile, topListeners, hiddenFromBoard, setHidden, myUid } from './leaders.js';
import { mi } from './icons2.js';
import { artistPic } from './artistpic.js';
import { openArtist } from './artist.js';
import { openUserPage, favArtistsRow, favTracksList, isOnline } from './userpage.js';
import { voiceOn, setVoice, showVoiceGuide, voiceSupported } from './voice.js';
import { openImage } from './viewer.js';
import { isDev, devBadge, fanBadge, nickMarks, isContrib, contribBadge } from './dev.js';
import { watchContrib, openContribAdmin } from './contrib.js';
import { fanNumber, restoreFan, becomeFan } from './fans.js';
import { ping } from './leaders.js';
import { streamsOn, setStreams, checkBackground } from './stream.js';
import { DEF_AV, avSrc, isDefAv } from './avatar.js';
import { ONLINE_MS, loadFriends, friendIds, addFriend, removeFriend, findByNick, friendCards, onFriends, declineRequest, acceptRequest, requestIds, sentIds, friendState, friendsLoaded } from './friends.js';
import { openChat, chatWith, isUnread, onChats } from './chat.js';
import { notifyOn, setNotify } from './notify.js';
import { openInstall, standalone } from './install.js';
import { getRingtone, clearRingtone } from './ringtone.js';
import { searchTracks } from './catalog.js';
import { seenText } from './userpage.js';

// s: sec, likes, playlists, plays, days, artists, night, styled, showcase, rank
export const ACHIEVEMENTS = [
  { id: 'dev', i: 'crown', title: 'Создатель MKW', hint: 'Разработчик приложения MKW Music', ok: (s) => s.dev, secret: true },
  { id: 'crash0', i: 'fire', title: 'Основатель сбоя', hint: 'Лимитированный значок: такой один на весь MKW. Спасибо за идею самой масштабной ошибки', ok: (s) => s.founder, secret: true, cls: 'ach-crash' },
  { id: 'wait1', i: 'hourglass', title: 'Дождался модерации', hint: 'Ждал, пока MKW Music проходил модерацию Google (ноябрь 2026). Уникальный значок', ok: (s) => s.waited, cls: 'ach-wait' },
  { id: 'dark1', i: 'shield', title: 'Пережил тёмное время бана', hint: 'Был с MKW, когда сайт по ошибке пометили как опасный (ноябрь 2026). Значок в знак извинения', ok: (s) => s.darkBan, cls: 'ach-dark' },
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
  // 0.37.1: новые достижения
  { id: 'winter26', i: 'sparkle', title: 'Зима 2026', hint: 'Слушали музыку в MKW зимой 2026–2027. Сезонный значок', ok: (s) => s.winter },
  { id: 'like250', i: 'heart-star', title: 'Сердце MKW', hint: '250 лайков', v: (s) => [s.likes, 250] },
  { id: 'h50', i: 'headphones', title: 'Полсотни часов', hint: '50 часов музыки', v: (s) => [Math.floor(s.sec / 3600), 50] },
  { id: 'h250', i: 'crown', title: 'Живу музыкой', hint: '250 часов музыки', v: (s) => [Math.floor(s.sec / 3600), 250] },
  { id: 'p500', i: 'play-circle', title: 'Плейлист бесконечности', hint: '500 треков', v: (s) => [s.plays, 500] },
  { id: 'p5000', i: 'rocket', title: 'Космос', hint: '5000 треков', v: (s) => [s.plays, 5000] },
  { id: 'd60', i: 'calendar-month', title: 'Два месяца с MKW', hint: '60 дней с нами', v: (s) => [s.days, 60] },
  { id: 'd365', i: 'trophy', title: 'Год с MKW', hint: '365 дней с нами', v: (s) => [s.days, 365] },
  { id: 'a100', i: 'globe', title: 'Музыкальный турист', hint: '100 разных исполнителей', v: (s) => [s.artists, 100] },
  { id: 'pl10', i: 'folders', title: 'Библиотекарь', hint: '10 плейлистов', v: (s) => [s.playlists, 10] },
  { id: 'fr10', i: 'group', title: 'Своя тусовка', hint: 'Добавьте 10 друзей', v: (s) => [s.friends, 10] },
  { id: 'show', i: 'star', title: 'Витрина', hint: 'Добавьте любимые треки или исполнителей', ok: (s) => s.showcase },
  { id: 'top3', i: 'medal', title: 'Топ-3', hint: 'Войдите в тройку слушателей', ok: (s) => s.rank > 0 && s.rank <= 3 },
  { id: 'top1', i: 'crown', title: 'Король эфира', hint: 'Станьте первым в рейтинге', ok: (s) => s.rank === 1 },
  { id: 'fr3', i: 'group', title: 'Душа компании', hint: 'Добавьте 3 друзей', v: (s) => [s.friends, 3] },
];
export const DARK_UNTIL = Date.UTC(2026, 10, 10);
export const FOUNDER = 'motrahka'; // «Основатель сбоя» — лимитированный значок только у него
export const achDone = (a, s) => (a.ok ? a.ok(s) : a.v(s)[0] >= a.v(s)[1]);
export const ACH = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

export const BANNERS = [
  // 0.37: зимние и «парные» баннеры
  { id: 'wtree', name: 'Наряжаем ёлку', css: 'right 6% bottom 4% / auto 86% no-repeat url(assets/mkw-st49.webp), radial-gradient(circle at 18% 28%, rgba(255,255,255,.9) 0 1.5px, transparent 2.5px), radial-gradient(circle at 38% 66%, rgba(255,255,255,.75) 0 1.5px, transparent 2.5px), radial-gradient(circle at 8% 78%, rgba(255,255,255,.7) 0 1px, transparent 2px), radial-gradient(circle at 52% 22%, rgba(255,255,255,.8) 0 1px, transparent 2px), linear-gradient(160deg, #123a5e, #1b1f4d 55%, #0b0d22)' },
  { id: 'wpair', name: 'Парочка', css: 'right 7% center / auto 86% no-repeat url(assets/mkw-st37.webp), linear-gradient(135deg, #ff9ecb, #c084ff 55%, #6d7dff)' },
  { id: 'wduo', name: 'Слушаем вместе', css: 'right 6% center / auto 84% no-repeat url(assets/mkw-st39.webp), radial-gradient(120% 100% at 85% 15%, #3a3350, #12101c 70%)' },
  { id: 'wbox', name: 'Коробка MKW', css: 'right 6% bottom 2% / auto 88% no-repeat url(assets/mkw-st48.webp), linear-gradient(135deg, #2b2d42, #8d5cf6 60%, #ff7ac0)' },
  { id: 'wnorth', name: 'Северное сияние', css: 'radial-gradient(90% 120% at 15% 0%, rgba(52,211,255,.85), transparent 60%), radial-gradient(90% 120% at 85% 10%, rgba(160,110,255,.8), transparent 60%), radial-gradient(120% 90% at 50% 110%, rgba(70,227,140,.55), transparent 60%), linear-gradient(180deg, #0a1030, #05060f)' },
  { id: 'catnight', name: 'Котик ночью', css: 'right 8% bottom 6% / auto 78% no-repeat url(assets/mkw-st26.webp), radial-gradient(120% 90% at 80% 20%, #2b2f6b, #0d0b1f 70%)' },
  { id: 'catlove', name: 'Котик с сердцем', css: 'right 8% center / auto 82% no-repeat url(assets/mkw-cat2.webp), linear-gradient(135deg, #ff8fc4, #b06bff)' },
  { id: 'catmusic', name: 'Котик-меломан', css: 'right 6% center / auto 82% no-repeat url(assets/mkw-st31.webp), linear-gradient(135deg, #1a1a1a, #3a3a3a 60%, #111)' },
  { id: 'catparty', name: 'Котики MKW', css: 'left 4% bottom 0 / auto 60% no-repeat url(assets/mkw-st1.webp), right 4% bottom 0 / auto 60% no-repeat url(assets/mkw-cat5.webp), center bottom / auto 68% no-repeat url(assets/mkw-st2.webp), linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary) 30%, #0b0b10))' },
  { id: 'accent', name: 'Акцент', css: 'linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary) 40%, #120812))' },
  { id: 'sunset', name: 'Закат', css: 'linear-gradient(135deg, #ff7a59, #ff3d7f 50%, #7a2bff)' },
  { id: 'ocean', name: 'Океан', css: 'linear-gradient(135deg, #00d2ff, #3a47d5)' },
  { id: 'aurora', name: 'Сияние', css: 'linear-gradient(135deg, #43e97b, #38f9d7 40%, #6a5cff)' },
  { id: 'fire', name: 'Огонь', css: 'linear-gradient(135deg, #f9d423, #ff4e50)' },
  { id: 'night', name: 'Ночь', css: 'linear-gradient(135deg, #232526, #414345 50%, #1a1035)' },
  { id: 'candy', name: 'Конфета', css: 'linear-gradient(135deg, #f6a5ff, #a0c4ff)' },
  { id: 'mono', name: 'Графит', css: 'linear-gradient(135deg, #3a3a3a, #0d0d0d)' },
  { id: 'black', name: 'Чёрный', css: 'radial-gradient(120% 140% at 80% 0%, #2a2a2a, #000 60%)' },
  { id: 'cosmos', name: 'Космос', css: 'radial-gradient(circle at 20% 30%, rgba(255,255,255,.8) 0 1px, transparent 2px), radial-gradient(circle at 70% 60%, rgba(255,255,255,.7) 0 1px, transparent 2px), radial-gradient(circle at 45% 80%, rgba(255,255,255,.6) 0 1px, transparent 2px), linear-gradient(135deg, #0b0b2b, #2b0b3f 50%, #000)' },
  { id: 'sakura', name: 'Сакура', css: 'linear-gradient(135deg, #ffd1e8, #ff8fc7 45%, #b04a8a)' },
  { id: 'lime', name: 'Лайм', css: 'linear-gradient(135deg, #d4fc79, #37c978)' },
];
export const FRAMES = [
  { id: 'none', name: 'Без рамки' }, { id: 'glow', name: 'Свечение' }, { id: 'rainbow', name: 'Радуга' }, { id: 'gold', name: 'Золото' }, { id: 'neon', name: 'Неон' },
  { id: 'black', name: 'Чёрный глянец' }, { id: 'silver', name: 'Серебро' }, { id: 'fire', name: 'Огонь' },
  { id: 'pink', name: 'Розовый неон' }, { id: 'ice', name: 'Лёд' }, { id: 'toxic', name: 'Кислота' }, { id: 'sunset', name: 'Закат' },
  { id: 'pulse', name: 'Пульс' }, { id: 'dash', name: 'Пунктир' }, { id: 'double', name: 'Двойная' },
  { id: 'garland', name: 'Гирлянда' }, { id: 'frost', name: 'Иней' },
  { id: 'candy', name: 'Леденец' }, { id: 'aurora', name: 'Сияние' }, { id: 'gift', name: 'Подарок' }, { id: 'night', name: 'Ночь' },
];
export const bannerCss = (id, img) => (safeUrl(img) ? `center / cover no-repeat url("${safeUrl(img)}")` : (BANNERS.find((b) => b.id === id) || BANNERS[0]).css);

let built = false, curNick = '', boardLoaded = 0, myRank = 0, restored = false;
const refs = {};

const CKEY = (n) => `mkw.pcustom.${n}`;
const DEF = { status: '', banner: 'accent', bannerImg: '', frame: 'glow', badges: [], favArtists: [], favTracks: [], bio: '', nickStyle: 'plain', shape: 'circle', effect: 'none', showNow: true, devBadge: true, fanBadge: true };
export const NICK_STYLES = [{ id: 'plain', name: 'Обычный' }, { id: 'accent', name: 'Цвет акцента' }, { id: 'gradient', name: 'Градиент' }, { id: 'rainbow', name: 'Радуга' }, { id: 'glow', name: 'Неон' }, { id: 'gold', name: 'Золото' }, { id: 'silver', name: 'Серебро' }, { id: 'fire', name: 'Огонь' }, { id: 'outline', name: 'Контур' }];
export const SHAPES = [{ id: 'circle', name: 'Круг' }, { id: 'squircle', name: 'Скруглённый' }, { id: 'flower', name: 'Цветок' }, { id: 'hex', name: 'Соты' }, { id: 'heart', name: 'Сердце' }, { id: 'star', name: 'Звезда' }, { id: 'diamond', name: 'Ромб' }, { id: 'blob', name: 'Капля' }, { id: 'snowflake', name: 'Снежинка' }, { id: 'tree', name: 'Ёлка' }, { id: 'cloud', name: 'Облако' }, { id: 'octagon', name: 'Восьмиугольник' }];
// шрифт ника хранится вместе со стилем: «gold~mo» — стиль «Золото», шрифт «Моно»
export const FONTS = [{ id: '', name: 'Обычный' }, { id: 'pf', name: 'Pacifico' }, { id: 'lb', name: 'Lobster' }, { id: 'cv', name: 'Caveat' }, { id: 'ms', name: 'Marck Script' },
  { id: 'ps', name: 'Пиксель' }, { id: 'ru', name: 'Russo One' }, { id: 'rm', name: 'Rubik Mono' }, { id: 'cm', name: 'Comfortaa' }, { id: 'ub', name: 'Unbounded' },
  { id: 'am', name: 'Amatic SC' }, { id: 'ne', name: 'Neucha' }, { id: 'sr', name: 'С засечками' }, { id: 'mo', name: 'Моно' }, { id: 'wd', name: 'ШИРОКИЙ' }, { id: 'it', name: 'Курсив' }];
// красивые шрифты подгружаем один раз (файлы скачиваются, только когда шрифт где-то используется)
let fontsLinked = false;
export function linkFonts() {
  if (fontsLinked) return; fontsLinked = true;
  const fams = ['Pacifico', 'Lobster', 'Caveat:wght@700', 'Marck+Script', 'Press+Start+2P', 'Russo+One', 'Rubik+Mono+One', 'Comfortaa:wght@700', 'Unbounded:wght@800', 'Amatic+SC:wght@700', 'Neucha'];
  const l = document.createElement('link'); l.rel = 'stylesheet';
  l.href = `https://fonts.googleapis.com/css2?${fams.map((f) => `family=${f}`).join('&')}&display=swap`;
  document.head.appendChild(l);
}
export const splitStyle = (v) => { const [st, f] = String(v || 'plain').split('~'); return [st || 'plain', f || '']; };
export const EFFECTS = [{ id: 'none', name: 'Без эффекта' }, { id: 'crosses', name: 'Кресты' }, { id: 'stars', name: 'Звёзды' }, { id: 'aurora', name: 'Сияние' }, { id: 'snow', name: 'Снег' }, { id: 'waves', name: 'Волны' }, { id: 'hearts', name: 'Сердечки' }, { id: 'fireflies', name: 'Светлячки' },
  { id: 'sakura', name: 'Сакура' }, { id: 'notes', name: 'Ноты' }, { id: 'rain', name: 'Дождь' }, { id: 'bubbles', name: 'Пузыри' }, { id: 'confetti', name: 'Конфетти' }, { id: 'matrix', name: 'Матрица' }, { id: 'meteor', name: 'Метеоры' }, { id: 'cats', name: 'Котики MKW' },
  { id: 'flakes', name: 'Снежинки' }, { id: 'gifts', name: 'Подарки' }, { id: 'sparks', name: 'Искры' }, { id: 'aurorafx', name: 'Северное сияние' }];
const nowPlaying = () => { const c = getCustom(), t = player.queue.current; return c.showNow !== false && t && player.st.playing ? `${t.artist} — ${t.title}` : ''; };
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
  if (refs.srcnote) refs.srcnote.textContent = `iTunes: работает · YouTube: работает без лимита (через сервер MKW${youtubeQuotaOut() ? ', ключ на сегодня исчерпан' : ''}) · Audius: ${audiusEnabled() ? 'работает' : 'нет ключа'}`;
  const tog = (el, v) => { if (el) { el.classList.toggle('active', v); el.setAttribute('aria-checked', String(v)); } };
  tog(refs.gest, gesturesOn()); tog(refs.voice, voiceOn()); tog(refs.notify, notifyOn()); tog(refs.bgplay, streamsOn()); tog(refs.lowp, lowPower()); tog(refs.livebg, liveBg()); tog(refs.winter, winterOn()); tog(refs.player2, player2On()); tog(refs.board, !hiddenFromBoard());
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
  if (entry.text) body.push(h('p', { class: 'cl-text', text: entry.text }));
  if (entry.new.length) body.push(h('div', { class: 'cl-h', text: 'Новое' }), h('ul', {}, entry.new.map((t) => h('li', { text: t }))));
  if (entry.fixed.length) body.push(h('div', { class: 'cl-h fix', text: 'Исправлено' }), h('ul', {}, entry.fixed.map((t) => h('li', { text: t }))));
  const d = h('details', { class: 'cl' }, h('summary', {}, h('b', { text: `v${entry.version}` }), h('span', { text: entry.date })), ...body);
  if (open) d.open = true;
  return d;
}

const AV = (n) => `mkw.avatar.${n}`;
// подсказка «поставьте своё фото», пока стоит человечек по умолчанию
function paintAvHint() { if (refs.avHint) refs.avHint.hidden = !isDefAv(refs.avatar && refs.avatar.getAttribute('src')); }
export function getAvatar(nick) { try { return avSrc(localStorage.getItem(AV(nick))); } catch { return DEF_AV; } }
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
    try { const d = await resizeToDataUrl(f); localStorage.setItem(AV(nick), d); refs.avatar.src = d; paintAvHint(); closeSheet(); toast('Фото обновлено'); pushCard(true); }
    catch { toast('Не получилось загрузить фото'); }
  });
  openSheet('Фото профиля', h('div', {}, inp,
    sheetItem('user', 'Посмотреть фото', () => { closeSheet(); openImage(getAvatar(nick), nick); }),
    sheetItem('user', 'Выбрать фото из галереи', () => inp.click()),
    sheetItem('close', 'Убрать фото', () => { try { localStorage.removeItem(AV(nick)); } catch { /* ignore */ } refs.avatar.src = DEF_AV; paintAvHint(); closeSheet(); pushCard(true); }, true),
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
  // история хранит не всё — «Полуночник» запоминаем навсегда, как только он заработан
  let night = false; try { night = localStorage.getItem('mkw.ach.night') === '1'; } catch { /* ignore */ }
  if (!night && (store.state.history.some((t) => t.playedAt && new Date(Number(t.playedAt)).getHours() < 5) || (player.st.playing && new Date().getHours() < 5))) { night = true; try { localStorage.setItem('mkw.ach.night', '1'); } catch { /* ignore */ } }
  const created = Number(p.createdAt) || 0;
  const c = getCustom();
  return {
    sec: store.listenedTotal(), likes: store.state.likes.length, playlists: store.state.playlists.length,
    plays: Number(p.plays) || store.state.history.length,
    days: created ? Math.max(1, Math.ceil((Date.now() - created) / 86400000)) : 1,
    artists: seen.size, night, winter: (() => { try { if (Date.now() < Date.UTC(2027, 2, 1) && (player.st.playing || store.state.history.length)) localStorage.setItem('mkw.ach.winter', '1'); return localStorage.getItem('mkw.ach.winter') === '1'; } catch { return false; } })(), styled: Boolean(c.styled), showcase: Boolean(c.favArtists.length || c.favTracks.length), rank: myRank, friends: friendIds().length, dev: isDev(curNick),
    // значок «Пережил тёмное время бана»: у всех, кто был с MKW до 10 ноября 2026
    founder: String(curNick).toLowerCase() === FOUNDER,
    waited: (() => { try { return localStorage.getItem('mkw.wait.badge') === '1'; } catch { return false; } })() || c.badges.includes('wait1'),
    darkBan: Date.now() < DARK_UNTIL || (created > 0 && created < DARK_UNTIL) || c.badges.includes('dark1'),
  };
}

let pushTimer = 0, lastCardAt = 0;
// поменяли эмодзи у ника — сразу показываем его всем
window.addEventListener('mkw-nemo', () => { if (curNick) { try { paintMarks(getCustom()); } catch { /* ignore */ } pushCard(true); } });
// бережём бесплатный лимит Firestore: рейтинг пишется не чаще раза в 3 минуты, страница профиля — при изменениях и раз в 15 минут
let restoring = false; // пока подтягиваем оформление с сервера — не отправляем пустое
function pushCard(full) {
  if (restoring) { setTimeout(() => pushCard(full), 1500); return; }
  if (full !== true && Date.now() - lastCardAt < 180000) return;
  lastCardAt = Date.now();
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    const c = getCustom(), s = statsNow(), av = getAvatar(curNick);
    const small = await imageTo(av, 72, 72, 0.7);
    publishCard({ nick: curNick, sec: s.sec, plays: s.plays, likes: s.likes, status: c.status, banner: c.bannerImg ? 'img' : c.banner, frame: c.frame, badges: c.badges, avatar: small, shape: c.shape, now: nowPlaying(), nemo: (store.state.profile || {}).nemo || '', ...marksOut(c) });
    if (full !== false) {
      publishProfile({
        nick: curNick, status: c.status, banner: c.banner, bannerImg: c.bannerImg, frame: c.frame, badges: c.badges,
        avatar: await imageTo(av, 360, 360, 0.8), favArtists: c.favArtists, favTracks: c.favTracks.map(pickTrack),
        bio: c.bio, nickStyle: c.nickStyle, shape: c.shape, effect: c.effect, now: nowPlaying(),
        sec: s.sec, plays: s.plays, likes: s.likes, days: s.days, achCount: ACHIEVEMENTS.filter((a) => achDone(a, s)).length, nemo: (store.state.profile || {}).nemo || '', ...marksOut(c),
      });
    }
  }, 1500);
}

// значки у ника, которые видят другие
const marksOut = (c) => ({ fan: c.fanBadge !== false ? fanNumber(curNick) : 0, devOff: isDev(curNick) && c.devBadge === false });
function paintMarks(c) {
  if (!refs.marks) return;
  const n = fanNumber(curNick);
  refs.marks.replaceChildren(...[nickEmo((store.state.profile || {}).nemo, 'nick-emo big'), isDev(curNick) && c.devBadge !== false ? devBadge() : null, isContrib({ uid: myUid(), nick: curNick }) ? contribBadge() : null, n && c.fanBadge !== false ? fanBadge(n) : null].filter(Boolean));
  refs.marks.hidden = !refs.marks.children.length;
  if (refs.fanCard) refs.fanCard.hidden = Boolean(n);
}
async function likeMkw(btn) {
  if (btn) btn.disabled = true;
  try {
    const n = await becomeFan(curNick);
    setCustom({ fanBadge: true });
    toast(`Спасибо! Ваш значок фаната: MKW #${n}`);
    paintHero(); pushCard(true);
  } catch { toast('Не получилось. Админу нужно обновить правила Firestore'); if (btn) btn.disabled = false; }
}

// значок «Пережил тёмное время бана» сам закрепляется в профиле первым (поменять можно в «Изменить» → «Ник»)
function pinDarkBadge() {
  const k = `mkw.dark2.pinned.${curNick}`;
  try { if (localStorage.getItem(k)) return; localStorage.setItem(k, '1'); } catch { return; }
  const st = statsNow();
  if (!st.darkBan && !st.founder) return;
  const c = getCustom();
  const add = [...(String(curNick).toLowerCase() === FOUNDER ? ['crash0'] : []), 'dark1'].filter((x) => !c.badges.includes(x));
  if (add.length) setCustom({ badges: [...add, ...c.badges].slice(0, 3) }); // мест три — новые значки встают первыми
}

// значок «Дождался модерации»: получен кнопкой на странице модерации — сам встаёт первым в профиле
function pinWaitBadge() {
  const k = `mkw.wait.pinned.${curNick}`;
  try { if (localStorage.getItem('mkw.wait.badge') !== '1' || localStorage.getItem(k)) return; localStorage.setItem(k, '1'); } catch { return; }
  const c = getCustom();
  if (!c.badges.includes('wait1')) setCustom({ badges: ['wait1', ...c.badges].slice(0, 3) });
}

function badgeChips(ids) {
  return h('div', { class: 'pbadges' }, (ids || []).filter((id) => ACH[id]).map((id) => h('span', { class: `pbadge${ACH[id].cls ? ` ${ACH[id].cls}` : ''}`, title: ACH[id].hint }, mi(ACH[id].i), h('b', { text: ACH[id].title }))));
}

function paintHero() {
  if (!refs.hero) return;
  const c = getCustom();
  refs.hero.style.setProperty('--banner', bannerCss(c.banner, c.bannerImg));
  refs.hero.dataset.bimg = c.bannerImg ? '1' : '';
  refs.hero.dataset.frame = c.frame;
  refs.hero.dataset.shape = c.shape;
  refs.hero.dataset.effect = c.effect;
  [refs.nick.dataset.style, refs.nick.dataset.font] = splitStyle(c.nickStyle);
  refs.hero.classList.toggle('dev', isDev(curNick) && c.devBadge !== false);
  paintMarks(c);
  richText(refs.bio, c.bio); refs.bio.hidden = !c.bio;
  richText(refs.status, c.status || 'Добавьте статус — нажмите «Изменить»');
  refs.status.classList.toggle('st-empty', !c.status);
  refs.heroBadges.replaceChildren(...badgeChips(c.badges.filter((b) => b !== 'dev')).children);
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

// Баннер: выбираете, какая часть фото попадёт в полосу 3:1 — тянете пальцем и приближаете ползунком
function cropBanner(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let zoom = 1, ox = 0, oy = 0; // смещение в долях от свободного места (-1…1)
      const frame = h('div', { class: 'bc-frame' });
      const pic = h('img', { class: 'bc-img', src, alt: '', draggable: 'false' });
      frame.appendChild(pic);
      const range = h('input', { type: 'range', min: '1', max: '3', step: '0.01', value: '1', class: 'bc-zoom', 'aria-label': 'Приблизить' });
      const layout = () => {
        const fw = frame.clientWidth, fh = frame.clientHeight;
        const base = Math.max(fw / img.width, fh / img.height), sc = base * zoom;
        const w = img.width * sc, hh = img.height * sc, freeX = (w - fw) / 2, freeY = (hh - fh) / 2;
        ox = Math.max(-1, Math.min(1, ox)); oy = Math.max(-1, Math.min(1, oy));
        pic.style.width = `${w}px`; pic.style.height = `${hh}px`;
        pic.style.transform = `translate(${-freeX - ox * freeX}px, ${-freeY - oy * freeY}px)`;
        return { sc, freeX, freeY, fw, fh };
      };
      let drag = null;
      frame.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, ox, oy, g: layout() }; frame.setPointerCapture(e.pointerId); });
      frame.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const { freeX, freeY } = drag.g;
        ox = drag.ox - (freeX ? (e.clientX - drag.x) / freeX : 0); oy = drag.oy - (freeY ? (e.clientY - drag.y) / freeY : 0); layout();
      });
      frame.addEventListener('pointerup', () => { drag = null; });
      range.addEventListener('input', () => { zoom = Number(range.value); layout(); });
      const done = (ok) => {
        if (!ok) { box.remove(); resolve(''); return; }
        const g = layout();
        // какая часть исходного фото видна в рамке
        const sx = (g.freeX + ox * g.freeX) / g.sc, sy = (g.freeY + oy * g.freeY) / g.sc, sw = g.fw / g.sc, sh = g.fh / g.sc;
        const out = (W, q) => { const c = document.createElement('canvas'); c.width = W; c.height = Math.round(W / 3); const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', q); };
        let d = out(1200, 0.84); if (d.length > 290000) d = out(1200, 0.72); if (d.length > 290000) d = out(1000, 0.66); if (d.length > 290000) d = out(900, 0.6);
        box.remove(); resolve(d);
      };
      const box = h('div', { class: 'bc' },
        h('div', { class: 'bc-card' },
          h('b', { class: 'bc-title', text: 'Баннер профиля' }),
          h('small', { class: 'bc-hint', text: 'Перетащите фото и приблизите ползунком — так он будет выглядеть в профиле' }),
          frame, range,
          h('div', { class: 'bc-btns' }, h('button', { class: 'btn tonal', type: 'button', onclick: () => done(false) }, 'Отмена'), h('button', { class: 'btn', type: 'button', onclick: () => done(true) }, 'Готово'))));
      document.body.appendChild(box);
      requestAnimationFrame(layout);
    };
    img.onerror = () => resolve('');
    img.src = src;
  });
}

function editProfile() {
  const c = getCustom();
  let banner = c.banner, bannerImg = c.bannerImg, frame = c.frame, badges = [...c.badges], favA = [...c.favArtists], favT = [...c.favTracks];
  let [nickStyle, nickFont] = splitStyle(c.nickStyle);
  let shape = c.shape, effect = c.effect, showNow = c.showNow !== false;
  let devB = c.devBadge !== false, fanB = c.fanBadge !== false;
  const st = h('input', { type: 'text', maxlength: '60', class: 'sheet-input', placeholder: 'Статус, например: слушаю ночной вайб', value: c.status });
  const bio = h('textarea', { class: 'sheet-input pe-bio', maxlength: '160', rows: '2', placeholder: 'Пара слов о себе и своей музыке' });
  bio.value = c.bio || '';

  // ---- живой пример: так карточку увидят другие, меняется сразу ----
  const liveAv = h('img', { src: getAvatar(curNick), alt: '' });
  const liveNick = h('div', { class: 'hero-nick', text: curNick });
  const liveStatus = h('div', { class: 'pe-live-st' });
  const liveMarks = h('div', { class: 'nick-marks' });
  const liveBadges = h('div', { class: 'pbadges' });
  const live = h('div', { class: 'phero pe-live' },
    h('div', { class: 'phero-banner' }),
    h('div', { class: 'phero-fx' }, ...Array.from({ length: 10 }, () => h('i'))),
    h('div', { class: 'pe-live-row' }, h('span', { class: 'hero-avatar' }, liveAv),
      h('div', { class: 'pe-live-txt' }, liveNick, liveMarks, liveStatus)),
    liveBadges,
    h('span', { class: 'pe-live-tag', text: 'Так вас видят' }));
  const paintLive = () => {
    live.style.setProperty('--banner', bannerCss(banner, bannerImg));
    live.dataset.bimg = bannerImg ? '1' : '';
    live.dataset.frame = frame; live.dataset.shape = shape; live.dataset.effect = effect;
    live.classList.toggle('dev', isDev(curNick) && devB);
    liveNick.dataset.style = nickStyle; liveNick.dataset.font = nickFont;
    richText(liveStatus, st.value.trim() || bio.value.trim() || '');
    const n = fanNumber(curNick);
    liveMarks.replaceChildren(...(isDev(curNick) && devB ? [devBadge()] : []), ...(n && fanB ? [fanBadge(n)] : []));
    liveBadges.replaceChildren(...badgeChips(badges).children);
  };
  st.addEventListener('input', paintLive); bio.addEventListener('input', paintLive);

  // ---- выбор: выбранное — белое с галочкой, у каждого варианта маленький пример ----
  const pick = (list, get, set, sample, cls = '') => {
    const box = h('div', { class: `pe-frames ${cls}` });
    const paint = () => box.replaceChildren(...list.map((x) => {
      const on = x.id === get();
      return h('button', { type: 'button', class: `chip pe-opt${on ? ' active' : ''}`, 'aria-pressed': String(on), onclick: (e) => { set(x.id); paint(); paintLive(); e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); } },
        sample ? sample(x) : null, h('span', { text: x.name }), on ? mi('check', 'pe-ok') : null);
    }));
    paint();
    return box;
  };
  const upl = h('input', { type: 'file', accept: 'image/*', hidden: '' });
  upl.addEventListener('change', async () => {
    const f = upl.files && upl.files[0]; if (!f) return;
    upl.value = '';
    try { const out = await cropBanner(await fileToDataUrl(f)); if (out) { bannerImg = out; paintB(); paintLive(); } } catch { toast('Не получилось загрузить картинку'); }
  });
  const bWrap = h('div', { class: 'pe-banners' });
  const paintB = () => bWrap.replaceChildren(
    h('button', { type: 'button', class: `pe-banner own${bannerImg ? ' on' : ''}`, onclick: () => upl.click() }, mi('image'), h('span', { text: bannerImg ? 'Своё фото ✓' : 'Своё фото' })),
    ...BANNERS.map((b) => h('button', { type: 'button', class: `pe-banner${!bannerImg && b.id === banner ? ' on' : ''}`, style: `--b:${b.css}`, title: b.name, onclick: () => { banner = b.id; bannerImg = ''; paintB(); paintLive(); } }, h('span', { text: b.name }), !bannerImg && b.id === banner ? mi('check', 'pe-ok') : null)));
  const frameDot = (x) => h('span', { class: 'pe-sm fr', 'data-frame': x.id }, h('i'));
  const shapeDot = (x) => h('span', { class: 'pe-sm sh', 'data-shape': x.id }, h('i'));
  const fxDot = (x) => h('span', { class: 'pe-sm fx', 'data-effect': x.id }, h('i'), h('i'), h('i'));
  const nickDot = (x) => h('span', { class: 'hero-nick pe-nsd', 'data-style': x.id, text: 'Аа' });
  const fWrap = pick(FRAMES, () => frame, (v) => { frame = v; }, frameDot);
  const shWrap = pick(SHAPES, () => shape, (v) => { shape = v; }, shapeDot);
  const efWrap = pick(EFFECTS, () => effect, (v) => { effect = v; }, fxDot);
  const nsWrap = pick(NICK_STYLES, () => nickStyle, (v) => { nickStyle = v; }, nickDot);
  const fontDot = (x) => h('span', { class: 'hero-nick pe-nsd', 'data-font': x.id, text: 'Аа' });
  const nfWrap = pick(FONTS, () => nickFont, (v) => { nickFont = v; }, fontDot);

  // ---- значки у ника: выбрать, какие показывать ----
  const marksBox = h('div', { class: 'pe-badges pe-marks' });
  const paintMarksSel = () => {
    const n = fanNumber(curNick);
    const opt = (on, el, toggle) => h('button', { type: 'button', class: `pe-mark${on ? ' on' : ''}`, 'aria-pressed': String(on), onclick: () => { toggle(); paintMarksSel(); paintLive(); } }, el, on ? mi('check', 'pe-ok') : h('i', { class: 'pe-off' }));
    const kids = [];
    if (isDev(curNick)) kids.push(opt(devB, devBadge(), () => { devB = !devB; }));
    if (n) kids.push(opt(fanB, fanBadge(n), () => { fanB = !fanB; }));
    if (!n) kids.push(h('button', { class: 'btn tonal', type: 'button', onclick: (e) => { likeMkw(e.currentTarget).then(() => { closeSheet(); editProfile(); }); } }, mi('heart'), ' Мне нравится MKW — получить значок'));
    marksBox.replaceChildren(...kids);
  };

  // ---- значки в профиле (до 3) ----
  const s = statsNow();
  const earned = ACHIEVEMENTS.filter((a) => achDone(a, s) && a.id !== 'dev');
  const aWrap = h('div', { class: 'pe-badges' });
  const aCount = h('small', { class: 'pe-cnt' });
  const paintA = () => {
    aCount.textContent = `${badges.length} из 3`;
    aWrap.replaceChildren(...(earned.length ? earned.map((a) => {
      const on = badges.includes(a.id);
      return h('button', { type: 'button', class: `pe-badge${on ? ' on' : ''}${a.cls ? ` ${a.cls}` : ''}`, 'aria-pressed': String(on), title: a.hint, onclick: () => {
        if (on) badges = badges.filter((x) => x !== a.id);
        else if (badges.length < 3) badges.push(a.id); else { toast('Можно закрепить до 3 значков — сначала снимите один'); return; }
        paintA(); paintLive();
      } }, mi(a.i), a.title, on ? mi('check', 'pe-ok') : null);
    }) : [h('p', { class: 'profile-note', text: 'Пока нет полученных достижений.' })]));
  };

  // ---- витрина ----
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
  const trWrap = h('div', { class: 'pe-tracks' });
  // перетаскивание выбранных треков: зажать строку ~0,7 с и тащить; обычная прокрутка не мешает
  let dragged = 0;
  const lpDrag = (row) => {
    let timer = 0, active = false, y0 = 0, sx = 0, sy = 0, pid = 0, from = 0, to = 0, mids = [];
    const prevent = (e) => { if (active && e.cancelable) e.preventDefault(); };
    row.addEventListener('touchmove', prevent, { passive: false });
    row.addEventListener('contextmenu', (e) => { if (active) e.preventDefault(); });
    const end = () => {
      clearTimeout(timer);
      if (!active) return;
      active = false; dragged = Date.now();
      if (to !== from) { const [it] = favT.splice(from, 1); favT.splice(to, 0, it); }
      paintTr();
    };
    row.addEventListener('pointerdown', (e) => {
      sx = e.clientX; sy = e.clientY; pid = e.pointerId;
      timer = setTimeout(() => {
        const rows = [...trWrap.querySelectorAll('.pe-track.on')]; from = to = rows.indexOf(row); if (from < 0) return;
        mids = rows.map((r) => { const b = r.getBoundingClientRect(); return b.top + b.height / 2; });
        active = true; y0 = sy; row.classList.add('drag'); try { row.setPointerCapture(pid); } catch { /* ignore */ } try { navigator.vibrate && navigator.vibrate(15); } catch { /* ignore */ }
      }, 700);
    });
    row.addEventListener('pointermove', (e) => {
      if (!active) { if (Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8) clearTimeout(timer); return; }
      const dy = e.clientY - y0; row.style.transform = `translateY(${dy}px)`;
      const y = mids[from] + dy; to = mids.reduce((b, m, k) => (Math.abs(m - y) < Math.abs(mids[b] - y) ? k : b), 0);
    });
    row.addEventListener('pointerup', end); row.addEventListener('pointercancel', end);
  };
  const paintTr = () => {
    const pool = [...favT, ...store.state.likes.filter((t) => !favT.some((x) => x.id === t.id))].slice(0, 40);
    trWrap.replaceChildren(...(pool.length ? pool.map((t) => {
      const on = favT.some((x) => x.id === t.id);
      const rowEl = h('button', { type: 'button', class: `pe-track${on ? ' on' : ''}`, onclick: () => {
        if (Date.now() - dragged < 400) return;
        if (on) favT = favT.filter((x) => x.id !== t.id);
        else if (favT.length >= 10) { toast('Можно выбрать до 10 треков'); return; } else favT.push(pickTrack(t));
        paintTr();
      } }, h('img', { src: t.artwork || 'assets/mkw-logo.png', alt: '', loading: 'lazy' }), h('span', {}, h('b', { text: t.title }), h('small', { text: t.artist })), h('i', {}, mi(on ? 'check' : 'add')));
      // звезда: сделать трек «самым любимым» — он встанет первым и будет большой карточкой на витрине
      if (on) {
        const top = favT[0] && favT[0].id === t.id;
        rowEl.insertBefore(h('span', { class: `pe-star${top ? ' on' : ''}`, role: 'button', tabindex: '0', title: top ? 'Самый любимый' : 'Сделать самым любимым', onclick: (e) => {
          e.stopPropagation(); const k = favT.findIndex((x) => x.id === t.id); if (k > 0) { const [it] = favT.splice(k, 1); favT.unshift(it); paintTr(); }
        } }, mi('star')), rowEl.lastChild);
      }
      if (on) lpDrag(rowEl);
      return rowEl;
    }) : [h('p', { class: 'profile-note', text: 'Лайкните треки, и их можно будет добавить сюда.' })]));
  };
  const nowSw = h('button', { class: `switch${showNow ? ' active' : ''}`, type: 'button', role: 'switch', onclick: () => { showNow = !showNow; nowSw.classList.toggle('active', showNow); } }, h('i'));
  paintB(); paintA(); paintArt(); paintTr(); paintMarksSel(); paintLive();

  const save = h('button', { class: 'btn', type: 'button', onclick: () => {
    setCustom({ devBadge: devB, fanBadge: fanB, status: st.value.trim(), banner, bannerImg, frame, badges, favArtists: favA, favTracks: favT, bio: bio.value.trim(), nickStyle: nickFont ? `${nickStyle}~${nickFont}` : nickStyle, shape, effect, showNow });
    closeSheet(); toast('Профиль обновлён'); updateProfile();
  } }, mi('check'), ' Сохранить');
  const sec = (ic, t, ...kids) => h('section', { class: 'pe-sec' }, h('div', { class: 'pe-h' }, mi(ic), h('span', { text: t })), ...kids);
  const pane = (id, ...kids) => h('div', { class: 'pe-pane', 'data-pe': id }, ...kids);
  const panes = [
    pane('card',
      sec('image', 'Фон карточки', bWrap),
      h('button', { class: 'btn tonal pe-avbtn', type: 'button', onclick: () => avatarMenu(curNick) }, mi('person'), ' Сменить фото профиля'),
      sec('sparkle', 'Рамка фото', fWrap),
      sec('image', 'Форма фото', shWrap),
      sec('star', 'Эффект на карточке', efWrap)),
    pane('nick',
      sec('edit', 'Статус', emoField(st)),
      sec('person', 'О себе', emoField(bio)),
      sec('palette', 'Стиль ника', nsWrap),
      sec('edit', 'Шрифт ника', nfWrap),
      sec('verified', 'Значки у ника', marksBox),
      sec('medal', 'Значки в профиле', aCount, aWrap),
      h('div', { class: 'set-row pe-row' }, h('div', { class: 'set-txt' }, h('b', { text: 'Показывать, что я слушаю' }), h('small', { text: 'Другие увидят текущий трек, пока вы в сети' })), nowSw)),
    pane('show',
      sec('mic', 'Любимые исполнители (до 4)', artWrap, artAdd),
      sec('star', 'Любимые треки (до 10)', trWrap)),
  ];
  // ---- вкладки: плавно едут, листаются пальцем ----
  const IDS = ['card', 'nick', 'show'];
  const track = h('div', { class: 'pe-rail' }, ...panes);
  const view = h('div', { class: 'pe-view' }, track);
  const seg = h('div', { class: 'pe-tabs' }, h('i', { class: 'pe-lens' }));
  let curI = 0;
  // высота: сразу растём, сжимаемся только после переезда — без анимации высоты (она и давала мигание)
  let fitT = 0;
  const fit = () => {
    const want = panes[curI].offsetHeight, cur = view.offsetHeight;
    clearTimeout(fitT);
    if (!cur || want >= cur) view.style.height = `${want}px`;
    else fitT = setTimeout(() => { view.style.height = `${panes[curI].offsetHeight}px`; }, 440);
  };
  const go = (i, smooth = true) => {
    curI = Math.max(0, Math.min(IDS.length - 1, i));
    track.style.transition = smooth ? '' : 'none';
    track.style.transform = `translate3d(${-curI * 100}%,0,0)`;
    seg.style.setProperty('--i', String(curI));
    seg.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === curI));
    panes.forEach((p, k) => p.setAttribute('aria-hidden', String(k !== curI)));
    requestAnimationFrame(fit);
  };
  [['image', 'Карточка'], ['edit', 'Ник'], ['star', 'Витрина']].forEach(([ic, t], k) => seg.appendChild(h('button', { type: 'button', onclick: () => go(k) }, mi(ic), h('span', { text: t }))));
  // палец: тянем ленту за собой, отпускаем — доезжает до вкладки
  let sx = 0, sy = 0, dx = 0, drag = 0;
  view.addEventListener('touchstart', (e) => { if (e.touches.length !== 1 || e.target.closest('.pe-frames, .pe-banners, .pe-badges, input, textarea')) { drag = -1; return; } sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = 0; drag = 0; }, { passive: true });
  view.addEventListener('touchmove', (e) => {
    if (drag === -1) return;
    const mx = e.touches[0].clientX - sx, my = e.touches[0].clientY - sy;
    if (drag === 0) { if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.3) drag = 1; else if (Math.abs(my) > 10) { drag = -1; return; } else return; }
    dx = mx; track.style.transition = 'none'; form.classList.add('dragging');
    const edge = (curI === 0 && dx > 0) || (curI === IDS.length - 1 && dx < 0) ? 0.3 : 1;
    track.style.transform = `translate3d(calc(${-curI * 100}% + ${dx * edge}px),0,0)`;
  }, { passive: true });
  view.addEventListener('touchend', () => { form.classList.remove('dragging'); if (drag === 1) { track.style.transition = ''; go(curI + (dx < -60 ? 1 : dx > 60 ? -1 : 0)); } drag = 0; });
  const ro = window.ResizeObserver ? new ResizeObserver(fit) : null;
  if (ro) panes.forEach((p) => ro.observe(p));
  const form = h('div', { class: 'pw-form pe pe2' }, upl, h('div', { class: 'pe-side' }, live), h('div', { class: 'pe-main' }, seg, view), h('div', { class: 'pe-save' }, save));
  openSheet('Мой профиль', form);
  go(0, false);
  setTimeout(fit, 50);
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
    return h('button', { type: 'button', class: `lb-row${u.uid === me ? ' me' : ''}${i < 3 ? ` top${i + 1}` : ''}${isDev(u.nick) ? ' dev' : ''}`, style: `--banner:${bannerCss(u.banner === 'img' ? 'accent' : u.banner)};animation-delay:${Math.min(i, 12) * 35}ms`, onclick: () => openUserPage(u.uid, u) },
      h('span', { class: 'lb-rank' }, i < 3 ? mi('medal') : String(i + 1)),
      h('span', { class: 'lb-av', 'data-frame': u.frame || 'none', 'data-shape': u.shape || 'circle' }, h('img', { src: avSrc(u.avatar), alt: '', loading: 'lazy' }), isOnline(u.seen) ? h('i', { class: 'online-dot' }) : null),
      h('div', { class: 'lb-body' },
        h('div', { class: 'lb-nick' }, h('span', { text: u.uid === me ? `${u.nick} · вы` : u.nick }), ...nickMarks(u)),
        u.now && isOnline(u.seen) ? h('div', { class: 'lb-status now', text: `Слушает: ${u.now}` }) : u.status ? richText(h('div', { class: 'lb-status' }), u.status) : null,
        (u.badges || []).length ? h('div', { class: 'lb-badges' }, (u.badges || []).filter((id) => ACH[id]).map((id) => mi(ACH[id].i))) : null),
      h('div', { class: 'lb-time' }, h('b', { text: String(t.value) }), h('small', { text: t.unit })),
      h('span', { class: 'chev', text: '›' }));
  }));
  if (myRank) refs.myRank.textContent = `Ваше место: ${myRank} из ${list.length}`;
  else refs.myRank.textContent = hiddenFromBoard() ? 'Вы скрыты из рейтинга' : 'Вас пока нет в топе. Послушайте ещё!';
  updateAch();
}

async function runBgCheck() {
  const box = h('div', { class: 'bgc' }, h('p', { class: 'profile-note', text: 'Проверяю… это займёт до 30 секунд' }));
  openSheet('Проверка фона', box);
  const cur = player.queue.current;
  const vid = player.st.vid && /^[\w-]{11}$/.test(player.st.vid) ? player.st.vid : 'kJQP7kiw5Fk';
  const t = cur && player.st.vid === vid ? cur : { artist: 'Luis Fonsi', title: 'Despacito', duration: 229 };
  const res = await checkBackground(vid, t);
  const ok = res.every((r) => r.ok);
  box.replaceChildren(
    h('div', { class: 'bgc-list' }, res.map((r) => h('div', { class: `bgc-row${r.ok ? ' ok' : ''}` }, h('span', { class: 'bgc-ic' }, mi(r.ok ? 'check' : 'close')), h('span', { text: r.text })))),
    h('p', { class: 'profile-note', text: ok ? 'Всё в порядке. Включите «Слушать в фоне», запустите трек и погасите экран.' : 'Фон может не работать. Если вы в России — включите VPN и проверьте ещё раз. Если сервер старый — админу нужно обновить Worker.' }),
    h('p', { class: 'profile-note', text: `Проверка на треке: ${t.artist} — ${t.title}` }));
}

// ---------- друзья ----------
// Друг — только взаимно: вы отправили заявку, он нажал «Принять» (или наоборот).
async function addByNick() {
  const nick = refs.frInput.value.trim();
  if (!nick) return;
  if (nick.toLowerCase() === curNick.toLowerCase()) { toast('Это вы :)'); return; }
  toast('Ищу…');
  const u = await findByNick(nick);
  if (!u) { toast('Не нашла такого слушателя. Он должен быть в рейтинге (Профиль → Топ)'); return; }
  const st = friendState(u.uid);
  if (st === 'friend') { toast(`${u.nick} уже у вас в друзьях`); return; }
  if (st === 'sent') { toast(`Заявка для ${u.nick} уже отправлена`); return; }
  try {
    await addFriend(u.uid); refs.frInput.value = '';
    toast(st === 'incoming' ? `Теперь вы друзья с ${u.nick}` : `Заявка отправлена. ${u.nick} станет другом, когда примет её`);
    renderFriends(true);
  } catch { toast('Не получилось. Админу нужно обновить правила Firestore'); }
}

function friendRow(u, kind) {
  const online = seenOnline(u.seen);
  const c = kind === 'friend' ? chatWith(u.uid) : null;
  const unread = c && isUnread(c);
  const line = kind === 'sent' ? 'Ждёт, когда примут заявку'
    : unread && c.last ? `Новое: ${c.last.text}`
    : u.hidden ? 'скрыл(а) профиль' : online && u.now ? `Слушает: ${u.now}` : seenText(u.seen) || plainRich(u.status) || '';
  const btns = [];
  if (kind === 'req') {
    btns.push(h('button', { class: 'btn fr-btn', type: 'button', onclick: async () => { try { await acceptRequest(u.uid); toast(`Теперь вы друзья с ${u.nick}`); renderFriends(true); } catch { toast('Не получилось'); } } }, 'Принять'),
      h('button', { class: 'btn tonal fr-btn', type: 'button', onclick: async () => { await declineRequest(u.uid); toast('Заявка отклонена'); renderFriends(); } }, 'Отклонить'));
  } else if (kind === 'sent') {
    btns.push(h('button', { class: 'btn tonal fr-btn', type: 'button', onclick: async () => { await removeFriend(u.uid); toast('Заявка отменена'); renderFriends(); } }, 'Отменить'));
  } else {
    if (online && u.now) btns.push(h('button', { class: 'icon-btn fr-btn', type: 'button', title: 'Включить то же', 'aria-label': 'Включить то же', onclick: async () => {
      toast(`Включаю: ${u.now}`);
      const f = await searchTracks(u.now).catch(() => []);
      if (f.length) player.playTracks(f.slice(0, 10), 0); else toast('Не нашла этот трек');
    } }, mi('play-circle')));
    btns.push(h('button', { class: `icon-btn fr-btn fr-chat${unread ? ' unread' : ''}`, type: 'button', title: 'Написать', 'aria-label': `Написать ${u.nick}`, onclick: () => openChat(u.uid, u) }, mi('chat')));
  }
  return h('div', { class: `lb-row fr-row${online ? ' online' : ''}${isDev(u.nick) ? ' dev' : ''}${kind === 'sent' ? ' sent' : ''}`, style: `--banner:${bannerCss(u.banner === 'img' ? 'accent' : u.banner)}` },
    h('button', { type: 'button', class: 'fr-main', onclick: () => !u.hidden && openUserPage(u.uid, u) },
      h('span', { class: 'lb-av', 'data-frame': u.frame || 'none', 'data-shape': u.shape || 'circle' }, h('img', { src: avSrc(u.avatar), alt: '', loading: 'lazy' }), online ? h('i', { class: 'online-dot' }) : null),
      h('div', { class: 'lb-body' }, h('div', { class: 'lb-nick' }, h('span', { text: u.nick }), ...nickMarks(u)), h('div', { class: `lb-status${online && u.now && kind === 'friend' && !unread ? ' now' : ''}${unread ? ' unread' : ''}`, text: line }))),
    btns.length ? h('div', { class: 'fr-req-btns' }, ...btns) : null);
}

let frBusy = false, frAgain = false;
async function renderFriends(force) {
  if (!refs.frList) return;
  if (frBusy) { frAgain = true; return; }
  frBusy = true;
  try {
    if (force || !friendsLoaded()) await loadFriends();
    const ids = friendIds(), reqIds = requestIds().slice(0, 20), sent = sentIds().slice(0, 30);
    const [cards, reqs, sents] = await Promise.all([friendCards(ids.slice(0, 60), force ? 0 : 60000), friendCards(reqIds), friendCards(sent, 300000)]);
    // сначала те, с кем есть непрочитанные, потом недавние чаты, потом кто в сети
    const lastAt = (u) => { const c = chatWith(u.uid); return c ? (isUnread(c) ? 1e15 : 0) + (Number(c.at) || 0) : 0; };
    cards.sort((a, b) => lastAt(b) - lastAt(a));
    refs.frReq.replaceChildren(...(reqs.length ? [h('div', { class: 'section-title', text: `Хотят дружить · ${reqs.length}` }), h('div', { class: 'lb-list' }, reqs.map((u) => friendRow(u, 'req')))] : []));
    const on = cards.filter((u) => seenOnline(u.seen)).length;
    refs.frList.replaceChildren(
      ...(cards.length ? [h('div', { class: 'section-title', text: `Друзья · ${cards.length}${on ? ` · в сети ${on}` : ''}` }), ...cards.map((u) => friendRow(u, 'friend'))]
        : [h('p', { class: 'profile-note center', text: 'Пока никого. Впишите ник друга выше — он получит заявку и станет другом, когда нажмёт «Принять».' })]),
      ...(sents.length ? [h('div', { class: 'section-title', text: `Отправленные заявки · ${sents.length}` }), ...sents.map((u) => friendRow(u, 'sent'))] : []));
    updateAch();
  } finally { frBusy = false; if (frAgain) { frAgain = false; renderFriends(); } }
}
// заявки и сообщения приходят вживую — перерисовываем вкладку, если она открыта
let frWatch = false;
function watchFriendsTab() {
  if (frWatch) return; frWatch = true;
  const re = () => { if (refs.tab === 'friends') renderFriends(); };
  onFriends(re); onChats(re);
}

const TABS = ['main', 'friends', 'board', 'set', 'about'];
// линза под активной вкладкой: на телефоне вкладки разной ширины и листаются пальцем
function placeLens(scroll) {
  const bar = refs.tabs; if (!bar) return;
  const b = bar.querySelector('.ptab.active'); if (!b || !b.offsetWidth) return;
  bar.style.setProperty('--lx', `${b.offsetLeft}px`); bar.style.setProperty('--lw', `${b.offsetWidth}px`);
  if (scroll && bar.scrollWidth > bar.clientWidth) bar.scrollTo({ left: b.offsetLeft - (bar.clientWidth - b.offsetWidth) / 2, behavior: 'smooth' });
}
// свайп по содержимому профиля влево/вправо — соседняя вкладка (если палец не на ленте, которая сама листается)
function inHScroll(el, stop) {
  for (let n = el; n && n !== stop; n = n.parentElement) {
    if (n.matches && n.matches('input, textarea, .switch, [type=range]')) return true;
    const cs = getComputedStyle(n);
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && n.scrollWidth > n.clientWidth + 4) return true;
  }
  return false;
}
function swipeTabs(area) {
  let x0 = 0, y0 = 0, t0 = 0, ok = false;
  area.addEventListener('touchstart', (e) => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); ok = e.touches.length === 1 && !inHScroll(e.target, area); }, { passive: true });
  area.addEventListener('touchend', (e) => {
    if (!ok || window.innerWidth >= 1000) return;
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6 || Date.now() - t0 > 700) return;
    const i = TABS.indexOf(refs.tab || 'main') + (dx < 0 ? 1 : -1);
    if (i >= 0 && i < TABS.length) setTab(TABS[i]);
  }, { passive: true });
}
window.addEventListener('resize', () => placeLens(false));

function setTab(name) {
  if (name === 'about') { try { localStorage.setItem('mkw.aboutseen', '0.37.0'); } catch { /* ignore */ } document.querySelectorAll('.ptab.has-new').forEach((b) => b.classList.remove('has-new')); }
  const dir = TABS.indexOf(name) - TABS.indexOf(refs.tab || 'main');
  refs.tab = name;
  $$('.ptab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.ppane').forEach((p) => { p.hidden = p.dataset.pane !== name; p.classList.toggle('from-right', dir > 0); p.classList.toggle('from-left', dir < 0); });
  refs.tabs.style.setProperty('--i', String(TABS.indexOf(name)));
  placeLens(true);
  if (name === 'board') loadBoard();
  if (name === 'friends') { watchFriendsTab(); renderFriends(); }
}

export function buildProfile(nick) {
  curNick = nick;
  const root = $('#view-profile');
  refs.nick = h('div', { class: 'hero-nick', text: nick });
  refs.since = h('div', { class: 'hero-since', text: '' });
  refs.status = h('div', { class: 'hero-status' });
  refs.bio = h('div', { class: 'hero-bio', hidden: '' });
  refs.heroBadges = h('div', { class: 'pbadges' });
  refs.top = h('div', { class: 'top-list' });
  refs.ach = h('div', { class: 'ach-grid' });
  refs.achCount = h('span', { class: 'ach-count' });
  refs.favA = h('div'); refs.favT = h('div');
  refs.showcase = h('div', { class: 'showcase' }, refs.favA, refs.favT);
  const sw = (on) => h('button', { class: 'switch', type: 'button', role: 'switch', onclick: on }, h('i'));
  refs.livebg = sw(() => { setLiveBg(!liveBg()); syncControls(); });
  refs.winter = sw(() => { setWinter(!winterOn()); syncControls(); });
  refs.player2 = sw(() => { setPlayer2(!player2On()); syncControls(); });
  refs.lowp = sw(() => { setLowPower(!lowPower()); syncControls(); });
  refs.gest = sw(async () => { await setGestures(!gesturesOn()); syncControls(); });
  refs.voice = sw(() => { setVoice(!voiceOn()); syncControls(); });
  refs.notify = sw(async () => { await setNotify(!notifyOn()); syncControls(); });
  refs.bgplay = sw(() => { setStreams(!streamsOn()); syncControls(); toast(streamsOn() ? 'Готово: выключите экран — музыка продолжит играть' : 'Фоновый режим выключен'); });
  refs.board = sw(async () => { await setHidden(!hiddenFromBoard()); syncControls(); if (!hiddenFromBoard()) pushCard(true); setTimeout(() => loadBoard(true), 1800); });
  refs.boardList = h('div', { class: 'lb-list' });
  refs.myRank = h('div', { class: 'lb-me' });
  refs.srcnote = h('small', { class: 'src-note' });
  refs.listeners = h('div', { class: 'listeners' }, mi('headphones'), h('span', { text: 'Слушателей: считаем…' }));
  // живые цифры: всего, кто в сети прямо сейчас и кто заходил за сутки
  Promise.all([listenerStats().catch(() => null), topListeners(400).catch(() => null)]).then(([st, list]) => {
    const all = Array.isArray(list) ? list : [];
    const on = all.filter((u) => seenOnline(u.seen)).length;
    const day = all.filter((u) => Date.now() - realSeen(u.seen) < 86400000).length;
    const total = Math.max(st ? Number(st.total) || 0 : 0, all.length);
    refs.listeners.lastChild.textContent = total ? `Слушателей: ${total}${total > all.length && all.length ? ` (в топе ${all.length} — остальные скрыты или ещё не слушали)` : ''} · сейчас в сети: ${on} · за сутки заходили: ${day}` : 'Счётчик слушателей пока недоступен';
  });
  connectionCountry().then((c) => { if (refs.country) refs.country.textContent = c || 'не удалось определить'; });
  const row = (title, desc, ctrl, onclick, ic) => h('div', { class: `set-row${onclick ? ' tap' : ''}`, onclick },
    ic ? h('span', { class: 'set-ic' }, mi(ic)) : null,
    h('div', { class: 'set-txt' }, h('b', { text: title }), desc ? h('small', { text: desc }) : null), ctrl);
  const group = (title, ...kids) => h('div', { class: 'set-group' }, h('div', { class: 'set-gt', text: title }), h('div', { class: 'set-card' }, ...kids));
  const chev = () => h('span', { class: 'chev', text: '›' });

  refs.hero = h('div', { class: 'phero' },
    h('div', { class: 'phero-banner' }),
    h('div', { class: 'phero-row' },
      h('div', { class: 'av-wrap' },
        h('button', { class: 'hero-avatar', type: 'button', 'aria-label': 'Сменить фото', onclick: () => avatarMenu(nick) }, refs.avatar = h('img', { src: getAvatar(nick), alt: '' })),
        h('button', { class: 'av-pen', type: 'button', 'aria-label': 'Сменить фото', title: 'Сменить фото', onclick: () => avatarMenu(nick) }, mi('edit'))),
      h('div', { class: 'phero-btns' },
        h('button', { class: 'btn tonal phero-edit', type: 'button', onclick: () => openUserPage(myUid(), null, true), title: 'Как видят другие' }, mi('person')),
        h('button', { class: 'btn tonal phero-edit', type: 'button', onclick: editProfile }, mi('edit'), ' Изменить'))),
    h('div', { class: 'phero-fx' }, ...Array.from({ length: 10 }, () => h('i'))),
    h('div', { class: 'phero-info' }, refs.nick, refs.marks = h('div', { class: 'nick-marks' }), refs.avHint = h('button', { class: 'av-hint', type: 'button', hidden: '', onclick: () => avatarMenu(nick) }, mi('edit'), h('span', { text: 'Поставьте своё фото — нажмите на аватар' })), refs.status, refs.bio, refs.since, refs.heroBadges));

  paintAvHint();
  restoreFan(nick).then(() => { paintMarks(getCustom()); });
  const tabBtn = (id, label, ic) => h('button', { class: 'ptab', type: 'button', 'data-tab': id, onclick: () => setTab(id) }, mi(ic), h('span', { text: label }));
  refs.tabs = h('div', { class: 'ptabs' }, h('i', { class: 'ptab-lens' }), tabBtn('main', 'Обзор', 'person'), tabBtn('friends', 'Друзья', 'group'), tabBtn('board', 'Топ', 'trophy'), tabBtn('set', 'Настройки', 'palette'), tabBtn('about', 'О MKW', 'note'));
  try { if (localStorage.getItem('mkw.aboutseen') !== '0.37.0') refs.tabs.querySelector('[data-tab=about]').classList.add('has-new'); } catch { /* ignore */ }

  root.replaceChildren(
    h('div', { class: 'p-side' }, refs.hero, refs.tabs),
    refs.pmain = h('div', { class: 'p-main' },
    h('div', { class: 'ppane', 'data-pane': 'main' },
      refs.fanCard = h('div', { class: 'fan-card', hidden: '' },
        h('img', { class: 'fan-star', src: 'assets/mkw-star.png', alt: '' }),
        h('div', { class: 'fan-txt' }, h('b', { text: 'Нравится MKW?' }), h('small', { text: 'Нажмите — и получите значок фаната со своим номером. Его увидят все рядом с вашим ником' })),
        h('button', { class: 'btn', type: 'button', onclick: (e) => likeMkw(e.currentTarget) }, mi('heart'), ' Мне нравится MKW')),
      h('div', { id: 'daily-entry' }),
      h('div', { class: 'stats-grid' },
        statCard('time', 'Прослушано', 'timer'), statCard('plays', 'Треков сыграно', 'play-circle'),
        statCard('likes', 'В избранном', 'heart'), statCard('playlists', 'Плейлистов', 'playlist')),
      refs.showcase,
      h('div', { class: 'section-title', text: 'Чаще всего слушаете' }), refs.top,
      h('div', { class: 'section-title' }, 'Достижения ', refs.achCount), refs.ach),
    h('div', { class: 'ppane', 'data-pane': 'friends', hidden: '' },
      h('div', { class: 'lb-head' }, h('div', { class: 'lb-hic fr' }, mi('group')), h('div', {}, h('b', { text: 'Друзья' }), h('small', { text: 'Кто в сети и что слушает прямо сейчас' }))),
      h('form', { class: 'fr-add', onsubmit: (e) => { e.preventDefault(); addByNick(); } },
        refs.frInput = h('input', { class: 'sheet-input', type: 'text', placeholder: 'Ник друга', autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false' }),
        h('button', { class: 'btn', type: 'submit' }, mi('add'), ' Добавить')),
      refs.frReq = h('div', { class: 'fr-req' }),
      refs.frList = h('div', { class: 'lb-list fr-list' })),
    h('div', { class: 'ppane', 'data-pane': 'board', hidden: '' },
      h('div', { class: 'lb-head' }, h('div', { class: 'lb-hic' }, mi('trophy')), h('div', {}, h('b', { text: 'Топ слушателей' }), h('small', { text: 'По времени прослушивания. Нажмите на человека, чтобы открыть профиль' }))),
      refs.myRank, refs.boardList,
      h('div', { class: 'set-card', style: 'margin-top:14px' }, row('Показывать меня в рейтинге', 'Ник, фото, баннер, статус, значки, витрина и часы видят другие слушатели', refs.board, null, 'group'))),
    h('div', { class: 'ppane', 'data-pane': 'set', hidden: '' },
      h('div', { class: 'set-group bg-beta' }, h('div', { class: 'set-card' },
        row('Слушать в фоне с выключенным экраном', 'Бета: работает не у всех и не со всеми треками. Полный трек переключается на звук, когда вы гасите экран. Из России — с VPN', refs.bgplay, null, 'moon'),
        row('Проверить фон', 'Покажет, что работает на вашем телефоне и в вашей сети', h('span', { class: 'chev', text: '›' }), runBgCheck, 'shield'))),
      group('Приложение',
        row('Установить как приложение', standalone() ? 'Уже установлено — вы в приложении' : 'Своя иконка и отдельное окно. Покажу, куда нажать — в Яндекс Браузере, Chrome, Edge и на телефоне', chev(), () => openInstall(false), 'install')),
      group('Внешний вид',
        h('div', { class: 'set-block' }, h('b', { text: 'Тема' }),
          h('div', { class: 'theme-cards' }, themeCard('auto', 'Авто'), themeCard('light', 'Светлая'), themeCard('dark', 'Тёмная'), themeCard('black', 'Чёрная'))),
        h('div', { class: 'set-block' }, h('b', { text: 'Цвет акцента' }),
          h('div', { class: 'swatch-row' }, ACCENTS.map((a) => swatch(a.id, a.name, a.h, () => { setAccent(a.id); syncControls(); })),
            refs.customSw = h('button', { class: 'swatch custom', type: 'button', 'data-id': 'custom', 'aria-label': 'Свой цвет', onclick: openColorPicker },
              h('span', { class: 'sw-prev' }, h('i'), h('i'), h('i'), h('b', {}, mi('palette'))), h('span', { class: 'sw-name', text: 'Свой' })))),
        row('Зимнее оформление', 'Снег, гирлянда и северное сияние. Можно выключить в любой момент', refs.winter, null, 'sparkle'),
        row('Новый вид плеера', 'Крупная обложка, волнистая полоса и скорость воспроизведения. Обычный плеер вернётся, если выключить', refs.player2, null, 'play-circle'),
        row('Живой фон плеера', 'Цвета обложки двигаются в такт', refs.livebg, null, 'sparkle')),
      group('Музыка',
        h('div', { class: 'set-block' }, h('b', { text: 'Где искать музыку' }),
          h('div', { class: 'src-row' }, SOURCE_MODES.map((m) => h('button', { class: 'chip src-chip', type: 'button', 'data-id': m.id, onclick: () => { setSourceMode(m.id); syncControls(); } }, m.name))),
          refs.srcnote),
        row('Страна подключения', 'С VPN покажет страну VPN', refs.country = h('span', { class: 'conn-country', text: '…' }), null, 'globe'),
        h('div', { class: 'vpn-note' }, h('span', { class: 'set-ic' }, mi('shield')), h('div', {}, h('b', { text: 'Нет звука или обложек из России?' }), h('small', { text: 'Провайдеры блокируют часть музыкальных серверов. Включите любой VPN, и всё заработает.' })))),
      group('Устройство',
        row('Оптимизация для слабых устройств', 'Отключает размытие и тяжёлые анимации', refs.lowp, null, 'rocket'),
        row('Жесты (бета)', 'Управление рукой через камеру, взмах ладонью — сменить трек', refs.gest, null, 'hand-open'),
        row('Уведомления', 'Звонки, сообщения и заявки в друзья — уведомлением на телефон и компьютер, даже когда MKW закрыт', refs.notify, null, 'bell'),
        row('Рингтон звонка', (() => { const r = getRingtone(); return r ? `${r.artist} — ${r.title}. Нажмите, чтобы вернуть гудки` : 'Гудки. Любую песню: меню трека (⋮) → «Поставить на звонок»'; })(), chev(), () => { if (getRingtone()) { clearRingtone(); setTimeout(() => { const t = refs.tab; refs.tab = ''; buildProfile(curNick); setTab(t || 'set'); }, 200); } else toast('Откройте меню любой песни (⋮) → «Поставить на звонок»'); }, 'bell'),
        row('Какие жесты показывать', 'Список жестов и что они делают', chev(), showGestureGuide, 'hand-peace'),
        row('Голосовое управление', voiceSupported() ? 'Скажите «МКВ» или «Музыка», потом команду: «МКВ, следующая», «МКВ, включить Баста», «МКВ, позвони Лере»' : 'Этот браузер не поддерживает', refs.voice, null, 'mic'),
        row('Какие команды говорить', 'Все голосовые команды', chev(), showVoiceGuide, 'note')),
      group('Аккаунт',
        row('Изменить профиль', 'Фото, баннер, статус, витрина', chev(), editProfile, 'edit'),
        isDev(curNick) ? row('Часы прослушивания', 'Поставить любое количество или вернуть как было', chev(), () => {
          const inp = h('input', { type: 'number', min: '0', step: '1', class: 'input', placeholder: 'Часов', value: String(Math.round(store.listenedTotal() / 3600)) });
          const done = async (sec, msg) => { try { await store.devSetListened(sec); toast(msg); closeSheet(); } catch { toast('Не получилось'); } };
          openSheet('Часы прослушивания', h('div', { style: 'padding:0 16px 20px;display:grid;gap:12px' }, inp,
            h('button', { type: 'button', class: 'btn', onclick: () => done(Math.max(0, Number(inp.value) || 0) * 3600, 'Часы сохранены') }, 'Поставить'),
            h('button', { type: 'button', class: 'btn tonal', onclick: () => { const o = store.devOrigListened(); if (o == null) { toast('Оригинал не менялся'); return; } done(o, 'Вернул как было'); store.devClearBackup(); } }, 'Вернуть как было')));
        }, 'timer') : null,
        isDev(curNick) ? row('Значок Contributor', 'Выдать или забрать значок у пользователей', chev(), () => openContribAdmin(() => topListeners(400)), 'star') : null,
        row('Сменить ник', 'Имя в приложении и вход', chev(), openNickSheet, 'person'),
        row('Сменить пароль', '', chev(), openPasswordSheet, 'shield'),
        row('Выйти', '', h('span', { class: 'chev' }, icon('logout')), () => logOut()))),
    h('div', { class: 'ppane', 'data-pane': 'about', hidden: '' },
      h('div', { class: 'about-card' },
        h('div', { class: 'about-top' }, h('img', { src: 'assets/mkw-logo.png', alt: '', class: 'about-logo' }), h('div', {}, h('b', { text: 'MKW Music' }), h('span', { class: 'beta-badge', text: `${STAGE} · v${VERSION}` }))),
        betaCard(),
        refs.listeners,
        h('p', { class: 'profile-note', text: 'MKW Music — название сервиса. MiloKwel — его создатель: он делает все обновления и разработку. Бета-версия: что-то может ломаться, всё чиним.' }),
        CHANGELOG.map((e, i) => changelogEntry(e, i === 0)),
        h('div', { class: 'cl-h warn', text: 'Известные проблемы' }),
        h('ul', {}, KNOWN_ISSUES.map((t) => h('li', { text: t })))))));

  built = true;
  pinDarkBadge();
  pinWaitBadge();
  if (!refs.voiceSync) { refs.voiceSync = true; window.addEventListener('mkw-voice', () => syncControls()); }
  swipeTabs(refs.pmain);
  requestAnimationFrame(() => placeLens(false));
  setTab(refs.tab || 'main');
  paintHero();
  syncControls();
  updateProfile();
  setTimeout(() => pushCard(true), 5000);
  if (!refs.presence) {
    // раз в 2 минуты «я в сети» (и в фоне, если играет музыка); ушли из приложения без музыки — сразу «не в сети»
    refs.presence = setInterval(() => { if (!document.hidden || player.st.playing) ping(nowPlaying()); }, 90000);
    let offT = 0;
    const away = () => { clearTimeout(offT); offT = setTimeout(() => { if (document.hidden && !player.st.playing) goOffline(); }, 8000); };
    document.addEventListener('visibilitychange', () => { if (document.hidden) away(); else { clearTimeout(offT); ping(nowPlaying(), true); } });
    window.addEventListener('pagehide', () => { if (!player.st.playing) goOffline(); });
    let lastNow = '';
    // «Слушает»: друзья видят новый трек почти сразу (через 3 секунды после смены — чтобы не писать на каждое переключение)
    let nowT = 0;
    player.onPlayer((ev) => { if (ev !== 'state' && ev !== 'track') return; const n = nowPlaying(); if (n !== lastNow) { lastNow = n; clearTimeout(nowT); nowT = setTimeout(() => ping(nowPlaying(), true), 3000); } });
  }
  if (!restored) {
    restored = true;
    // на новом устройстве подтягиваем оформление профиля с сервера
    let local = null; try { local = localStorage.getItem(CKEY(curNick)); } catch { /* ignore */ }
    // сменили ник раньше и оформление осталось под старым ником на этом устройстве — переносим
    if (!local) { try { const old = Object.keys(localStorage).find((k) => k.startsWith('mkw.pcustom.') && k !== CKEY(curNick)); if (old) { moveNickData(old.slice('mkw.pcustom.'.length), curNick); local = localStorage.getItem(CKEY(curNick)); paintHero(); } } catch { /* ignore */ } }
    if (!local) {
      restoring = true;
      getProfile(myUid()).then((p) => {
        if (!p) return myCard().then((c) => c && setLocal(c));
        setLocal(p);
        if (p.avatar && !isDefAv(p.avatar) && isDefAv(getAvatar(curNick))) { try { localStorage.setItem(AV(curNick), p.avatar); refs.avatar.src = p.avatar; paintAvHint(); } catch { /* ignore */ } }
        return null;
      }).finally(() => { restoring = false; });
    }
  }
}
// всё оформление живёт под ником — при смене ника переносим на новый
export function moveNickData(from, to) {
  if (!from || !to || from === to) return;
  try {
    Object.keys(localStorage).forEach((k) => { if (k.endsWith(`.${from}`)) { const nk = k.slice(0, -from.length) + to; if (localStorage.getItem(nk) == null) localStorage.setItem(nk, localStorage.getItem(k)); } });
  } catch { /* ignore */ }
}
function setLocal(p) {
  const keep = {};
  ['bio', 'nickStyle', 'shape', 'effect'].forEach((k) => { if (p[k]) keep[k] = p[k]; });
  try { localStorage.setItem(CKEY(curNick), JSON.stringify({ ...DEF, ...keep, status: p.status || '', banner: p.banner && p.banner !== 'img' ? p.banner : 'accent', bannerImg: p.bannerImg || '', frame: p.frame || 'glow', badges: p.badges || [], favArtists: p.favArtists || [], favTracks: p.favTracks || [], styled: true })); } catch { /* ignore */ }
  paintHero();
}

// осмотреть награду: большая иконка, как получить и прогресс
// поле с кнопкой «свои эмодзи MKW»: вставляет котика или стикер прямо в текст
function emoField(inp) {
  const pane = h('div', { class: 'emo-inl', hidden: '' });
  const put = (tok) => { const a = inp.selectionStart ?? inp.value.length, b = inp.selectionEnd ?? a; const v = inp.value.slice(0, a) + tok + inp.value.slice(b); if (v.length > Number(inp.maxLength || 999)) { toast('Не помещается'); return; } inp.value = v; inp.focus(); inp.setSelectionRange(a + tok.length, a + tok.length); inp.dispatchEvent(new Event('input', { bubbles: true })); };
  const btn = h('button', { type: 'button', class: 'emo-inl-btn', title: 'Свои эмодзи MKW', 'aria-label': 'Свои эмодзи MKW', onclick: () => {
    if (!pane.firstChild) pane.appendChild(emojiPicker({ onCat: (n) => put(`:c${n}:`), onSticker: (n) => put(`:s${n}:`), onEmoji: (e) => put(e), compact: true }));
    pane.hidden = !pane.hidden;
  } }, h('img', { src: catSrc(2), alt: '' }));
  return h('div', { class: 'emo-field' }, h('div', { class: 'emo-row' }, inp, btn), pane);
}
window.addEventListener('mkw-contrib', () => { try { if (built) paintMarks(getCustom()); } catch { /* ignore */ } boardLoaded = 0; });
export function viewAch(a, ok, v, pr) {
  openSheet('', h('div', { class: `ach-view${ok ? ' on' : ''}${a.cls ? ` ${a.cls}` : ''}` },
    h('div', { class: 'achv-ico' }, h('i', { class: 'achv-glow' }), mi(a.i)),
    h('b', { class: 'achv-t', text: a.title }),
    h('p', { class: 'achv-h', text: a.hint }),
    ok ? h('span', { class: 'achv-ok' }, mi('check'), ' Получено') : h('div', { class: 'achv-pr' }, h('div', { class: 'ach-bar' }, h('i', { style: `width:${Math.round(pr * 100)}%` })), h('small', { text: v ? `${Math.min(v[0], v[1])} из ${v[1]}` : 'Ещё не получено' }))));
}
function updateAch() {
  const s = statsNow();
  let got = 0;
  const list = ACHIEVEMENTS.filter((a) => !a.secret || achDone(a, s));
  refs.ach.replaceChildren(...list.map((a) => {
    const ok = achDone(a, s); if (ok) got += 1;
    const v = a.v ? a.v(s) : null;
    const pr = v ? Math.min(1, v[0] / v[1]) : (ok ? 1 : 0);
    return h('div', { class: `ach${ok ? ' on' : ''}${a.secret ? ' dev-ach' : ''}${a.cls ? ` ${a.cls}` : ''}`, title: a.hint, role: 'button', tabindex: '0', onclick: () => viewAch(a, ok, v, pr) },
      h('div', { class: 'ach-ico m' }, mi(a.i)),
      h('div', { class: 'ach-t', text: a.title }),
      h('div', { class: 'ach-h', text: ok ? 'Получено' : v ? `${a.hint} · ${Math.min(v[0], v[1])}/${v[1]}` : a.hint }),
      ok ? null : h('div', { class: 'ach-bar' }, h('i', { style: `width:${Math.round(pr * 100)}%` })));
  }));
  refs.achCount.textContent = `${got} из ${list.length}`;
}

export function updateProfile() {
  requestAnimationFrame(() => placeLens(false));
  window.dispatchEvent(new CustomEvent('mkw-daily-paint'));
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
      moveNickData(curNick, r.nick);
      closeSheet();
      toast(r.loginChanged ? 'Ник изменён. Входите по новому нику' : 'Имя изменено. Вход остаётся по прежнему нику');
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      err.textContent = e.userText || authErrorText(e);
    } finally { btn.disabled = false; }
  });
  openSheet('Смена ника', h('div', { class: 'pw-form' }, nk, pw, err, btn));
}
