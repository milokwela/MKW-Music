// Экран «Профиль»: статистика, достижения, топ исполнителей, тема, версии.
import { $, $$, h, icon } from './ui.js';
import * as store from './store.js';
import { ACCENTS, getTheme, getAccent, setTheme, setAccent } from './theme.js';
import { CHANGELOG, VERSION, STAGE, KNOWN_ISSUES } from './changelog.js';
import { plural } from './utils.js';
import { youtubeEnabled, autoYouTube, setAutoYouTube } from './youtube.js';
import { logOut } from './auth.js';

const ACHIEVEMENTS = [
  { id: 'like1', icon: 'heart', title: 'Первый лайк', hint: 'Лайкните любой трек', ok: (s) => s.likes >= 1 },
  { id: 'like10', icon: 'heart-fill', title: 'Коллекционер', hint: '10 лайков', ok: (s) => s.likes >= 10 },
  { id: 'pl1', icon: 'library', title: 'Составитель', hint: 'Создайте плейлист', ok: (s) => s.playlists >= 1 },
  { id: 'h1', icon: 'clock', title: 'Час музыки', hint: 'Послушайте 1 час', ok: (s) => s.sec >= 3600 },
  { id: 'h10', icon: 'music', title: 'Меломан', hint: 'Послушайте 10 часов', ok: (s) => s.sec >= 36000 },
];

let built = false;
const refs = {};

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

