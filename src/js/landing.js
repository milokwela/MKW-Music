// Страница для тех, кто ещё не вошёл: промо MKW Music со стикерами + вход/регистрация.
import { APK_URL, PRIVACY_URL } from './apk.js';
import { inApp } from './install.js';
import { h } from './ui.js';
import { mi } from './icons2.js';
import { CATS, STICKERS, stSrc, catSrc } from './stickers.js';

const FEATS = [
  { i: 'sparkle', t: 'MKW Волна', s: 'Бесконечный поток музыки под ваш вкус — умнеет с каждым лайком' },
  { i: 'sticker', t: '36 стикеров и 15 котиков', s: 'Большие стикеры и реакции в чатах — бесплатно' },
  { i: 'mic', t: 'Голосовые', s: 'Держите кнопку или ставьте на замок, обрезайте перед отправкой' },
  { i: 'phone', t: 'Звонки до 4 человек', s: 'С показом экрана и общей музыкой прямо в звонке' },
  { i: 'star', t: 'Итоги недели', s: 'Сколько слушали, топ треков и исполнителей — как истории' },
  { i: 'headphones', t: 'Тексты песен', s: 'Строчки подсвечиваются в такт музыке' },
];

let done = false;
export function initLanding() {
  if (done) return; done = true;
  const scr = document.getElementById('auth-screen');
  const card = scr && scr.querySelector('.auth-card');
  if (!scr || !card) return;
  // в приложении — не промо-страница сайта, а простой экран входа на весь экран, как в обычных приложениях
  if (inApp) {
    scr.classList.add('app-auth');
    const logo = card.querySelector('.auth-logo'); if (logo) logo.src = 'assets/mkw-mark.png';
    card.append(h('p', { class: 'aa-foot' }, h('span', { text: 'MKW Music · by MiloKwel' }), ' · ', h('a', { href: PRIVACY_URL, target: '_blank', rel: 'noopener', text: 'Конфиденциальность' })));
    return;
  }
  const tab = (mode) => { const b = scr.querySelector(`#auth-tabs [data-mode="${mode}"]`); if (b) b.click(); };
  const toCard = (mode) => {
    tab(mode);
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('lp-ping'); void card.offsetWidth; card.classList.add('lp-ping');
    setTimeout(() => { const n = document.getElementById('auth-nick'); if (n) n.focus({ preventScroll: true }); }, 450);
  };
  // летающие стикеры вокруг трёх котиков
  const flyers = [5, 10, 12, 20, 24, 29, 33, 36].map((n, k) => h('img', { class: `lp-fly f${k + 1}`, src: stSrc(n), alt: '', decoding: 'async' }));
  const stage = h('div', { class: 'lp-stage', 'aria-hidden': 'true' },
    h('b', { class: 'lp-halo' }), ...flyers,
    h('img', { class: 'lp-cat l', src: stSrc(1), alt: '' }),
    h('img', { class: 'lp-cat r', src: catSrc(5), alt: '' }),
    h('img', { class: 'lp-cat c', src: stSrc(2), alt: '' }));
  const hero = h('div', { class: 'lp-hero' }, stage,
    h('span', { class: 'lp-chip' }, h('i'), 'Бесплатно · без рекламы'),
    h('h1', { class: 'lp-title' }, 'Музыка, друзья ', h('br'), 'и ', h('span', { text: 'котики MKW' })),
    h('p', { class: 'lp-sub', text: 'Слушайте любые треки, включайте MKW Волну под свой вкус, пишите друзьям, отправляйте голосовые и стикеры, звоните вместе.' }),
    h('div', { class: 'lp-cta' },
      h('button', { type: 'button', class: 'btn lp-go', onclick: () => toCard('register') }, 'Создать аккаунт'),
      h('button', { type: 'button', class: 'btn tonal lp-in', onclick: () => toCard('login') }, 'Войти')),
    // приложение для Android: на телефоне с Android — кнопка скачивания (файл качается сразу, без переходов)
    inApp ? null : /android/i.test(navigator.userAgent)
      ? h('div', { class: 'lp-app' },
        h('b', { text: 'Хотите приложение на Android?' }),
        h('small', { text: 'В нём музыка играет в фоне и при выключенном экране, а управлять можно с наушников и экрана блокировки. Бесплатно, Android 7.0 и новее. Скоро в RuStore.' }),
        h('div', { class: 'lp-app-btns' },
          h('a', { class: 'btn', href: APK_URL, download: '' }, mi('install'), 'Скачать приложение'),
          h('button', { type: 'button', class: 'btn tonal', onclick: () => toCard('register') }, 'Продолжить на сайте')))
      : h('div', { class: 'lp-app' },
        h('b', { text: 'MKW Music теперь и приложение для Android' }),
        h('small', { text: 'Музыка в фоне и при выключенном экране. Откройте mkwmusic.ru на телефоне с Android и нажмите «Скачать приложение». Скоро в RuStore.' })));
  const feats = h('div', { class: 'lp-feats' }, ...FEATS.map((f) => h('div', { class: 'lp-feat' }, h('span', { class: 'lp-fi' }, mi(f.i)), h('div', {}, h('b', { text: f.t }), h('small', { text: f.s })))));
  // стена стикеров — грузим, когда до неё доскроллили
  const all = [...STICKERS.map((s) => stSrc(s.n)), ...CATS.map((c) => catSrc(c.n))];
  const rowA = h('div', { class: 'lp-row' }), rowB = h('div', { class: 'lp-row rev' });
  const fill = () => {
    const half = Math.ceil(all.length / 2);
    const mk = (list) => { const imgs = list.map((src) => h('img', { src, alt: '', decoding: 'async' })); return h('div', { class: 'lp-track' }, ...imgs, ...imgs.map((i) => i.cloneNode())); };
    rowA.replaceChildren(mk(all.slice(0, half))); rowB.replaceChildren(mk(all.slice(half)));
  };
  const wall = h('section', { class: 'lp-wall' },
    h('div', { class: 'lp-wh' }, h('span', { class: 'lp-chip' }, h('i'), 'Промо'), h('h2', { text: 'Стикеры MKW — уже в каждом чате' }),
      h('p', { text: '36 стикеров и 15 котиков бесплатно. Отправляйте большие стикеры, ставьте реакции, а за 3 ежедневных задания выбирайте котика, который встанет рядом с вашим ником.' }),
      h('button', { type: 'button', class: 'btn lp-go', onclick: () => toCard('register') }, mi('sticker'), ' Забрать стикеры')),
    rowA, rowB);
  const foot = h('footer', { class: 'lp-foot' }, h('span', { text: 'MKW Music · mkwmusic.ru' }), h('span', { text: 'by MiloKwel' }), h('a', { href: PRIVACY_URL, target: '_blank', rel: 'noopener', text: 'Политика конфиденциальности', style: 'color:inherit' }));
  const top = h('div', { class: 'lp' }, hero, card, feats);
  scr.append(top, wall, foot);
  scr.classList.add('lp-on');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); fill(); } }, { rootMargin: '300px' });
    io.observe(wall);
  } else fill();
}
