// Уведомления: заявки в друзья, принятые заявки, новые сообщения.
// Внутри приложения — всплывашка и счётчик на вкладке «Профиль». Если приложение свёрнуто и вы разрешили —
// системное уведомление телефона/компьютера (работает, пока приложение открыто в фоне).
import { h, toast } from './ui.js?v=0.25.0';
import { avSrc } from './avatar.js?v=0.25.0';
import { watchFriends, stopWatchFriends, requestIds, onFriends, cardOf } from './friends.js?v=0.25.0';
import { watchChats, stopChats, unreadCount, onChats, openChat, chatOpen } from './chat.js?v=0.25.0';

const KEY = 'mkw.notify';
export const notifyOn = () => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } };
export const systemAllowed = () => 'Notification' in window && Notification.permission === 'granted';

export async function setNotify(v) {
  try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ }
  if (v && 'Notification' in window && Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch { /* ignore */ }
  }
  if (v && 'Notification' in window && Notification.permission === 'denied') toast('Системные уведомления запрещены в настройках браузера. Внутри приложения они всё равно будут');
  return v;
}

async function system(title, body, tag, onClick) {
  if (!notifyOn() || !systemAllowed() || !document.hidden) return;
  const opt = { body, tag, icon: 'ic5-192.png', badge: 'fav-96.png', renotify: true };
  try {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg) { await reg.showNotification(title, opt); return; } // на Android работает только так
    const n = new Notification(title, opt); n.onclick = () => { window.focus(); onClick && onClick(); n.close(); };
  } catch { /* ignore */ }
}

// счётчик на вкладке «Профиль» и на «Друзья» внутри профиля
function paint() {
  const req = requestIds().length, msg = unreadCount();
  const set = (el, n) => { if (!el) return; if (n) el.dataset.badge = n > 9 ? '9+' : String(n); else delete el.dataset.badge; };
  // сообщения — на «Чатах», заявки в друзья — на «Профиле»
  set(document.querySelector('#bottom-nav .nav-btn[data-view="chats"]'), msg);
  set(document.querySelector('#bottom-nav .nav-btn[data-view="profile"]'), req);
  set(document.querySelector('.ptab[data-tab="friends"]'), req);
  window.dispatchEvent(new CustomEvent('mkw-notify'));
}

let started = false;
export function startNotify() {
  if (started) return;
  started = true;
  onFriends(paint); onChats(paint);
  watchFriends(async (kind, uid) => {
    if (!notifyOn()) return;
    const u = await cardOf(uid).catch(() => null); const nick = (u && u.nick) || 'Кто-то';
    if (kind === 'request') { toast(`${nick} хочет дружить — Профиль → Друзья`); system('Заявка в друзья', `${nick} хочет дружить`, `fr-${uid}`); }
    else { toast(`${nick} принял(а) вашу заявку. Теперь вы друзья`); system('Теперь вы друзья', `${nick} принял(а) вашу заявку`, `fr-${uid}`); }
  });
  watchChats(async (c, uid) => {
    if (!notifyOn() || chatOpen()) return;
    const u = await cardOf(uid).catch(() => null); const nick = (u && u.nick) || 'Друг';
    const text = c.last && c.last.text ? c.last.text : 'Новое сообщение';
    showPop(u, nick, text, () => openChat(uid, u));
    system(nick, text, `chat-${c.id}`, () => openChat(uid, u));
  });
  paint();
}
export function stopNotify() { started = false; stopWatchFriends(); stopChats(); paint(); }

// всплывашка о новом сообщении: нажали — открылся чат
let pop = null;
function showPop(u, nick, text, onClick) {
  if (pop) pop.remove();
  pop = h('button', { class: 'msg-pop', type: 'button', onclick: () => { pop.remove(); pop = null; onClick(); } },
    h('img', { src: avSrc(u && u.avatar), alt: '' }), h('span', {}, h('b', { text: nick }), h('small', { text })));
  document.body.appendChild(pop);
  requestAnimationFrame(() => pop && pop.classList.add('show'));
  const p = pop; setTimeout(() => { p.classList.remove('show'); setTimeout(() => { p.remove(); if (pop === p) pop = null; }, 400); }, 5000);
}
export { paint as paintNotify };
