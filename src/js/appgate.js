// Обязательное обновление приложения: старые версии APK не работают, пока не обновят.
// Окно нельзя закрыть. Кнопка просит приложение скачать и поставить новую версию, а если приложение совсем старое — скачивает файл.
import { h } from './ui.js';
import { APK_URL } from './apk.js';

export const MIN_APP = '1.3.4';

const appVer = () => { const m = /MKWApp\/([\d.]+)/.exec(navigator.userAgent); return m ? m[1] : ''; };
const older = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0; }
  return false;
};

export function appGate() {
  const v = appVer();
  if (!v || !older(v, MIN_APP)) return false;
  const n = window.MKWNative;
  const go = () => {
    if (n && n.checkUpdate) n.checkUpdate();
    else location.href = APK_URL;
  };
  const box = h('div', { class: 'app-gate', role: 'alertdialog', 'aria-modal': 'true' },
    h('div', { class: 'ag-card' },
      h('img', { class: 'ag-logo', src: 'assets/mkw-mark.png', alt: '' }),
      h('h1', { text: 'Обновите приложение' }),
      h('p', { text: `Версия ${v} больше не работает. Установите MKW Music ${MIN_APP} или новее — вход, лайки и чаты сохранятся.` }),
      h('button', { type: 'button', class: 'btn block ag-go', onclick: go }, 'Обновить'),
      h('a', { class: 'ag-alt', href: APK_URL, text: 'Не получается? Скачать файл вручную' })));
  document.body.appendChild(box);
  document.documentElement.classList.add('gated');
  // окно открывается само — без нажатия
  setTimeout(go, 800);
  return true;
}
