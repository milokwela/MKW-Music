import { auth, db } from './firebase.js';
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { doc, setDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { normalizeNick, isValidNick, nickToEmail, emailToNick } from './utils.js';

const ERRORS = {
  'auth/invalid-credential': 'Неверный ник или пароль',
  'auth/invalid-login-credentials': 'Неверный ник или пароль',
  'auth/user-not-found': 'Такого ника нет',
  'auth/wrong-password': 'Неверный пароль',
  'auth/email-already-in-use': 'Этот ник уже занят',
  'auth/weak-password': 'Пароль слишком простой, нужно от 6 символов',
  'auth/too-many-requests': 'Слишком много попыток, подождите пару минут',
  'auth/network-request-failed': 'Нет интернета',
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
  return onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, nick: emailToNick(u.email) } : null));
}