function statCard(key, label, iconName) {
  const num = h('span', { class: 'stat-num', text: '0' });
  const unit = h('span', { class: 'stat-unit' });
  refs[key] = { num, unit };
  return h('div', { class: 'stat-card' },
    h('div', { class: 'stat-ico' }, icon(iconName)),
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
  if (refs.autoyt) refs.autoyt.classList.toggle('active', autoYouTube());
  $$('.accent-dot').forEach((c) => c.classList.toggle('active', c.dataset.id === getAccent()));
}

function changelogEntry(entry, open) {
  const body = [];
  if (entry.new.length) body.push(h('div', { class: 'cl-h', text: 'Новое' }), h('ul', {}, entry.new.map((t) => h('li', { text: t }))));
  if (entry.fixed.length) body.push(h('div', { class: 'cl-h fix', text: 'Исправлено' }), h('ul', {}, entry.fixed.map((t) => h('li', { text: t }))));
  const d = h('details', { class: 'cl' }, h('summary', {}, h('b', { text: `v${entry.version}` }), h('span', { text: entry.date })), ...body);
  if (open) d.open = true;
  return d;
}

export function buildProfile(nick) {
  const root = $('#view-profile');
  refs.nick = h('div', { class: 'hero-nick', text: nick });
  refs.since = h('div', { class: 'hero-since', text: '' });
  refs.top = h('div', { class: 'top-list' });
  refs.ach = h('div', { class: 'ach-grid' });
  refs.yt = h('p', { class: 'profile-note' });
  refs.autoyt = h('button', { class: 'chip', type: 'button', onclick: () => { setAutoYouTube(!autoYouTube()); syncControls(); } }, 'Искать и на YouTube сразу');

  root.replaceChildren(
    h('div', { class: 'hero' },
      h('div', { class: 'hero-avatar' }, h('span', { text: nick.slice(0, 1) })),
      h('div', { class: 'hero-info' }, refs.nick, refs.since,
        h('span', { class: 'beta-badge', text: `${STAGE} · v${VERSION}` }))),

    h('div', { class: 'section-title', text: 'Статистика' }),
    h('div', { class: 'stats-grid' },
      statCard('time', 'Прослушано', 'clock'),
      statCard('plays', 'Треков сыграно', 'music'),
      statCard('likes', 'В избранном', 'heart-fill'),
      statCard('playlists', 'Плейлистов', 'library')),

    h('div', { class: 'section-title', text: 'Любимые исполнители' }),
    refs.top,

    h('div', { class: 'section-title', text: 'Достижения' }),
    refs.ach,

    h('div', { class: 'section-title', text: 'Внешний вид' }),
    h('div', { class: 'theme-cards' }, themeCard('auto', 'Авто'), themeCard('light', 'Светлая'), themeCard('dark', 'Тёмная')),
    h('div', { class: 'accent-row' }, ACCENTS.map((a) => h('button', {
      class: 'accent-dot', type: 'button', 'data-id': a.id, 'aria-label': a.name, title: a.name,
      style: `--dot:hsl(${a.h} 80% 62%)`,
      onclick: () => { setAccent(a.id); syncControls(); },
    }))),

    h('div', { class: 'section-title', text: 'Звук' }),
    refs.yt,
    h('div', { class: 'lib-actions' }, refs.autoyt),
    h('p', { class: 'profile-note', text: 'Быстрее старт и больше исполнителей, но тратит дневной лимит YouTube (около 100 поисков на всех).' }),

    h('div', { class: 'section-title' , text: 'О приложении' }),
    h('div', { class: 'about-card' },
      h('div', { class: 'about-top' }, h('b', { text: 'MKW Music' }), h('span', { class: 'beta-badge', text: `${STAGE} · v${VERSION}` })),
      h('p', { class: 'profile-note', text: 'Это бета-версия: что-то может ломаться, мы это чиним.' }),
      CHANGELOG.map((e, i) => changelogEntry(e, i === 0)),
      h('div', { class: 'cl-h warn', text: 'Известные проблемы' }),
      h('ul', {}, KNOWN_ISSUES.map((t) => h('li', { text: t })))),

    h('button', { class: 'btn tonal logout', type: 'button', onclick: () => logOut() }, icon('logout'), 'Выйти'),
    h('p', { class: 'profile-note center', text: `MKW ${VERSION} ${STAGE}` }));

  built = true;
  syncControls();
  updateProfile();
}

export function updateProfile() {
  if (!built) return;
  const p = store.state.profile || {};
  const sec = store.listenedTotal();
  const likes = store.state.likes.length;
  const playlists = store.state.playlists.length;
  const plays = Number(p.plays) || store.state.history.length;

  const t = formatListened(sec);
  countTo(refs.time.num, t.value);
  refs.time.unit.textContent = ` ${t.unit}`;
  countTo(refs.plays.num, plays);
  countTo(refs.likes.num, likes);
  countTo(refs.playlists.num, playlists);

  if (p.createdAt) {
    const days = Math.max(1, Math.ceil((Date.now() - p.createdAt) / 86400000));
    refs.since.textContent = `С нами ${days} ${plural(days, 'день', 'дня', 'дней')}`;
  }

  // топ исполнителей по лайкам и последним прослушиваниям
  const counts = new Map();
  for (const tr of [...store.state.likes, ...store.state.history]) {
    if (tr.artist) counts.set(tr.artist, (counts.get(tr.artist) || 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!top.length) refs.top.replaceChildren(h('p', { class: 'profile-note', text: 'Послушайте пару треков, и здесь появится ваш топ.' }));
  else {
    const max = top[0][1];
    refs.top.replaceChildren(...top.map(([name, n], i) => h('div', { class: 'top-row' },
      h('span', { class: 'top-rank', text: String(i + 1) }),
      h('div', { class: 'top-body' }, h('div', { class: 'top-name', text: name }),
        h('div', { class: 'top-bar' }, h('i', { style: `width:${Math.max(12, (n / max) * 100)}%` }))))));
  }

  const stats = { sec, likes, playlists };
  refs.ach.replaceChildren(...ACHIEVEMENTS.map((a) => {
    const ok = a.ok(stats);
    return h('div', { class: `ach${ok ? ' on' : ''}`, title: a.hint },
      h('div', { class: 'ach-ico' }, icon(a.icon)),
      h('div', { class: 'ach-t', text: a.title }),
      h('div', { class: 'ach-h', text: ok ? 'Получено' : a.hint }));
  }));

  refs.yt.textContent = youtubeEnabled()
    ? 'Играют полные треки через YouTube. Если трек не нашёлся, играет фрагмент 30 секунд.'
    : 'Сейчас играют фрагменты по 30 секунд. Полные треки включатся после подключения ключа YouTube.';
}

export function resetProfile() {
  built = false;
}

setInterval(() => { if (built && !$('#view-profile').hidden) updateProfile(); }, 10000);
