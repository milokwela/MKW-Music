// Установить MKW Music как приложение: своя иконка, отдельное окно, запуск без браузера.
// Chrome / Edge / Яндекс Браузер на компьютере и Android — родное окно установки в один клик (если браузер его даёт),
// иначе — пошаговая подсказка для вашего браузера и живая демонстрация, куда нажимать.
import { h, openSheet, closeSheet, isSheetOpen, toast } from './ui.js?v=0.35.3';
import { mi } from './icons2.js?v=0.35.3';

let deferred = null;
export const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: window-controls-overlay)').matches || navigator.standalone === true;
const SKEY = 'mkw.install.later';
const ASK = 'mkw.install.ask';
const ASK_V = '0.27'; // после этого обновления предлагаем установить всем ещё раз

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; window.dispatchEvent(new CustomEvent('mkw-installable')); });
window.addEventListener('appinstalled', () => { deferred = null; closeSheet(); toast('MKW Music установлен — ищите иконку на рабочем столе'); });
export const canOneClick = () => Boolean(deferred);

// какой у человека браузер и устройство
export function browserInfo() {
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /android/i.test(ua);
  const name = /YaBrowser|YaSearchBrowser/i.test(ua) ? 'yandex' : /Edg\//.test(ua) ? 'edge' : /OPR\/|Opera/.test(ua) ? 'opera'
    : /SamsungBrowser/i.test(ua) ? 'samsung' : /Firefox\/|FxiOS/.test(ua) ? 'firefox' : /CriOS|Chrome\//.test(ua) ? 'chrome' : /Safari\//.test(ua) ? 'safari' : 'other';
  return { ios, android, mobile: ios || android, name };
}
const NAMES = { yandex: 'Яндекс Браузер', edge: 'Microsoft Edge', opera: 'Opera', samsung: 'Samsung Internet', firefox: 'Firefox', chrome: 'Chrome', safari: 'Safari', other: 'ваш браузер' };

// шаги для каждого браузера: { steps: [...], demo: 'pc' | 'phone' | 'ios', menu: 'пункт меню' }
function guide(b) {
  if (b.ios) {
    return { demo: 'ios', menu: 'На экран «Домой»', steps: [
      b.name === 'safari' ? 'Нажмите «Поделиться» внизу экрана (квадрат со стрелкой вверх)' : 'Нажмите «Поделиться» (квадрат со стрелкой) — в Chrome и Яндексе он в адресной строке или в меню',
      'Пролистайте вниз и выберите «На экран «Домой»»',
      'Нажмите «Добавить» — иконка MKW появится на главном экране',
    ] };
  }
  if (b.android) {
    if (b.name === 'yandex') return { demo: 'phone', menu: 'Добавить ярлык на телефон', steps: ['Нажмите меню ⋮ (три точки) внизу справа', 'Выберите «Добавить ярлык на телефон» (или «Установить приложение»)', 'Нажмите «Добавить» — MKW появится на главном экране'] };
    if (b.name === 'samsung') return { demo: 'phone', menu: 'Главный экран', steps: ['Нажмите меню ≡ внизу справа', 'Выберите «Добавить страницу на» → «Главный экран»', 'Нажмите «Добавить»'] };
    if (b.name === 'firefox') return { demo: 'phone', menu: 'Установить', steps: ['Нажмите меню ⋮', 'Выберите «Установить»', 'Нажмите «Добавить»'] };
    return { demo: 'phone', menu: 'Установить приложение', steps: ['Нажмите меню ⋮ (три точки) вверху справа', 'Выберите «Установить приложение» или «Добавить на гл. экран»', 'Нажмите «Установить» — MKW появится среди приложений'] };
  }
  if (b.name === 'yandex') return { demo: 'pc', menu: 'Установить как приложение', steps: ['В адресной строке справа нажмите «Меню страницы»', 'Выберите «Установить как приложение»', 'Выберите «Отдельное окно» — MKW появится на рабочем столе и в «Пуске». Можно включить автозапуск'] };
  if (b.name === 'edge') return { demo: 'pc', menu: 'Установить MKW Music', steps: ['Нажмите значок установки в адресной строке справа (или меню … → «Приложения»)', 'Выберите «Установить MKW Music»', 'Нажмите «Установить» — откроется отдельное окно'] };
  if (b.name === 'firefox') return { demo: 'pc', menu: 'Установить', steps: ['Firefox на компьютере не устанавливает сайты как приложения', 'Откройте mkwmusic.ru в Яндекс Браузере, Chrome или Edge', 'И нажмите «Установить» — так будет отдельное окно и иконка'] };
  if (b.name === 'safari') return { demo: 'pc', menu: 'Добавить в Dock', steps: ['В меню «Файл» выберите «Добавить в Dock»', 'Нажмите «Добавить»', 'MKW появится в Dock и в Launchpad'] };
  return { demo: 'pc', menu: 'Установить MKW Music', steps: ['Нажмите значок установки в адресной строке справа (монитор со стрелкой)', 'Или меню ⋮ → «Трансляция, сохранение и отправка» → «Установить MKW Music»', 'Нажмите «Установить» — MKW откроется в своём окне'] };
}

