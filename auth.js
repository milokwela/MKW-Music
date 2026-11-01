import { auth, db } from './firebase.js?v=0.17.0';
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider, updateEmail,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { doc, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { normalizeNick, isValidNick, nickToEmail, emailToNick } from './utils.js?v=0.17.0';

const ERRORS = {
  'auth/invalid-credential': 'Неверный ник или пароль',
  'auth/invalid-login-credentials': 'Неверный ник или пароль',
  'auth/user-not-found': 'Такого ника нет',
  'auth/wrong-password': 'Неверный пароль',
  'auth/email-already-in-use': 'Этот ник уже занят',
  'auth/weak-password': 'Пароль слишком простой, нужно от 6 символов',
  'auth/too-many-requests': 'Слишком много попыток, подождите пару минут',
  'auth/network-request-failed': 'Нет интернета',
  'auth/requires-recent-login': 'Для смены нужен текущий пароль. Если не помните, выйдите и войдите заново',
  'auth/operation-not-allowed': 'Вход по паролю выключен в Firebase (Authentication → Sign-in method → Email/Password)',
};

export function authErrorText(err) {
  return ERRORS[err?.code] || `Не получилось: ${err?.code || err?.message || 'ошибка'}`;
}

function checkInput(nickRaw, pass) {
  const nick = normalizeNick(nickRaw);
  if (!isValidNick(nick)) throw Object.assign(new Error('nick'), { userText: 'Ник: только латиница и цифры, 3–20 символов' });
  if (String(pass).length < 6) throw Object.assign(new Error('pass'), { userText: 'Пароль: минимум 6 символов' });
  return nick;
}

export async function signIn(nickRaw, pass) {
  const nick = checkInput(nickRaw, pass);
  await signInWithEmailAndPassword(auth, nickToEmail(nick), pass);
}

export async function signUp(nickRaw, pass) {
  const nick = checkInput(nickRaw, pass);
  const cred = await createUserWithEmailAndPassword(auth, nickToEmail(nick), pass);
  try {
    await setDoc(doc(db, 'users', cred.user.uid), { nick, createdAt: Date.now() });
  } catch (e) {
    console.warn('Не удалось записать профиль', e);
  }
}

export function logOut() {
  return signOut(auth);
}

// Колбэк получает { uid, nick } или null.
export function watchAuth(cb) {
  return onAuthStateChanged(auth, async (u) => {
    if (!u) { cb(null); return; }
    let nick = emailToNick(u.email);
    try {
      // имя из профиля (если ник менялся только в приложении), с ограничением по времени
      const snap = await Promise.race([getDoc(doc(db, 'users', u.uid)), new Promise((_, rej) => setTimeout(rej, 2500))]);
      const n = snap && snap.exists() ? snap.data().nick : '';
      if (n && isValidNick(normalizeNick(n))) nick = normalizeNick(n);
    } catch { /* остаётся ник из входа */ }
    cb({ uid: u.uid, nick });
  });
}

// Смена ника. Пробуем сменить и вход (почта Firebase), если сервер не разрешает, меняем только имя в приложении.
export async function changeNick(nickRaw, pass) {
  const user = auth.currentUser;
  if (!user) throw Object.assign(new Error('nouser'), { userText: 'Сначала войдите' });
  const nick = normalizeNick(nickRaw);
  if (!isValidNick(nick)) throw Object.assign(new Error('nick'), { userText: 'Ник: только латиница и цифры, 3–20 символов' });
  if (!pass) throw Object.assign(new Error('pass'), { userText: 'Введите текущий пароль' });
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, pass));
  let loginChanged = false;
  try {
    await updateEmail(user, nickToEmail(nick));
    loginChanged = true;
  } catch (e) {
    if (e.code === 'auth/email-already-in-use') throw e;
    console.warn('Вход не сменён, меняем только имя', e);
  }
  await setDoc(doc(db, 'users', user.uid), { nick }, { merge: true });
  return { nick, loginChanged };
}

// Смена пароля. Если текущий пароль указан, подтверждаем им; если нет, пробуем без него (работает, пока вход свежий).
export async function changePassword(current, next) {
  const user = auth.currentUser;
  if (!user) throw Object.assign(new Error('nouser'), { userText: 'Сначала войдите' });
  if (String(next).length < 6) throw Object.assign(new Error('pass'), { userText: 'Новый пароль: минимум 6 символов' });
  if (current) await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current));
  await updatePassword(user, next);
}
