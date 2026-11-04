// Окно «Вышло крупное обновление»: картинки вместо текста, кнопки «Ого!» и «Пропустить». Показывается один раз.
import { h } from './ui.js?v=0.35.6';
import { mi } from './icons2.js?v=0.35.6';
import { VERSION } from './changelog.js?v=0.35.6';

const KEY = 'mkw.news';
// что нового в последней версии — каждое окно показывается один раз на версию
const SLIDES = [
  { tag: 'Голосовые', title: 'Держите или на замок', text: 'Держите кнопку — запись, отпустили — отправилось. Коротко нажали — запись на замке. Работает и мышкой на компьютере', icon: 'mic', orbit: ['lock', 'send', 'stop'], hue: 200 },
  { tag: 'Заставка', title: 'Котик стал живее', text: 'Приземляется с тенью, светится и пульсирует в такт музыке', img: 'mkw-st1.webp', orbit: ['note', 'star', 'heart'], hue: 300 },
];

export function showNews() {
  const ver = '0.35.5'; // окно «Что нового» — для версии с новинками, мелкие исправления его не показывают
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
