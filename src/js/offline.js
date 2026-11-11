// Офлайн-музыка (только в Android-приложении): лайки и плейлисты скачиваются в память телефона и играют без интернета.
// Звук и обложки хранит приложение (OfflineStore.java), страница лишь решает, что скачать, и находит ссылку на звук.
import * as store from './store.js';
import { findYouTubeId, peekYouTubeId, youtubeEnabled } from './youtube.js';
import { resolveStream } from './stream.js';
import { artUrl, pickTrack } from './utils.js';

const N = () => (window.MKWNative && window.MKWNative.offState ? window.MKWNative : null);
// Офлайн-музыка убрана (0.42.5): скачивание с серверов MKW работало ненадёжно. Код оставлен, но выключен.
export const offlineSupported = () => false;

// то же имя файла, что делает приложение (OfflineStore.safe)
export const offKey = (id) => String(id || '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120);

let st = window.__mkwOffState || { items: [], total: 0 };
const have = new Map(); // id трека → что скачано
const subs = new Set();
const emit = () => subs.forEach((f) => { try { f(); } catch { /* ignore */ } });
export const onOffline = (f) => { subs.add(f); return () => subs.delete(f); };
function apply(o) {
  st = o || { items: [] };
  have.clear();
  for (const it of st.items || []) have.set(it.id, it);
  emit();
}
apply(st);
window.addEventListener('mkw-off', (e) => { if (offlineSupported()) apply(e.detail); });

export const offState = () => st;
export const isDownloaded = (id) => have.has(String(id));
export const offlineSrc = (t) => (offlineSupported() && t && have.has(String(t.id)) ? `/__offline/${offKey(t.id)}` : null);

// скачанные треки как обычные треки (обложка — из памяти телефона, чтобы была видна и без сети)
export function downloadedTracks() {
  return [...have.values()].sort((a, b) => (b.at || 0) - (a.at || 0)).map((it) => ({
    ...(it.t || {}), id: it.id, title: it.title || (it.t && it.t.title) || '', artist: it.artist || (it.t && it.t.artist) || '',
    artwork: it.cover || it.art || '', duration: it.dur || (it.t && it.t.duration) || 0, size: it.size || 0,
  }));
}

// ---------- настройки ----------
const KEY = 'mkw.off';
const DEF = { auto: false, net: 'wifi', pl: true };
export function offSettings() { try { return { ...DEF, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEF }; } }
export function setOffSettings(p) {
  const s = { ...offSettings(), ...p };
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
  emit();
  if (s.auto) syncSoon(800);
  return s;
}

// что нужно держать скачанным: лайки и (по желанию) треки плейлистов
export function wanted() {
  const s = offSettings(), seen = new Set(), out = [];
  const add = (t) => { if (t && t.id && !seen.has(String(t.id))) { seen.add(String(t.id)); out.push(t); } };
  store.state.likes.forEach(add);
  if (s.pl) for (const pl of store.state.playlists) (pl.tracks || []).forEach(add);
  return out;
}

// ---------- загрузка ----------
export const prog = { running: false, total: 0, done: 0, fail: 0, cur: null, wait: '', why: '' };
const failed = new Map(); // id → когда не вышло (повторим не раньше чем через 6 часов)
let stopFlag = false;
const timeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);

async function linksFor(t) {
  let urls = null;
  try {
    const vid = t.ytId || peekYouTubeId(t) || (youtubeEnabled() && !t.noYt ? await findYouTubeId(t) : null);
    if (vid) urls = await timeout(resolveStream(vid, t, true), 25000);
    if (!urls || !urls.length) urls = await timeout(resolveStream(`sc:${t.id}`, t, true), 25000);
  } catch { /* не нашлось */ }
  return urls && urls.length ? urls : null;
}

function askNative(t, urls, wifiOnly) {
  return new Promise((res) => {
    let tm = 0;
    const on = (e) => { const d = e.detail || {}; if (d.id !== String(t.id)) return; window.removeEventListener('mkw-off-done', on); clearTimeout(tm); res(d); };
    window.addEventListener('mkw-off-done', on);
    tm = setTimeout(() => { window.removeEventListener('mkw-off-done', on); res({ ok: false, why: 'долго' }); }, 240000);
    N().offDownload({
      id: String(t.id), urls: urls.slice(0, 4), title: t.title || '', artist: t.artist || '', album: t.album || '',
      dur: Number(t.duration) || 0, art: t.artwork ? artUrl(t.artwork, 600) : '', wifiOnly, track: pickTrack(t),
    });
  });
}

export function stopSync() { stopFlag = true; }

