// Чат с друзьями. Писать можно только взаимным друзьям (проверяют и приложение, и правила Firestore).
//   chats/{a_b}            — { members: [a, b], last: { from, text, at }, at, read: { uid: время } }   (a < b)
//   chats/{a_b}/msgs/{id}  — { from, text, at, track? }
import { db } from './firebase.js?v=0.26.0';
import { doc, setDoc, addDoc, collection, query, where, orderBy, limit, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { h, toast, openSheet, closeSheet } from './ui.js?v=0.26.0';
import { openImage } from './viewer.js?v=0.26.0';
import { mi } from './icons2.js?v=0.26.0';
import * as player from './player.js?v=0.26.0';
import { searchTracks } from './catalog.js?v=0.26.0';
import { me, isFriend, cardOf, friendIds, friendCards, loadFriends, friendsLoaded } from './friends.js?v=0.26.0';
import { avSrc } from './avatar.js?v=0.26.0';
import { seenText, isOnline } from './userpage.js?v=0.26.0';
import { startCall } from './call.js?v=0.26.0';

export const chatId = (a, b) => [a, b].sort().join('_');
const other = (c) => (c.members || []).find((x) => x !== me()) || '';
export const otherOf = other;

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
      paintTicks();
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

async function send(cid, text, track, img) {
  const at = Date.now(), from = me();
  const msg = { from, text: text.slice(0, 500), at };
  if (track) msg.track = { title: String(track.title).slice(0, 120), artist: String(track.artist).slice(0, 120) };
  if (img) msg.img = img;
  await addDoc(collection(db, 'chats', cid, 'msgs'), msg);
  await setDoc(doc(db, 'chats', cid), { members: cid.split('_'), last: { from, text: (img && !msg.text ? 'Фото' : track && !msg.text ? `♪ ${msg.track.artist} — ${msg.track.title}` : msg.text).slice(0, 140), at }, at, read: { [from]: at } }, { merge: true });
}

// фото: сжимаем до ~800 px JPEG, чтобы влезло в документ Firestore (без платного хранилища)
function shrink(file, max = 820, q = 0.72) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      let d = c.toDataURL('image/jpeg', q);
      if (d.length > 380000) d = c.toDataURL('image/jpeg', 0.5);
      if (d.length > 380000) { const c2 = document.createElement('canvas'); c2.width = Math.round(c.width * 0.65); c2.height = Math.round(c.height * 0.65); c2.getContext('2d').drawImage(c, 0, 0, c2.width, c2.height); d = c2.toDataURL('image/jpeg', 0.55); }
      resolve(d);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img')); };
    img.src = url;
  });
}

// фон чата: у каждого свой, хранится на этом устройстве
const BGS = [
  { id: 'none', name: 'Обычный', css: '' },
  { id: 'night', name: 'Ночь', css: 'linear-gradient(160deg, #0b0b1e, #1a1035 60%, #000)' },
  { id: 'sunset', name: 'Закат', css: 'linear-gradient(160deg, #3b0f2e, #7a2b3f 50%, #1a0b12)' },
  { id: 'ocean', name: 'Океан', css: 'linear-gradient(160deg, #021b2e, #063a5a 50%, #020c16)' },
  { id: 'aurora', name: 'Сияние', css: 'radial-gradient(120% 80% at 20% 0%, rgba(67,233,123,.35), transparent 60%), radial-gradient(120% 80% at 90% 30%, rgba(106,92,255,.4), transparent 60%), #05060a' },
  { id: 'black', name: 'Чёрный', css: '#000' },
  { id: 'accent', name: 'Цвет приложения', css: 'radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--primary) 35%, transparent), transparent 70%), var(--bg)' },
];
const BGKEY = (cid) => `mkw.chatbg.${cid}`;
function bgOf(cid) { try { return localStorage.getItem(BGKEY(cid)) || 'none'; } catch { return 'none'; } }
function paintBg(list, cid) {
  const v = bgOf(cid);
  const css = v.startsWith('data:') ? `linear-gradient(rgba(0,0,0,.35), rgba(0,0,0,.35)), center / cover no-repeat url("${v}")` : (BGS.find((b) => b.id === v) || BGS[0]).css;
  list.style.background = css || '';
  list.style.backgroundAttachment = 'local';
}
function bgMenu(list, cid) {
  const upl = h('input', { type: 'file', accept: 'image/*', hidden: '' });
  upl.addEventListener('change', async () => {
    const f = upl.files && upl.files[0]; if (!f) return;
    try { const d = await shrink(f, 1100, 0.7); localStorage.setItem(BGKEY(cid), d); paintBg(list, cid); closeSheet(); toast('Фон чата обновлён'); }
    catch { toast('Картинка слишком большая'); }
  });
  const set = (id) => { try { localStorage.setItem(BGKEY(cid), id); } catch { /* ignore */ } paintBg(list, cid); closeSheet(); };
  openSheet('Фон чата', h('div', {}, upl,
    h('div', { class: 'chbg-grid' },
      h('button', { type: 'button', class: 'chbg own', onclick: () => upl.click() }, mi('image'), h('span', { text: 'Своё фото' })),
      ...BGS.map((b) => h('button', { type: 'button', class: `chbg${bgOf(cid) === b.id ? ' on' : ''}`, style: `--b:${b.css || 'var(--bg)'}`, onclick: () => set(b.id) }, h('span', { text: b.name })))),
    h('p', { class: 'profile-note', text: 'Фон видите только вы, на этом устройстве.' })));
}

