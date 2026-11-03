// Чат с друзьями. Писать можно только взаимным друзьям (проверяют и приложение, и правила Firestore).
//   chats/{a_b}            — { members: [a, b], last: { from, text, at }, at, read: { uid: время } }   (a < b)
//   chats/{a_b}/msgs/{id}  — { from, text, at, track? }
import { safeUrl } from './utils.js?v=0.33.0';
import { db } from './firebase.js?v=0.33.0';
import { doc, setDoc, addDoc, deleteDoc, getDocs, collection, query, where, orderBy, limit, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { h, toast, openSheet, closeSheet } from './ui.js?v=0.33.0';
import { openImage } from './viewer.js?v=0.33.0';
import { mi } from './icons2.js?v=0.33.0';
import * as player from './player.js?v=0.33.0';
import { searchTracks } from './catalog.js?v=0.33.0';
import { me, isFriend, cardOf, friendIds, friendCards, loadFriends, friendsLoaded } from './friends.js?v=0.33.0';
import { avSrc } from './avatar.js?v=0.33.0';
import { seenText, isOnline, openUserPage, closeUserPage } from './userpage.js?v=0.33.0';
import { startCall, warmCalls } from './call.js?v=0.33.0';
import { streakOf, streakPatch, fireIcon, openStreak, startStreak, playFire } from './streak.js?v=0.33.0';
import { pushTo, myNick } from './push.js?v=0.33.0';
import { srvNow } from './clock.js?v=0.33.0';

export const chatId = (a, b) => [a, b].sort().join('_');

// События звонка в переписке: «пропущенный», «отклонил», «звонок · 3 мин». Хранятся как текст с меткой —
// так подходят и старые правила базы.
const CALL_MARK = '\u2060CALL|';
const isCallMsg = (t) => String(t || '').startsWith(CALL_MARK);
function parseCall(t) { const [kind, sec, nick] = String(t).slice(CALL_MARK.length).split('|'); return { kind, sec: Number(sec) || 0, nick: nick || '' }; }
const dur = (s) => (s < 60 ? `${s} сек` : `${Math.floor(s / 60)} мин${s % 60 ? ` ${s % 60} сек` : ''}`);
export async function postCallEvent(uid, kind, sec = 0, nick = '') {
  if (!uid || !isFriend(uid)) return;
  const cid = chatId(me(), uid), at = srvNow();
  const human = kind === 'missed' ? 'Пропущенный звонок' : kind === 'declined' ? `${nick || 'Друг'} отклонил(а) звонок` : `Звонок · ${dur(sec)}`;
  try {
    await addDoc(collection(db, 'chats', cid, 'msgs'), { from: me(), text: `${CALL_MARK}${kind}|${sec}|${String(nick).slice(0, 32)}`, at });
    await setDoc(doc(db, 'chats', cid), { members: cid.split('_'), last: { from: me(), text: human, at }, at, read: { [me()]: at } }, { merge: true });
  } catch { /* старые правила — без записи в чат */ }
}
const other = (c) => (c.members || []).find((x) => x !== me()) || '';
export const otherOf = other;

// ---------- список чатов и непрочитанные ----------
let chats = [];
let unsubList = null;
const subs = new Set();
export const onChats = (f) => { subs.add(f); return () => subs.delete(f); };
export const chatList = () => chats;
export const isUnread = (c) => c && c.last && c.last.from !== me() && (Number(c.at) || 0) > (Number(c.read && c.read[me()]) || 0) && !(Number((c.read || {})[`b_${me()}`]) > 0);
export const unreadCount = () => chats.filter(isUnread).length;
export const chatWith = (uid) => chats.find((c) => other(c) === uid) || null;

// ---------- очистка и блокировка (в документе чата, поле read — правила базы это уже разрешают) ----------
//   read.x_<uid> — с какого момента этот человек очистил чат у себя;  read.xa — чат очищен у обоих
//   read.b_<uid> — с какого момента этот человек заблокировал собеседника (0 — не блокировал)
const rd = (c) => (c && c.read) || {};
export const clearedAt = (c) => Math.max(Number(rd(c)[`x_${me()}`]) || 0, Number(rd(c).xa) || 0);
export const blockedByMe = (uid) => Number(rd(chatWith(uid))[`b_${me()}`]) || 0;
export const blockedMe = (uid) => Number(rd(chatWith(uid))[`b_${uid}`]) || 0;
export const isBlocked = (uid) => Boolean(blockedByMe(uid) || blockedMe(uid));
async function setFlags(uid, flags) {
  const cid = chatId(me(), uid);
  await setDoc(doc(db, 'chats', cid), { members: cid.split('_'), read: flags }, { merge: true });
  const c = chatWith(uid); if (c) c.read = { ...(c.read || {}), ...flags };
  subs.forEach((f) => { try { f(); } catch { /* ignore */ } });
}
export async function clearForMe(uid) { await setFlags(uid, { [`x_${me()}`]: srvNow() }); }
export async function clearForAll(uid) {
  await setFlags(uid, { xa: srvNow() });
  // сами сообщения тоже стираем из базы (если правила базы это разрешают — иначе они просто скрыты у обоих)
  try {
    const cid = chatId(me(), uid);
    for (let round = 0; round < 10; round += 1) {
      const s = await getDocs(query(collection(db, 'chats', cid, 'msgs'), orderBy('at', 'desc'), limit(100)));
      if (!s.size) break;
      await Promise.all(s.docs.map((d) => deleteDoc(d.ref)));
      if (s.size < 100) break;
    }
  } catch { /* старые правила — сообщения скрыты, но остаются в базе */ }
}
export async function setBlocked(uid, on) { await setFlags(uid, { [`b_${me()}`]: on ? srvNow() : 0 }); }

// кнопки в профиле друга: очистить, удалить у всех, заблокировать
export function chatActions(uid, u) {
  const nick = (u && u.nick) || 'друг';
  const confirm2 = (btn, text, run) => {
    if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; const old = btn.querySelector('span').textContent; btn.querySelector('span').textContent = text; setTimeout(() => { if (btn.isConnected) { btn.dataset.sure = ''; btn.querySelector('span').textContent = old; } }, 3500); return; }
    btn.dataset.sure = ''; run();
  };
  const box = h('div', { class: 'up-chat' });
  const paint = () => {
    const bl = blockedByMe(uid);
    box.replaceChildren(...[
      h('div', { class: 'section-title', text: 'Переписка' }),
      bl ? h('div', { class: 'up-blocked' }, mi('close'), h('span', { text: `Вы заблокировали ${nick}. Он(а) не может писать вам и звонить` })) : null,
      h('div', { class: 'up-chat-list' },
        h('button', { type: 'button', class: 'up-ca', onclick: (e) => confirm2(e.currentTarget, 'Нажмите ещё раз — очистить у себя', async () => { try { await clearForMe(uid); toast('Чат очищен у вас'); } catch { toast('Не получилось. Проверьте интернет'); } }) }, mi('chat'), h('span', { text: 'Очистить чат у себя' })),
        h('button', { type: 'button', class: 'up-ca danger', onclick: (e) => confirm2(e.currentTarget, 'Нажмите ещё раз — удалить у обоих', async () => { try { await clearForAll(uid); toast(`Чат удалён у вас и у ${nick}`); } catch { toast('Не получилось. Проверьте интернет'); } }) }, mi('close'), h('span', { text: 'Удалить чат у всех' })),
        h('button', { type: 'button', class: `up-ca${bl ? '' : ' danger'}`, onclick: async () => {
          try { await setBlocked(uid, !bl); toast(bl ? `${nick} разблокирован(а)` : `${nick} заблокирован(а)`); paint(); } catch { toast('Не получилось. Проверьте интернет'); }
        } }, mi(bl ? 'check' : 'shield'), h('span', { text: bl ? 'Разблокировать' : 'Заблокировать' })))].filter(Boolean));
  };
  paint();
  return box;
}

