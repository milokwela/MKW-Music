// Друзья. У каждого открытый список friends/{uid} = { list: [uid…] } — кому я отправил заявку или кого принял.
// Друзья — только взаимно: я есть в его списке, а он в моём. То есть дружба начинается, когда второй нажал «Принять».
//   заявка ко мне  — он добавил меня, я его ещё нет;
//   моя заявка     — я добавил его, он меня ещё нет.
import { db, auth } from './firebase.js?v=0.35.1';
import { doc, getDoc, setDoc, collection, query, where, getDocs, limit, onSnapshot, documentId } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { srvNow, seenOnline, realSeen } from './clock.js?v=0.35.1';

// «В сети»: отметка свежее 3.5 минуты (пинг раз в 2 минуты, при уходе из приложения — сразу «не в сети»)
export const ONLINE_MS = 190000;

let mine = [];       // мой список (заявки + принятые)
let incoming = [];   // у кого я в списке
let declined = [];
let loaded = false;
const DKEY = () => `mkw.friends.declined.${me()}`;
const subs = new Set();
export const me = () => (auth.currentUser && auth.currentUser.uid) || '';
const emit = () => subs.forEach((f) => { try { f(); } catch { /* ignore */ } });

export const onFriends = (f) => { subs.add(f); return () => subs.delete(f); };
export const friendsLoaded = () => loaded;
// взаимные друзья
export const friendIds = () => mine.filter((x) => incoming.includes(x));
export const isFriend = (uid) => mine.includes(uid) && incoming.includes(uid);
export const requestIds = () => incoming.filter((x) => !mine.includes(x) && !declined.includes(x));
export const sentIds = () => mine.filter((x) => !incoming.includes(x));
export const declinedIds = () => declined;
// 'friend' | 'sent' | 'incoming' | 'none'
export function friendState(uid) {
  const a = mine.includes(uid), b = incoming.includes(uid);
  return a && b ? 'friend' : a ? 'sent' : b && !declined.includes(uid) ? 'incoming' : 'none';
}

async function loadIncoming() {
  const uid = me(); if (!uid) return [];
  try {
    const s = await getDocs(query(collection(db, 'friends'), where('list', 'array-contains', uid), limit(200)));
    incoming = s.docs.map((d) => d.id);
  } catch { /* оставляем прежнее */ }
  return incoming;
}

export async function loadFriends() {
  const uid = me();
  if (!uid) return [];
  let local = [];
  try { local = JSON.parse(localStorage.getItem(DKEY()) || '[]'); } catch { /* ignore */ }
  try {
    const s = await getDoc(doc(db, 'friends', uid));
    const d = s.exists() ? s.data() : {};
    mine = Array.isArray(d.list) ? d.list.map(String) : [];
    declined = [...new Set([...(Array.isArray(d.declined) ? d.declined.map(String) : []), ...local])];
  } catch { mine = []; declined = local; }
  await loadIncoming();
  loaded = true; emit();
  return friendIds();
}

async function save() {
  const uid = me(); if (!uid) return;
  try { localStorage.setItem(DKEY(), JSON.stringify(declined.slice(-300))); } catch { /* ignore */ }
  try { await setDoc(doc(db, 'friends', uid), { list: mine.slice(0, 200), declined: declined.slice(-300), updatedAt: srvNow() }); }
  catch { await setDoc(doc(db, 'friends', uid), { list: mine.slice(0, 200), updatedAt: srvNow() }); } // старые правила
}

// Отклонить заявку: человек больше не появится в «Хотят дружить» (сам он об этом не узнает)
export async function declineRequest(uid) {
  if (!uid || declined.includes(uid)) return;
  declined = [...declined, uid]; emit();
  try { await save(); } catch { /* останется на этом устройстве */ }
}
// Отправить заявку или принять входящую — одно и то же действие: добавить человека в свой список
export async function addFriend(uid) {
  if (!uid || uid === me() || mine.includes(uid)) return;
  mine = [uid, ...mine].slice(0, 200); declined = declined.filter((x) => x !== uid); emit();
  try { await save(); } catch (e) { mine = mine.filter((x) => x !== uid); emit(); throw e; }
}
export const acceptRequest = addFriend;
// Удалить из друзей или отменить свою заявку
export async function removeFriend(uid) {
  mine = mine.filter((x) => x !== uid); emit();
  try { await save(); } catch { /* ignore */ }
}

// Найти слушателя по нику (среди тех, кто есть в рейтинге)
export async function findByNick(nick) {
  const n = String(nick || '').trim().toLowerCase().replace(/^@/, '');
  if (!n) return null;
  try {
    const s = await getDocs(query(collection(db, 'leaders'), where('nick', '==', n), limit(1)));
    const d = s.docs[0];
    return d ? { uid: d.id, ...d.data() } : null;
  } catch { return null; }
}

// Кто добавил меня (для совместимости)
export async function followers() { await loadIncoming(); return incoming; }

// Живое обновление: новые заявки и принятые заявки приходят сразу, без перезагрузки
let unsubLive = null;
export function watchFriends(onEvent) {
  const uid = me(); if (!uid || unsubLive) return;
  let first = true;
  try {
    unsubLive = onSnapshot(query(collection(db, 'friends'), where('list', 'array-contains', uid), limit(200)), (s) => {
      const now = s.docs.map((d) => d.id);
      if (!first) {
        const added = now.filter((x) => !incoming.includes(x));
        added.forEach((x) => onEvent && onEvent(mine.includes(x) ? 'accepted' : 'request', x));
      }
      first = false;
      incoming = now; loaded = true; emit();
    }, () => { /* нет сети или старые правила */ });
  } catch { /* ignore */ }
}
export function stopWatchFriends() { if (unsubLive) { unsubLive(); unsubLive = null; } }

// Карточки людей (ник, фото, в сети, что слушают). Сначала те, кто в сети.
const cache = new Map();
export async function friendCards(uids, maxAge = 60000) {
  const out = await Promise.all(uids.map(async (uid) => {
    const c = cache.get(uid);
    if (c && srvNow() - c.at < maxAge) return c.v;
    try { const s = await getDoc(doc(db, 'leaders', uid)); const v = s.exists() ? { uid, ...s.data() } : { uid, nick: 'слушатель', hidden: true }; cache.set(uid, { v, at: srvNow() }); return v; }
    catch { return { uid, nick: 'слушатель', hidden: true }; }
  }));
  const online = (u) => seenOnline(u.seen);
  return out.sort((a, b) => (online(b) - online(a)) || (realSeen(b.seen) - realSeen(a.seen)));
}
export async function cardOf(uid) { return (await friendCards([uid], 300000))[0]; }

// Живой статус друзей: «в сети», что слушает — обновляется сразу, как друг зашёл или вышел
let presSig = '', presUnsub = [];
export function watchPresence() {
  const ids = friendIds().slice(0, 60);
  const sig = ids.slice().sort().join(',');
  if (sig === presSig) return;
  presSig = sig; presUnsub.forEach((f) => f()); presUnsub = [];
  for (let i = 0; i < ids.length; i += 30) {
    try {
      presUnsub.push(onSnapshot(query(collection(db, 'leaders'), where(documentId(), 'in', ids.slice(i, i + 30))), (s) => {
        s.docs.forEach((d) => cache.set(d.id, { v: { uid: d.id, ...d.data() }, at: srvNow() }));
        emit();
      }, () => { /* нет сети */ }));
    } catch { /* ignore */ }
  }
}
export function stopPresence() { presSig = ''; presUnsub.forEach((f) => f()); presUnsub = []; }
