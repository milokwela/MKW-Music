// Рейтинг слушателей: у каждого публичная карточка leaders/{uid} (ник, часы, статус, значки, маленькое фото).
import { db, auth } from './firebase.js?v=0.20.0';
import { doc, getDoc, setDoc, deleteDoc, collection, query, orderBy, limit, getDocs, where } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const KEY = 'mkw.leaders.hide';
export const hiddenFromBoard = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
let lastSent = '';
let lastSeenAt = 0;

// «В сети»: отметка времени и что сейчас играет. Не чаще раза в 4 минуты (бережём лимит Firestore).
export async function ping(now, force) {
  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid || hiddenFromBoard() || !lastSent) return;
  if (!force && Date.now() - lastSeenAt < 240000) return;
  lastSeenAt = Date.now();
  const data = { seen: Date.now(), now: String(now || '').slice(0, 120) };
  try { await setDoc(doc(db, 'leaders', uid), data, { merge: true }); } catch { /* нет карточки — не страшно */ }
  try { await setDoc(doc(db, 'profiles', uid), data, { merge: true }); } catch { /* ignore */ }
}

export async function setHidden(v) {
  try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ }
  const uid = auth.currentUser && auth.currentUser.uid;
  if (v && uid) { try { await deleteDoc(doc(db, 'leaders', uid)); await deleteDoc(doc(db, 'profiles', uid)); } catch (e) { console.warn('leaders', e); } }
  lastSent = ''; lastPub = '';
}

export async function publishCard(card) {
  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid || hiddenFromBoard()) return;
  const data = {
    nick: String(card.nick || '').slice(0, 32),
    sec: Math.floor(Number(card.sec) || 0),
    plays: Math.floor(Number(card.plays) || 0),
    likes: Math.floor(Number(card.likes) || 0),
    status: String(card.status || '').slice(0, 60),
    banner: String(card.banner || 'accent').slice(0, 16),
    frame: String(card.frame || 'none').slice(0, 16),
    badges: (card.badges || []).slice(0, 3).map(String),
    avatar: card.avatar && card.avatar.length < 20000 ? card.avatar : '',
    shape: String(card.shape || 'circle').slice(0, 12),
    now: String(card.now || '').slice(0, 120),
  };
  const sig = JSON.stringify(data);
  if (sig === lastSent) return;
  try { await setDoc(doc(db, 'leaders', uid), { ...data, seen: Date.now(), updatedAt: Date.now() }); lastSent = sig; lastSeenAt = Date.now(); }
  catch (e) {
    // старые правила Firestore не знают новых полей — пишем в прежнем виде, пока админ не обновит правила
    const { shape, now, ...old } = data;
    try { await setDoc(doc(db, 'leaders', uid), { ...old, updatedAt: Date.now() }); lastSent = sig; } catch (e2) { console.warn('leaders', e2); }
  }
}

export async function myCard() {
  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid) return null;
  try { const s = await getDoc(doc(db, 'leaders', uid)); return s.exists() ? s.data() : null; } catch { return null; }
}

export async function topListeners(n = 50) {
  try {
    const s = await getDocs(query(collection(db, 'leaders'), orderBy('sec', 'desc'), limit(n)));
    return s.docs.map((d) => ({ uid: d.id, ...d.data() }));
  } catch (e) { console.warn('leaders', e); return null; }
}
export const myUid = () => (auth.currentUser && auth.currentUser.uid) || '';

// Публичная страница профиля profiles/{uid}: баннер, фото, любимые исполнители и треки. Отдельно от рейтинга, чтобы список грузился быстро.
let lastPub = '';
export async function publishProfile(p) {
  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid || hiddenFromBoard()) return;
  const data = {
    nick: String(p.nick || '').slice(0, 32),
    status: String(p.status || '').slice(0, 60),
    banner: String(p.banner || 'accent').slice(0, 16),
    bannerImg: p.bannerImg && p.bannerImg.length < 300000 ? p.bannerImg : '',
    avatar: p.avatar && p.avatar.length < 90000 ? p.avatar : '',
    frame: String(p.frame || 'none').slice(0, 16),
    badges: (p.badges || []).slice(0, 3).map(String),
    bio: String(p.bio || '').slice(0, 160),
    nickStyle: String(p.nickStyle || 'plain').slice(0, 12),
    shape: String(p.shape || 'circle').slice(0, 12),
    effect: String(p.effect || 'none').slice(0, 12),
    now: String(p.now || '').slice(0, 120),
    favArtists: (p.favArtists || []).slice(0, 4).map((a) => String(a).slice(0, 80)),
    favTracks: (p.favTracks || []).slice(0, 10),
    sec: Math.floor(Number(p.sec) || 0), plays: Math.floor(Number(p.plays) || 0), likes: Math.floor(Number(p.likes) || 0),
    days: Math.floor(Number(p.days) || 0), achCount: Math.floor(Number(p.achCount) || 0),
  };
  const sig = JSON.stringify(data);
  if (sig === lastPub) return;
  try { await setDoc(doc(db, 'profiles', uid), { ...data, seen: Date.now(), updatedAt: Date.now() }); lastPub = sig; }
  catch (e) {
    const { bio, nickStyle, shape, effect, now, ...old } = data;
    if (old.avatar.length > 60000) old.avatar = '';
    try { await setDoc(doc(db, 'profiles', uid), { ...old, updatedAt: Date.now() }); lastPub = sig; } catch (e2) { console.warn('profiles', e2); }
  }
}
export async function getProfile(uid) {
  try { const s = await getDoc(doc(db, 'profiles', uid)); return s.exists() ? s.data() : null; } catch { return null; }
}
export async function hideProfile() {
  const uid = auth.currentUser && auth.currentUser.uid;
  if (uid) { try { await deleteDoc(doc(db, 'profiles', uid)); } catch { /* ignore */ } }
  lastPub = '';
}

// Вкусы сообщества для Волны: любимые исполнители из открытых профилей (кэш на 12 часов)
export async function communityTaste() {
  const KEY = 'mkw.community.v1';
  try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); if (c && Date.now() - c.at < 12 * 3600000) return c.v; } catch { /* ignore */ }
  let v = [];
  try {
    const s = await getDocs(query(collection(db, 'profiles'), limit(80)));
    v = s.docs.map((d) => (d.data().favArtists || []).map(String)).filter((x) => x.length > 1);
  } catch { return []; }
  try { localStorage.setItem(KEY, JSON.stringify({ v, at: Date.now() })); } catch { /* ignore */ }
  return v;
}
