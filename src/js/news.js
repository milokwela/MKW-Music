// Окно «Вышло крупное обновление»: картинки вместо текста, кнопки «Ого!» и «Пропустить». Показывается один раз.
import { h, toast } from './ui.js';
import { APK_URL } from './apk.js';
import { inApp } from './install.js';
import { mi } from './icons2.js';
import { VERSION } from './changelog.js';

const KEY = 'mkw.news';
// что нового в последней версии — каждое окно показывается один раз на версию
const SLIDES = [
  { tag: 'Праздник', title: 'MKW Music теперь на Android', text: 'Настоящее приложение. В нём есть то, чего раньше не было — листайте', icon: 'rocket', orbit: ['star', 'heart', 'sparkle'], hue: 330 },
  { tag: 'Наконец-то', title: 'Музыка в фоне', text: 'Сверните приложение или погасите экран — трек не остановится. Спустя много попыток это работает', icon: 'moon', orbit: ['note', 'star', 'sparkle'], hue: 265 },
  { tag: 'Управление', title: 'Экран блокировки и наушники', text: 'Пауза, следующий трек и перемотка — с экрана блокировки, из шторки, с Bluetooth-наушников и в машине', icon: 'headphones', orbit: ['play', 'pause', 'note'], hue: 200 },
  { tag: 'Bluetooth', title: 'Подключить устройство', text: 'Поиск наушников и колонок, заряд, громкость телефона — прямо в плеере. Голос и жесты тоже меняют громкость телефона', icon: 'phone', orbit: ['headphones', 'mic', 'sparkle'], hue: 165 },
  { tag: 'Бесплатно', title: 'Скачайте приложение', text: 'Android 7.0 и новее. Быстрее сайта и само следит за обновлениями. Скоро мы будем в RuStore', icon: 'install', orbit: ['shield', 'rocket', 'heart'], hue: 335 },
];
export const NEWS_VER = '0.39.0';
const ANDROID = /android/i.test(navigator.userAgent);


export function showNews() {
  const ver = NEWS_VER; // окно — для версии с большой новостью, мелкие исправления его не показывают
  if (inApp) { try { localStorage.setItem(KEY, ver); } catch { /* ignore */ } return; } // в самом приложении звать в приложение незачем
  try { if (localStorage.getItem(KEY) === ver) return; } catch { return; }
  if (document.querySelector('.inc')) { setTimeout(showNews, 8000); return; } // сначала сообщение о сбое
  let i = 0;
  const done = () => { try { localStorage.setItem(KEY, ver); } catch { /* ignore */ } box.classList.add('out'); setTimeout(() => box.remove(), 350); };
  const slides = SLIDES.map((s) => h('div', { class: `nw-slide${s.glow ? ' glow' : ''}`, style: `--h:${s.hue}` },
    h('div', { class: 'nw-art' },
      h('i', { class: 'nw-ring' }), h('i', { class: 'nw-ring r2' }),
      h('div', { class: `nw-core${s.img ? ' img' : ''}` }, s.img ? h('img', { src: s.img, alt: '' }) : mi(s.icon)),
      ...s.orbit.map((o, k) => h('span', { class: `nw-orb o${k + 1}` }, mi(o)))),
    h('span', { class: 'nw-tag', text: s.tag }),
    h('h2', { text: s.title }),
    h('p', { text: s.text })));
  const track = h('div', { class: 'nw-track' }, ...slides);
  const dots = h('div', { class: 'nw-dots' }, SLIDES.map(() => h('i')));
  const wow = h('button', { class: 'btn nw-wow', type: 'button' }, 'Ого!');
  const skip = h('button', { class: 'btn tonal nw-skip', type: 'button', onclick: done }, 'Позже');
  const go = (n) => {
    i = Math.max(0, Math.min(SLIDES.length - 1, n));
    track.style.transform = `translateX(${-i * 100}%)`;
    [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
    slides.forEach((s, k) => s.classList.toggle('on', k === i));
    wow.textContent = i === SLIDES.length - 1 ? (ANDROID ? 'Скачать приложение' : 'Круто!') : 'Ого!';
  };
  wow.addEventListener('click', () => { if (i < SLIDES.length - 1) { go(i + 1); return; } done(); if (ANDROID) { toast('Скачиваем приложение — откройте файл, когда загрузится'); location.href = APK_URL; } else toast('Скачать можно с телефона Android: Профиль → О MKW'); });
  const box = h('div', { class: 'nw', role: 'dialog', 'aria-label': 'Что нового' },
    h('div', { class: 'nw-card' },
      h('div', { class: 'nw-head' }, h('b', { text: 'Большая новость' }), h('small', { text: `MKW Music ${VERSION}` })),
      h('div', { class: 'nw-view' }, track), dots,
      h('div', { class: 'nw-btns' }, skip, wow)));
  // листание пальцем или мышью
  let x0 = null;
  track.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  track.addEventListener('pointerup', (e) => { if (x0 == null) return; const d = e.clientX - x0; x0 = null; if (Math.abs(d) > 40) go(i + (d < 0 ? 1 : -1)); });
  document.body.appendChild(box);
  requestAnimationFrame(() => go(0));
}
