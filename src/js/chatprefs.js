// Свои настройки чатов: закреплённые сверху и «без уведомлений» на время.
// Хранятся в своём документе users/{uid} (видно только вам) и копией — для фоновых уведомлений.
import { db } from './firebase.js';
import { doc, setDoc, deleteField } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import * as store from './store.js';

const FOREVER = 9e15;
const prof = () => store.state.profile || {};
export const pinnedChats = () => (Array.isArray(prof().chatPins) ? prof().chatPins.map(String) : []);
export const isPinned = (cid) => pinnedChats().includes(cid);
const muteMap = () => (prof().chatMute && typeof prof().chatMute === 'object' ? prof().chatMute : {});
export const mutedUntil = (cid) => { const t = Number(muteMap()[cid]) || 0; return t > Date.now() ? t : 0; };
export const isMuted = (cid) => mutedUntil(cid) > 0;
export const mutedForever = (cid) => mutedUntil(cid) >= FOREVER;

async function save(patch, local) {
  if (!store.state.uid) return;
  store.state.profile = { ...prof(), ...local };
  syncSw();
  window.dispatchEvent(new CustomEvent('mkw-chatprefs'));
  await setDoc(doc(db, 'users', store.state.uid), patch, { merge: true });
}

export async function togglePin(cid) {
  const list = pinnedChats();
  const next = list.includes(cid) ? list.filter((x) => x !== cid) : [cid, ...list].slice(0, 10);
  await save({ chatPins: next }, { chatPins: next });
  return next.includes(cid);
}
// ms: на сколько; 0 — включить уведомления; Infinity — навсегда
export async function setMute(cid, ms) {
  const m = { ...muteMap() };
  if (!ms) { delete m[cid]; await save({ chatMute: { [cid]: deleteField() } }, { chatMute: m }); return; }
  const until = ms === Infinity ? FOREVER : Date.now() + ms;
  m[cid] = until;
  await save({ chatMute: { [cid]: until } }, { chatMute: m });
}
export function muteLabel(cid) {
  const t = mutedUntil(cid);
  if (!t) return '';
  if (t >= FOREVER) return 'Без уведомлений';
  const d = new Date(t), today = new Date();
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === today.toDateString() ? `Без уведомлений до ${hm}` : `Без уведомлений до ${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}, ${hm}`;
}

// копия для фоновых уведомлений (service worker читает её, когда приходит пуш)
export async function syncSw() {
  try {
    if (!('caches' in window)) return;
    const c = await caches.open('mkw-prefs');
    await c.put('/__mkw_mute', new Response(JSON.stringify(muteMap()), { headers: { 'Content-Type': 'application/json' } }));
  } catch { /* ignore */ }
}
store.onStore((w) => { if (w === 'profile') syncSw(); });
