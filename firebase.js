// Единая точка подключения к Firebase.
// Firestore с локальным кэшем в IndexedDB: лайки, плейлисты и история открываются мгновенно и без сети,
// а повторные чтения не тратят бесплатный лимит. Если браузер кэш не поддерживает — обычный режим.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js?v=0.21.0';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

function makeDb() {
  try {
    if (typeof indexedDB === 'undefined') return getFirestore(app);
    return initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (e) {
    console.warn('Firestore без локального кэша', e);
    return getFirestore(app);
  }
}
export const db = makeDb();
