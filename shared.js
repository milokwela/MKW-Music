// Общие плейлисты: один плейлист на переписку (с другом или группой), пополняют все участники.
// shared/{id переписки}: { members, owner, name, tracks: [...], at }
import { db } from './firebase.js?v=0.34.0';
import { doc, setDoc, updateDoc, deleteDoc, getDoc, onSnapshot, query, collection, where, limit } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { pickTrack } from './utils.js?v=0.34.0';
import { me } from './friends.js?v=0.34.0';
import { srvNow } from './clock.js?v=0.34.0';

const MAX = 300;
let list = [];
let unsub = null;
const subs = new Set();
export const onShared = (f) => { subs.add(f); return () => subs.delete(f); };
export const sharedList = () => list;
export const getShared = (id) => list.find((p) => p.id === id) || null;
const emit = () => subs.forEach((f) => { try { f(); } catch { /* ignore */ } });

export function watchShared() {
  if (unsub || !me()) return;
  try {
    unsub = onSnapshot(query(collection(db, 'shared'), where('members', 'array-contains', me()), limit(50)), (s) => {
      list = s.docs.map((d) => ({ id: d.id, ...d.data(), tracks: Array.isArray(d.data().tracks) ? d.data().tracks : [] }))
        .sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
      emit();
    }, () => { /* правила ещё не обновлены */ });
  } catch { /* ignore */ }
}
export function stopShared() { if (unsub) { unsub(); unsub = null; } list = []; emit(); }

// общий плейлист переписки: создаём при первом открытии
export async function ensureShared(cid, members, name) {
  const have = getShared(cid);
  if (have) return have;
  const ref = doc(db, 'shared', cid);
  const s = await getDoc(ref).catch(() => null);
  if (s && s.exists()) return { id: cid, ...s.data() };
  const data = { members, owner: me(), name: String(name || 'Общий плейлист').slice(0, 60), tracks: [], at: srvNow() };
  await setDoc(ref, data);
  return { id: cid, ...data };
}

export async function addToShared(id, track) {
  const ref = doc(db, 'shared', id);
  const s = await getDoc(ref);
  if (!s.exists()) throw new Error('нет плейлиста');
  const tracks = Array.isArray(s.data().tracks) ? s.data().tracks : [];
  const t = pickTrack(track);
  if (tracks.some((x) => x.id === t.id)) return 'exists';
  if (tracks.length >= MAX) return 'full';
  await updateDoc(ref, { tracks: [...tracks, { ...t, by: me(), addedAt: srvNow() }], at: srvNow() });
  return 'added';
}
export async function removeFromShared(id, trackId) {
  const ref = doc(db, 'shared', id);
  const s = await getDoc(ref);
  if (!s.exists()) return;
  await updateDoc(ref, { tracks: (s.data().tracks || []).filter((x) => x.id !== trackId), at: srvNow() });
}
export async function renameShared(id, name) { await updateDoc(doc(db, 'shared', id), { name: String(name).slice(0, 60), at: srvNow() }); }
export async function deleteShared(id) { await deleteDoc(doc(db, 'shared', id)); }
