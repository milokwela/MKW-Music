import { proxify } from './bypass.js?v=0.22.0';
// Мелкие чистые функции. Здесь нет обращений к DOM, поэтому их можно проверять без браузера.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Экранирование текста для вставки в HTML-строку.
// В самом приложении текст вставляется через textContent, эта функция нужна как страховка.
export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESC[ch]);
}

// Секунды -> "м:сс" или "ч:мм:сс".
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function debounce(fn, delay) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// Перемешивание Фишера-Йетса. Возвращает копию.
export function shuffled(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Склонение: plural(5, 'трек', 'трека', 'треков') -> 'треков'
export function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

export function tracksWord(n) {
  return `${n} ${plural(n, 'трек', 'трека', 'треков')}`;
}

// Размер обложки iTunes: .../100x100bb.jpg -> .../300x300bb.jpg
export function artUrl(url, size) {
  if (!url) return '';
  return proxify(url.replace(/\/\d+x\d+(bb)?\.(jpg|png|webp)(?=$|\?)/, `/${size}x${size}bb.$2`));
}

// Оставляет в треке только те поля, которые мы храним.
// Firestore не принимает undefined, поэтому у каждого поля есть значение по умолчанию.
export function pickTrack(t) {
  return {
    id: String(t?.id ?? ''),
    title: String(t?.title ?? ''),
    artist: String(t?.artist ?? ''),
    album: String(t?.album ?? ''),
    artwork: String(t?.artwork ?? ''),
    previewUrl: String(t?.previewUrl ?? ''),
    duration: Number(t?.duration) || 0,
    genre: String(t?.genre ?? ''),
    ytId: String(t?.ytId ?? ''),
    auId: String(t?.auId ?? ''),
    noYt: Boolean(t?.noYt),
  };
}

// "5 мин назад", "вчера" и т.п. для истории.
export function timeAgo(ts, now = Date.now()) {
  const diff = Math.max(0, now - Number(ts || 0));
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

// Ник: латиница и цифры, 3-20 символов. Храним в нижнем регистре.
export function normalizeNick(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function isValidNick(nick) {
  return /^[a-z0-9]{3,20}$/.test(nick);
}

export function nickToEmail(nick) {
  return `${nick}@mkw.invalid`;
}

export function emailToNick(email) {
  return String(email ?? '').split('@')[0];
}
