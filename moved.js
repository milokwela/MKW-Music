// Разовое сообщение о переезде на новый домен.
import { h, openSheet, closeSheet } from './ui.js?v=0.21.0';

const KEY = 'mkw.moved.v1';

export function showMoved() {
  try { if (localStorage.getItem(KEY)) return; } catch { /* ignore */ }
  const ok = h('button', { class: 'btn', type: 'button' }, 'Отлично!');
  ok.addEventListener('click', () => { try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } closeSheet(); });
  openSheet('Ура, мы продвигаемся!', h('div', { class: 'pw-form' },
    h('p', { class: 'profile-note', text: 'MKW Music переехал на новый адрес — mkwmusic.ru. Всё на месте: лайки, плейлисты и история. Спасибо, что вы с нами! Если хотите, установите приложение заново: так удобнее.' }),
    ok));
}

// Новая иконка: у установленного приложения значок на телефоне сам не меняется, предлагаем переустановить.
const IKEY = 'mkw.icon.v5';
export function showIconUpdate() {
  const installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (!installed) return;
  try { if (localStorage.getItem(IKEY)) return; } catch { /* ignore */ }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  // Android (Chrome/Яндекс) обновляет значок сам по manifest в течение суток, напоминание нужно только на iPhone
  if (!ios) return;
  const ok = h('button', { class: 'btn', type: 'button' }, 'Понятно');
  ok.addEventListener('click', () => { try { localStorage.setItem(IKEY, '1'); } catch { /* ignore */ } closeSheet(); });
  const later = h('button', { class: 'btn tonal', type: 'button' }, 'Напомнить позже');
  later.addEventListener('click', () => closeSheet());
  openSheet('У MKW новый логотип', h('div', { class: 'pw-form' },
    h('img', { src: 'mkw-logo.png', alt: '', style: 'width:96px;height:96px;border-radius:26%;margin:4px auto 10px;display:block;box-shadow:0 10px 30px rgba(0,0,0,.35)' }),
    h('p', { class: 'profile-note', text: ios
      ? 'Чтобы на экране «Домой» появилась новая иконка, удалите старый ярлык MKW и добавьте заново: в Safari откройте mkwmusic.ru → «Поделиться» → «На экран Домой». Ваш аккаунт, лайки и плейлисты сохранятся.'
      : 'Чтобы увидеть новую иконку, переустановите приложение: удалите старый значок MKW и установите заново через меню браузера («Установить приложение»). Chrome иногда обновляет иконку сам в течение нескольких дней. Ваш аккаунт, лайки и плейлисты сохранятся.' }),
    ok, later));
}
