// «Обход РФ»: если включено, превью и обложки идут через ваш Cloudflare Worker (адрес берётся из shazam-config.js).
// По умолчанию выключено: тогда всё работает напрямую, как обычно.
import { RECOGNIZE_URL } from './shazam-config.js?v=0.22.0';

const KEY = 'mkw.bypass';
const HOSTS = /(^|\.)(mzstatic\.com|itunes\.apple\.com|dzcdn\.net|deezer\.com)$/i;

export const bypassAvailable = () => Boolean(RECOGNIZE_URL);
// Функция убрана в 0.16: провайдеры блокируют workers.dev. Всегда выключено.
export const bypassOn = () => false;
try { localStorage.removeItem(KEY); } catch { /* ignore */ }
export function setBypass(v) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ } }

export function proxify(url) {
  if (!url || !bypassOn()) return url;
  try {
    const u = new URL(url);
    if (!HOSTS.test(u.hostname)) return url;
    return `${RECOGNIZE_URL.replace(/\/$/, '')}/proxy?u=${encodeURIComponent(url)}`;
  } catch { return url; }
}

// Проверка: обновлён ли Worker и доступен ли он из вашей сети. Возвращает '' если всё хорошо, иначе текст причины.
export async function checkBypass() {
  if (!RECOGNIZE_URL) return 'Не указан адрес Worker в shazam-config.js';
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 7000);
  try {
    const r = await fetch(`${RECOGNIZE_URL.replace(/\/$/, '')}/ping`, { signal: ctl.signal });
    if (!r.ok) return 'Worker не обновлён: вставьте новый код и нажмите Deploy';
    const j = await r.json();
    return j && j.proxy ? '' : 'Worker не обновлён: вставьте новый код и нажмите Deploy';
  } catch {
    // CORS-ответ старого Worker тоже падает сюда: no-cors-запрос отличает «не достучаться» от «ответил, но без CORS»
    try { await fetch(`${RECOGNIZE_URL.replace(/\/$/, '')}/ping`, { mode: 'no-cors', cache: 'no-store' }); return 'Worker отвечает, но не обновлён: вставьте новый код (recognize-worker.js) и нажмите Deploy'; }
    catch { return 'Worker недоступен из этой сети: провайдер, похоже, блокирует workers.dev. Откройте адрес Worker /ping в браузере для проверки'; }
  }
  finally { clearTimeout(to); }
}
