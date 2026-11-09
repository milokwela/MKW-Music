// Сообщение о сбое 3 ноября 2026: браузеры по ошибке показывали «Опасный сайт».
// Показывается один раз; всем, кто был с нами, — значок «Пережил тёмное время бана».
import { h } from './ui.js';
import { mi } from './icons2.js';

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

// Лично для motrahka: лимитированный значок «Основатель сбоя»
export function showFounderNote(nick) {
  if (String(nick || '').toLowerCase() !== 'motrahka') return;
  try { if (localStorage.getItem('mkw.founder.note')) return; } catch { return; }
  if (document.querySelector('.inc')) { setTimeout(() => showFounderNote(nick), 1500); return; }
  const close = () => { try { localStorage.setItem('mkw.founder.note', '1'); } catch { /* ignore */ } box.classList.remove('show'); setTimeout(() => box.remove(), 400); };
  const box = h('div', { class: 'inc founder', role: 'dialog', 'aria-label': 'Лимитированный значок' },
    h('div', { class: 'inc-card' },
      h('div', { class: 'inc-badge' }, h('i'), h('span', {}, mi('fire'))),
      h('small', { class: 'inc-tag', text: 'Только для вас · лимитированный' }),
      h('h2', { text: 'Основатель сбоя' }),
      h('p', { text: 'Спасибо, что дали идею сделать такую масштабную ошибку. Без вас этой ночи бы не было.' }),
      h('div', { class: 'inc-gift' },
        h('span', { class: 'pbadge ach-crash' }, mi('fire'), h('b', { text: 'Основатель сбоя' })),
        h('small', { text: 'Такой значок один на весь MKW — и он ваш. Он уже стоит первым в профиле, его видят все.' })),
      h('div', { class: 'inc-btns one' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Ношу с гордостью'))));
  document.body.appendChild(box);
  requestAnimationFrame(() => box.classList.add('show'));
}
