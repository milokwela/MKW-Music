// Разовое сообщение о переезде на новый домен.
import { h, openSheet, closeSheet } from './ui.js?v=0.11.1';

const KEY = 'mkw.moved.v1';

export function showMoved() {
  try { if (localStorage.getItem(KEY)) return; } catch { /* ignore */ }
  const ok = h('button', { class: 'btn', type: 'button' }, 'Отлично!');
  ok.addEventListener('click', () => { try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } closeSheet(); });
  openSheet('🎉 Ура, мы продвигаемся!', h('div', { class: 'pw-form' },
    h('p', { class: 'profile-note', text: 'MKW Music переехал на новый адрес — mkwmusic.ru. Всё на месте: лайки, плейлисты и история. Спасибо, что вы с нами! Если хотите, установите приложение заново: так удобнее.' }),
    ok));
}