export function watchChats(onNew) {
  if (unsubList || !me()) return;
  let first = true;
  try {
    unsubList = onSnapshot(query(collection(db, 'chats'), where('members', 'array-contains', me()), limit(100)), (s) => {
      const prev = new Map(chats.map((c) => [c.id, c.at]));
      chats = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
      if (!first && onNew) chats.forEach((c) => { if (isUnread(c) && (prev.get(c.id) || 0) < c.at && openId !== c.id && !(Number((c.read || {})[`b_${me()}`]) > 0)) onNew(c, other(c)); });
      first = false;
      paintTicks();
      if (openId) { const c = chats.find((x) => x.id === openId); if (c && isUnread(c)) markRead(openId); }
      subs.forEach((f) => { try { f(); } catch { /* ignore */ } });
    }, () => { /* старые правила или нет сети */ });
  } catch { /* ignore */ }
}
export function stopChats() { if (unsubList) { unsubList(); unsubList = null; } chats = []; closeChat(); }

function markRead(cid) {
  const c = chats.find((x) => x.id === cid); if (!c) return;
  c.read = { ...(c.read || {}), [me()]: srvNow() };
  setDoc(doc(db, 'chats', cid), { read: { [me()]: srvNow() } }, { merge: true }).catch(() => {});
  subs.forEach((f) => { try { f(); } catch { /* ignore */ } });
}

