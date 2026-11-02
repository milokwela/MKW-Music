// Сообщение о сбое 3 ноября 2026: браузеры по ошибке показывали «Опасный сайт».
// Показывается один раз; всем, кто был с нами, — значок «Пережил тёмное время бана».
import { h } from './ui.js?v=0.27.5';
import { mi } from './icons2.js?v=0.27.5';

const KEY = 'mkw.incident.ban1';

export function showIncident() {
  try { if (localStorage.getItem(KEY)) return; } catch { return; }
  if (document.querySelector('.inc')) return;
  const close = () => { try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } box.classList.remove('show'); setTimeout(() => box.remove(), 400); };
  const toProfile = () => {
    close();
    const b = document.querySelector('#bottom-nav .nav-btn[data-view="profile"]');
    if (b) b.click();
    setTimeout(() => { const t = document.querySelector('.ptab[data-tab="main"]'); if (t) t.click(); }, 350);
  };
  const box = h('div', { class: 'inc', role: 'dialog', 'aria-label': 'Сообщение о сбое' },
    h('div', { class: 'inc-card' },
      h('div', { class: 'inc-badge' }, h('i'), h('span', {}, mi('shield'))),
      h('small', { class: 'inc-tag', text: 'Сообщение от MKW Music' }),
      h('h2', { text: 'Был сбой — уже всё исправили' }),
      h('p', { text: 'Ночью 3 ноября браузеры по ошибке показывали, что MKW Music — «опасный сайт». Причина — неудачная функция, которую мы сразу убрали. Сайт безопасен, ваш профиль, лайки и музыка в порядке.' }),
      h('p', { text: 'Если где-то ещё видите красную страницу — она скоро пропадёт: браузеры обновляют свои списки сами.' }),
      h('div', { class: 'inc-gift' },
        h('span', { class: 'pbadge ach-dark' }, mi('shield'), h('b', { text: 'Пережил тёмное время бана' })),
        h('small', { text: 'Простите за неудобства. Этот значок — всем, кто был с нами. Он уже в достижениях и в вашем профиле — его видят все.' })),
      h('div', { class: 'inc-btns' },
        h('button', { class: 'btn tonal', type: 'button', onclick: close }, 'Понятно'),
        h('button', { class: 'btn', type: 'button', onclick: toProfile }, 'Посмотреть значок'))));
  document.body.appendChild(box);
  requestAnimationFrame(() => box.classList.add('show'));
}