// Запасной путь: страница скачивает звук сама (как плеер) и кусками по ~24 КБ (больше мост приложения не пропускает) передаёт приложению.
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
async function viaPage(t, urls) {
  const n = N();
  if (!n || !n.offPut) return { ok: false, why: 'обновите приложение' };
  let why = '';
  for (const u of urls.slice(0, 4)) {
    try {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 120000);
      const res = await fetch(u, { signal: ctl.signal, credentials: 'omit' });
      if (!res.ok || !res.body) { clearTimeout(tm); why = `сервер ответил ${res.status}`; continue; }
      const type = res.headers.get('content-type') || '';
      if (/text|html|json/.test(type)) { clearTimeout(tm); why = 'вместо звука пришла страница'; continue; }
      const done = new Promise((res2) => {
        const on = (e) => { const d = e.detail || {}; if (d.id !== String(t.id)) return; window.removeEventListener('mkw-off-done', on); res2(d); };
        window.addEventListener('mkw-off-done', on);
        setTimeout(() => { window.removeEventListener('mkw-off-done', on); res2({ ok: false, why: 'долго' }); }, 240000);
      });
      const rd = res.body.getReader();
      let seq = 0, buf = new Uint8Array(0);
      const flush = (last) => {
        const part = last ? buf : buf.subarray(0, 24 * 1024);
        const msg = { id: String(t.id), seq: seq++, b64: b64(part), last };
        if (last) Object.assign(msg, { title: t.title || '', artist: t.artist || '', album: t.album || '', dur: Number(t.duration) || 0, art: t.artwork ? artUrl(t.artwork, 600) : '', track: pickTrack(t) });
        n.offPut(msg);
        buf = last ? new Uint8Array(0) : buf.subarray(part.length);
      };
      for (;;) {
        const { value, done: end } = await rd.read();
        if (value && value.length) { const nb = new Uint8Array(buf.length + value.length); nb.set(buf); nb.set(value, buf.length); buf = nb; }
        while (buf.length >= 24 * 1024) flush(false);
        if (end) break;
      }
      clearTimeout(tm);
      flush(true);
      const r = await done;
      if (r.ok) return r;
      why = r.why || why;
    } catch (e) { why = e && e.name === 'AbortError' ? 'долго качалось' : 'ссылка не открылась'; }
  }
  return { ok: false, why: why || 'не получилось' };
}

export async function syncOffline(manual = false) {
  const n = N(), s = offSettings();
  if (!n || prog.running) return;
  if (!manual && !s.auto) return;
  // свежие сведения о сети от приложения (Wi-Fi включили только что, или он под VPN)
  n.offState();
  await new Promise((r) => setTimeout(r, 350));
  if (!navigator.onLine) { prog.wait = 'нет интернета'; emit(); return; }
  const now = Date.now();
  const list = wanted().filter((t) => !have.has(String(t.id)) && !(failed.get(String(t.id)) > now - 6 * 3600e3 && !manual));
  Object.assign(prog, { running: true, total: list.length, done: 0, fail: 0, cur: null, wait: '', why: '' });
  stopFlag = false;
  emit();
  for (const t of list) {
    if (stopFlag || (!manual && !offSettings().auto)) break;
    if (have.has(String(t.id))) { prog.done += 1; continue; }
    prog.cur = t; emit();
    const urls = await linksFor(t);
    if (!urls) { prog.fail += 1; failed.set(String(t.id), Date.now()); emit(); continue; }
    // сеть приложение выбирает само: качает и по Wi-Fi, и по мобильному (песня — несколько МБ)
    let r = await askNative(t, urls, false);
    // не вышло у приложения — скачиваем так же, как это делает плеер на странице, и передаём файл приложению
    if (!r.ok && r.why !== 'нет интернета') { const r2 = await viaPage(t, urls); if (r2.ok) r = r2; else r = { ...r, why: r2.why || r.why }; }
    if (!r.ok && r.why) prog.why = r.why;
    if (r.ok) prog.done += 1;
    else if (r.why === 'ждём Wi-Fi' || r.why === 'нет интернета') { prog.wait = r.why; break; }
    else { prog.fail += 1; failed.set(String(t.id), Date.now()); }
    emit();
  }
  // автоматический режим держит скачанным только нужное: убрали лайк (и трека нет в плейлистах) — файл удаляется
  if (offSettings().auto && !stopFlag) {
    const keep = new Set(wanted().map((t) => String(t.id)));
    if (keep.size) for (const id of have.keys()) if (!keep.has(id)) n.offRemove(id);
  }
  Object.assign(prog, { running: false, cur: null });
  emit();
}

let syncT = 0;
export function syncSoon(ms = 4000) { clearTimeout(syncT); syncT = setTimeout(() => syncOffline(false), ms); }
export function removeDownload(id) { const n = N(); if (n) n.offRemove(String(id)); }
export function clearDownloads() { const n = N(); if (n) { stopFlag = true; n.offClear(); } }

export function initOffline() {
  const n = N();
  if (!n) return;
  // режим убран: удаляем уже скачанное (освобождаем память телефона) и больше ничего не качаем
  have.clear(); st = { items: [], total: 0 };
  try { if (n.offClear) n.offClear(); } catch { /* ignore */ }
  if (!offlineSupported()) return;
  n.offState();
  store.onStore((what) => { if (what === 'likes' || what === 'playlists') syncSoon(5000); });
  window.addEventListener('online', () => { n.offState(); syncSoon(3000); });
  window.addEventListener('mkw-fg', () => { if (window.__mkwFg) { n.offState(); syncSoon(6000); } });
  setTimeout(() => syncOffline(false), 20000);
  setInterval(() => { n.offState(); syncOffline(false); }, 10 * 60 * 1000);
}