const VOICE_TXT = '🎤 Голосовое сообщение';
async function send(cid, text, track, img, voice) {
  const at = srvNow(), from = me();
  const msg = { from, text: text.slice(0, 500), at };
  if (track) msg.track = { title: String(track.title).slice(0, 120), artist: String(track.artist).slice(0, 120) };
  if (img) msg.img = img;
  if (voice) {
    msg.voice = voice.data; msg.vdur = Math.round(voice.dur);
    try { await addDoc(collection(db, 'chats', cid, 'msgs'), msg); }
    catch {
      // правила базы ещё старые — кладём запись в поле фото, а текстом подписываем для старых версий приложения
      await addDoc(collection(db, 'chats', cid, 'msgs'), { from, text: VOICE_TXT, at, img: voice.data });
    }
  } else await addDoc(collection(db, 'chats', cid, 'msgs'), msg);
  const preview = (voice ? VOICE_TXT : img && !msg.text ? 'Фото' : track && !msg.text ? `♪ ${msg.track.artist} — ${msg.track.title}` : msg.text).slice(0, 140);
  const to0 = cid.split('_').find((x) => x !== from);
  await setDoc(doc(db, 'chats', cid), { members: cid.split('_'), last: { from, text: preview, at }, at, read: { [from]: at, ...streakPatch(chatWith(to0), from, to0) } }, { merge: true });
  // пуш другу — придёт, даже если у него MKW закрыт (тот же тег, что и у уведомления внутри приложения, — без повторов)
  const to = cid.split('_').find((x) => x !== from);
  if (to) pushTo(to, 'msg', myNick(), preview, `chat-${cid}`, `./#chat=${from}`);
}

// фото: сжимаем до ~800 px JPEG, чтобы влезло в документ Firestore (без платного хранилища)
function shrink(file, max = 820, q = 0.72) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      let d = c.toDataURL('image/jpeg', q);
      if (d.length > 380000) d = c.toDataURL('image/jpeg', 0.5);
      if (d.length > 380000) { const c2 = document.createElement('canvas'); c2.width = Math.round(c.width * 0.65); c2.height = Math.round(c.height * 0.65); c2.getContext('2d').drawImage(c, 0, 0, c2.width, c2.height); d = c2.toDataURL('image/jpeg', 0.55); }
      resolve(d);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img')); };
    img.src = url;
  });
}

// фон чата: у каждого свой, хранится на этом устройстве
const BGS = [
  { id: 'none', name: 'Обычный', css: '' },
  { id: 'night', name: 'Ночь', css: 'linear-gradient(160deg, #0b0b1e, #1a1035 60%, #000)' },
  { id: 'sunset', name: 'Закат', css: 'linear-gradient(160deg, #3b0f2e, #7a2b3f 50%, #1a0b12)' },
  { id: 'ocean', name: 'Океан', css: 'linear-gradient(160deg, #021b2e, #063a5a 50%, #020c16)' },
  { id: 'aurora', name: 'Сияние', css: 'radial-gradient(120% 80% at 20% 0%, rgba(67,233,123,.35), transparent 60%), radial-gradient(120% 80% at 90% 30%, rgba(106,92,255,.4), transparent 60%), #05060a' },
  { id: 'black', name: 'Чёрный', css: '#000' },
  { id: 'accent', name: 'Цвет приложения', css: 'radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--primary) 35%, transparent), transparent 70%), var(--bg)' },
];
const BGKEY = (cid) => `mkw.chatbg.${cid}`;
function bgOf(cid) { try { return localStorage.getItem(BGKEY(cid)) || 'none'; } catch { return 'none'; } }
function paintBg(list, cid) {
  const v = bgOf(cid);
  const css = v.startsWith('data:') && safeUrl(v) ? `linear-gradient(rgba(0,0,0,.35), rgba(0,0,0,.35)), center / cover no-repeat url("${safeUrl(v)}")` : (BGS.find((b) => b.id === v) || BGS[0]).css;
  list.style.background = css || '';
  list.style.backgroundAttachment = 'local';
}
function bgMenu(list, cid) {
  const upl = h('input', { type: 'file', accept: 'image/*', hidden: '' });
  upl.addEventListener('change', async () => {
    const f = upl.files && upl.files[0]; if (!f) return;
    try { const d = await shrink(f, 1100, 0.7); localStorage.setItem(BGKEY(cid), d); paintBg(list, cid); closeSheet(); toast('Фон чата обновлён'); }
    catch { toast('Картинка слишком большая'); }
  });
  const set = (id) => { try { localStorage.setItem(BGKEY(cid), id); } catch { /* ignore */ } paintBg(list, cid); closeSheet(); };
  openSheet('Фон чата', h('div', {}, upl,
    h('div', { class: 'chbg-grid' },
      h('button', { type: 'button', class: 'chbg own', onclick: () => upl.click() }, mi('image'), h('span', { text: 'Своё фото' })),
      ...BGS.map((b) => h('button', { type: 'button', class: `chbg${bgOf(cid) === b.id ? ' on' : ''}`, style: `--b:${b.css || 'var(--bg)'}`, onclick: () => set(b.id) }, h('span', { text: b.name })))),
    h('p', { class: 'profile-note', text: 'Фон видите только вы, на этом устройстве.' })));
}

