// Общие часы для всех: время сервера, а не телефона.
// Если на телефоне часы спешат или отстают, сообщения вставали не по порядку, галочки «прочитано»
// загорались раньше времени, а «в сети» висело лишние минуты. Берём время из ответа нашего же сайта.
const KEY = 'mkw.clock.off';
let off = 0;
try { off = Number(localStorage.getItem(KEY)) || 0; } catch { /* ignore */ }
export const srvNow = () => Date.now() + off;
let busy = false, last = 0;
export async function syncClock() {
  if (busy || Date.now() - last < 60000) return;
  busy = true;
  try {
    const t0 = Date.now();
    const r = await fetch(`version.json?clock=${t0}`, { cache: 'no-store' });
    const t1 = Date.now();
    const d = Date.parse(r.headers.get('date') || '');
    if (d && t1 - t0 < 4000) {
      const o = d + 500 - (t0 + t1) / 2; // в заголовке время до секунды — берём середину
      off = Math.abs(o) < 1500 ? 0 : Math.round(o);
      last = t1;
      try { localStorage.setItem(KEY, String(off)); } catch { /* ignore */ }
    }
  } catch { /* без сети — оставляем прошлую поправку */ }
  busy = false;
}
export function initClock() {
  syncClock();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncClock(); });
}

// «В сети». Когда человек уходит из приложения, отметку сдвигаем в прошлое на OFF_SHIFT,
// чтобы друзья сразу видели «не в сети», а в миллисекундах ставим метку 997 — по ней
// восстанавливаем настоящее время ухода (раньше показывало «был(а) в сети 10 минут назад»).
export const ONLINE_WIN = 190000;
const OFF_SHIFT = 200000, MARK = 997;
export const offlineStamp = () => { const t = srvNow(); return t - (t % 1000) + MARK - OFF_SHIFT; };
export const onlineStamp = () => { const t = srvNow(); return t % 1000 === MARK ? t + 1 : t; };
export const isOffMark = (s) => (Number(s) || 0) % 1000 === MARK;
export const realSeen = (s) => { const n = Number(s) || 0; return n && isOffMark(n) ? n + OFF_SHIFT : n; };
export const seenOnline = (s) => { const n = Number(s) || 0; return Boolean(n) && !isOffMark(n) && srvNow() - n < ONLINE_WIN; };