// ---------- отправить песню другу (из меню трека) ----------
export async function sendTrackTo(uid, track, text = 'Послушай') {
  if (!isFriend(uid)) throw new Error('не друг');
  await send(chatId(me(), uid), text, track);
}
export async function pickFriendFor(track) {
  if (!friendsLoaded()) await loadFriends();
  const ids = friendIds();
  if (!ids.length) { openSheet('Отправить другу', h('p', { class: 'profile-note', text: 'Пока нет друзей. Добавьте друга в Профиль → Друзья: когда он примет заявку, сюда можно будет отправлять песни.' })); return; }
  const list = h('div', { class: 'lb-list' }, h('p', { class: 'profile-note', text: 'Загрузка…' }));
  openSheet('Отправить другу', h('div', {}, h('div', { class: 'sheet-note', text: `${track.title} — ${track.artist}` }), list));
  const cards = await friendCards(ids.slice(0, 60));
  list.replaceChildren(...cards.map((u) => h('button', { type: 'button', class: 'lb-row fr-pick', onclick: async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { await sendTrackTo(u.uid, track); closeSheet(); toast(`Отправлено ${u.nick}`); }
    catch { toast('Не отправилось. Админу нужно обновить правила Firestore'); b.disabled = false; }
  } }, h('span', { class: 'lb-av' }, h('img', { src: avSrc(u.avatar), alt: '', loading: 'lazy' }), isOnline(u.seen) ? h('i', { class: 'online-dot' }) : null),
    h('div', { class: 'lb-body' }, h('div', { class: 'lb-nick' }, h('span', { text: u.nick })), h('div', { class: 'lb-status', text: isOnline(u.seen) ? 'в сети' : seenText(u.seen) })),
    h('span', { class: 'fr-send' }, mi('send')))));
}

