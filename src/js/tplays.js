// Сколько раз трек включили на MKW в этом месяце: общий счётчик на всех слушателей (tplays/{месяц}_{трек}).
// Если правила Firestore для счётчика ещё не опубликованы, запись и чтение тихо не срабатывают — строка просто не показывается.
import { db, auth } from './firebase.js';
import { doc, getDoc, setDoc, increment } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { srvNow } from './clock.js';

const month = () => new Date(srvNow()).toISOString().slice(0, 7);
const key = (t) => `${month()}_${String(t.id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 90)}`;
const seen = new Map();

export function countPlay(t) {
  if (!auth.currentUser || !t || !t.id) return;
  const k = key(t);
  setDoc(doc(db, 'tplays', k), { n: increment(1) }, { merge: true }).then(() => { if (seen.has(k)) seen.set(k, seen.get(k) + 1); }).catch(() => {});
}

export async function monthPlays(t) {
  if (!auth.currentUser || !t || !t.id) return null;
  const k = key(t);
  if (seen.has(k)) return seen.get(k);
  try { const s = await getDoc(doc(db, 'tplays', k)); const n = s.exists() ? Number(s.data().n) || 0 : 0; seen.set(k, n); return n; } catch (e) { console.warn('MKW: счётчик прослушиваний недоступен — проверьте правила Firestore (tplays)', e && e.code); return null; }
}
