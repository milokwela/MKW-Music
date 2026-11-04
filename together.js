// «Слушать вместе» без звонка: у всех в переписке играет одно и то же, синхронно.
// Документ together/{id переписки}: { members, host, by, track, pos, at, playing, on: [кто слушает], v }
//  • кто переключил трек, поставил паузу или перемотал — тот и записывает новое состояние;
//  • остальные подстраиваются: включают тот же трек и встают на ту же секунду (по общему времени сервера).
import { db } from './firebase.js?v=0.35.5';
import { doc, setDoc, updateDoc, deleteDoc, getDoc, onSnapshot, arrayUnion, arrayRemove } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import * as player from './player.js?v=0.35.5';
import { srvNow } from './clock.js?v=0.35.5';
import { me } from './friends.js?v=0.35.5';
import { h, toast } from './ui.js?v=0.35.5';
import { mi } from './icons2.js?v=0.35.5';
import { pickTrack } from './utils.js?v=0.35.5';

let sess = null;            // { cid, unsub, v, quietUntil, lastT, lastAt, timer, data }
const subs = new Set();
export const onTogether = (f) => { subs.add(f); return () => subs.delete(f); };
const emit = () => subs.forEach((f) => { try { f(); } catch { /* ignore */ } });
export const togetherCid = () => (sess ? sess.cid : '');
export const togetherData = () => (sess ? sess.data : null);

const ref = (cid) => doc(db, 'together', cid);
const cur = () => player.queue.current;
const quiet = (ms = 2600) => { if (sess) sess.quietUntil = Date.now() + ms; };
const expected = (d) => Math.max(0, (Number(d.pos) || 0) + (d.playing ? (srvNow() - (Number(d.at) || 0)) / 1000 : 0));

function stateNow(extra) {
  const t = cur();
  return { by: me(), track: t ? pickTrack(t) : null, pos: Math.round((player.st.time || 0) * 10) / 10, at: srvNow(), playing: Boolean(player.st.playing || player.st.loading), ...extra };
}

// записываем своё действие для остальных
async function publish() {
  if (!sess || Date.now() < sess.quietUntil || !cur()) return;
  sess.v = (sess.v || 0) + 1;
  const data = stateNow({ v: sess.v });
  sess.data = { ...(sess.data || {}), ...data };
  try { await updateDoc(ref(sess.cid), data); } catch { /* нет сети — догоним при следующем действии */ }
}

// ждём, пока трек реально заиграет, и встаём на нужную секунду
function settle(d, tries = 0) {
  if (!sess || !d.track || !cur() || cur().id !== d.track.id) return;
  if ((player.st.loading || !player.st.mode) && tries < 40) { setTimeout(() => settle(d, tries + 1), 250); return; }
  quiet();
  const want = expected(d);
  if (Math.abs((player.st.time || 0) - want) > 1.5 && (!player.st.duration || want < player.st.duration - 2)) player.seek(want);
  if (!d.playing && player.st.playing) player.pause();
  if (d.playing && !player.st.playing && player.st.mode) player.toggle();
}

function applyRemote(d) {
  if (!sess || !d || !d.track) return;
  if (d.by === me() && (Number(d.v) || 0) <= (sess.v || 0)) return; // это мы сами
  sess.v = Math.max(sess.v || 0, Number(d.v) || 0);
  quiet(4000);
  const t = cur();
  if (!t || t.id !== d.track.id) { player.playTracks([d.track], 0); settle(d); return; }
  settle(d);
}

function watchLocal() {
  // перемотку и паузу ловим по ходу времени: раз в секунду сравниваем, где трек должен быть и где он есть
  sess.lastT = player.st.time || 0; sess.lastAt = Date.now(); sess.lastPlaying = player.st.playing; sess.lastId = cur() ? cur().id : '';
  sess.timer = setInterval(() => {
    if (!sess) return;
    const t = cur(), id = t ? t.id : '';
    const now = Date.now(), dt = (now - sess.lastAt) / 1000;
    const want = sess.lastT + (sess.lastPlaying ? dt : 0);
    const jumped = id === sess.lastId && Math.abs((player.st.time || 0) - want) > 2.5 && !player.st.loading;
    const toggled = id === sess.lastId && sess.lastPlaying !== player.st.playing && !player.st.loading;
    const changed = id !== sess.lastId && id && !player.st.loading;
    sess.lastT = player.st.time || 0; sess.lastAt = now; sess.lastPlaying = player.st.playing; sess.lastId = id;
    if ((jumped || toggled || changed) && Date.now() >= sess.quietUntil) publish();
  }, 1000);
}

