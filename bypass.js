// «Обход РФ»: если включено, превью и обложки идут через ваш Cloudflare Worker (адрес берётся из shazam-config.js).
// По умолчанию выключено: тогда всё работает напрямую, как обычно.
import { RECOGNIZE_URL } from './shazam-config.js?v=0.13.1';

const KEY = 'mkw.bypass';
const HOSTS = /(^|\.)(mzstatic\.com|itunes\.apple\.com|dzcdn\.net|deezer\.com)$/i;

export const bypassAvailable = () => Boolean(RECOGNIZE_URL);
export const bypassOn = () => { try { return localStorage.getItem(KEY) === '1' && bypassAvailable(); } catch { return false; } };
export function setBypass(v) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ } }

export function proxify(url) {
  if (!url || !bypassOn()) return url;
  try {
    const u = new URL(url);
    if (!HOSTS.test(u.hostname)) return url;
    return `${RECOGNIZE_URL.replace(/\/$/, '')}/proxy?u=${encodeURIComponent(url)}`;
  } catch { return url; }
}