// ---------- отправить песню другу (из меню трека) ----------
export async function sendTrackTo(uid, track, text = 'Послушай') {
  if (!isFriend(uid)) throw new Error('не друг');
  await send(chatId(me(), uid), text, track);
}
export async function pickFriendFor(track) {
  if (!friendsLoaded()) await loadFriends();
  const ids = friendIds();
  if (!ids.length) { openSheet('Отправить другу', h('p', { class: 'profile-note', text: 'Пока нет друзей. Добавьте друга в Профиль → Друзья: когда он примет заявку, сюда можно будет отправлять песни.' })); return; }
  const list = h('div', { class: 'lb-list' }, h('p', { class: 'profile-note', text: 'Загрузка…' }));
  openSheet('Отправить другу', h('div', {}, h('div', { class: 'sheet-note', text: `${track.title} — ${track.artist}` }), list));
  const cards = await friendCards(ids.slice(0, 60));
  list.replaceChildren(...cards.map((u) => h('button', { type: 'button', class: 'lb-row fr-pick', onclick: async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { await sendTrackTo(u.uid, track); closeSheet(); toast(`Отправлено ${u.nick}`); }
    catch { toast('Не отправилось. Админу нужно обновить правила Firestore'); b.disabled = false; }
  } }, h('span', { class: 'lb-av' }, h('img', { src: avSrc(u.avatar), alt: '', loading: 'lazy' }), isOnline(u.seen) ? h('i', { class: 'online-dot' }) : null),
    h('div', { class: 'lb-body' }, h('div', { class: 'lb-nick' }, h('span', { text: u.nick })), h('div', { class: 'lb-status', text: isOnline(u.seen) ? 'в сети' : seenText(u.seen) })),
    h('span', { class: 'fr-send' }, mi('send')))));
}

// ---------- окно чата ----------
let page = null, openId = '', unsubMsgs = null, offTicks = null;
function ensurePage() {
  if (page) return page;
  page = h('section', { id: 'chat-page', 'aria-label': 'Чат' });
  document.body.appendChild(page);
  return page;
}
export function closeChat() {
  if (unsubMsgs) { unsubMsgs(); unsubMsgs = null; }
  if (typeof stopVoice === 'function') stopVoice();
  if (offPeer) offPeer();
  if (offKb) { offKb(); offKb = null; }
  if (offTicks) { offTicks(); offTicks = null; }
  openId = '';
  if (page) page.classList.remove('open');
  document.body.classList.remove('chat-open');
  document.querySelectorAll('.cl-row.on').forEach((r) => r.classList.remove('on'));
}
export const chatOpen = () => Boolean(openId);
export const openUid = () => (openId ? openId.split('_').find((x) => x !== me()) || '' : '');

function timeOf(t) { const d = new Date(Number(t) || 0); return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
function dayOf(t) {
  const d = new Date(Number(t) || 0), n = new Date();
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, n)) return 'Сегодня';
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (same(d, y)) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

async function playTrack(t) {
  toast(`Включаю: ${t.artist} — ${t.title}`);
  const f = await searchTracks(`${t.artist} ${t.title}`).catch(() => []);
  if (f.length) player.playTracks(f.slice(0, 10), 0); else toast('Не нашла этот трек');
}

