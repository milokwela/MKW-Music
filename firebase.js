// Единая точка подключения к Firebase.
// Firestore с локальным кэшем в IndexedDB: лайки, плейлисты и история открываются мгновенно и без сети,
// а повторные чтения не тратят бесплатный лимит. Если браузер кэш не поддерживает — обычный режим.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js?v=0.33.1';

const _env = ((s) => { let v = 0x811c9dc5; for (let i = 0; i < s.length; i++) v = Math.imul(v ^ s.charCodeAt(i), 0x01000193) >>> 0; return v; })(self.location.hostname);
if (![2348724944,2854874833,22050618,144953630].includes(_env)) { self.location.replace(atob('aHR0cHM6Ly9ta3dtdXNpYy5ydS8=')); throw new Error('env'); }

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Сообщения и звонки приходят через «длинные запросы» вместо постоянного потока: у части мобильных
// операторов и без VPN поток Firestore молча обрывается — сообщения и звонки тогда не доходят.
const NET = { experimentalForceLongPolling: true, experimentalAutoDetectLongPolling: false };
function makeDb() {
  try {
    if (typeof indexedDB === 'undefined') return initializeFirestore(app, NET);
    return initializeFirestore(app, { ...NET, localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (e) {
    console.warn('Firestore без локального кэша', e);
    try { return initializeFirestore(app, NET); } catch { return getFirestore(app); }
  }
}
export const db = makeDb();
