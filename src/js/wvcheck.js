// Приложение рисует интерфейс через системный компонент Android System WebView. На телефонах, где он давно не обновлялся,
// часть оформления не поддерживается (экран выглядит «не так») и всё работает медленнее. Один раз в несколько дней
// подсказываем обновить его — это бесплатно и делается в Google Play за минуту.
import { h, openSheet, closeSheet } from './ui.js';
import { device } from './quality.js';

const KEY = 'mkw.wv.ask';
const NEED = 111; // с этой версии движок понимает всё оформление MKW
const PLAY = 'https://play.google.com/store/apps/details?id=com.google.android.webview';

export function webViewVersion() {
  const d = device();
  if (d && d.wv) return Number(d.wv) || 0;
  const m = /Chrome\/(\d+)/.exec(navigator.userAgent);
  return m ? Number(m[1]) : 0;
}

export function webViewOld() {
  let modern = true;
  try { modern = CSS.supports('color', 'color-mix(in srgb, red, blue)') && CSS.supports('selector(:has(a))'); } catch { modern = false; }
  const v = webViewVersion();
  return !modern || (v > 0 && v < NEED);
}

export function checkWebView() {
  if (!/MKWApp\//.test(navigator.userAgent) || !webViewOld()) return;
  document.documentElement.classList.add('old-wv');
  let last = 0;
  try { last = Number(localStorage.getItem(KEY)) || 0; } catch { /* ignore */ }
  if (Date.now() - last < 3 * 86400000) return;
  try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ }
  const v = webViewVersion();
  const huawei = /huawei|honor/i.test((device() && device().brand) || navigator.userAgent);
  setTimeout(() => {
    openSheet('Обновите компонент Android', h('div', { class: 'wv-note' },
      h('p', { text: `MKW рисует экран через системный компонент «Android System WebView». На этом телефоне он устарел${v ? ` (версия ${v})` : ''}, поэтому часть оформления может выглядеть криво, а приложение — работать медленнее и сильнее греть телефон.` }),
      h('p', { text: huawei
        ? 'Обновите «Android System WebView» (или «Huawei WebView») в AppGallery или в Настройках → Обновление системы. Если на телефоне есть Google Play — можно там.'
        : 'Обновите «Android System WebView» и «Google Chrome» в Google Play. Это бесплатно и занимает минуту, после обновления перезапустите MKW.' }),
      h('a', { class: 'btn block', href: PLAY, target: '_blank', rel: 'noopener noreferrer', text: 'Открыть в Google Play', onclick: () => setTimeout(closeSheet, 300) }),
      h('button', { class: 'btn tonal', type: 'button', text: 'Позже', onclick: closeSheet })));
  }, 6000);
}
