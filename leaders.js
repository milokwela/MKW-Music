// Рейтинг слушателей: у каждого публичная карточка leaders/{uid} (ник, часы, статус, значки, маленькое фото).
import { db, auth } from './firebase.js?v=0.16.0';
import { doc, getDoc, setDoc, deleteDoc, collection, query, orderBy, limit, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const KEY = 'mkw.leaders.hide';
export const hiddenFromBoard = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
let lastSent = '';

export async function setHidden(v) {
  try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ }
  const uid = auth.currentUser && auth.currentUser.uid;
  if (v && uid) { try { await deleteDoc(doc(db, 'leaders', uid)); } catch (e) { console.warn('leaders', e); } }
  lastSent = '';
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
  };
  const sig = JSON.stringify(data);
  if (sig === lastSent) return;
  try { await setDoc(doc(db, 'leaders', uid), { ...data, updatedAt: Date.now() }); lastSent = sig; } catch (e) { console.warn('leaders', e); }
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
