// Страна, из которой виден ваш интернет. Сначала ваш Worker (Cloudflare знает страну), запасной вариант: api.country.is.
import { RECOGNIZE_URL } from './shazam-config.js?v=0.22.0';

function name(code) {
  try { return new Intl.DisplayNames(['ru'], { type: 'region' }).of(code) || code; } catch { return code; }
}
function flag(code) {
  return String(code).toUpperCase().replace(/./g, (ch) => String.fromCodePoint(127397 + ch.charCodeAt(0)));
}
async function getJson(url) {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 6000);
  try { const r = await fetch(url, { signal: ctl.signal }); return r.ok ? await r.json() : null; } catch { return null; } finally { clearTimeout(to); }
}

export async function connectionCountry() {
  let code = '';
  if (RECOGNIZE_URL) { const j = await getJson(`${RECOGNIZE_URL.replace(/\/$/, '')}/geo`); code = j && j.country; }
  if (!code) { const j = await getJson('https://api.country.is/'); code = j && j.country; }
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return '';
  return `${flag(code)} ${name(code.toUpperCase())}`;
}
