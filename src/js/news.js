// Окно «Вышло крупное обновление»: картинки вместо текста, кнопки «Ого!» и «Пропустить». Показывается один раз.
import { h } from './ui.js';
import { mi } from './icons2.js';
import { VERSION } from './changelog.js';

const KEY = 'mkw.news';
// что нового в последней версии — каждое окно показывается один раз на версию
const SLIDES = [
  { tag: 'Музыка', title: 'MKW Волна умнее', text: 'Держит настроение того, что вы дослушали, не ставит короткие интро, ночью спокойнее, утром бодрее', icon: 'sparkle', orbit: ['headphones', 'note', 'heart'], hue: 300 },
  { tag: 'Профиль', title: 'Баннеры с котиками', text: 'Четыре новых баннера с котиками MKW. А рамка фото теперь работает на всех формах', img: 'assets/mkw-cat2.webp', orbit: ['image', 'star', 'heart'], hue: 330 },
  { tag: 'Важно', title: 'Перерыв до 9 ноября', text: 'Это последнее обновление до 9 ноября — дальше будет перерыв, возможно только мелкие исправления. Спасибо, что вы с нами!', img: 'assets/mkw-fixcat.webp', orbit: ['heart', 'star', 'note'], hue: 40 },
];

export function showNews() {
  const ver = '0.36.4'; // окно «Что нового» — для версии с новинками, мелкие исправления его не показывают
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
