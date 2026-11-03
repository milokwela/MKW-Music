// Рейтинг слушателей: у каждого публичная карточка leaders/{uid} (ник, часы, статус, значки, маленькое фото).
import { db, auth } from './firebase.js?v=0.34.0';
import { doc, getDoc, setDoc, deleteDoc, collection, query, orderBy, limit, getDocs, where } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { srvNow } from './clock.js?v=0.34.0';

const KEY = 'mkw.leaders.hide';
export const hiddenFromBoard = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
let lastSent = '';
let lastSeenAt = 0;

// «В сети»: отметка времени и что сейчас играет. Не чаще раза в 2 минуты (бережём лимит Firestore).
export async function ping(now, force) {
  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid || hiddenFromBoard() || !lastSent) return;
  if (!force && srvNow() - lastSeenAt < 80000) return;
  lastSeenAt = srvNow();
  const data = { seen: srvNow(), now: String(now || '').slice(0, 120) };
  try { await setDoc(doc(db, 'leaders', uid), data, { merge: true }); } catch { /* нет карточки — не страшно */ }
  try { await setDoc(doc(db, 'profiles', uid), data, { merge: true }); } catch { /* ignore */ }
}

// Ушли из приложения — сразу «не в сети» (отметку сдвигаем в прошлое, чтобы друзья не ждали 3 минуты)
export async function goOffline() {
  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid || hiddenFromBoard() || !lastSent) return;
  lastSeenAt = 0;
  const data = { seen: srvNow() - 600000, now: '' };
  try { await setDoc(doc(db, 'leaders', uid), data, { merge: true }); } catch { /* ignore */ }
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
    fan: Math.max(0, Math.floor(Number(card.fan) || 0)),
    devOff: Boolean(card.devOff),
  };
  const sig = JSON.stringify(data);
  if (sig === lastSent) return;
  try { await setDoc(doc(db, 'leaders', uid), { ...data, seen: srvNow(), updatedAt: srvNow() }); lastSent = sig; lastSeenAt = srvNow(); }
  catch (e) {
    // старые правила Firestore не знают новых полей — пишем в прежнем виде, пока админ не обновит правила
    const { shape, now, fan, devOff, ...old } = data;
    try { await setDoc(doc(db, 'leaders', uid), { ...old, updatedAt: srvNow() }); lastSent = sig; } catch (e2) { console.warn('leaders', e2); }
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
    fan: Math.max(0, Math.floor(Number(p.fan) || 0)), devOff: Boolean(p.devOff),
  };
  const sig = JSON.stringify(data);
  if (sig === lastPub) return;
  try { await setDoc(doc(db, 'profiles', uid), { ...data, seen: srvNow(), updatedAt: srvNow() }); lastPub = sig; }
  catch (e) {
    const { bio, nickStyle, shape, effect, now, fan, devOff, ...old } = data;
    if (old.avatar.length > 60000) old.avatar = '';
    try { await setDoc(doc(db, 'profiles', uid), { ...old, updatedAt: srvNow() }); lastPub = sig; } catch (e2) { console.warn('profiles', e2); }
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
  try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); if (c && srvNow() - c.at < 12 * 3600000) return c.v; } catch { /* ignore */ }
  let v = [];
  try {
    const s = await getDocs(query(collection(db, 'profiles'), limit(80)));
    v = s.docs.map((d) => (d.data().favArtists || []).map(String)).filter((x) => x.length > 1);
  } catch { return []; }
  try { localStorage.setItem(KEY, JSON.stringify({ v, at: srvNow() })); } catch { /* ignore */ }
  return v;
}

// «Сейчас слушают в MKW»: любимые треки из открытых профилей слушателей. Кэш на 6 часов, чтобы беречь лимит.
export async function communityTracks() {
  const KEY = 'mkw.community.tracks.v1';
  try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); if (c && srvNow() - c.at < 6 * 3600000 && c.v.length) return c.v; } catch { /* ignore */ }
  let v = [];
  try {
    const s = await getDocs(query(collection(db, 'profiles'), limit(80)));
    const seen = new Set();
    const rows = s.docs.map((d) => d.data()).sort((a, b) => (Number(b.sec) || 0) - (Number(a.sec) || 0));
    for (const p of rows) for (const t of (p.favTracks || [])) {
      const k = `${String(t.title || '').toLowerCase()}|${String(t.artist || '').toLowerCase()}`;
      if (!t || !t.title || seen.has(k)) continue; seen.add(k); v.push({ ...t, by: p.nick || '' });
    }
  } catch { return []; }
  v = v.slice(0, 60);
  try { localStorage.setItem(KEY, JSON.stringify({ v, at: srvNow() })); } catch { /* ignore */ }
  return v;
}
