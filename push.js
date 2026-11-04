// Пуш-уведомления: звонок или сообщение от друга приходит на телефон и компьютер,
// даже когда MKW закрыт. Подписка этого устройства хранится в push/{uid} (до 6 устройств),
// а отправляет уведомление наш Cloudflare Worker — подписки он читает от имени отправителя,
// поэтому получить их могут только взаимные друзья.
import { db, auth, app } from './firebase.js?v=0.35.0';
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { RECOGNIZE_URL } from './shazam-config.js?v=0.35.0';

const W = () => String(RECOGNIZE_URL || '').replace(/\/$/, '');
const me = () => (auth.currentUser && auth.currentUser.uid) || '';
export const myNick = () => String((auth.currentUser && auth.currentUser.email) || '').split('@')[0] || 'Друг';
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && Boolean(W());

const fromB64u = (s) => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
let keyP = null;
function vapidKey() {
  if (!keyP) {
    keyP = fetch(`${W()}/vapid`).then((r) => (r.ok ? r.json() : { key: '' })).then((j) => String(j.key || '')).catch(() => '');
    keyP.then((k) => { if (!k) keyP = null; });
  }
  return keyP;
}

// включить пуш на этом устройстве (разрешение на уведомления уже должно быть)
export async function enablePush() {
  if (!pushSupported() || Notification.permission !== 'granted' || !me()) return false;
  try {
    const key = await vapidKey();
    if (!key) return false; // на сервере ещё не настроены уведомления
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    let oldKey = ''; try { oldKey = localStorage.getItem('mkw.push.key') || ''; } catch { /* ignore */ }
    if (sub && oldKey && oldKey !== key) { await sub.unsubscribe().catch(() => {}); sub = null; } // ключ сервера сменился
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(key) });
    const j = sub.toJSON();
    const mark = `${me()}|${j.endpoint}`;
    let saved = ''; let savedAt = 0;
    try { saved = localStorage.getItem('mkw.push.saved') || ''; savedAt = Number(localStorage.getItem('mkw.push.savedAt') || 0); localStorage.setItem('mkw.push.key', key); } catch { /* ignore */ }
    if (saved === mark && Date.now() - savedAt < 7 * 864e5) return true;
    const ref = doc(db, 'push', me());
    let list = [];
    try { const s = await getDoc(ref); list = (s.exists() && Array.isArray(s.data().subs)) ? s.data().subs : []; } catch { /* ignore */ }
    list = [{ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, at: Date.now() }, ...list.filter((x) => x && x.endpoint !== j.endpoint)].slice(0, 6);
    await setDoc(ref, { subs: list, updatedAt: Date.now() });
    try { localStorage.setItem('mkw.push.saved', mark); localStorage.setItem('mkw.push.savedAt', String(Date.now())); } catch { /* ignore */ }
    return true;
  } catch (e) { console.warn('push', e); return false; }
}

export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const ep = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    if (!me()) return;
    const ref = doc(db, 'push', me());
    const s = await getDoc(ref);
    const list = (s.exists() && Array.isArray(s.data().subs)) ? s.data().subs.filter((x) => x.endpoint !== ep) : [];
    await setDoc(ref, { subs: list, updatedAt: Date.now() });
    try { localStorage.removeItem('mkw.push.saved'); } catch { /* ignore */ }
  } catch { /* ignore */ }
}

// отправить уведомление другу: kind 'call' | 'missed' | 'msg'
export async function pushTo(uid, kind, title, body, tag, url) {
  if (!W() || !uid || !auth.currentUser || !auth.currentUser.getIdToken) return;
  try {
    const tok = await auth.currentUser.getIdToken();
    await fetch(`${W()}/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ to: uid, kind, title, body, tag, url, project: (app.options && app.options.projectId) || '' }),
      keepalive: true,
    });
  } catch { /* без уведомления — друг увидит внутри приложения */ }
}
