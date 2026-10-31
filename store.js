// Данные пользователя в Firestore: лайки, плейлисты, история.
// users/{uid}/likes/{trackId}, users/{uid}/playlists/{id}, users/{uid}/history/{auto}
import { db } from './firebase.js?v=0.13.0';
import {
  collection, doc, setDoc, deleteDoc, addDoc, updateDoc, onSnapshot, query, orderBy, limit, increment,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { pickTrack } from './utils.js?v=0.13.0';

const MAX_PLAYLIST = 300;
const HISTORY_LIMIT = 50;

export const state = { uid: null, likes: [], playlists: [], history: [], profile: {} };
const listeners = new Set();
let unsubs = [];

export function onStore(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(what) { listeners.forEach((fn) => { try { fn(what); } catch (e) { console.error(e); } }); }

export function startStore(uid) {
  stopStore();
  state.uid = uid;
  const base = (name) => collection(db, 'users', uid, name);
  const watch = (q, key, map) => onSnapshot(
    q,
    (snap) => { state[key] = snap.docs.map(map); emit(key); },
    (err) => console.error('Firestore', key, err),
  );
  unsubs = [
    watch(query(base('likes'), orderBy('likedAt', 'desc')), 'likes', (d) => ({ ...d.data(), id: d.id })),
    watch(query(base('playlists'), orderBy('createdAt', 'asc')), 'playlists', (d) => ({ ...d.data(), pid: d.id })),
    watch(query(base('history'), orderBy('playedAt', 'desc'), limit(HISTORY_LIMIT)), 'history', (d) => ({ ...d.data(), hid: d.id })),
    onSnapshot(doc(db, 'users', uid), (snap) => { state.profile = snap.exists() ? snap.data() : {}; emit('profile'); }, (err) => console.error('Firestore profile', err)),
  ];
}

export function stopStore() {
  unsubs.forEach((u) => u());
  unsubs = [];
  state.uid = null;
  state.likes = [];
  state.playlists = [];
  state.history = [];
  state.profile = {};
  pendingSec = 0;
}

const need = () => { if (!state.uid) throw new Error('Не выполнен вход'); return state.uid; };

// ---- лайки ----
export function isLiked(id) { return state.likes.some((t) => t.id === String(id)); }

export async function toggleLike(track) {
  const uid = need();
  const t = pickTrack(track);
  if (!t.id) return false;
  const ref = doc(db, 'users', uid, 'likes', t.id);
  if (isLiked(t.id)) { await deleteDoc(ref); return false; }
  await setDoc(ref, { ...t, likedAt: Date.now() });
  return true;
}

// ---- плейлисты ----
export async function createPlaylist(name, firstTrack) {
  const uid = need();
  const tracks = firstTrack ? [pickTrack(firstTrack)] : [];
  const ref = await addDoc(collection(db, 'users', uid, 'playlists'), {
    name: String(name).trim().slice(0, 60) || 'Плейлист', tracks, createdAt: Date.now(),
  });
  return ref.id;
}

export function renamePlaylist(pid, name) {
  return updateDoc(doc(db, 'users', need(), 'playlists', pid), { name: String(name).trim().slice(0, 60) || 'Плейлист' });
}

export function deletePlaylist(pid) { return deleteDoc(doc(db, 'users', need(), 'playlists', pid)); }

export function getPlaylist(pid) { return state.playlists.find((p) => p.pid === pid) || null; }

// Возвращает 'added' | 'exists' | 'full'
export async function addToPlaylist(pid, track) {
  const pl = getPlaylist(pid);
  if (!pl) throw new Error('Плейлист не найден');
  const t = pickTrack(track);
  if (pl.tracks.some((x) => x.id === t.id)) return 'exists';
  if (pl.tracks.length >= MAX_PLAYLIST) return 'full';
  await updateDoc(doc(db, 'users', need(), 'playlists', pid), { tracks: [...pl.tracks, t] });
  return 'added';
}

export async function removeFromPlaylist(pid, trackId) {
  const pl = getPlaylist(pid);
  if (!pl) return;
  await updateDoc(doc(db, 'users', need(), 'playlists', pid), { tracks: pl.tracks.filter((x) => x.id !== trackId) });
}

// ---- статистика прослушивания ----
let pendingSec = 0;
export function addListened(sec) { pendingSec += sec; }
export function listenedTotal() { return (Number(state.profile.listenedSec) || 0) + pendingSec; }
export async function flushListened() {
  if (!state.uid || pendingSec < 1) return;
  const n = Math.floor(pendingSec);
  pendingSec -= n;
  try {
    await setDoc(doc(db, 'users', state.uid), { listenedSec: increment(n) }, { merge: true });
  } catch (e) {
    pendingSec += n;
  }
}

// ---- история ----
let lastLogged = { id: '', at: 0 };
export async function logPlay(track) {
  if (!state.uid) return;
  const t = pickTrack(track);
  const now = Date.now();
  if (!t.id || (lastLogged.id === t.id && now - lastLogged.at < 30000)) return;
  lastLogged = { id: t.id, at: now };
  try {
    await addDoc(collection(db, 'users', state.uid, 'history'), { ...t, playedAt: now });
    setDoc(doc(db, 'users', state.uid), { plays: increment(1) }, { merge: true }).catch(() => {});
  } catch (e) { console.warn('История не записана', e); }
}
