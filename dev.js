// Престиж разработчика: MiloKwel (ник milokq) — создатель MKW Music. Видно всем: профиль, топ, друзья.
// Значок чёрный, со звездой MKW. Разработчик может его спрятать (Изменить → Значки у ника).
import { h } from './ui.js?v=0.27.7';

const DEV_NICKS = new Set(['milokq']);
export const isDev = (nick) => DEV_NICKS.has(String(nick || '').trim().toLowerCase());
// показывать ли значок разработчика у человека из рейтинга/друзей (u — карточка из Firestore)
export const showDev = (u) => Boolean(u && isDev(u.nick) && !u.devOff);

const star = () => h('img', { class: 'mkw-star', src: 'mkw-star-64.png', alt: '' });

export function devBadge(small = false) {
  return h('span', { class: `dev-badge v2${small ? ' sm' : ''}`, title: 'Создатель и разработчик MKW Music' }, star(), h('b', { text: small ? 'DEV' : 'Разработчик MKW' }));
}

// Значок фаната: «MKW #12». Номер по порядку — кто раньше нажал «Мне нравится MKW». У разработчика #1.
export const validFan = (u) => { const n = Number(u && u.fan) || 0; return n >= 2 || (n === 1 && isDev(u.nick)); };
export function fanBadge(n, small = false) {
  return h('span', { class: `fan-badge${small ? ' sm' : ''}${n === 1 ? ' one' : ''}`, title: `Фанат MKW Music №${n}` }, star(), h('b', { text: small ? `#${n}` : `MKW #${n}` }));
}
// значки рядом с ником в списках
export function nickMarks(u) {
  // у разработчика в списках хватает «DEV», иначе ник не помещается
  return [showDev(u) ? devBadge(true) : null, validFan(u) && !showDev(u) ? fanBadge(Number(u.fan), true) : null].filter(Boolean);
}