// ---------- окно чата ----------
let page = null, openId = '', unsubMsgs = null, offTicks = null;
function ensurePage() {
  if (page) return page;
  page = h('section', { id: 'chat-page', 'aria-label': 'Чат' });
  document.body.appendChild(page);
  return page;
}
export function closeChat() {
  if (unsubMsgs) { unsubMsgs(); unsubMsgs = null; }
  if (offTicks) { offTicks(); offTicks = null; }
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
  const photoIn = h('input', { type: 'file', accept: 'image/*', hidden: '' });
  const photoBtn = h('button', { class: 'ch-share', type: 'button', title: 'Отправить фото', 'aria-label': 'Отправить фото', onclick: () => photoIn.click() }, mi('image'));
  photoIn.addEventListener('change', async () => {
    const f = photoIn.files && photoIn.files[0]; photoIn.value = ''; if (!f) return;
    toast('Отправляю фото…');
    try { const d = await shrink(f); await send(cid, input.value.trim(), null, d); input.value = ''; }
    catch { toast('Фото не отправилось. Админу нужно обновить правила Firestore'); }
  });
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
      h('div', { class: 'ch-who' }, h('b', { text: u.nick || 'друг' }), h('small', { text: isOnline(u.seen) && u.now ? `Слушает: ${u.now}` : seenText(u.seen) || '' })),
      h('button', { class: 'icon-btn ch-callbtn', type: 'button', 'aria-label': 'Позвонить', title: 'Позвонить', onclick: () => startCall([uid]) }, mi('phone')),
      h('button', { class: 'icon-btn ch-bgbtn', type: 'button', 'aria-label': 'Фон чата', title: 'Фон чата', onclick: () => bgMenu(list, cid) }, mi('palette'))),
    list,
    h('div', { class: 'ch-bar' }, photoIn, photoBtn, shareBtn, input, sendBtn));
  paintBg(list, cid);
  requestAnimationFrame(() => p.classList.add('open'));

  if (unsubMsgs) unsubMsgs();
  const drawn = new Map(); let first = true;
  // галочки: одна — доставлено, две — прочитано (друг открыл чат после этого сообщения)
  const ticks = new Map();
  const paintTicks = () => {
    const c = chatWith(uid); const readAt = Number(c && c.read && c.read[uid]) || 0;
    ticks.forEach(({ at, el }) => { const r = readAt >= at; if (el.dataset.r !== String(r)) { el.dataset.r = String(r); el.classList.toggle('read', r); el.title = r ? 'Прочитано' : 'Доставлено'; } });
  };
  if (offTicks) offTicks();
  offTicks = onChats(paintTicks);
  list.replaceChildren(h('p', { class: 'ch-empty', text: 'Загрузка…' }));
  try {
    unsubMsgs = onSnapshot(query(collection(db, 'chats', cid, 'msgs'), orderBy('at', 'desc'), limit(80)), (s) => {
      const msgs = s.docs;
      const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      if (!msgs.length) { list.replaceChildren(h('p', { class: 'ch-empty', text: `Напишите ${u.nick || 'другу'} первым. Можно отправить трек, который сейчас играет — кнопка с нотой.` })); return; }
      let day = '';
      const nodes = [];
      s.docs.slice().reverse().forEach((d) => {
        const m = d.data();
        const dd = dayOf(m.at); if (dd !== day) { day = dd; nodes.push(h('div', { class: 'ch-day', text: dd })); }
        // уже нарисованные сообщения не пересоздаём — фото не мигают и не грузятся заново
        let el = drawn.get(d.id);
        if (!el) {
          const mineMsg = m.from === me();
          const photoOnly = m.img && !m.text && !m.track;
          const img = m.img ? h('img', { class: 'ch-img', src: m.img, alt: 'Фото', decoding: 'async', onclick: () => openImage(m.img, '') }) : null;
          if (img) img.addEventListener('load', () => { if (list.scrollHeight - list.scrollTop - list.clientHeight < 400) list.scrollTop = list.scrollHeight; }, { once: true });
          el = h('div', { class: `ch-msg${mineMsg ? ' me' : ''}${m.img ? ' has-img' : ''}${photoOnly ? ' photo' : ''}${first ? '' : ' new'}` },
            m.track ? h('button', { class: 'ch-track', type: 'button', onclick: () => playTrack(m.track) }, mi('play-circle'), h('span', {}, h('b', { text: m.track.title }), h('small', { text: m.track.artist }))) : null,
            img,
            m.text ? h('div', { class: 'ch-text', text: m.text }) : null,
            h('time', {}, timeOf(m.at), mineMsg ? (() => { const tk = h('span', { class: 'ch-tick', 'aria-hidden': 'true' }, h('i'), h('i')); ticks.set(d.id, { at: Number(m.at) || 0, el: tk }); return tk; })() : null));
          drawn.set(d.id, el);
        }
        nodes.push(el);
      });
      first = false;
      list.replaceChildren(...nodes);
      if (atBottom || list.dataset.first !== '1') { list.scrollTop = list.scrollHeight; list.dataset.first = '1'; }
      if (chatWith(uid)) markRead(cid);
    }, () => { list.replaceChildren(h('p', { class: 'ch-empty', text: 'Чат недоступен. Админу нужно обновить правила Firestore.' })); });
  } catch { /* ignore */ }
  setTimeout(() => input.focus({ preventScroll: true }), 350);
}
