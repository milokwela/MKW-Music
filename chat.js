// Чат с друзьями. Писать можно только взаимным друзьям (проверяют и приложение, и правила Firestore).
//   chats/{a_b}            — { members: [a, b], last: { from, text, at }, at, read: { uid: время } }   (a < b)
//   chats/{a_b}/msgs/{id}  — { from, text, at, track? }
import { db } from './firebase.js?v=0.23.0';
import { doc, setDoc, addDoc, collection, query, where, orderBy, limit, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { h, toast } from './ui.js?v=0.23.0';
import { mi } from './icons2.js?v=0.23.0';
import * as player from './player.js?v=0.23.0';
import { searchTracks } from './catalog.js?v=0.23.0';
import { me, isFriend, cardOf } from './friends.js?v=0.23.0';
import { avSrc } from './avatar.js?v=0.23.0';
import { seenText, isOnline } from './userpage.js?v=0.23.0';

export const chatId = (a, b) => [a, b].sort().join('_');
const other = (c) => (c.members || []).find((x) => x !== me()) || '';

// ---------- список чатов и непрочитанные ----------
let chats = [];
let unsubList = null;
const subs = new Set();
export const onChats = (f) => { subs.add(f); return () => subs.delete(f); };
export const chatList = () => chats;
export const isUnread = (c) => c && c.last && c.last.from !== me() && (Number(c.at) || 0) > (Number(c.read && c.read[me()]) || 0);
export const unreadCount = () => chats.filter(isUnread).length;
export const chatWith = (uid) => chats.find((c) => other(c) === uid) || null;

export function watchChats(onNew) {
  if (unsubList || !me()) return;
  let first = true;
  try {
    unsubList = onSnapshot(query(collection(db, 'chats'), where('members', 'array-contains', me()), limit(100)), (s) => {
      const prev = new Map(chats.map((c) => [c.id, c.at]));
      chats = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
      if (!first && onNew) chats.forEach((c) => { if (isUnread(c) && (prev.get(c.id) || 0) < c.at && openId !== c.id) onNew(c, other(c)); });
      first = false;
      if (openId) { const c = chats.find((x) => x.id === openId); if (c && isUnread(c)) markRead(openId); }
      subs.forEach((f) => { try { f(); } catch { /* ignore */ } });
    }, () => { /* старые правила или нет сети */ });
  } catch { /* ignore */ }
}
export function stopChats() { if (unsubList) { unsubList(); unsubList = null; } chats = []; closeChat(); }

function markRead(cid) {
  const c = chats.find((x) => x.id === cid); if (!c) return;
  c.read = { ...(c.read || {}), [me()]: Date.now() };
  setDoc(doc(db, 'chats', cid), { read: { [me()]: Date.now() } }, { merge: true }).catch(() => {});
  subs.forEach((f) => { try { f(); } catch { /* ignore */ } });
}

async function send(cid, text, track) {
  const at = Date.now(), from = me();
  const msg = { from, text: text.slice(0, 500), at };
  if (track) msg.track = { title: String(track.title).slice(0, 120), artist: String(track.artist).slice(0, 120) };
  await addDoc(collection(db, 'chats', cid, 'msgs'), msg);
  await setDoc(doc(db, 'chats', cid), { members: cid.split('_'), last: { from, text: msg.text.slice(0, 140), at }, at, read: { [from]: at } }, { merge: true });
}

// ---------- окно чата ----------
let page = null, openId = '', unsubMsgs = null;
function ensurePage() {
  if (page) return page;
  page = h('section', { id: 'chat-page', 'aria-label': 'Чат' });
  document.body.appendChild(page);
  return page;
}
export function closeChat() {
  if (unsubMsgs) { unsubMsgs(); unsubMsgs = null; }
  openId = '';
  if (page) page.classList.remove('open');
}
export const chatOpen = () => Boolean(openId);

function timeOf(t) { const d = new Date(Number(t) || 0); return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
function dayOf(t) {
  const d = new Date(Number(t) || 0), n = new Date();
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, n)) return 'Сегодня';
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (same(d, y)) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

async function playTrack(t) {
  toast(`Включаю: ${t.artist} — ${t.title}`);
  const f = await searchTracks(`${t.artist} ${t.title}`).catch(() => []);
  if (f.length) player.playTracks(f.slice(0, 10), 0); else toast('Не нашла этот трек');
}

export async function openChat(uid, card) {
  if (!uid) return;
  if (!isFriend(uid)) { toast('Писать можно только друзьям. Дождитесь, пока заявку примут'); return; }
  const cid = chatId(me(), uid);
  const u = card || (await cardOf(uid)) || { uid, nick: 'друг' };
  const p = ensurePage();
  openId = cid;
  const list = h('div', { class: 'ch-list' });
  const input = h('textarea', { class: 'ch-input', rows: '1', placeholder: 'Сообщение', maxlength: '500', enterkeyhint: 'send' });
  const sendBtn = h('button', { class: 'ch-send', type: 'button', 'aria-label': 'Отправить' }, mi('send'));
  const shareBtn = h('button', { class: 'ch-share', type: 'button', title: 'Отправить трек, который играет', 'aria-label': 'Отправить текущий трек' }, mi('note'));
  const doSend = async (track) => {
    const text = input.value.trim();
    if (!text && !track) return;
    input.value = ''; input.style.height = '';
    try { await send(cid, track ? (text || 'Послушай') : text, track); }
    catch { toast('Не отправилось. Админу нужно обновить правила Firestore'); input.value = text; }
  };
  sendBtn.addEventListener('click', () => doSend());
  shareBtn.addEventListener('click', () => { const t = player.queue.current; if (!t) { toast('Сейчас ничего не играет'); return; } doSend(t); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } });
  input.addEventListener('input', () => { input.style.height = ''; input.style.height = `${Math.min(120, input.scrollHeight)}px`; });

  p.replaceChildren(
    h('header', { class: 'ch-head' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Назад', onclick: closeChat }, mi('close')),
      h('span', { class: 'ch-av' }, h('img', { src: avSrc(u.avatar), alt: '' }), isOnline(u.seen) ? h('i', { class: 'online-dot' }) : null),
      h('div', { class: 'ch-who' }, h('b', { text: u.nick || 'друг' }), h('small', { text: isOnline(u.seen) && u.now ? `Слушает: ${u.now}` : seenText(u.seen) || '' }))),
    list,
    h('div', { class: 'ch-bar' }, shareBtn, input, sendBtn));
  requestAnimationFrame(() => p.classList.add('open'));

  if (unsubMsgs) unsubMsgs();
  list.replaceChildren(h('p', { class: 'ch-empty', text: 'Загрузка…' }));
  try {
    unsubMsgs = onSnapshot(query(collection(db, 'chats', cid, 'msgs'), orderBy('at', 'desc'), limit(80)), (s) => {
      const msgs = s.docs.map((d) => d.data()).reverse();
      const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      if (!msgs.length) { list.replaceChildren(h('p', { class: 'ch-empty', text: `Напишите ${u.nick || 'другу'} первым. Можно отправить трек, который сейчас играет — кнопка с нотой.` })); return; }
      let day = '';
      const nodes = [];
      msgs.forEach((m) => {
        const dd = dayOf(m.at); if (dd !== day) { day = dd; nodes.push(h('div', { class: 'ch-day', text: dd })); }
        const mineMsg = m.from === me();
        nodes.push(h('div', { class: `ch-msg${mineMsg ? ' me' : ''}` },
          m.track ? h('button', { class: 'ch-track', type: 'button', onclick: () => playTrack(m.track) }, mi('play-circle'), h('span', {}, h('b', { text: m.track.title }), h('small', { text: m.track.artist }))) : null,
          m.text ? h('div', { class: 'ch-text', text: m.text }) : null,
          h('time', { text: timeOf(m.at) })));
      });
      list.replaceChildren(...nodes);
      if (atBottom || list.dataset.first !== '1') { list.scrollTop = list.scrollHeight; list.dataset.first = '1'; }
      if (chatWith(uid)) markRead(cid);
    }, () => { list.replaceChildren(h('p', { class: 'ch-empty', text: 'Чат недоступен. Админу нужно обновить правила Firestore.' })); });
  } catch { /* ignore */ }
  setTimeout(() => input.focus({ preventScroll: true }), 350);
}
