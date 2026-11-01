// Престиж разработчика: MiloKwel (ник milokq) — создатель MKW Music. Видно всем: профиль, топ, друзья.
import { h } from './ui.js?v=0.22.0';
import { mi } from './icons2.js?v=0.22.0';

const DEV_NICKS = new Set(['milokq']);
export const isDev = (nick) => DEV_NICKS.has(String(nick || '').trim().toLowerCase());

export function devBadge(small = false) {
  return h('span', { class: `dev-badge${small ? ' sm' : ''}`, title: 'Создатель и разработчик MKW Music' }, mi('verified'), h('b', { text: small ? 'DEV' : 'Разработчик MKW' }));
}
