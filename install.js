// Предложение установить приложение (Chrome/Android — родное окно, iPhone — подсказка).
import { h, openSheet, closeSheet } from './ui.js?v=0.13.1';

let deferred = null;
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const SKEY = 'mkw.install.later';

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
window.addEventListener('appinstalled', () => { deferred = null; closeSheet(); });

export function offerInstall() {
  if (standalone()) return;
  try { if (Date.now() - Number(localStorage.getItem(SKEY) || 0) < 3 * 864e5) return; } catch { /* ignore */ }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!deferred && !ios) return;
  const later = h('button', { class: 'btn tonal', type: 'button' }, 'Позже');
  later.addEventListener('click', () => { try { localStorage.setItem(SKEY, String(Date.now())); } catch { /* ignore */ } closeSheet(); });
  const kids = [h('p', { class: 'profile-note', text: 'Так удобнее: своя иконка, запуск без браузера, полный экран и быстрее открывается.' })];
  if (deferred) {
    const yes = h('button', { class: 'btn', type: 'button' }, 'Установить приложение');
    yes.addEventListener('click', async () => { try { deferred.prompt(); await deferred.userChoice; } catch { /* ignore */ } deferred = null; closeSheet(); });
    kids.push(yes);
  } else {
    kids.push(h('p', { class: 'profile-note', text: 'На iPhone: нажмите «Поделиться» в Safari → «На экран «Домой»».' }));
  }
  kids.push(later);
  openSheet('Установите MKW Music', h('div', { class: 'pw-form' }, ...kids));
}
