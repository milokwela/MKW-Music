// Уведомления: заявки в друзья, принятые заявки, новые сообщения.
// Внутри приложения — всплывашка и счётчик на вкладке «Профиль». Если приложение свёрнуто и вы разрешили —
// системное уведомление телефона/компьютера (работает, пока приложение открыто в фоне).
import { h, toast } from './ui.js?v=0.35.0';
import { avSrc } from './avatar.js?v=0.35.0';
import { watchFriends, stopWatchFriends, requestIds, onFriends, cardOf, watchPresence, stopPresence, friendsLoaded, loadFriends } from './friends.js?v=0.35.0';
import { watchCalls, stopCalls, warmCalls } from './call.js?v=0.35.0';
import { enablePush, disablePush, pushSupported } from './push.js?v=0.35.0';
import { watchChats, stopChats, unreadCount, onChats, openChat, openGroup, chatOpen, chatList, otherOf } from './chat.js?v=0.35.0';
import { watchShared, stopShared } from './shared.js?v=0.35.0';
import { leaveTogether } from './together.js?v=0.35.0';
import { greyReminders } from './streak.js?v=0.35.0';
import { me as meUid } from './friends.js?v=0.35.0';

const KEY = 'mkw.notify';
export const notifyOn = () => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } };
export const systemAllowed = () => 'Notification' in window && Notification.permission === 'granted';

export async function setNotify(v) {
  try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ }
  if (v && 'Notification' in window && Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch { /* ignore */ }
  }
  if (v && 'Notification' in window && Notification.permission === 'denied') toast('Системные уведомления запрещены в настройках браузера. Внутри приложения они всё равно будут');
  if (v && systemAllowed()) enablePush().then((ok) => { if (ok) toast('Уведомления включены: звонки и сообщения придут, даже когда MKW закрыт'); });
  if (!v) disablePush();
  return v;
}

async function system(title, body, tag, onClick, always) {
  if ((!notifyOn() && !always) || !systemAllowed() || !document.hidden) return;
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
  // огонёк гаснет — напоминаем раз в день
  onChats(() => greyReminders(chatList(), meUid(), otherOf, (uid) => cardOf(uid).then((u) => (u && u.nick) || 'другом').catch(() => 'другом'), (title, body, tag) => { toast(body); system(title, body, tag, null, true); }));
  onFriends(watchPresence); // список друзей поменялся — следим за их «в сети»
  watchFriends(async (kind, uid) => {
    if (!notifyOn()) return;
    const u = await cardOf(uid).catch(() => null); const nick = (u && u.nick) || 'Кто-то';
    if (kind === 'request') { toast(`${nick} хочет дружить — Профиль → Друзья`); system('Заявка в друзья', `${nick} хочет дружить`, `fr-${uid}`); }
    else { toast(`${nick} принял(а) вашу заявку. Теперь вы друзья`); system('Теперь вы друзья', `${nick} принял(а) вашу заявку`, `fr-${uid}`); }
  });
  watchChats(async (c, uid) => {
    if (!notifyOn() || chatOpen()) return;
    if (c.group) {
      const text = c.last && c.last.text ? `${c.last.nick || 'Кто-то'}: ${c.last.text}` : 'Новое сообщение';
      showPop({ avatar: '' }, c.name || 'Группа', text, () => openGroup(c.id));
      system(c.name || 'Группа', text, `chat-${c.id}`, () => openGroup(c.id));
      return;
    }
    const u = await cardOf(uid).catch(() => null); const nick = (u && u.nick) || 'Друг';
    const text = c.last && c.last.text ? c.last.text : 'Новое сообщение';
    showPop(u, nick, text, () => openChat(uid, u));
    system(nick, text, `chat-${c.id}`, () => openChat(uid, u));
  });
  // входящие звонки — слушаем всегда (это важнее настройки уведомлений)
  (friendsLoaded() ? Promise.resolve() : loadFriends()).catch(() => {}).then(() => watchCalls((nick, many, id) => system(many ? 'Общий звонок' : 'Входящий звонок', `${nick} звонит вам в MKW`, `call-${id}`, null, true)));
  // пуш на это устройство (если уведомления разрешены)
  // пуш нужен для звонков всегда, если браузер разрешил уведомления
  if (systemAllowed() && pushSupported()) setTimeout(() => enablePush(), 4000);
  warmCalls();
  watchShared();
  openFromLink(location.hash);
  paint();
}
export function stopNotify() { started = false; stopWatchFriends(); stopPresence(); stopChats(); stopShared(); leaveTogether(true); stopCalls(); paint(); }

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

// нажали на уведомление: #chat=<uid> — открыть переписку, #call=<id> — звонок сам появится на экране
function openFromLink(hash) {
  const m = String(hash || '').match(/#chat=([A-Za-z0-9]{10,64})/);
  const g = String(hash || '').match(/#group=(g[A-Za-z0-9]{6,40})/);
  if (g) {
    try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }
    const go = () => { if (!document.querySelector('#bottom-nav')) { setTimeout(go, 600); return; } openGroup(g[1]); };
    setTimeout(go, 800);
  } else if (m) {
    const uid = m[1];
    try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }
    const go = () => { if (!document.querySelector('#bottom-nav')) { setTimeout(go, 500); return; } cardOf(uid).then((u) => openChat(uid, u)).catch(() => {}); };
    setTimeout(go, 600);
  } else if (/#call=/.test(String(hash || ''))) {
    try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }
  }
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type === 'open' && d.url) { try { openFromLink(new URL(d.url).hash); } catch { /* ignore */ } }
  });
}
