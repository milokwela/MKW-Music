// Обновление «на лету»: если пока вы в приложении вышла новая версия — показываем предупреждение
// и через несколько секунд перезапускаем приложение, чтобы у всех была одна версия и ничего не ломалось.
import { VERSION } from './changelog.js?v=0.29.0';
import { h } from './ui.js?v=0.29.0';

let shown = false, timer = 0;
const busy = () => document.documentElement.classList.contains('in-call'); // во время звонка не перезапускаем сами

async function latest() {
  try {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return '';
    const j = await r.json();
    return String(j.v || '');
  } catch { return ''; }
}

async function reloadNow() {
  try { window.dispatchEvent(new CustomEvent('mkw-before-update')); } catch { /* ignore */ }
  try { const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch { /* ignore */ }
  location.reload();
}

export function showUpdating(v, reason) {
  if (shown) return;
  shown = true;
  let left = busy() ? 0 : 6;
  const count = h('b', { text: left ? `${left}` : '' });
  const note = h('small', { text: busy() ? 'Перезапустите, когда закончите звонок.' : 'Приложение перезапустится само через' });
  const box = h('div', { class: 'upd', role: 'alertdialog', 'aria-live': 'assertive' },
    h('div', { class: 'upd-card' },
      h('div', { class: 'upd-star' }, h('img', { src: 'mkw-star.png', alt: '' })),
      h('div', { class: 'upd-title', text: reason === 'error' ? 'Вышло обновление MKW Music' : `MKW Music обновляется${v ? ` до ${v}` : ''}` }),
      h('p', { class: 'upd-text', text: 'Мы как раз выложили новую версию. Чтобы ничего не сломалось, приложение нужно перезапустить — это пара секунд.' }),
      h('div', { class: 'upd-count' }, note, left ? count : null),
      h('button', { class: 'btn', type: 'button', onclick: reloadNow }, 'Обновить сейчас')));
  document.body.appendChild(box);
  requestAnimationFrame(() => box.classList.add('show'));
  if (!left) return;
  timer = setInterval(() => {
    left -= 1; count.textContent = String(left);
    if (left <= 0) { clearInterval(timer); reloadNow(); }
  }, 1000);
}

async function check() {
  if (shown || document.hidden) return;
  const v = await latest();
  if (v && v !== VERSION) showUpdating(v);
}

export function startUpdateWatch() {
  setTimeout(check, 15000);
  setInterval(check, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.addEventListener('online', check);
  // старая версия пытается загрузить файлы, которых уже нет — это и есть «вылетает с ошибкой»
  const broken = (msg) => /dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch dynamically/i.test(String(msg || ''));
  window.addEventListener('error', (e) => { if (broken(e.message)) showUpdating('', 'error'); });
  window.addEventListener('unhandledrejection', (e) => { if (broken(e.reason && (e.reason.message || e.reason))) showUpdating('', 'error'); });
}
