// «Мне нравится MKW»: значок фаната с номером по порядку. Номера раздаёт счётчик meta/fans в Firestore
// (в одной транзакции: fans/{uid} = { n } и meta/fans = { count: n }), поэтому номера не повторяются.
// Разработчик всегда #1, первый фанат получает #2.
import { db, auth } from './firebase.js?v=0.29.0';
import { doc, getDoc, runTransaction } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { isDev } from './dev.js?v=0.29.0';

const KEY = (uid) => `mkw.fan.${uid}`;
const uidNow = () => (auth.currentUser && auth.currentUser.uid) || '';

export function fanNumber(nick) {
  if (isDev(nick)) return 1;
  try { return Number(localStorage.getItem(KEY(uidNow()))) || 0; } catch { return 0; }
}

// новое устройство: номер подтягивается с сервера
export async function restoreFan(nick) {
  const uid = uidNow();
  if (!uid || isDev(nick) || fanNumber(nick)) return fanNumber(nick);
  try {
    const s = await getDoc(doc(db, 'fans', uid));
    if (s.exists() && s.data().n) { localStorage.setItem(KEY(uid), String(s.data().n)); return s.data().n; }
  } catch { /* ignore */ }
  return 0;
}

export async function becomeFan(nick) {
  const uid = uidNow();
  if (!uid) throw new Error('нет входа');
  if (isDev(nick)) return 1;
  const have = fanNumber(nick); if (have) return have;
  const n = await runTransaction(db, async (tx) => {
    const fref = doc(db, 'fans', uid), mref = doc(db, 'meta', 'fans');
    const f = await tx.get(fref);
    if (f.exists()) return f.data().n;
    const m = await tx.get(mref);
    const next = (m.exists() ? Number(m.data().count) || 1 : 1) + 1;
    tx.set(fref, { n: next, at: Date.now() });
    tx.set(mref, { count: next });
    return next;
  });
  try { localStorage.setItem(KEY(uid), String(n)); } catch { /* ignore */ }
  return n;
}
