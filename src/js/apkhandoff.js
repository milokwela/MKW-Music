// Вход в приложение для Android «с сайта».
// Приложение открывает эту страницу в браузере (mkwmusic.ru/?apk=handoff&s=одноразовый_код). Если вы здесь уже вошли,
// по кнопке вход возвращается в приложение. Приложение принимает его только с тем кодом, который само выдало.
import { auth } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { h } from './ui.js';
import { emailToNick } from './utils.js';

const PKG = 'ru.mkwmusic.app';
const STYLE = 'position:fixed;left:12px;right:12px;top:max(12px,env(safe-area-inset-top));z-index:99999;display:grid;gap:10px;'
  + 'max-width:480px;margin:0 auto;padding:16px;border-radius:20px;background:#241820;color:#f3e9ee;'
  + 'box-shadow:0 12px 40px rgba(0,0,0,.55);font:14px/1.45 system-ui,sans-serif';

// сохранённая вход-сессия Firebase этого браузера (то, что браузер помнит, чтобы вы не вводили пароль заново)
function readSession(uid) {
  return new Promise((resolve) => {
    try {
      const rq = indexedDB.open('firebaseLocalStorageDb');
      rq.onerror = () => resolve(null);
      rq.onsuccess = () => {
        const db = rq.result;
        try {
          if (!db.objectStoreNames.contains('firebaseLocalStorage')) { db.close(); resolve(null); return; }
          const g = db.transaction('firebaseLocalStorage').objectStore('firebaseLocalStorage').getAll();
          g.onsuccess = () => {
            db.close();
            const rec = (g.result || []).find((r) => r && typeof r.fbase_key === 'string' && r.fbase_key.startsWith('firebase:authUser:') && r.value && r.value.uid === uid);
            resolve(rec ? { k: rec.fbase_key, v: rec.value } : null);
          };
          g.onerror = () => { db.close(); resolve(null); };
        } catch { db.close(); resolve(null); }
      };
    } catch { resolve(null); }
  });
}

// intent:// с package — открывает именно приложение MKW, а не любое другое с похожей ссылкой
const intentUrl = (nonce, rec) => `intent://handoff#Intent;scheme=mkwmusic;package=${PKG};S.s=${nonce};S.u=${encodeURIComponent(JSON.stringify(rec))};S.browser_fallback_url=${encodeURIComponent('https://mkwmusic.ru/')};end`;

export function initApkHandoff() {
  let nonce = '';
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('apk') !== 'handoff') return;
    nonce = q.get('s') || '';
  } catch { return; }
  if (!/^[0-9a-f]{32}$/.test(nonce)) return;
  if (/MKWApp\//.test(navigator.userAgent)) return; // внутри самого приложения подтверждать нечего

  const box = h('div', { role: 'dialog', 'aria-label': 'Вход в приложение MKW', style: STYLE });
  const close = () => { box.remove(); try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ } };
  const title = (t) => h('b', { text: t, style: 'font-size:16px' });
  const note = (t) => h('p', { text: t, style: 'margin:0;opacity:.8' });
  const closeBtn = (label) => { const b = h('button', { class: 'btn tonal', type: 'button', text: label }); b.addEventListener('click', close); return b; };
  const show = (...kids) => box.replaceChildren(...kids);

  const paint = (user) => {
    if (!/android/i.test(navigator.userAgent)) {
      show(title('Эта страница — для приложения MKW на Android'), note('Откройте её с телефона, на котором установлено приложение: нажмите «Продолжить с сайта» на его экране входа.'), closeBtn('Закрыть'));
      return;
    }
    if (!user) {
      show(title('На сайте вы пока не вошли'),
        note('Войдите здесь по нику и паролю — и эта подсказка предложит вернуться в приложение. Или закройте её и введите ник и пароль прямо в приложении.'),
        closeBtn('Закрыть'));
      return;
    }
    const go = h('button', { class: 'btn', type: 'button', text: 'Продолжить в приложении' });
    const msg = note('Откроем приложение MKW Music и войдём в нём в этот же аккаунт.');
    go.addEventListener('click', async () => {
      const rec = await readSession(user.uid);
      if (!rec) { msg.textContent = 'Не получилось прочитать вход в этом браузере. Введите ник и пароль в приложении.'; return; }
      msg.textContent = 'Если приложение не открылось, оно не установлено или его нужно обновить до версии 0.2.0.';
      location.href = intentUrl(nonce, rec);
    });
    show(title(`Войти в приложение как ${emailToNick(user.email || '') || 'вы'}?`), msg, go, closeBtn('Отмена'));
  };

  document.body.appendChild(box);
  show(note('Проверяем вход…'));
  onAuthStateChanged(auth, paint);
}