// живая демонстрация: анимированный браузер или телефон, куда нажимать
export function installDemo(kind, menu) {
  if (kind === 'pc') {
    return h('div', { class: 'idemo pc', 'aria-hidden': 'true' },
      h('div', { class: 'id-win' },
        h('div', { class: 'id-bar' }, h('i'), h('i'), h('i'), h('span', { class: 'id-url', text: 'mkwmusic.ru' }), h('span', { class: 'id-ico' }, mi('install'))),
        h('div', { class: 'id-page' }, h('img', { src: 'mkw-star-64.png', alt: '' }), h('b', { text: 'MKW Music' }), h('span'), h('span')),
        h('div', { class: 'id-menu' }, h('span', { text: 'Открыть в новой вкладке' }), h('span', { class: 'hl' }, mi('install'), menu), h('span', { text: 'Поделиться' }))),
      h('div', { class: 'id-app' }, h('div', { class: 'id-appbar' }, h('img', { src: 'mkw-star-64.png', alt: '' }), 'MKW Music'), h('div', { class: 'id-page' }, h('b', { text: 'Своё окно' }), h('span'), h('span'))),
      h('div', { class: 'id-desk' }, h('img', { src: 'ic5-192.png', alt: '' }), h('small', { text: 'MKW Music' })),
      h('i', { class: 'id-cursor' }));
  }
  const ios = kind === 'ios';
  return h('div', { class: `idemo phone${ios ? ' ios' : ''}`, 'aria-hidden': 'true' },
    h('div', { class: 'id-phone' },
      h('div', { class: 'id-page' }, h('img', { src: 'mkw-star-64.png', alt: '' }), h('b', { text: 'MKW Music' }), h('span'), h('span')),
      h('span', { class: 'id-ico' }, ios ? mi('install') : h('b', { text: '⋮' })),
      h('div', { class: 'id-menu' }, h('span', { text: ios ? 'Скопировать' : 'Новая вкладка' }), h('span', { class: 'hl' }, mi('add'), menu), h('span', { text: ios ? 'В закладки' : 'Поделиться' })),
      h('div', { class: 'id-home' }, ...[0, 1, 2, 3, 4, 5, 6].map((i) => h('i', { class: `a${i}` })), h('span', { class: 'id-new' }, h('img', { src: 'ic5-192.png', alt: '' }), h('small', { text: 'MKW' }))),
      h('i', { class: 'id-tap' })));
}

export function openInstall(first) {
  const b = browserInfo();
  if (standalone()) {
    openSheet('MKW Music установлен', h('div', { class: 'pw-form inst' },
      h('div', { class: 'inst-ok' }, h('img', { src: 'ic5-192.png', alt: '' }), h('div', {}, h('b', { text: 'Вы уже в приложении' }), h('small', { text: 'Иконка MKW на рабочем столе или главном экране открывает его сразу' })))));
    return;
  }
  const g = guide(b);
  const kids = [
    h('p', { class: 'profile-note', text: first ? 'Мы обновились! Поставьте MKW Music как приложение: своя иконка, отдельное окно, запуск без браузера — и работает быстрее.' : 'Своя иконка, отдельное окно, запуск без браузера — и работает быстрее.' }),
  ];
  if (deferred) {
    const yes = h('button', { class: 'btn inst-go', type: 'button' }, mi('install'), h('span', { text: 'Установить в один клик' }));
    yes.addEventListener('click', async () => {
      try { deferred.prompt(); const r = await deferred.userChoice; if (r && r.outcome === 'accepted') closeSheet(); } catch { /* ignore */ }
      deferred = null;
    });
    kids.push(yes, h('div', { class: 'inst-or', text: 'или вручную' }));
  }
  kids.push(
    h('div', { class: 'inst-for' }, mi(b.mobile ? 'person' : 'screen'), h('span', { text: `${NAMES[b.name]} · ${b.ios ? 'iPhone' : b.android ? 'Android' : 'компьютер'}` })),
    installDemo(g.demo, g.menu),
    h('ol', { class: 'inst-steps' }, ...g.steps.map((t) => h('li', { text: t }))),
    h('details', { class: 'inst-more' }, h('summary', { text: 'Другой браузер или устройство' }),
      h('div', { class: 'inst-other' },
        ...[['Яндекс Браузер · компьютер', 'Адресная строка → «Меню страницы» → «Установить как приложение»'],
          ['Яндекс Браузер · телефон', 'Меню ⋮ → «Добавить ярлык на телефон» → «Добавить»'],
          ['Chrome · компьютер', 'Значок установки в адресной строке или ⋮ → «Трансляция, сохранение и отправка» → «Установить MKW Music»'],
          ['Chrome · Android', 'Меню ⋮ → «Установить приложение» / «Добавить на гл. экран»'],
          ['Edge', 'Значок установки в адресной строке или … → «Приложения» → «Установить MKW Music»'],
          ['iPhone · Safari', '«Поделиться» → «На экран «Домой»» → «Добавить»']].map(([a, t]) => h('div', {}, h('b', { text: a }), h('small', { text: t }))))));
  if (first) {
    const later = h('button', { class: 'btn tonal', type: 'button', text: 'Позже' });
    later.addEventListener('click', () => { try { localStorage.setItem(SKEY, String(Date.now())); } catch { /* ignore */ } closeSheet(); });
    kids.push(later);
  }
  openSheet('Установите MKW Music', h('div', { class: 'pw-form inst' }, ...kids));
}

export function offerInstall() {
  if (standalone()) return;
  // поверх другого окна не показываем — попробуем чуть позже
  if (isSheetOpen() || document.querySelector('.nw:not(.out), .upd, .call-in, .inc')) { setTimeout(offerInstall, 12000); return; }
  let asked = '';
  try { asked = localStorage.getItem(ASK) || ''; } catch { /* ignore */ }
  if (asked !== ASK_V) {
    try { localStorage.setItem(ASK, ASK_V); } catch { /* ignore */ }
    openInstall(true);
    return;
  }
  try { if (Date.now() - Number(localStorage.getItem(SKEY) || 0) < 7 * 864e5) return; } catch { /* ignore */ }
  if (!deferred) return; // напоминаем только там, где можно поставить в один клик
  openInstall(true);
}