// ---------- голосовые сообщения ----------
const VOICE_MAX = 60; // секунд
const voiceMime = () => {
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
  return ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
};
const canVoice = () => Boolean(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
let vAudio = null, vUi = null;
function stopVoice() {
  if (vAudio) { try { vAudio.pause(); } catch { /* ignore */ } }
  if (vUi) { vUi.box.classList.remove('playing'); vUi.btn.replaceChildren(mi('play')); vUi.box.style.setProperty('--p', '0'); vUi.time.textContent = mmss(vUi.dur); }
  vAudio = null; vUi = null;
}
function voiceBubble(src, durSec) {
  const btn = h('button', { type: 'button', class: 'ch-vplay', 'aria-label': 'Слушать' }, mi('play'));
  let seed = src.length;
  const bars = h('span', { class: 'ch-vbars' }, ...Array.from({ length: 30 }, (_, i) => { seed = (seed * 9301 + 49297 + i) % 233280; return h('i', { style: `height:${28 + Math.round((seed / 233280) * 72)}%` }); }));
  const time = h('small', { class: 'ch-vtime', text: mmss(durSec || 0) });
  const box = h('span', { class: 'ch-voice' }, btn, bars, time);
  const ui = { box, btn, time, dur: durSec || 0 };
  btn.addEventListener('click', () => {
    if (vUi === ui) { stopVoice(); return; }
    stopVoice();
    const a = new Audio(src); vAudio = a; vUi = ui;
    box.classList.add('playing'); btn.replaceChildren(mi('pause'));
    a.addEventListener('loadedmetadata', () => { if (!ui.dur && Number.isFinite(a.duration)) ui.dur = a.duration; });
    a.addEventListener('timeupdate', () => { const d = ui.dur || a.duration || 1; box.style.setProperty('--p', String(Math.min(1, a.currentTime / d))); time.textContent = mmss(a.currentTime); });
    a.addEventListener('ended', stopVoice);
    if (player.st.playing) player.pause();
    a.play().catch(() => { stopVoice(); toast('Это голосовое не играет на этом устройстве'); });
  });
  bars.addEventListener('click', (e) => { if (vUi !== ui || !vAudio) return; const r = bars.getBoundingClientRect(); vAudio.currentTime = ((e.clientX - r.left) / r.width) * (ui.dur || vAudio.duration || 0); });
  return box;
}

// экран с клавиатурой: на iPhone клавиатура не сжимает страницу — подгоняем окно чата под видимую часть сами
function fitKeyboard(p, list) {
  const vv = window.visualViewport;
  if (!vv || !matchMedia('(pointer: coarse)').matches) return () => {};
  const f = () => {
    if (!p.classList.contains('open')) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    const full = Math.abs(vv.height - window.innerHeight) < 2 && vv.offsetTop < 1;
    p.style.top = full ? '' : `${vv.offsetTop}px`;
    p.style.height = full ? '' : `${vv.height}px`;
    p.style.bottom = full ? '' : 'auto';
    p.classList.toggle('kb', !full);
    if (atBottom) list.scrollTop = list.scrollHeight;
  };
  vv.addEventListener('resize', f); vv.addEventListener('scroll', f);
  return () => { vv.removeEventListener('resize', f); vv.removeEventListener('scroll', f); p.style.top = ''; p.style.height = ''; p.style.bottom = ''; p.classList.remove('kb'); };
}
let offKb = null;
let offPeer = null;

export async function openChat(uid, card) {
  warmCalls();
  if (!uid) return;
  if (!isFriend(uid)) { toast('Писать можно только друзьям. Дождитесь, пока заявку примут'); return; }
  const up = document.getElementById('user-page');
  if (up && up.classList.contains('open')) closeUserPage();
  const cid = chatId(me(), uid);
  const u = card || (await cardOf(uid)) || { uid, nick: 'друг' };
  const p = ensurePage();
  if (offKb) { offKb(); offKb = null; }
  stopVoice();
  openId = cid;
  const list = h('div', { class: 'ch-list' });
  const input = h('textarea', { class: 'ch-input', rows: '1', placeholder: 'Сообщение', maxlength: '500', enterkeyhint: 'send' });
  const sendBtn = h('button', { class: 'ch-send', type: 'button', 'aria-label': 'Отправить' }, mi('send'));
  const micBtn = h('button', { class: 'ch-send ch-mic', type: 'button', 'aria-label': 'Записать голосовое', title: 'Голосовое сообщение' }, mi('mic'));
  const shareBtn = h('button', { class: 'ch-share', type: 'button', title: 'Отправить трек, который играет', 'aria-label': 'Отправить текущий трек' }, mi('note'));
  const photoIn = h('input', { type: 'file', accept: 'image/*', hidden: '' });
  const photoBtn = h('button', { class: 'ch-share', type: 'button', title: 'Отправить фото', 'aria-label': 'Отправить фото', onclick: () => photoIn.click() }, mi('image'));
  const bar = h('div', { class: 'ch-bar' }, photoIn, photoBtn, shareBtn, input, sendBtn, canVoice() ? micBtn : null);
  const paintBar = () => bar.classList.toggle('typing', Boolean(input.value.trim()) || !canVoice());
  photoIn.addEventListener('change', async () => {
    const f = photoIn.files && photoIn.files[0]; photoIn.value = ''; if (!f) return;
    let d;
    try { d = await shrink(f); } catch { toast('Не получилось открыть это фото'); return; }
    // сначала показываем фото и спрашиваем: отправить или отменить
    const cap = h('input', { class: 'ch-pc-cap', type: 'text', maxlength: '500', placeholder: 'Подпись (необязательно)', value: input.value.trim() });
    const close = () => { box.classList.remove('show'); setTimeout(() => box.remove(), 260); };
    const ok = h('button', { class: 'btn', type: 'button', onclick: async () => {
      ok.disabled = true; ok.textContent = 'Отправляю…';
      try { await send(cid, cap.value.trim(), null, d); input.value = ''; paintBar(); close(); }
      catch { ok.disabled = false; ok.textContent = 'Отправить'; toast('Фото не отправилось. Попробуйте ещё раз'); }
    } }, mi('send'), h('span', { text: 'Отправить' }));
    const box = h('div', { class: 'ch-pc', role: 'dialog', 'aria-label': 'Отправить фото?' },
      h('div', { class: 'ch-pc-card' },
        h('b', { class: 'ch-pc-t', text: `Отправить фото ${u.nick || 'другу'}?` }),
        h('img', { src: d, alt: '' }), cap,
        h('div', { class: 'ch-pc-btns' }, h('button', { class: 'btn tonal', type: 'button', onclick: close }, 'Отмена'), ok)));
    box.addEventListener('click', (e) => { if (e.target === box) close(); });
    cap.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } });
    p.appendChild(box); requestAnimationFrame(() => box.classList.add('show'));
  });
  // клавиатура не прячется после отправки: кнопка не забирает фокус у поля ввода
  let keepFocus = false;
  const noSteal = (e) => { keepFocus = document.activeElement === input; e.preventDefault(); };
  sendBtn.addEventListener('mousedown', noSteal); sendBtn.addEventListener('pointerdown', (e) => { keepFocus = document.activeElement === input; if (e.pointerType === 'mouse') e.preventDefault(); });
  const doSend = async (track) => {
    const text = input.value.trim();
    if (!text && !track) return;
    if (blockedByMe(uid)) { toast('Сначала разблокируйте собеседника'); return; }
    if (blockedMe(uid)) { toast(`${u.nick || 'Собеседник'} ограничил(а) сообщения`); return; }
    input.value = ''; input.style.height = ''; paintBar();
    if (keepFocus) input.focus({ preventScroll: true });
    keepFocus = false;
    try { await send(cid, track ? (text || 'Послушай') : text, track); }
    catch { toast('Не отправилось. Проверьте интернет и попробуйте ещё раз'); if (!input.value) { input.value = text; paintBar(); } }
  };
  sendBtn.addEventListener('click', () => doSend());
  shareBtn.addEventListener('click', () => { const t = player.queue.current; if (!t) { toast('Сейчас ничего не играет'); return; } doSend(t); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); doSend(); } });
  input.addEventListener('input', () => { input.style.height = ''; input.style.height = `${Math.min(120, input.scrollHeight)}px`; paintBar(); });

  // ---- запись голосового: нажали микрофон — пишем, «отправить» или «отмена» ----
  let rec = null;
  const recUi = h('div', { class: 'ch-rec' });
  const stopRec = (sendIt) => {
    if (!rec) return;
    const r = rec; rec = null;
    clearInterval(r.timer); clearTimeout(r.cap);
    r.sendIt = sendIt;
    try { if (r.mr.state !== 'inactive') r.mr.stop(); } catch { /* ignore */ }
    bar.classList.remove('rec');
  };
  micBtn.addEventListener('click', async () => {
    if (rec) return;
    if (blockedByMe(uid) || blockedMe(uid)) { toast('Переписка ограничена'); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch { toast('Нет доступа к микрофону. Разрешите его в настройках браузера'); return; }
    const mime = voiceMime();
    let mr;
    try { mr = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32000 }); }
    catch { try { mr = new MediaRecorder(stream); } catch { stream.getTracks().forEach((t) => t.stop()); toast('Этот браузер не умеет записывать голос'); return; } }
    const chunks = [], t0 = srvNow();
    const r = { mr, stream, t0, sendIt: false, timer: 0, cap: 0 };
    rec = r;
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const dur = (srvNow() - t0) / 1000;
      if (!r.sendIt) return;
      if (dur < 0.7) { toast('Слишком коротко — держите запись подольше'); return; }
      const blob = new Blob(chunks, { type: (mr.mimeType || mime || 'audio/webm').split(';')[0] });
      if (blob.size > 290000) { toast('Слишком длинное голосовое'); return; }
      const data = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => res(''); fr.readAsDataURL(blob); });
      if (!data) return;
      try { await send(cid, '', null, null, { data, dur }); } catch { toast('Голосовое не отправилось. Попробуйте ещё раз'); }
    };
    mr.start(250);
    if (player.st.playing) player.pause();
    const tm = h('b', { class: 'ch-rec-t', text: '0:00' });
    recUi.replaceChildren(
      h('button', { type: 'button', class: 'ch-rec-x', 'aria-label': 'Отменить', onclick: () => stopRec(false) }, mi('close')),
      h('i', { class: 'ch-rec-dot' }), tm, h('span', { class: 'ch-rec-hint', text: 'Идёт запись…' }),
      h('button', { type: 'button', class: 'ch-send ch-rec-send', 'aria-label': 'Отправить голосовое', onclick: () => stopRec(true) }, mi('send')));
    bar.classList.add('rec');
    r.timer = setInterval(() => { tm.textContent = mmss((srvNow() - t0) / 1000); }, 250);
    r.cap = setTimeout(() => stopRec(true), VOICE_MAX * 1000);
  });
  bar.appendChild(recUi);

  // ---- шапка: нажали на ник или фото — открывается профиль собеседника ----
  const openProfile = () => openUserPage(uid, u);
  const banner = h('div', { class: 'ch-block' });
  p.replaceChildren(
    h('header', { class: 'ch-head' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Назад', onclick: closeChat }, mi('close')),
      h('button', { type: 'button', class: 'ch-av', 'aria-label': 'Профиль', onclick: openProfile }, h('img', { src: avSrc(u.avatar), alt: '' }), isOnline(u.seen) ? h('i', { class: 'online-dot' }) : null),
      h('div', { class: 'ch-who', role: 'button', tabindex: '0', onclick: (e) => { if (!e.target.closest('.fire')) openProfile(); } }, h('b', {}, h('span', { text: u.nick || 'друг' }), h('span', { class: 'ch-fire' })), h('small', { text: isOnline(u.seen) && u.now ? `Слушает: ${u.now}` : seenText(u.seen) || '' })),
      h('button', { class: 'icon-btn ch-callbtn', type: 'button', 'aria-label': 'Позвонить', title: 'Позвонить', onclick: () => { if (isBlocked(uid)) { toast('Звонки ограничены'); return; } startCall([uid]); } }, mi('phone')),
      h('button', { class: 'icon-btn ch-bgbtn', type: 'button', 'aria-label': 'Фон чата', title: 'Фон чата', onclick: () => bgMenu(list, cid) }, mi('palette'))),
    list,
    h('div', { class: 'ch-firecta' }),
    banner,
    bar);
  paintBar();
  paintBg(list, cid);
  requestAnimationFrame(() => p.classList.add('open'));
  document.body.classList.add('chat-open');
  document.querySelectorAll('.cl-row').forEach((r) => r.classList.toggle('on', r.dataset.uid === uid));
  offKb = fitKeyboard(p, list);

  if (unsubMsgs) unsubMsgs();
  const drawn = new Map(); let first = true; let lastDocs = null; let viewKey = '';
  // галочки: одна — доставлено, две — прочитано (друг открыл чат после этого сообщения)
  const ticks = new Map();
  const paintTicks = () => {
    const c = chatWith(uid); const readAt = Number(c && c.read && c.read[uid]) || 0;
    ticks.forEach(({ at, el }) => { const r = readAt >= at; if (el.dataset.r !== String(r)) { el.dataset.r = String(r); el.classList.toggle('read', r); el.title = r ? 'Прочитано' : 'Доставлено'; } });
  };
  // блокировка: плашка вместо поля ввода
  const paintBlock = () => {
    const mine = blockedByMe(uid), theirs = blockedMe(uid);
    p.classList.toggle('blocked', Boolean(mine || theirs));
    if (mine) banner.replaceChildren(h('span', { text: `Вы заблокировали ${u.nick || 'собеседника'}` }), h('button', { type: 'button', class: 'btn tonal', onclick: async () => { try { await setBlocked(uid, false); toast('Разблокировано'); } catch { toast('Не получилось'); } } }, 'Разблокировать'));
    else if (theirs) banner.replaceChildren(h('span', { text: `${u.nick || 'Собеседник'} ограничил(а) сообщения и звонки` }));
    else banner.replaceChildren();
  };
  // огонёк в шапке чата
  const fireSlot = p.querySelector('.ch-fire');
  const cta = p.querySelector('.ch-firecta');
  const paintFire = () => {
    if (!fireSlot) return;
    const c = chatWith(uid); const stt = streakOf(c, me(), uid);
    // кнопка «Завести MKW огонёк», пока огонька нет (или он погас)
    if (cta) {
      if (c && !isBlocked(uid) && (stt.state === 'none' || stt.state === 'lost')) {
        if (cta.dataset.s !== stt.state) {
          cta.dataset.s = stt.state;
          const go = h('button', { class: 'ch-fire-go', type: 'button', onclick: async () => {
            if (stt.state === 'lost') { openStreak(cid, chatWith(uid) || { read: {} }, me(), uid, u.nick || 'другом'); return; }
            go.disabled = true;
            try { await startStreak(cid, me()); } catch { go.disabled = false; toast('Не получилось. Проверьте интернет'); }
          } }, fireIcon({ state: 'lit', level: { l: 1 } }, true), h('span', { text: stt.state === 'lost' ? 'Огонёк погас — восстановить или завести заново' : 'Завести MKW огонёк' }));
          cta.replaceChildren(go);
        }
      } else if (cta.dataset.s) { cta.dataset.s = ''; cta.replaceChildren(); }
    }
    playFire(p, cid, stt, c, u.nick || 'другом');
    if (stt.state === 'none') { fireSlot.replaceChildren(); return; }
    const f = fireIcon(stt); f.setAttribute('role', 'button'); f.tabIndex = 0;
    f.addEventListener('click', () => openStreak(cid, c || { read: {} }, me(), uid, u.nick || 'другом'));
    fireSlot.replaceChildren(f);
  };
  const keyOf = () => { const c = chatWith(uid); return `${clearedAt(c)}|${blockedByMe(uid)}`; };
  // рисуем сообщения (уже нарисованные не пересоздаём — фото и голосовые не мигают)
  const render = () => {
    if (!lastDocs) return;
    viewKey = keyOf();
    const c = chatWith(uid), from = clearedAt(c), bl = blockedByMe(uid);
    const docs = lastDocs.slice().reverse().filter((d) => { const m = d.data(); const at = Number(m.at) || 0; return at > from && !(bl && m.from === uid && at > bl); });
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    if (!docs.length) { list.replaceChildren(h('p', { class: 'ch-empty', text: from ? 'Здесь пока пусто — чат очищен.' : `Напишите ${u.nick || 'другу'} первым. Можно отправить трек, который сейчас играет — кнопка с нотой, или голосовое — кнопка с микрофоном.` })); return; }
    let day = '';
    const nodes = [];
    docs.forEach((d) => {
      const m = d.data();
      const dd = dayOf(m.at); if (dd !== day) { day = dd; nodes.push(h('div', { class: 'ch-day', text: dd })); }
      let el = drawn.get(d.id);
      if (!el && isCallMsg(m.text)) {
        const ev = parseCall(m.text); const mine = m.from === me();
        const label = ev.kind === 'missed' ? (mine ? 'Звонок без ответа' : 'Пропущенный звонок')
          : ev.kind === 'declined' ? `${ev.nick || 'Друг'} отклонил(а) звонок`
          : `${mine ? 'Исходящий' : 'Входящий'} звонок · ${dur(ev.sec)}`;
        el = h('div', { class: `ch-call ${ev.kind}${mine ? ' me' : ''}${first ? '' : ' new'}` },
          h('span', { class: 'ch-call-ic' }, mi(ev.kind === 'ended' ? 'phone' : 'call-end')),
          h('span', { class: 'ch-call-t' }, h('b', { text: label }), h('small', { text: timeOf(m.at) })),
          h('button', { class: 'ch-call-again', type: 'button', title: 'Позвонить', 'aria-label': 'Позвонить', onclick: () => startCall([uid]) }, mi('phone')));
        drawn.set(d.id, el);
      }
      if (!el) {
        const mineMsg = m.from === me();
        const voiceSrc = typeof m.voice === 'string' && m.voice.startsWith('data:audio/') ? m.voice : typeof m.img === 'string' && m.img.startsWith('data:audio/') ? m.img : '';
        const photoOnly = m.img && !voiceSrc && !m.text && !m.track;
        const img = !voiceSrc && m.img && safeUrl(m.img).startsWith('data:image/') ? h('img', { class: 'ch-img', src: m.img, alt: 'Фото', decoding: 'async', onclick: () => openImage(m.img, '') }) : null;
        if (img) img.addEventListener('load', () => { if (list.scrollHeight - list.scrollTop - list.clientHeight < 400) list.scrollTop = list.scrollHeight; }, { once: true });
        const text = voiceSrc && m.text === VOICE_TXT ? '' : m.text;
        el = h('div', { class: `ch-msg${mineMsg ? ' me' : ''}${img ? ' has-img' : ''}${photoOnly ? ' photo' : ''}${voiceSrc ? ' voice' : ''}${first ? '' : ' new'}` },
          m.track ? h('button', { class: 'ch-track', type: 'button', onclick: () => playTrack(m.track) }, mi('play-circle'), h('span', {}, h('b', { text: m.track.title }), h('small', { text: m.track.artist }))) : null,
          img,
          voiceSrc ? voiceBubble(voiceSrc, Number(m.vdur) || 0) : null,
          text ? h('div', { class: 'ch-text', text }) : null,
          h('time', {}, timeOf(m.at), mineMsg ? (() => { const tk = h('span', { class: 'ch-tick', 'aria-hidden': 'true' }, h('i'), h('i')); ticks.set(d.id, { at: Number(m.at) || 0, el: tk }); return tk; })() : null));
        drawn.set(d.id, el);
      }
      nodes.push(el);
    });
    first = false;
    list.replaceChildren(...nodes);
    paintTicks();
    if (atBottom || list.dataset.first !== '1') { list.scrollTop = list.scrollHeight; list.dataset.first = '1'; }
  };
  // «в сети» и «слушает» в шапке — вживую, без переоткрытия чата
  if (offPeer) offPeer();
  const whoSmall = p.querySelector('.ch-who small'), avBox = p.querySelector('.ch-head .ch-av');
  const paintPeer = () => {
    const on = isOnline(u.seen);
    whoSmall.textContent = on && u.now ? `Слушает: ${u.now}` : on ? 'в сети' : seenText(u.seen) || '';
    whoSmall.classList.toggle('on', on);
    const dot = avBox.querySelector('.online-dot');
    if (on && !dot) avBox.appendChild(h('i', { class: 'online-dot' })); else if (!on && dot) dot.remove();
  };
  let unsubPeer = () => {};
  try { unsubPeer = onSnapshot(doc(db, 'profiles', uid), (d) => { const x = d.exists() ? d.data() : {}; if (x.seen != null) u.seen = x.seen; if (x.now != null) u.now = x.now; paintPeer(); }, () => {}); } catch { /* ignore */ }
  const peerT = setInterval(paintPeer, 30000);
  offPeer = () => { try { unsubPeer(); } catch { /* ignore */ } clearInterval(peerT); offPeer = null; };
  paintPeer();
  paintFire(); paintBlock();
  if (offTicks) offTicks();
  offTicks = onChats(() => { paintTicks(); paintFire(); paintBlock(); if (keyOf() !== viewKey) render(); });
  list.replaceChildren(h('p', { class: 'ch-empty', text: 'Загрузка…' }));
  try {
    unsubMsgs = onSnapshot(query(collection(db, 'chats', cid, 'msgs'), orderBy('at', 'desc'), limit(80)), (s) => {
      lastDocs = s.docs;
      render();
      if (chatWith(uid)) markRead(cid);
    }, () => { list.replaceChildren(h('p', { class: 'ch-empty', text: 'Чат недоступен. Проверьте интернет и откройте снова.' })); });
  } catch { /* ignore */ }
  if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => input.focus({ preventScroll: true }), 350);
}