async function attach(cid, data) {
  if (sess && sess.cid === cid) return;
  if (sess) await leaveTogether(true);
  sess = { cid, v: Number(data && data.v) || 0, quietUntil: 0, data: data || null };
  document.body.classList.add('jam-on');
  sess.unsub = onSnapshot(ref(cid), (s) => {
    if (!sess || sess.cid !== cid) return;
    if (!s.exists()) { const was = sess; stopLocal(); if (was) toast('Совместное прослушивание закончилось'); emit(); return; }
    const d = s.data();
    sess.data = d;
    if (!(d.on || []).includes(me())) { stopLocal(); emit(); return; }
    applyRemote(d);
    emit();
  }, () => { stopLocal(); emit(); });
  watchLocal();
  emit();
}
function stopLocal() {
  if (!sess) return;
  clearInterval(sess.timer);
  try { sess.unsub && sess.unsub(); } catch { /* ignore */ }
  sess = null;
  document.body.classList.remove('jam-on');
}

// начать: включённый у меня трек становится общим
export async function startTogether(cid, members) {
  const t = cur();
  if (!t) { toast('Сначала включите трек — его и будете слушать вместе'); return false; }
  const data = { members, host: me(), on: [me()], ...stateNow({ v: 1 }) };
  try { await setDoc(ref(cid), data); }
  catch { toast('Не получилось. Обновите правила базы (together) — инструкция у разработчика'); return false; }
  await attach(cid, data);
  sess.v = 1;
  return true;
}

// присоединиться к тем, кто уже слушает
export async function joinTogether(cid) {
  try {
    const s = await getDoc(ref(cid));
    if (!s.exists()) { toast('Совместное прослушивание уже закончилось'); return false; }
    await updateDoc(ref(cid), { on: arrayUnion(me()) });
    const d = s.data();
    await attach(cid, { ...d, on: [...new Set([...(d.on || []), me()])] });
    sess.v = 0;
    applyRemote({ ...d, by: d.by === me() ? '' : d.by });
    return true;
  } catch { toast('Не получилось присоединиться'); return false; }
}

export async function leaveTogether(silent) {
  if (!sess) return;
  const cid = sess.cid, d = sess.data || {};
  stopLocal();
  emit();
  try {
    const left = (d.on || []).filter((x) => x !== me());
    if (!left.length) await deleteDoc(ref(cid)); else await updateDoc(ref(cid), { on: arrayRemove(me()) });
  } catch { /* ignore */ }
  if (!silent) toast('Вы вышли из совместного прослушивания');
}

// плашка в переписке: «Слушаете вместе» / «X слушает — Присоединиться» / кнопка начать
export function togetherBar(cid, members, nickOf, onStart) {
  const el = h('div', { class: 'tg-bar', hidden: '' });
  let remote = null;
  const paint = () => {
    const mine = sess && sess.cid === cid;
    const d = mine ? sess.data : remote;
    if (!d || !d.track) { el.hidden = true; el.replaceChildren(); return; }
    const on = (d.on || []);
    const t = d.track;
    el.hidden = false;
    el.classList.toggle('in', Boolean(mine));
    const who = on.filter((x) => x !== me()).map(nickOf).filter(Boolean);
    el.replaceChildren(
      h('span', { class: 'tg-eq' }, h('i'), h('i'), h('i')),
      h('img', { class: 'tg-art', src: t.artwork || 'mkw-logo.png', alt: '' }),
      h('span', { class: 'tg-txt' },
        h('b', { text: mine ? (who.length ? `Слушаете вместе с ${who.join(', ')}` : 'Ждём друзей…') : `${who[0] || 'Друг'} слушает` }),
        h('small', { text: `${t.title} — ${t.artist}` })),
      mine
        ? h('button', { type: 'button', class: 'tg-btn out', onclick: () => leaveTogether() }, 'Выйти')
        : h('button', { type: 'button', class: 'tg-btn', onclick: () => joinTogether(cid) }, mi('headphones'), h('span', { text: 'Слушать' })));
  };
  let unsub = () => {};
  try { unsub = onSnapshot(ref(cid), (s) => { remote = s.exists() ? s.data() : null; paint(); }, () => { remote = null; paint(); }); } catch { /* ignore */ }
  const off = onTogether(paint);
  paint();
  return { el, stop: () => { try { unsub(); } catch { /* ignore */ } off(); }, start: () => onStart && onStart() };
}
