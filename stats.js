// Счётчик слушателей: у каждого пользователя один маркер joined/{uid} с месяцем регистрации.
import { db, auth } from './firebase.js?v=0.17.0';
import { doc, getDoc, setDoc, collection, query, where, getCountFromServer } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export async function registerListener(uid) {
  try {
    const ref = doc(db, 'joined', uid);
    if ((await getDoc(ref)).exists()) return;
    const created = auth.currentUser?.metadata?.creationTime;
    await setDoc(ref, { month: ym(created ? new Date(created) : new Date()) });
  } catch (e) { console.warn('joined', e); }
}

export async function listenerStats() {
  try {
    const col = collection(db, 'joined');
    const [all, mon] = await Promise.all([
      getCountFromServer(col),
      getCountFromServer(query(col, where('month', '==', ym(new Date())))),
    ]);
    return { total: all.data().count, month: mon.data().count };
  } catch (e) { console.warn('stats', e); return null; }
}
