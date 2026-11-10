// Окно «Вышло крупное обновление»: картинки вместо текста, кнопки «Ого!» и «Пропустить». Показывается один раз.
import { h } from './ui.js';
import { mi } from './icons2.js';
import { VERSION } from './changelog.js';

const KEY = 'mkw.news';
// что нового в последней версии — каждое окно показывается один раз на версию
const SLIDES = [
  { tag: 'Итоги голосования', title: 'Победила зима. Но мы сделали всё', text: 'Вы выбрали зимнее оформление. А мы заодно улучшили музыку и ускорили приложение — все три варианта из опроса', img: 'assets/mkw-st49.webp', orbit: ['trophy', 'star', 'heart'], hue: 200 },
  { tag: 'Зима', title: 'Зимнее оформление', text: 'Снег, гирлянда и северное сияние. Уже включено, а выключить можно в Настройках → Внешний вид', img: 'assets/mkw-st27.webp', orbit: ['sparkle', 'star', 'moon'], hue: 195 },
  { tag: 'Музыка', title: 'MKW Волна 5', text: 'Вышла из беты. Точнее понимает вкус, реже повторяется и чаще находит новое, но похожее на любимое', icon: 'sparkle', orbit: ['headphones', 'note', 'heart'], hue: 300 },
  { tag: 'Стикеры', title: '29 новых стикеров', text: 'Наборы «Парочка» и «Чёрный котик» ждут в чатах — и в статусе профиля тоже', img: 'assets/mkw-st37.webp', orbit: ['heart', 'star', 'note'], hue: 330 },
  { tag: 'Скорость', title: 'Быстрее и плавнее', text: 'Приложение открывается быстрее и меньше нагружает телефон', icon: 'rocket', orbit: ['timer', 'sparkle', 'star'], hue: 150 },
];

export function showNews() {
  const ver = '0.37.0'; // окно «Что нового» — для версии с новинками, мелкие исправления его не показывают
  // на новом устройстве (и новым слушателям) окно не показываем — оно для тех, кто обновился
  try { const cur = localStorage.getItem(KEY); if (cur === ver) return; if (cur === null) { localStorage.setItem(KEY, ver); return; } } catch { return; }
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
  const skip = h('button', { class: 'btn tonal nw-skip', type: 'button', onclick: done }, 'Пропустить');
  const go = (n) => {
    i = Math.max(0, Math.min(SLIDES.length - 1, n));
    track.style.transform = `translateX(${-i * 100}%)`;
    [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
    slides.forEach((s, k) => s.classList.toggle('on', k === i));
    wow.textContent = i === SLIDES.length - 1 ? 'Круто, поехали!' : 'Ого!';
  };
  wow.addEventListener('click', () => { if (i < SLIDES.length - 1) go(i + 1); else done(); });
  const box = h('div', { class: 'nw', role: 'dialog', 'aria-label': 'Что нового' },
    h('div', { class: 'nw-card' },
      h('div', { class: 'nw-head' }, h('b', { text: 'Что нового' }), h('small', { text: `MKW Music ${VERSION}` })),
      h('div', { class: 'nw-view' }, track), dots,
      h('div', { class: 'nw-btns' }, skip, wow)));
  // листание пальцем или мышью
  let x0 = null;
  track.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  track.addEventListener('pointerup', (e) => { if (x0 == null) return; const d = e.clientX - x0; x0 = null; if (Math.abs(d) > 40) go(i + (d < 0 ? 1 : -1)); });
  document.body.appendChild(box);
  requestAnimationFrame(() => go(0));
}
