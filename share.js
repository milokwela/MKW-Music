// Поделиться треком: ссылка на сайт с зашитым треком; по ней у друга откроется окно «Слушать».
import { $, h, toast, openSheet, closeSheet } from './ui.js?v=0.13.0';
import * as player from './player.js?v=0.13.0';

const enc = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const dec = (s) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))));

export function trackLink(t) {
  const o = { i: t.id, t: t.title, a: t.artist, w: t.artwork || '', y: t.ytId || '', u: t.auId || '', p: t.previewUrl && !t.auId ? t.previewUrl : '' };
  return `${location.origin}${location.pathname}#s=${enc(o)}`;
}

export async function shareTrack(t) {
  const url = trackLink(t);
  const text = `${t.title} — ${t.artist}`;
  try {
    if (navigator.share) { await navigator.share({ title: 'MKW Music', text, url }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url); toast('Ссылка скопирована'); }
  catch { openSheet('Ссылка на трек', h('div', { class: 'pw-form' }, h('input', { class: 'sheet-input', value: url, readonly: '' }))); }
}

let pending = null;
export function readIncoming() {
  const m = location.hash.match(/^#s=(.+)$/);
  if (!m) return;
  try {
    const o = dec(m[1]);
    pending = {
      id: String(o.i || ''), title: String(o.t || ''), artist: String(o.a || ''), album: '', artwork: String(o.w || ''),
      previewUrl: String(o.p || ''), duration: 0, genre: '', ytId: String(o.y || ''), auId: String(o.u || ''), noYt: Boolean(o.u),
    };
  } catch { pending = null; }
  history.replaceState(null, '', location.pathname + location.search);
}

export function showIncoming() {
  if (!pending) return;
  const t = pending;
  pending = null;
  openSheet('Вам прислали трек', h('div', { class: 'pw-form' },
    h('div', { class: 'share-card' },
      t.artwork ? h('img', { src: t.artwork, alt: '' }) : null,
      h('div', {}, h('b', { text: t.title }), h('div', { class: 'track-sub', text: t.artist }))),
    h('button', { class: 'btn', type: 'button', onclick: () => { closeSheet(); player.playTracks([t], 0); } }, 'Слушать')));
}
void $;
