// Чаты MKW: переписка с другом и групповые чаты (3–10 человек).
//   chats/{a_b}            — с другом: { members: [a, b], last, at, read }      (a < b, только взаимные друзья)
//   chats/{g…}             — группа:   { group: true, name, owner, members, last, at, read }
//   chats/{id}/msgs/{id}   — { from, text, at, track?, img?, voice?, vdur?, re?: {id, from, text}, rx?: {uid: эмодзи}, ed? }
// В read хранится всё «служебное»: прочитано (uid), огонёк (g_*, gs, gd…), очистка (x_*), блокировка (b_*),
// «печатает…» (t_<uid> — когда, tk_<uid> — что: text | voice).
import { safeUrl } from './utils.js?v=0.35.5';
import { db } from './firebase.js?v=0.35.5';
import { doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, getDocs, collection, query, where, orderBy, limit, onSnapshot, deleteField } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { h, toast, openSheet, closeSheet } from './ui.js?v=0.35.5';
import { openImage } from './viewer.js?v=0.35.5';
import { mi } from './icons2.js?v=0.35.5';
import * as player from './player.js?v=0.35.5';
import { searchTracks } from './catalog.js?v=0.35.5';
import { me, isFriend, cardOf, friendIds, friendCards, loadFriends, friendsLoaded } from './friends.js?v=0.35.5';
import { avSrc } from './avatar.js?v=0.35.5';
import { seenText, isOnline, openUserPage, closeUserPage } from './userpage.js?v=0.35.5';
import { startCall, warmCalls } from './call.js?v=0.35.5';
import { streakAny, streakPatch, groupPatch, fireIcon, openStreak, startStreak, playFire } from './streak.js?v=0.35.5';
import { pushTo, myNick } from './push.js?v=0.35.5';
import { srvNow, realSeen } from './clock.js?v=0.35.5';
import { togetherBar, startTogether } from './together.js?v=0.35.5';
import { ensureShared } from './shared.js?v=0.35.5';
import { STICKER_TXT, stickerOf, nickEmo, catOf, catName, rxNode, emojiPicker, QUICK_RX } from './stickers.js?v=0.35.5';
import { markDaily } from './daily.js?v=0.35.5';
import { openPhotoEditor } from './photoedit.js?v=0.35.5';
import { pcmCapture, loadLame, encodeMp3, decodeBlob, blobToDataUrl, toWavUrl, wavUrl } from './voicerec.js?v=0.35.5';
import { openSharedSheet } from './sharedui.js?v=0.35.5';

export const chatId = (a, b) => [a, b].sort().join('_');
const isGroupId = (cid) => String(cid || '').startsWith('g') && !String(cid).includes('_');

// События звонка в переписке: «пропущенный», «отклонил», «звонок · 3 мин». Хранятся как текст с меткой —
// так подходят и старые правила базы.
const CALL_MARK = '⁠CALL|';
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
const other = (c) => (c && !c.group ? (c.members || []).find((x) => x !== me()) || '' : '');
export const otherOf = other;

// ---------- список чатов и непрочитанные ----------
let chats = [];
let unsubList = null;
const subs = new Set();
const notifySubs = () => subs.forEach((f) => { try { f(); } catch (e) { console.warn('chats', e); } });
export const onChats = (f) => { subs.add(f); return () => subs.delete(f); };
export const chatList = () => chats;
export const isUnread = (c) => c && c.last && c.last.from !== me() && (Number(c.at) || 0) > (Number(c.read && c.read[me()]) || 0) && !(Number((c.read || {})[`b_${me()}`]) > 0);
export const unreadCount = () => chats.filter(isUnread).length;
export const chatWith = (uid) => chats.find((c) => !c.group && other(c) === uid) || null;
export const chatById = (cid) => chats.find((c) => c.id === cid) || null;
export const groupList = () => chats.filter((c) => c.group);

// ---------- очистка и блокировка ----------
//   read.x_<uid> — с какого момента этот человек очистил чат у себя;  read.xa — чат очищен у всех
//   read.b_<uid> — с какого момента этот человек заблокировал собеседника (0 — не блокировал)
const rd = (c) => (c && c.read) || {};
export const clearedAt = (c) => Math.max(Number(rd(c)[`x_${me()}`]) || 0, Number(rd(c).xa) || 0);
export const blockedByMe = (uid) => Number(rd(chatWith(uid))[`b_${me()}`]) || 0;
export const blockedMe = (uid) => Number(rd(chatWith(uid))[`b_${uid}`]) || 0;
export const isBlocked = (uid) => Boolean(blockedByMe(uid) || blockedMe(uid));
async function setFlagsCid(cid, flags) {
  if (isGroupId(cid)) await setDoc(doc(db, 'chats', cid), { read: flags }, { merge: true });
  else await setDoc(doc(db, 'chats', cid), { members: cid.split('_'), read: flags }, { merge: true });
  const c = chatById(cid); if (c) c.read = { ...(c.read || {}), ...flags };
  notifySubs();
}
const setFlags = (uid, flags) => setFlagsCid(chatId(me(), uid), flags);
export async function clearForMe(uid) { await setFlags(uid, { [`x_${me()}`]: srvNow() }); }
async function wipeMsgs(cid) {
  try {
    for (let round = 0; round < 10; round += 1) {
      const s = await getDocs(query(collection(db, 'chats', cid, 'msgs'), orderBy('at', 'desc'), limit(100)));
      if (!s.size) break;
      await Promise.all(s.docs.map((d) => deleteDoc(d.ref)));
      if (s.size < 100) break;
    }
  } catch { /* старые правила — сообщения скрыты, но остаются в базе */ }
}
export async function clearForAll(uid) { await setFlags(uid, { xa: srvNow() }); await wipeMsgs(chatId(me(), uid)); }
export async function setBlocked(uid, on) { await setFlags(uid, { [`b_${me()}`]: on ? srvNow() : 0 }); }

// кнопки в профиле друга: очистить, удалить у всех, заблокировать
function confirm2(btn, text, run) {
  if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; const sp = btn.querySelector('span'); const old = sp.textContent; sp.textContent = text; setTimeout(() => { if (btn.isConnected) { btn.dataset.sure = ''; sp.textContent = old; } }, 3500); return; }
  btn.dataset.sure = ''; run();
}
export function chatActions(uid, u) {
  const nick = (u && u.nick) || 'друг';
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
    unsubList = onSnapshot(query(collection(db, 'chats'), where('members', 'array-contains', me()), limit(120)), (s) => {
      const prev = new Map(chats.map((c) => [c.id, c.at]));
      chats = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
      if (!first && onNew) chats.forEach((c) => { if (isUnread(c) && (prev.get(c.id) || 0) < c.at && openId !== c.id) onNew(c, other(c)); });
      first = false;
      if (openId) { const c = chats.find((x) => x.id === openId); if (c && isUnread(c) && !document.hidden) markRead(openId); }
      notifySubs();
    }, () => { /* старые правила или нет сети */ });
  } catch { /* ignore */ }
}
export function stopChats() { if (unsubList) { unsubList(); unsubList = null; } chats = []; closeChat(); }

function markRead(cid) {
  const c = chats.find((x) => x.id === cid); if (!c) return;
  const t = srvNow();
  c.read = { ...(c.read || {}), [me()]: t };
  setDoc(doc(db, 'chats', cid), { read: { [me()]: t } }, { merge: true }).catch(() => {});
  notifySubs();
}

// ---------- «печатает…» и «записывает голосовое…» ----------
const TYPING_TTL = 6500;
let typingSent = { cid: '', kind: '', at: 0 };
function typing(cid, kind) {
  if (!cid) return;
  const now = Date.now();
  if (typingSent.cid === cid && typingSent.kind === kind && now - typingSent.at < 3500) return;
  typingSent = { cid, kind, at: now };
  setDoc(doc(db, 'chats', cid), { read: { [`t_${me()}`]: srvNow(), [`tk_${me()}`]: kind } }, { merge: true }).catch(() => {});
}
function typingOff(cid) {
  if (!cid || typingSent.cid !== cid || !typingSent.at) return;
  typingSent = { cid: '', kind: '', at: 0 };
  setDoc(doc(db, 'chats', cid), { read: { [`t_${me()}`]: 0 } }, { merge: true }).catch(() => {});
}
// кто сейчас печатает в этой переписке: [{ uid, kind }]
function typers(c) {
  const r = rd(c), now = srvNow();
  return (c && c.members ? c.members : []).filter((u) => u !== me()).map((u) => ({ uid: u, at: Number(r[`t_${u}`]) || 0, kind: r[`tk_${u}`] === 'voice' ? 'voice' : 'text' })).filter((x) => x.at && now - x.at < TYPING_TTL);
}

// ---------- отправка ----------
const VOICE_TXT = '🎤 Голосовое сообщение';
const quoteText = (m) => (stickerOf(m.img) ? STICKER_TXT : m.voice || (typeof m.img === 'string' && m.img.startsWith('data:audio/')) ? '🎤 Голосовое' : m.img && !m.text ? '📷 Фото' : m.track && !m.text ? `♪ ${m.track.artist} — ${m.track.title}` : String(m.text || '')).slice(0, 120);
async function send(cv, text, track, img, voice, re) {
  const cid = cv.cid;
  const at = srvNow(), from = me();
  const msg = { from, text: String(text || '').slice(0, 500), at };
  if (track) msg.track = { title: String(track.title).slice(0, 120), artist: String(track.artist).slice(0, 120) };
  if (img) msg.img = img;
  if (re && re.id) msg.re = { id: String(re.id), from: String(re.from || ''), text: String(re.text || '').slice(0, 120) };
  if (voice) {
    msg.voice = voice.data; msg.vdur = Math.round(voice.dur);
    try { await addDoc(collection(db, 'chats', cid, 'msgs'), msg); }
    catch {
      // правила базы ещё старые — кладём запись в поле фото, а текстом подписываем для старых версий приложения
      const old = { from, text: VOICE_TXT, at, img: voice.data };
      await addDoc(collection(db, 'chats', cid, 'msgs'), old);
    }
  } else {
    try { await addDoc(collection(db, 'chats', cid, 'msgs'), msg); }
    catch (e) { if (msg.re) { delete msg.re; await addDoc(collection(db, 'chats', cid, 'msgs'), msg); } else throw e; }
  }
  try { markDaily('msg'); if (track) markDaily('share'); if (voice) markDaily('voice'); if (stickerOf(img)) markDaily('sticker'); } catch { /* ignore */ }
  const preview = (voice ? VOICE_TXT : img && !msg.text ? 'Фото' : track && !msg.text ? `♪ ${msg.track.artist} — ${msg.track.title}` : msg.text).slice(0, 140);
  typingSent = { cid: '', kind: '', at: 0 };
  if (cv.group) {
    const c = chatById(cid);
    await setDoc(doc(db, 'chats', cid), { last: { from, text: preview, at, nick: myNick() }, at, read: { [from]: at, [`t_${from}`]: 0, ...groupPatch(c || { members: cv.members, read: {} }, from) } }, { merge: true });
    (cv.members || []).filter((x) => x !== from).slice(0, 9).forEach((to) => pushTo(to, 'msg', cv.title || 'Группа', `${myNick()}: ${preview}`, `chat-${cid}`, `./#group=${cid}`));
    return;
  }
  const to = cid.split('_').find((x) => x !== from);
  await setDoc(doc(db, 'chats', cid), { members: cid.split('_'), last: { from, text: preview, at }, at, read: { [from]: at, [`t_${from}`]: 0, ...streakPatch(chatWith(to), from, to) } }, { merge: true });
  // пуш другу — придёт, даже если у него MKW закрыт (тот же тег, что и у уведомления внутри приложения, — без повторов)
  if (to) pushTo(to, 'msg', myNick(), preview, `chat-${cid}`, `./#chat=${from}`);
}

// закреп: хранится в чате как read.pin = { id, t (текст), f (кто написал), by, at }
async function pinMsg(cid, id, m) {
  await setDoc(doc(db, 'chats', cid), { read: { pin: { id, t: quoteText(m), f: m.from || '', by: me(), at: srvNow() } } }, { merge: true });
}
async function unpinMsg(cid) { await updateDoc(doc(db, 'chats', cid), { 'read.pin': deleteField() }); }
const pinOf = (c) => { const x = rd(c).pin; return x && typeof x === 'object' && x.id ? x : null; };

// правка, удаление, реакции
async function editMsg(cid, id, text) { await updateDoc(doc(db, 'chats', cid, 'msgs', id), { text: String(text).slice(0, 500), ed: srvNow() }); }
async function deleteMsg(cid, id) {
  await deleteDoc(doc(db, 'chats', cid, 'msgs', id));
  if ((pinOf(chatById(cid)) || {}).id === id) unpinMsg(cid).catch(() => {});
}
async function react(cid, id, emoji, mine) {
  await updateDoc(doc(db, 'chats', cid, 'msgs', id), { [`rx.${me()}`]: mine === emoji ? deleteField() : emoji });
  if (mine !== emoji) markDaily('react');
}

// ---------- группы ----------
export async function createGroup(name, uids) {
  const ids = [...new Set(uids)].filter((x) => x && x !== me()).slice(0, 9);
  if (ids.length < 2) throw new Error('мало участников');
  const gid = `g${Math.random().toString(36).slice(2, 10)}${srvNow().toString(36).slice(-4)}`;
  const at = srvNow();
  await setDoc(doc(db, 'chats', gid), { group: true, name: String(name || '').trim().slice(0, 40) || 'Группа', owner: me(), members: [me(), ...ids], at, last: { from: me(), text: 'Группа создана', at, nick: myNick() }, read: { [me()]: at } });
  return gid;
}
async function patchGroup(gid, data) { await setDoc(doc(db, 'chats', gid), data, { merge: true }); }
export async function leaveGroup(gid) {
  const c = chatById(gid); if (!c) return;
  await patchGroup(gid, { members: (c.members || []).filter((x) => x !== me()) });
}

// создать группу: название и друзья галочками
export async function createGroupSheet(preselect = []) {
  if (!friendsLoaded()) await loadFriends();
  const ids = friendIds();
  if (ids.length < 2) { openSheet('Новая группа', h('p', { class: 'profile-note', text: 'Для группы нужно хотя бы два друга. Добавьте друзей в Профиль → Друзья.' })); return; }
  const picked = new Set(preselect);
  const name = h('input', { class: 'sheet-input', type: 'text', maxlength: '40', placeholder: 'Название группы' });
  const cnt = h('small', { class: 'gr-cnt' });
  const go = h('button', { class: 'btn', type: 'button' }, mi('group'), h('span', { text: 'Создать группу' }));
  const list = h('div', { class: 'gr-pick' }, h('p', { class: 'profile-note', text: 'Загрузка…' }));
  const paint = () => { cnt.textContent = `Выбрано: ${picked.size} из 9`; go.disabled = picked.size < 2; };
  go.addEventListener('click', async () => {
    go.disabled = true;
    try { const gid = await createGroup(name.value, [...picked]); closeSheet(); toast('Группа создана'); setTimeout(() => openGroup(gid), 250); }
    catch { go.disabled = false; toast('Не получилось. Нужны новые правила базы — у разработчика'); }
  });
  openSheet('Новая группа', h('div', { class: 'gr-sheet' }, name, cnt, list, go));
  const cards = await friendCards(ids.slice(0, 80));
  list.replaceChildren(...cards.map((u) => {
    const row = h('button', { type: 'button', class: `gr-row${picked.has(u.uid) ? ' on' : ''}` },
      h('img', { src: avSrc(u.avatar), alt: '', loading: 'lazy' }), h('b', { text: u.nick || 'друг' }), h('i', { class: 'gr-chk' }, mi('check')));
    row.addEventListener('click', () => {
      if (picked.has(u.uid)) picked.delete(u.uid); else if (picked.size < 9) picked.add(u.uid); else toast('В группе до 10 человек');
      row.classList.toggle('on', picked.has(u.uid)); paint();
    });
    return row;
  }));
  paint();
}

// аватар группы: до трёх фото участников кружками
export function groupAvatar(c, cards) {
  const ms = (c.members || []).filter((x) => x !== me()).slice(0, 3);
  return h('span', { class: 'gr-av' }, ...ms.map((u) => h('img', { src: avSrc((cards && cards.get && cards.get(u) || {}).avatar), alt: '', loading: 'lazy' })));
}

// ---------- отправить песню другу (из меню трека) ----------
export async function sendTrackTo(uid, track, text = 'Послушай') {
  if (!isFriend(uid)) throw new Error('не друг');
  const cid = chatId(me(), uid);
  await send({ cid, group: false, members: cid.split('_') }, text, track);
}
export async function pickFriendFor(track) {
  if (!friendsLoaded()) await loadFriends();
  const ids = friendIds();
  if (!ids.length) { openSheet('Отправить другу', h('p', { class: 'profile-note', text: 'Пока нет друзей. Добавьте друга в Профиль → Друзья: когда он примет заявку, сюда можно будет отправлять песни.' })); return; }
  const list = h('div', { class: 'lb-list' }, h('p', { class: 'profile-note', text: 'Загрузка…' }));
  openSheet('Отправить другу', h('div', {}, h('div', { class: 'sheet-note', text: `${track.title} — ${track.artist}` }), list));
  const cards = await friendCards(ids.slice(0, 60));
  const groups = groupList();
  list.replaceChildren(
    ...groups.map((g) => h('button', { type: 'button', class: 'lb-row fr-pick', onclick: async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { await send({ cid: g.id, group: true, members: g.members, title: g.name }, 'Послушай', track); closeSheet(); toast(`Отправлено в «${g.name}»`); }
      catch { toast('Не отправилось'); b.disabled = false; }
    } }, h('span', { class: 'lb-av' }, groupAvatar(g)), h('div', { class: 'lb-body' }, h('div', { class: 'lb-nick' }, h('span', { text: g.name || 'Группа' })), h('div', { class: 'lb-status', text: `Группа · ${(g.members || []).length}` })), h('span', { class: 'fr-send' }, mi('send')))),
    ...cards.map((u) => h('button', { type: 'button', class: 'lb-row fr-pick', onclick: async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { await sendTrackTo(u.uid, track); closeSheet(); toast(`Отправлено ${u.nick}`); }
      catch { toast('Не отправилось. Проверьте интернет'); b.disabled = false; }
    } }, h('span', { class: 'lb-av' }, h('img', { src: avSrc(u.avatar), alt: '', loading: 'lazy' }), isOnline(u.seen) ? h('i', { class: 'online-dot' }) : null),
      h('div', { class: 'lb-body' }, h('div', { class: 'lb-nick' }, h('span', { text: u.nick }), nickEmo(u.nemo)), h('div', { class: 'lb-status', text: isOnline(u.seen) ? 'в сети' : seenText(u.seen) })),
      h('span', { class: 'fr-send' }, mi('send')))));
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
  const knob = h('i', { class: 'ch-vknob', 'aria-hidden': 'true' });
  const box = h('span', { class: 'ch-voice' }, btn, bars, time, knob);
  const ui = { box, btn, time, dur: durSec || 0 };
  // белый «бегунок» на волне — ездит вместе с перемоткой и воспроизведением
  const setP = (f) => { box.style.setProperty('--p', String(f)); box.style.setProperty('--kx', `${bars.offsetLeft + f * bars.offsetWidth}px`); };
  ui.setP = setP;
  btn.addEventListener('click', () => {
    if (vUi === ui) { stopVoice(); return; }
    stopVoice();
    const a = new Audio(); a.preload = 'auto'; a.src = ui.wav || src; vAudio = a; vUi = ui;
    box.classList.add('playing'); btn.replaceChildren(mi('pause'));
    a.addEventListener('loadedmetadata', () => { if (!ui.dur && Number.isFinite(a.duration)) ui.dur = a.duration; });
    a.addEventListener('timeupdate', () => { if (box.classList.contains('scrub')) return; const d = ui.dur || (Number.isFinite(a.duration) ? a.duration : 0) || 1; setP(Math.min(1, a.currentTime / d)); time.textContent = mmss(a.currentTime); });
    a.addEventListener('ended', stopVoice);
    if (player.st.playing) player.pause();
    const oldFmt = () => { if (vUi === ui) stopVoice(); toast('Это голосовое записано в старом формате, и этот телефон его не открывает. Новые голосовые играют везде'); };
    a.play().catch(async (e) => {
      if (e && e.name === 'AbortError') return;
      if (ui.wav) { oldFmt(); return; }
      // старый формат (webm / mp4-фрагменты): раскодируем сами и играем как WAV
      const url = await toWavUrl(src);
      if (!url) { oldFmt(); return; }
      ui.wav = url;
      if (vUi !== ui) return;
      a.src = url;
      a.play().catch(oldFmt);
    });
  });
  // перемотка пальцем или мышкой: тянем по волне
  let scrub = false;
  const seekTo = (e) => {
    const r = bars.getBoundingClientRect(); const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    setP(f);
    const d = ui.dur || (vAudio && Number.isFinite(vAudio.duration) ? vAudio.duration : 0);
    time.textContent = mmss(f * d);
    if (vUi === ui && vAudio && d) { try { vAudio.currentTime = f * d; } catch { /* ignore */ } }
  };
  bars.style.touchAction = 'none';
  bars.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (vUi !== ui) btn.click(); // ещё не играет — включаем и сразу перематываем
    scrub = true; box.classList.add('scrub');
    if (vAudio) vAudio.muted = true; // пока тянете — тишина, звук с нового места после отпускания
    setTimeout(() => { if (scrub && vAudio) vAudio.muted = true; }, 0);
    try { bars.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const ev = { clientX: e.clientX };
    setTimeout(() => seekTo(ev), vUi === ui && vAudio && vAudio.readyState > 0 ? 0 : 120);
  });
  bars.addEventListener('pointermove', (e) => { if (scrub) { e.stopPropagation(); seekTo(e); } });
  const endScrub = () => { scrub = false; box.classList.remove('scrub'); if (vUi === ui && vAudio) vAudio.muted = false; };
  bars.addEventListener('pointerup', endScrub); bars.addEventListener('pointercancel', endScrub);
  bars.addEventListener('click', (e) => e.stopPropagation());
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

// ---------- окно переписки ----------
let page = null, openId = '', unsubMsgs = null, offTicks = null;
let offKb = null, offPeer = null, offTg = null, meCard = null, cvCur = null, closeMenu = null;
function ensurePage() {
  if (page) return page;
  page = h('section', { id: 'chat-page', 'aria-label': 'Чат' });
  document.body.appendChild(page);
  return page;
}
function cleanup() {
  if (unsubMsgs) { unsubMsgs(); unsubMsgs = null; }
  stopVoice();
  if (offPeer) offPeer();
  if (offTg) { offTg(); offTg = null; }
  if (offKb) { offKb(); offKb = null; }
  if (offTicks) { offTicks(); offTicks = null; }
  if (closeMenu) closeMenu();
  typingOff(openId);
}
export function closeChat() {
  cleanup();
  openId = ''; cvCur = null;
  if (page) page.classList.remove('open');
  document.body.classList.remove('chat-open');
  document.querySelectorAll('.cl-row.on').forEach((r) => r.classList.remove('on'));
}
export const chatOpen = () => Boolean(openId);
export const openCid = () => openId;
export const openUid = () => (openId && !isGroupId(openId) ? openId.split('_').find((x) => x !== me()) || '' : '');

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

export async function openChat(uid, card) {
  warmCalls();
  if (!uid) return;
  if (!isFriend(uid)) { toast('Писать можно только друзьям. Дождитесь, пока заявку примут'); return; }
  const u = card || (await cardOf(uid)) || { uid, nick: 'друг' };
  const cid = chatId(me(), uid);
  await openConv({ cid, group: false, peer: uid, u, title: u.nick || 'друг', members: cid.split('_'), cards: new Map([[uid, u]]) });
}
export async function openGroup(gid) {
  warmCalls();
  let c = chatById(gid);
  if (!c) { try { const s = await getDoc(doc(db, 'chats', gid)); if (s.exists()) c = { id: gid, ...s.data() }; } catch { /* ignore */ } }
  if (!c || !(c.members || []).includes(me())) { toast('Группа недоступна'); return; }
  const cards = new Map((await friendCards((c.members || []).filter((x) => x !== me()), 120000).catch(() => [])).map((u) => [u.uid, u]));
  await openConv({ cid: gid, group: true, title: c.name || 'Группа', members: c.members || [], owner: c.owner, cards });
}

// меню переписки (⋯): слушать вместе, общий плейлист, огонёк, фон, профиль/участники
function convMenu(cv, list) {
  const items = [];
  const it = (ic, label, fn, danger) => h('button', { type: 'button', class: `ch-sm${danger ? ' danger' : ''}`, onclick: () => { closeSheet(); setTimeout(fn, 200); } }, mi(ic), h('span', { text: label }));
  items.push(it('headphones', 'Слушать вместе', async () => {
    const t = player.queue.current;
    if (!t) { toast('Включите трек, который хотите слушать вместе'); return; }
    if (await startTogether(cv.cid, cv.members)) {
      toast('Вы слушаете вместе — друзья увидят приглашение');
      send(cv, '🎧 Зову слушать вместе — нажмите «Слушать» сверху', t).catch(() => {});
    }
  }));
  items.push(it('playlist', 'Общий плейлист', async () => {
    try {
      const sp = await ensureShared(cv.cid, cv.members, cv.group ? cv.title : `${myNick() || 'Я'} + ${cv.title}`);
      openSharedSheet(sp.id);
    } catch { toast('Общие плейлисты заработают после обновления правил базы'); }
  }));
  items.push(it('fire', 'MKW огонёк', () => openStreak(cv.cid, chatById(cv.cid) || { read: {}, group: cv.group, members: cv.members }, me(), cv.peer, cv.group ? 'группой' : (cv.u.nick || 'другом'))));
  items.push(it('palette', 'Фон чата', () => bgMenu(list, cv.cid)));
  if (cv.group) items.push(it('group', 'Участники и настройки', () => groupSheet(cv)));
  else items.push(it('person', 'Профиль', () => openUserPage(cv.peer, cv.u)));
  openSheet(cv.title, h('div', { class: 'ch-smenu' }, ...items));
}

// настройки группы: название, участники, добавить, огонёк, очистить, выйти
async function groupSheet(cv) {
  const c = chatById(cv.cid) || { members: cv.members, name: cv.title, owner: cv.owner, read: {} };
  const owner = c.owner === me();
  const name = h('input', { class: 'sheet-input', type: 'text', maxlength: '40', value: c.name || '' });
  const save = h('button', { class: 'btn tonal', type: 'button', onclick: async () => { const v = name.value.trim(); if (!v) return; try { await patchGroup(cv.cid, { name: v.slice(0, 40) }); toast('Название сохранено'); } catch { toast('Не получилось'); } } }, 'Сохранить');
  const cards = await friendCards((c.members || []).filter((x) => x !== me()), 120000).catch(() => []);
  const rows = [{ uid: me(), nick: `${myNick() || 'Вы'} (вы)`, avatar: (meCard || {}).avatar }, ...cards].map((u) => h('button', { type: 'button', class: 'gr-mem', onclick: () => { if (u.uid !== me()) { closeSheet(); setTimeout(() => openUserPage(u.uid, u), 250); } } },
    h('img', { src: avSrc(u.avatar), alt: '', loading: 'lazy' }), h('b', { text: u.nick || 'друг' }), c.owner === u.uid ? h('small', { text: 'создатель' }) : null));
  const addBtn = owner && (c.members || []).length < 10 ? h('button', { type: 'button', class: 'up-ca', onclick: async () => {
    if (!friendsLoaded()) await loadFriends();
    const free = friendIds().filter((x) => !(c.members || []).includes(x));
    if (!free.length) { toast('Все ваши друзья уже в группе'); return; }
    const fc = await friendCards(free.slice(0, 60));
    openSheet('Добавить в группу', h('div', { class: 'gr-pick' }, ...fc.map((u) => h('button', { type: 'button', class: 'gr-row', onclick: async () => {
      try { const m = [...new Set([...(chatById(cv.cid) || c).members, u.uid])].slice(0, 10); await patchGroup(cv.cid, { members: m }); cv.members = m; cv.cards.set(u.uid, u); closeSheet(); toast(`${u.nick} в группе`); } catch { toast('Не получилось'); }
    } }, h('img', { src: avSrc(u.avatar), alt: '' }), h('b', { text: u.nick }), h('i', { class: 'gr-chk' }, mi('add'))))));
  } }, mi('person-add'), h('span', { text: 'Добавить участников' })) : null;
  openSheet(c.name || 'Группа', h('div', { class: 'gr-sheet' },
    h('div', { class: 'gr-name' }, name, save),
    h('div', { class: 'section-title', text: `Участники · ${(c.members || []).length}` }),
    h('div', { class: 'gr-mems' }, ...rows),
    h('div', { class: 'up-chat-list' }, ...[addBtn,
      h('button', { type: 'button', class: 'up-ca', onclick: () => { closeSheet(); setTimeout(() => openStreak(cv.cid, chatById(cv.cid) || c, me(), '', 'группой'), 250); } }, mi('fire'), h('span', { text: 'Огонёк группы' })),
      h('button', { type: 'button', class: 'up-ca', onclick: (e) => confirm2(e.currentTarget, 'Нажмите ещё раз — очистить у себя', async () => { try { await setFlagsCid(cv.cid, { [`x_${me()}`]: srvNow() }); toast('Чат очищен у вас'); closeSheet(); } catch { toast('Не получилось'); } }) }, mi('chat'), h('span', { text: 'Очистить чат у себя' })),
      h('button', { type: 'button', class: 'up-ca danger', onclick: (e) => confirm2(e.currentTarget, 'Нажмите ещё раз — выйти из группы', async () => { try { await leaveGroup(cv.cid); closeSheet(); closeChat(); toast('Вы вышли из группы'); } catch { toast('Не получилось'); } }) }, mi('close'), h('span', { text: 'Выйти из группы' }))].filter(Boolean))));
}

async function openConv(cv) {
  const up = document.getElementById('user-page');
  if (up && up.classList.contains('open')) closeUserPage();
  const p = ensurePage();
  cleanup();
  openId = cv.cid; cvCur = cv;
  const cid = cv.cid, uid = cv.peer, u = cv.u || {};
  if (!meCard) cardOf(me()).then((c) => { if (c) meCard = c; }).catch(() => {});
  const nickOf = (x) => (x === me() ? ((meCard && meCard.nick) || myNick() || 'Вы') : ((cv.cards.get(x) || {}).nick || 'друг'));
  const avOf = (x) => (x === me() ? (meCard || {}).avatar : (cv.cards.get(x) || {}).avatar);
  const fine = matchMedia('(pointer: fine)').matches;

  const list = h('div', { class: 'ch-list' });
  const input = h('textarea', { class: 'ch-input', rows: '1', placeholder: fine ? `Написать ${cv.group ? `в «${cv.title}»` : `@${u.nick || 'другу'}`}` : 'Сообщение', maxlength: '500', enterkeyhint: 'send' });
  const sendBtn = h('button', { class: 'ch-send', type: 'button', 'aria-label': 'Отправить' }, mi('send'));
  const micBtn = h('button', { class: 'ch-send ch-mic', type: 'button', 'aria-label': 'Записать голосовое', title: 'Голосовое сообщение' }, mi('mic'));
  const shareBtn = h('button', { class: 'ch-share', type: 'button', title: 'Отправить трек, который играет', 'aria-label': 'Отправить текущий трек' }, mi('note'));
  const photoIn = h('input', { type: 'file', accept: 'image/*', hidden: '' });
  const photoBtn = h('button', { class: 'ch-share', type: 'button', title: 'Отправить фото', 'aria-label': 'Отправить фото', onclick: () => photoIn.click() }, mi('image'));
  // стикеры и эмодзи: кнопка в поле ввода, панель над ним
  const emoBtn = h('button', { class: 'ch-emobtn', type: 'button', 'aria-label': 'Стикеры и эмодзи', title: 'Стикеры и эмодзи' }, mi('emoji'));
  const emoBox = h('div', { class: 'ch-emo', hidden: '' });
  const stBtn = h('button', { class: 'ch-share ch-stbtn', type: 'button', title: 'Стикеры MKW', 'aria-label': 'Стикеры' }, mi('sticker'));
  const field = h('div', { class: 'ch-field' }, input, emoBtn);
  const bar = h('div', { class: 'ch-bar' }, photoIn, photoBtn, shareBtn, stBtn, field, sendBtn, canVoice() ? micBtn : null);
  const paintBar = () => { bar.classList.toggle('typing', Boolean(input.value.trim()) || !canVoice() || Boolean(editing)); bar.classList.toggle('has-text', Boolean(input.value.trim())); };

  // ответ и правка: плашка над полем ввода
  const replyBar = h('div', { class: 'ch-reply', hidden: '' });
  let replyTo = null, editing = null;
  const paintReply = () => {
    const x = editing || replyTo;
    if (!x) { replyBar.hidden = true; replyBar.replaceChildren(); paintBar(); return; }
    replyBar.hidden = false;
    replyBar.classList.toggle('edit', Boolean(editing));
    replyBar.replaceChildren(
      h('span', { class: 'ch-reply-ic' }, mi(editing ? 'edit' : 'reply')),
      h('span', { class: 'ch-reply-t' }, h('b', { text: editing ? 'Редактирование' : `Ответ ${nickOf(replyTo.from)}` }), h('small', { text: editing ? editing.text : replyTo.text })),
      h('button', { type: 'button', class: 'ch-reply-x', 'aria-label': 'Отменить', onclick: () => { if (editing) { input.value = ''; input.style.height = ''; } replyTo = null; editing = null; paintReply(); } }, mi('close')));
    paintBar();
  };
  const sendSticker = async (v) => {
    closeEmo();
    const re = replyTo; replyTo = null; paintReply();
    try { await send(cv, STICKER_TXT, null, v, null, re); } catch { toast('Стикер не отправился. Попробуйте ещё раз'); }
  };
  let emoKind = '';
  const closeEmo = () => { if (emoBox.hidden) return; emoBox.hidden = true; emoBox.replaceChildren(); emoBtn.classList.remove('on'); stBtn.classList.remove('on'); p.classList.remove('emo-open'); emoKind = ''; };
  // kind: 'emoji' — эмодзи и эмодзи MKW (кнопка в поле), 'stickers' — стикеры (отдельная кнопка слева)
  const openEmo = (kind = 'emoji') => {
    if (!emoBox.hidden && emoKind === kind) { closeEmo(); if (kind === 'emoji') input.focus({ preventScroll: true }); return; }
    if (blockedNow()) { toast('Переписка ограничена'); return; }
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    if (!fine) input.blur();
    emoKind = kind;
    emoBox.replaceChildren(kind === 'stickers' ? emojiPicker({ onSticker: (n) => sendSticker(`st:${n}`), only: 'stickers' }) : emojiPicker({
      tab: (() => { try { return localStorage.getItem('mkw.emo.tab3') || 'cats'; } catch { return 'cats'; } })(),
      onCat: (n) => sendSticker(`mkw:${n}`),
      onEmoji: (e) => {
        const a = input.selectionStart ?? input.value.length, b = input.selectionEnd ?? a;
        input.value = `${input.value.slice(0, a)}${e}${input.value.slice(b)}`.slice(0, 500);
        try { input.selectionStart = input.selectionEnd = a + e.length; } catch { /* ignore */ }
        paintBar(); typing(cid, 'text');
      },
    }));
    emoBox.querySelectorAll('.emo-tab').forEach((t) => t.addEventListener('click', () => { try { localStorage.setItem('mkw.emo.tab3', t.dataset.t); } catch { /* ignore */ } }));
    emoBox.hidden = false; (kind === 'stickers' ? stBtn : emoBtn).classList.add('on'); (kind === 'stickers' ? emoBtn : stBtn).classList.remove('on'); p.classList.add('emo-open');
    if (atBottom) requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  };
  emoBtn.addEventListener('click', (e) => { e.preventDefault(); openEmo('emoji'); });
  stBtn.addEventListener('click', (e) => { e.preventDefault(); openEmo('stickers'); });
  emoBtn.addEventListener('mousedown', (e) => e.preventDefault()); // не забираем фокус у поля на компьютере
  input.addEventListener('focus', () => { if (!fine) closeEmo(); });
  const setReply = (id, m) => { editing = null; replyTo = { id, from: m.from, text: quoteText(m) }; paintReply(); input.focus({ preventScroll: true }); };
  const setEdit = (id, m) => { replyTo = null; editing = { id, text: String(m.text || '').slice(0, 80) }; input.value = m.text || ''; input.style.height = ''; input.style.height = `${Math.min(120, input.scrollHeight)}px`; paintReply(); input.focus({ preventScroll: true }); };

  // фото: несколько сразу, обрезка, поворот и рисование — в редакторе перед отправкой
  const editPhotos = (files) => {
    if (blockedNow()) { toast('Переписка ограничена'); return; }
    openPhotoEditor(files, {
      title: `Фото ${cv.group ? `в «${cv.title}»` : `для ${u.nick || 'друга'}`}`,
      caption: input.value.trim(),
      onSend: async (list, capText) => {
        const re = replyTo;
        for (let i = 0; i < list.length; i += 1) await send(cv, i === list.length - 1 ? capText : '', null, list[i], null, i === 0 ? re : null);
        if (capText) { input.value = ''; input.style.height = ''; }
        replyTo = null; paintReply(); paintBar();
      },
    });
  };
  photoIn.multiple = true;
  photoIn.addEventListener('change', () => { const fl = [...(photoIn.files || [])]; photoIn.value = ''; if (fl.length) editPhotos(fl); });
  // компьютер: вставить картинку из буфера (Ctrl+V) или перетащить в чат
  input.addEventListener('paste', (e) => {
    const fl = [...((e.clipboardData && e.clipboardData.files) || [])].filter((f) => /^image\//.test(f.type));
    if (fl.length) { e.preventDefault(); editPhotos(fl); }
  });
  list.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); list.classList.add('drop'); } });
  list.addEventListener('dragleave', (e) => { if (!list.contains(e.relatedTarget)) list.classList.remove('drop'); });
  list.addEventListener('drop', (e) => {
    list.classList.remove('drop');
    const fl = [...((e.dataTransfer && e.dataTransfer.files) || [])].filter((f) => /^image\//.test(f.type));
    if (fl.length) { e.preventDefault(); editPhotos(fl); }
  });
  // клавиатура не прячется после отправки: кнопка не забирает фокус у поля ввода
  let keepFocus = false;
  sendBtn.addEventListener('mousedown', (e) => { keepFocus = document.activeElement === input; e.preventDefault(); });
  sendBtn.addEventListener('pointerdown', (e) => { keepFocus = document.activeElement === input; if (e.pointerType === 'mouse') e.preventDefault(); });
  const blockedNow = () => (!cv.group && (blockedByMe(uid) || blockedMe(uid)));
  const doSend = async (track) => {
    const text = input.value.trim();
    if (editing) {
      const ed = editing; editing = null;
      input.value = ''; input.style.height = ''; paintReply();
      if (text && text !== ed.text) { try { await editMsg(cid, ed.id, text); } catch { toast('Изменения заработают после обновления правил базы'); } }
      return;
    }
    if (!text && !track) return;
    if (blockedNow()) { toast(blockedByMe(uid) ? 'Сначала разблокируйте собеседника' : `${u.nick || 'Собеседник'} ограничил(а) сообщения`); return; }
    const re = replyTo; replyTo = null;
    input.value = ''; input.style.height = ''; paintReply();
    if (keepFocus) input.focus({ preventScroll: true });
    keepFocus = false;
    try { await send(cv, track ? (text || 'Послушай') : text, track, null, null, re); }
    catch { toast('Не отправилось. Проверьте интернет и попробуйте ещё раз'); if (!input.value) { input.value = text; paintBar(); } }
  };
  sendBtn.addEventListener('click', () => doSend());
  shareBtn.addEventListener('click', () => { const t = player.queue.current; if (!t) { toast('Сейчас ничего не играет'); return; } doSend(t); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); doSend(); }
    if (e.key === 'Escape' && (replyTo || editing)) { if (editing) input.value = ''; replyTo = null; editing = null; paintReply(); }
    // стрелка вверх в пустом поле — изменить своё последнее сообщение
    if (e.key === 'ArrowUp' && !input.value && lastDocs) {
      const mine = lastDocs.find((d) => d.data().from === me() && !isCallMsg(d.data().text) && d.data().text && !d.data().voice && !stickerOf(d.data().img));
      if (mine) { e.preventDefault(); setEdit(mine.id, mine.data()); }
    }
  });
  input.addEventListener('input', () => { input.style.height = ''; input.style.height = `${Math.min(120, input.scrollHeight)}px`; paintBar(); if (input.value.trim() && !editing) typing(cid, 'text'); });
  input.addEventListener('blur', () => { if (!input.value.trim()) typingOff(cid); });

  // ---- голосовые ----
  // Телефон: держите микрофон — идёт запись, отпустили — отправилось. Влево — отмена, вверх — замок (можно отпустить).
  // Компьютер: нажали — запись. В записи с замком и на компьютере можно остановить, послушать, обрезать и отправить.
  let rec = null;
  const recUi = h('div', { class: 'ch-rec' });
  const holdMode = 'PointerEvent' in window; // и на телефоне, и мышкой: держать — запись, коротко нажать — запись с замком
  const endRec = () => { bar.classList.remove('rec', 'hold', 'locked', 'pv'); recUi.replaceChildren(); recUi.style.removeProperty('--dx'); recUi.style.removeProperty('--dy'); };
  const stopCapture = (r) => new Promise((res) => {
    if (r.stopped) { res(); return; }
    r.stopped = true;
    clearInterval(r.timer); clearTimeout(r.cap); clearInterval(r.typ);
    let done = false;
    const fin = () => {
      if (done) return; done = true;
      if (r.stream) r.stream.getTracks().forEach((t) => t.stop());
      r.sec = r.t0 ? (Date.now() - r.t0) / 1000 : 0;
      r.samples = r.pc && r.pc.ok ? r.pc.samples() : null;
      r.rate = r.pc ? r.pc.rate : 0;
      if (r.pc) r.pc.stop();
      res();
    };
    try { if (r.mr && r.mr.state !== 'inactive') { r.mr.onstop = fin; r.mr.stop(); setTimeout(fin, 2500); } else fin(); } catch { fin(); }
  });
  const pcmOf = async (r) => {
    r.blob = r.chunks.length ? new Blob(r.chunks, { type: ((r.mr && r.mr.mimeType) || r.mime || 'audio/webm').split(';')[0] }) : null;
    if (r.samples && r.samples.length) {
      let pk = 0; for (let i = 0; i < r.samples.length; i += 32) pk = Math.max(pk, Math.abs(r.samples[i]));
      if (pk > 0.003) return { f32: r.samples, rate: r.rate };
    }
    return r.blob ? decodeBlob(r.blob) : null;
  };
  const sendRec = async (r, pcm, a = 0, b = 1) => {
    endRec();
    let data = '', dur = r.sec;
    if (pcm) {
      const from = Math.floor(pcm.f32.length * a), to = Math.ceil(pcm.f32.length * b);
      if ((to - from) / pcm.rate < 0.5) { toast('Слишком коротко'); typingOff(cid); return; }
      try { const out = await encodeMp3(pcm.f32.subarray(from, to), pcm.rate); if (out) { data = await blobToDataUrl(out.blob); dur = out.dur; } } catch { data = ''; }
    }
    if (!data && r.blob && a === 0 && b === 1) data = await blobToDataUrl(r.blob);
    if (!data) { toast('Не получилось записать голосовое. Проверьте микрофон'); typingOff(cid); return; }
    if (data.length > 395000) { toast('Слишком длинное голосовое'); typingOff(cid); return; }
    if (r.re && r.re === replyTo) { replyTo = null; paintReply(); }
    try { await send(cv, '', null, null, { data, dur }, r.re); } catch { toast('Голосовое не отправилось. Попробуйте ещё раз'); }
  };
  const cancelRec = async () => {
    const r = rec; rec = null;
    endRec(); typingOff(cid);
    if (r) await stopCapture(r);
    if (navigator.vibrate) navigator.vibrate(8);
  };
  const finishSend = async () => {
    const r = rec; rec = null;
    if (!r) return;
    await stopCapture(r);
    if (r.sec < 0.7) { endRec(); typingOff(cid); toast(holdMode ? 'Удерживайте микрофон, пока говорите' : 'Слишком коротко'); return; }
    await sendRec(r, await pcmOf(r));
  };
  const toPreview = async () => {
    const r = rec; rec = null;
    if (!r) return;
    await stopCapture(r);
    if (r.sec < 0.7) { endRec(); typingOff(cid); toast('Слишком коротко'); return; }
    const pcm = await pcmOf(r);
    if (!pcm) { await sendRec(r, null); return; }
    showPreview(r, pcm);
  };
  const recTime = () => h('b', { class: 'ch-rec-t', text: '0:00' });
  const paintHold = (r) => {
    bar.classList.add('rec', 'hold');
    r.tm = recTime();
    recUi.replaceChildren(
      h('i', { class: 'ch-rec-dot' }), r.tm,
      h('span', { class: 'ch-rec-slide' }, h('span', { text: '‹ Влево — отмена' })),
      h('span', { class: 'ch-rec-lock' }, mi('lock'), mi('up')),
      h('span', { class: 'ch-rec-mic' }, mi('mic')));
  };
  const paintLocked = (r) => {
    bar.classList.remove('hold'); bar.classList.add('rec', 'locked');
    const tm = r.tm || recTime(); r.tm = tm;
    recUi.style.removeProperty('--dx'); recUi.style.removeProperty('--dy');
    recUi.replaceChildren(
      h('button', { type: 'button', class: 'ch-rec-x', 'aria-label': 'Удалить запись', title: 'Удалить', onclick: cancelRec }, mi('trash')),
      h('i', { class: 'ch-rec-dot' }), tm, h('span', { class: 'ch-rec-hint', text: 'Идёт запись…' }),
      h('button', { type: 'button', class: 'ch-rec-stop', 'aria-label': 'Остановить и прослушать', title: 'Остановить — прослушать и обрезать', onclick: toPreview }, mi('stop')),
      h('button', { type: 'button', class: 'ch-send ch-rec-send', 'aria-label': 'Отправить голосовое', onclick: finishSend }, mi('send')));
  };
  // прослушать запись и обрезать: тянем края пальцем или мышкой
  const showPreview = (r, pcm) => {
    bar.classList.remove('hold', 'locked'); bar.classList.add('rec', 'pv');
    const total = pcm.f32.length / pcm.rate;
    const N = 34, step = Math.max(1, Math.floor(pcm.f32.length / N));
    const peaks = Array.from({ length: N }, (_, i) => { let m = 0; for (let k = i * step; k < Math.min(pcm.f32.length, (i + 1) * step); k += 8) m = Math.max(m, Math.abs(pcm.f32[k])); return m; });
    const mx = Math.max(0.02, ...peaks);
    let a = 0, b = 1;
    const box = h('div', { class: 'ch-pv' }, h('span', { class: 'ch-pv-wave' }, ...peaks.map((v) => h('i', { style: `height:${14 + (v / mx) * 86}%` }))),
      h('span', { class: 'ch-pv-dim l' }), h('span', { class: 'ch-pv-dim r' }), h('span', { class: 'ch-pv-h l' }), h('span', { class: 'ch-pv-h r' }), h('span', { class: 'ch-pv-head' }));
    const tm = h('b', { class: 'ch-rec-t' });
    const url = wavUrl(pcm.f32, pcm.rate);
    const au = url ? new Audio(url) : null;
    const playBtn = h('button', { type: 'button', class: 'ch-pv-play', 'aria-label': 'Прослушать' }, mi('play'));
    const paint = () => { box.style.setProperty('--a', String(a)); box.style.setProperty('--b', String(b)); tm.textContent = mmss(total * (b - a)); };
    const stopPlay = () => { if (au) au.pause(); playBtn.replaceChildren(mi('play')); box.classList.remove('playing'); };
    if (au) {
      au.addEventListener('timeupdate', () => { box.style.setProperty('--t', String(au.currentTime / total)); if (au.currentTime >= total * b) stopPlay(); });
      au.addEventListener('ended', stopPlay);
    }
    playBtn.addEventListener('click', () => {
      if (!au) { toast('Прослушать здесь не получится — можно сразу отправить'); return; }
      if (!au.paused) { stopPlay(); return; }
      if (au.currentTime < total * a || au.currentTime >= total * b - 0.05) au.currentTime = total * a;
      if (player.st.playing) player.pause();
      au.play().then(() => { playBtn.replaceChildren(mi('pause')); box.classList.add('playing'); }).catch(() => toast('Не получилось воспроизвести'));
    });
    let drag = '';
    const pos = (e) => { const rc = box.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - rc.left) / rc.width)); };
    const minGap = Math.min(0.9, 0.6 / total);
    box.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const x = pos(e);
      drag = Math.abs(x - a) <= Math.abs(x - b) ? 'a' : 'b';
      try { box.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      box.classList.add('drag');
    });
    box.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const x = pos(e);
      if (drag === 'a') a = Math.min(x, b - minGap); else b = Math.max(x, a + minGap);
      a = Math.max(0, a); b = Math.min(1, b);
      paint();
      if (au) { au.currentTime = total * (drag === 'a' ? a : Math.max(a, b - 1.2)); box.style.setProperty('--t', String(au.currentTime / total)); }
    });
    const upH = () => { drag = ''; box.classList.remove('drag'); };
    box.addEventListener('pointerup', upH); box.addEventListener('pointercancel', upH);
    const done = () => { stopPlay(); if (url) setTimeout(() => URL.revokeObjectURL(url), 2000); };
    recUi.replaceChildren(
      h('button', { type: 'button', class: 'ch-rec-x', 'aria-label': 'Удалить запись', title: 'Удалить', onclick: () => { done(); endRec(); typingOff(cid); } }, mi('trash')),
      playBtn, box, tm,
      h('button', { type: 'button', class: 'ch-send ch-rec-send', 'aria-label': 'Отправить голосовое', onclick: () => { done(); sendRec(r, pcm, a, b); } }, mi('send')));
    paint();
  };
  const startRec = async (mode) => {
    if (rec) return null;
    if (blockedNow()) { toast('Переписка ограничена'); return null; }
    const pc = pcmCapture(); // AudioContext — прямо в нажатии, иначе iPhone его не запустит
    loadLame().catch(() => {});
    const r = { mode, pc, chunks: [], t0: 0, re: replyTo, stopped: false, ready: false };
    rec = r;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch { if (pc) pc.stop(); if (rec === r) rec = null; toast('Нет доступа к микрофону. Разрешите его в настройках браузера'); return null; }
    if (rec !== r) { stream.getTracks().forEach((t) => t.stop()); if (pc) pc.stop(); return null; }
    r.stream = stream;
    if (pc) pc.attach(stream);
    r.mime = voiceMime();
    try { r.mr = new MediaRecorder(stream, { ...(r.mime ? { mimeType: r.mime } : {}), audioBitsPerSecond: 32000 }); }
    catch { try { r.mr = new MediaRecorder(stream); } catch { r.mr = null; } }
    if (!r.mr && !(pc && pc.ok)) { stream.getTracks().forEach((t) => t.stop()); if (pc) pc.stop(); rec = null; toast('Этот браузер не умеет записывать голос'); return null; }
    if (r.mr) { r.mr.ondataavailable = (e) => { if (e.data && e.data.size) r.chunks.push(e.data); }; try { r.mr.start(250); } catch { r.mr = null; } }
    r.t0 = Date.now();
    r.ready = true;
    if (player.st.playing) player.pause();
    typing(cid, 'voice');
    if (mode === 'hold') paintHold(r); else paintLocked(r);
    r.timer = setInterval(() => { if (r.tm) r.tm.textContent = mmss((Date.now() - r.t0) / 1000); }, 250);
    r.typ = setInterval(() => typing(cid, 'voice'), 3600);
    r.cap = setTimeout(() => { if (rec === r) finishSend(); }, VOICE_MAX * 1000);
    return r;
  };
  if (holdMode) {
    // держим микрофон пальцем
    let g = null;
    micBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    micBtn.addEventListener('pointerdown', async (e) => {
      if (rec) return;
      e.preventDefault();
      try { micBtn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const gg = { x: e.clientX, y: e.clientY, id: e.pointerId, up: false, locked: false, t0: Date.now() };
      g = gg;
      if (navigator.vibrate) navigator.vibrate(10);
      const r = await startRec('hold');
      if (!r) { if (g === gg) g = null; return; }
      if (gg.up) {
        // отпустили, пока включался микрофон (или просто коротко нажали) — запись продолжается «с замком»
        r.mode = 'locked'; paintLocked(r);
      }
    });
    micBtn.addEventListener('pointermove', (e) => {
      if (!g || e.pointerId !== g.id || !rec || !rec.ready || rec.mode !== 'hold' || g.locked) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      recUi.style.setProperty('--dx', `${Math.max(-130, Math.min(0, dx))}px`);
      recUi.style.setProperty('--dy', `${Math.max(-90, Math.min(0, dy))}px`);
      if (dx < -110) { g = null; cancelRec(); toast('Запись отменена'); return; }
      if (dy < -70) { g.locked = true; rec.mode = 'locked'; paintLocked(rec); if (navigator.vibrate) navigator.vibrate(15); }
    });
    const up = (e, cancel) => {
      if (!g || e.pointerId !== g.id) return;
      g.up = true;
      const locked = g.locked, quick = Date.now() - g.t0 < 400; g = null;
      if (!rec || !rec.ready || locked || rec.mode !== 'hold') return;
      if (cancel) { cancelRec(); return; }
      // коротко нажали — не отправляем пустое, а пишем дальше с замком (кнопки «стоп» и «отправить»)
      if (quick) { rec.mode = 'locked'; paintLocked(rec); return; }
      finishSend();
    };
    micBtn.addEventListener('pointerup', (e) => up(e, false));
    micBtn.addEventListener('pointercancel', (e) => up(e, true));
  } else {
    micBtn.addEventListener('click', () => startRec('click'));
  }
  bar.appendChild(recUi);

  // ---- закреплённое сообщение ----
  const pinBar = h('div', { class: 'ch-pin', hidden: '' });
  let pinSig = '';
  const paintPin = () => {
    const x = pinOf(chatById(cid));
    const sig = x ? `${x.id}|${x.t}` : '';
    if (sig === pinSig) return;
    pinSig = sig;
    if (!x) { pinBar.hidden = true; pinBar.replaceChildren(); return; }
    pinBar.hidden = false;
    pinBar.replaceChildren(
      h('button', { type: 'button', class: 'ch-pin-go', onclick: () => flashPin(x.id) }, h('span', { class: 'ch-pin-ic' }, mi('pin')),
        h('span', { class: 'ch-pin-t' }, h('b', { text: 'Закреплённое сообщение' }), h('small', { text: x.t || '…' }))),
      h('button', { type: 'button', class: 'ch-pin-x', 'aria-label': 'Открепить', title: 'Открепить', onclick: () => unpinMsg(cid).then(() => toast('Сообщение откреплено')).catch(() => toast('Не получилось открепить')) }, mi('close')));
  };
  let flashPin = () => {};

  // ---- шапка ----
  const openProfile = () => (cv.group ? groupSheet(cv) : openUserPage(uid, u));
  const banner = h('div', { class: 'ch-block' });
  const avBtn = h('button', { type: 'button', class: 'ch-av', 'aria-label': cv.group ? 'Участники' : 'Профиль', onclick: openProfile },
    cv.group ? groupAvatar({ members: cv.members }, cv.cards) : h('img', { src: avSrc(u.avatar), alt: '' }));
  const whoName = h('span', { text: cv.title });
  const whoSmall = h('small');
  p.replaceChildren(
    h('header', { class: 'ch-head' },
      h('button', { class: 'icon-btn ch-back', type: 'button', 'aria-label': 'Назад', onclick: closeChat }, mi('close')),
      avBtn,
      h('div', { class: 'ch-who', role: 'button', tabindex: '0', onclick: (e) => { if (!e.target.closest('.fire')) openProfile(); } }, h('b', {}, whoName, cv.group ? null : nickEmo(u.nemo), h('span', { class: 'ch-fire' })), whoSmall),
      h('button', { class: 'icon-btn ch-callbtn', type: 'button', 'aria-label': 'Позвонить', title: cv.group ? 'Позвонить группе (до 4 человек)' : 'Позвонить', onclick: () => {
        if (cv.group) { startCall(cv.members.filter((x) => x !== me() && isFriend(x)).slice(0, 3)); return; }
        if (isBlocked(uid)) { toast('Звонки ограничены'); return; }
        startCall([uid]);
      } }, mi('phone')),
      h('button', { class: 'icon-btn ch-morebtn', type: 'button', 'aria-label': 'Ещё', title: 'Слушать вместе, общий плейлист, огонёк, фон', onclick: () => convMenu(cv, list) }, mi('more'))),
    h('div', { class: 'ch-tg' }),
    pinBar,
    list,
    h('div', { class: 'ch-firecta' }),
    banner,
    replyBar,
    emoBox,
    bar);
  paintBar();
  paintBg(list, cid);
  requestAnimationFrame(() => p.classList.add('open'));
  document.body.classList.add('chat-open');
  document.querySelectorAll('.cl-row').forEach((r) => r.classList.toggle('on', r.dataset.cid === cid));
  offKb = fitKeyboard(p, list);
  // «Слушаете вместе»
  const tg = togetherBar(cid, cv.members, nickOf);
  p.querySelector('.ch-tg').appendChild(tg.el);
  offTg = tg.stop;

  // ---- статус в шапке: в сети / слушает / печатает ----
  let peerSeen = u.seen, peerNow = u.now;
  const paintStatus = () => {
    const c = chatById(cid);
    const ty = typers(c);
    whoSmall.classList.remove('on', 'ty');
    if (ty.length) {
      whoSmall.classList.add('ty');
      const voice = ty.some((x) => x.kind === 'voice');
      const who = cv.group ? `${ty.map((x) => nickOf(x.uid)).slice(0, 2).join(', ')} ` : '';
      whoSmall.replaceChildren(h('span', { text: `${who}${voice ? 'записывает голосовое' : 'печатает'}` }), h('i', { class: 'ty-dots' }, h('i'), h('i'), h('i')));
      return;
    }
    if (cv.group) { whoSmall.textContent = `${(c ? c.members : cv.members).length} участников`; return; }
    // читает, печатает или пишет прямо сейчас — значит в сети, даже если отметка «в сети» ещё не дошла
    const rd0 = (c && c.read) || {};
    let act = Math.max(Number(rd0[uid]) || 0, Number(rd0[`t_${uid}`]) || 0, c && c.last && c.last.from === uid ? Number(c.last.at) || 0 : 0);
    if (act % 1000 === 997) act -= 1;
    const fresh = act > realSeen(peerSeen) && srvNow() - act < 60000;
    const on = isOnline(peerSeen) || fresh;
    const lastSeen = act > realSeen(peerSeen) ? act : peerSeen;
    whoSmall.textContent = on && peerNow && isOnline(peerSeen) ? `Слушает: ${peerNow}` : on ? 'в сети' : seenText(lastSeen) || '';
    whoSmall.classList.toggle('on', on);
    const dot = avBtn.querySelector('.online-dot');
    if (on && !dot) avBtn.appendChild(h('i', { class: 'online-dot' })); else if (!on && dot) dot.remove();
  };
  let unsubPeer = () => {};
  if (!cv.group) { try { unsubPeer = onSnapshot(doc(db, 'profiles', uid), (d) => { const x = d.exists() ? d.data() : {}; if (x.seen != null) peerSeen = x.seen; if (x.now != null) peerNow = x.now; paintStatus(); }, () => {}); } catch { /* ignore */ } }
  const peerT = setInterval(paintStatus, 2000);
  offPeer = () => { try { unsubPeer(); } catch { /* ignore */ } clearInterval(peerT); offPeer = null; };

  // блокировка: плашка вместо поля ввода
  const paintBlock = () => {
    if (cv.group) { banner.replaceChildren(); p.classList.remove('blocked'); return; }
    const mine = blockedByMe(uid), theirs = blockedMe(uid);
    p.classList.toggle('blocked', Boolean(mine || theirs));
    if (mine) banner.replaceChildren(h('span', { text: `Вы заблокировали ${u.nick || 'собеседника'}` }), h('button', { type: 'button', class: 'btn tonal', onclick: async () => { try { await setBlocked(uid, false); toast('Разблокировано'); } catch { toast('Не получилось'); } } }, 'Разблокировать'));
    else if (theirs) banner.replaceChildren(h('span', { text: `${u.nick || 'Собеседник'} ограничил(а) сообщения и звонки` }));
    else banner.replaceChildren();
  };
  // огонёк
  const fireSlot = p.querySelector('.ch-fire');
  const cta = p.querySelector('.ch-firecta');
  const paintFire = () => {
    const c = chatById(cid); const stt = streakAny(c, me(), uid);
    if (c && !blockedNow() && (stt.state === 'none' || stt.state === 'lost')) {
      if (cta.dataset.s !== stt.state) {
        cta.dataset.s = stt.state;
        const go = h('button', { class: 'ch-fire-go', type: 'button', onclick: async () => {
          if (stt.state === 'lost') { openStreak(cid, chatById(cid) || { read: {} }, me(), uid, cv.group ? 'группой' : (u.nick || 'другом')); return; }
          go.disabled = true;
          try { await startStreak(cid, me(), cv.group); } catch { go.disabled = false; toast('Не получилось. Проверьте интернет'); }
        } }, fireIcon({ state: 'lit', level: { l: 1 } }, true), h('span', { text: stt.state === 'lost' ? 'Огонёк погас — восстановить или завести заново' : cv.group ? 'Завести огонёк группы' : 'Завести MKW огонёк' }));
        cta.replaceChildren(go);
      }
    } else if (cta.dataset.s) { cta.dataset.s = ''; cta.replaceChildren(); }
    playFire(p, cid, stt, c, cv.group ? cv.title : (u.nick || 'другом'));
    if (stt.state === 'none') { fireSlot.replaceChildren(); return; }
    const f = fireIcon(stt); f.setAttribute('role', 'button'); f.tabIndex = 0;
    f.addEventListener('click', () => openStreak(cid, chatById(cid) || { read: {} }, me(), uid, cv.group ? 'группой' : (u.nick || 'другом')));
    fireSlot.replaceChildren(f);
  };

  // ---- сообщения ----
  const drawn = new Map(); let first = true; let lastDocs = null; let viewKey = '';
  const byId = new Map();
  const ticks = new Map();
  const readBy = () => {
    const c = chatById(cid); const r = rd(c);
    return Math.max(0, ...(c ? c.members : cv.members).filter((x) => x !== me()).map((x) => Number(r[x]) || 0));
  };
  const paintTicks = () => {
    const readAt = readBy();
    ticks.forEach(({ at, el }) => { const r = readAt >= at; if (el.dataset.r !== String(r)) { el.dataset.r = String(r); el.classList.toggle('read', r); el.title = r ? 'Прочитано' : 'Доставлено'; } });
  };
  const keyOf = () => { const c = chatById(cid); return `${clearedAt(c)}|${cv.group ? '' : blockedByMe(uid)}`; };
  const sigOf = (m) => `${m.text}|${m.ed || 0}|${JSON.stringify(m.rx || {})}|${(m.re && m.re.id) || ''}`;
  const rxRow = (id, m) => {
    const rx = m.rx || {}; const groups = {};
    Object.entries(rx).forEach(([who, e]) => { if (e) (groups[e] = groups[e] || []).push(who); });
    const keys = Object.keys(groups);
    if (!keys.length) return null;
    const mineR = rx[me()];
    return h('div', { class: 'ch-rx' }, ...keys.map((e) => h('button', { type: 'button', class: `ch-rxc${groups[e].includes(me()) ? ' on' : ''}`, title: groups[e].map(nickOf).join(', '), onclick: (ev) => { ev.stopPropagation(); react(cid, id, e, mineR).catch(() => toast('Реакции заработают после обновления правил базы')); } },
      rxNode(e), groups[e].length > 1 || cv.group ? h('small', { text: String(groups[e].length) }) : null)));
  };
  const flash = (id) => { const x = drawn.get(id); if (!x) { toast('Это сообщение выше — пролистайте'); return; } x.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); x.el.classList.remove('flash'); void x.el.offsetWidth; x.el.classList.add('flash'); };
  const build = (id, m) => {
    if (isCallMsg(m.text)) {
      const ev = parseCall(m.text); const mine = m.from === me();
      const label = ev.kind === 'missed' ? (mine ? 'Звонок без ответа' : 'Пропущенный звонок')
        : ev.kind === 'declined' ? `${ev.nick || 'Друг'} отклонил(а) звонок`
        : `${mine ? 'Исходящий' : 'Входящий'} звонок · ${dur(ev.sec)}`;
      return h('div', { class: `ch-call ${ev.kind}${mine ? ' me' : ''}${first ? '' : ' new'}`, 'data-id': id },
        h('span', { class: 'ch-call-ic' }, mi(ev.kind === 'ended' ? 'phone' : 'call-end')),
        h('span', { class: 'ch-call-t' }, h('b', { text: label }), h('small', { text: timeOf(m.at) })),
        h('button', { class: 'ch-call-again', type: 'button', title: 'Позвонить', 'aria-label': 'Позвонить', onclick: () => (cv.group ? startCall(cv.members.filter((x) => x !== me() && isFriend(x)).slice(0, 3)) : startCall([uid])) }, mi('phone')));
    }
    const mineMsg = m.from === me();
    const voiceSrc = typeof m.voice === 'string' && m.voice.startsWith('data:audio/') ? m.voice : typeof m.img === 'string' && m.img.startsWith('data:audio/') ? m.img : '';
    const cat = stickerOf(m.img);
    const photoOnly = m.img && !voiceSrc && !cat && !m.text && !m.track && !m.re;
    const img = !voiceSrc && m.img && safeUrl(m.img).startsWith('data:image/') ? h('img', { class: 'ch-img', src: m.img, alt: 'Фото', decoding: 'async', onclick: () => openImage(m.img, '') }) : null;
    if (img) img.addEventListener('load', () => { if (list.scrollHeight - list.scrollTop - list.clientHeight < 400) list.scrollTop = list.scrollHeight; }, { once: true });
    const text = (voiceSrc && m.text === VOICE_TXT) || (cat && m.text === STICKER_TXT) ? '' : m.text;
    const sticker = cat ? h('img', { class: `ch-sticker${cat.big ? ' big' : ''}`, src: cat.src, alt: cat.name, title: cat.name, draggable: 'false' }) : null;
    const meta = h('div', { class: 'ch-meta' }, h('img', { src: avSrc(avOf(m.from)), alt: '', loading: 'lazy' }), h('b', { text: nickOf(m.from) }), h('span', { text: `${dayOf(m.at)}, ${timeOf(m.at)}` }));
    const quote = m.re && m.re.id ? h('button', { type: 'button', class: 'ch-quote', onclick: (e) => { e.stopPropagation(); flash(m.re.id); } }, h('b', { text: nickOf(m.re.from) }), h('span', { text: m.re.text || '…' })) : null;
    let tk = null;
    if (mineMsg) { tk = h('span', { class: 'ch-tick', 'aria-hidden': 'true' }, h('i'), h('i')); ticks.set(id, { at: Number(m.at) || 0, el: tk }); }
    const hov = fine ? h('span', { class: 'ch-hov' },
      h('button', { type: 'button', title: 'Реакция', 'data-act': 'menu' }, mi('emoji')),
      h('button', { type: 'button', title: 'Ответить', 'data-act': 'reply' }, mi('reply')),
      mineMsg && text && !voiceSrc && !cat ? h('button', { type: 'button', title: 'Изменить', 'data-act': 'edit' }, mi('edit')) : null,
      h('button', { type: 'button', title: 'Ещё', 'data-act': 'menu' }, mi('more'))) : null;
    return h('div', { class: `ch-msg${mineMsg ? ' me' : ''}${img ? ' has-img' : ''}${photoOnly ? ' photo' : ''}${voiceSrc ? ' voice' : ''}${cat ? ' sticker' : ''}${first ? '' : ' new'}`, 'data-id': id },
      meta,
      cv.group && !mineMsg ? h('div', { class: 'ch-from', text: nickOf(m.from) }) : null,
      quote,
      m.track ? h('button', { class: 'ch-track', type: 'button', onclick: () => playTrack(m.track) }, mi('play-circle'), h('span', {}, h('b', { text: m.track.title }), h('small', { text: m.track.artist }))) : null,
      img,
      sticker,
      voiceSrc ? voiceBubble(voiceSrc, Number(m.vdur) || 0) : null,
      text ? h('div', { class: 'ch-text', text }) : null,
      rxRow(id, m),
      h('time', {}, m.ed ? h('em', { text: 'изм. ' }) : null, timeOf(m.at), tk),
      hov);
  };
  // чат «прилипает» к низу: пока вы внизу (или печатаете), новые сообщения и рост поля ввода не уводят ленту вверх
  let stick = true;
  list.addEventListener('scroll', () => { stick = list.scrollHeight - list.scrollTop - list.clientHeight < 120; }, { passive: true });
  try { new ResizeObserver(() => { if (stick) list.scrollTop = list.scrollHeight; }).observe(list); } catch { /* старый браузер */ }
  const render = () => {
    if (!lastDocs) return;
    viewKey = keyOf();
    const c = chatById(cid), from = clearedAt(c), bl = cv.group ? 0 : blockedByMe(uid);
    const docs = lastDocs.slice().reverse().filter((d) => { const m = d.data(); const at = Number(m.at) || 0; return at > from && !(bl && m.from === uid && at > bl); });
    byId.clear(); docs.forEach((d) => byId.set(d.id, d.data()));
    const atBottom = stick || document.activeElement === input || list.scrollHeight - list.scrollTop - list.clientHeight < 160;
    if (!docs.length) { list.replaceChildren(h('p', { class: 'ch-empty', text: from ? 'Здесь пока пусто — чат очищен.' : cv.group ? 'Группа создана. Напишите первым!' : `Напишите ${u.nick || 'другу'} первым. Можно отправить трек, который сейчас играет — кнопка с нотой, или голосовое — кнопка с микрофоном.` })); return; }
    let day = '', prevFrom = '', prevAt = 0;
    const nodes = [];
    docs.forEach((d) => {
      const m = d.data();
      const dd = dayOf(m.at); if (dd !== day) { day = dd; prevFrom = ''; nodes.push(h('div', { class: 'ch-day', text: dd })); }
      const sig = sigOf(m);
      let x = drawn.get(d.id);
      if (!x || x.sig !== sig) { x = { el: build(d.id, m), sig }; drawn.set(d.id, x); }
      const at = Number(m.at) || 0, call = isCallMsg(m.text);
      x.el.classList.toggle('grp', !call && prevFrom === m.from && at - prevAt < 420000);
      prevFrom = call ? '' : m.from; prevAt = at;
      nodes.push(x.el);
    });
    first = false;
    list.replaceChildren(...nodes);
    paintTicks();
    if (atBottom || list.dataset.first !== '1') { list.scrollTop = list.scrollHeight; list.dataset.first = '1'; stick = true; requestAnimationFrame(() => { if (stick) list.scrollTop = list.scrollHeight; }); }
  };

  // ---- меню сообщения: реакции, ответить, копировать, изменить, удалить ----
  const openMenu = (el) => {
    const id = el && el.dataset.id; const m = id && byId.get(id);
    if (!m || isCallMsg(m.text)) return;
    if (closeMenu) closeMenu();
    const mine = m.from === me();
    const myR = (m.rx || {})[me()];
    const isVoice = Boolean(m.voice || (typeof m.img === 'string' && m.img.startsWith('data:audio/')));
    const close = () => { wrap.classList.remove('show'); el.classList.remove('picked'); setTimeout(() => wrap.remove(), 180); closeMenu = null; };
    const item = (ic, label, fn, danger) => h('button', { type: 'button', class: `ch-mi${danger ? ' danger' : ''}`, onclick: () => { close(); fn(); } }, mi(ic), h('span', { text: label }));
    const isCat = Boolean(stickerOf(m.img));
    const doReact = (e) => { close(); react(cid, id, e, myR).catch(() => toast('Реакции заработают после обновления правил базы')); };
    const more = h('button', { type: 'button', class: 'ch-mm-more', 'aria-label': 'Все реакции', title: 'Все реакции и котики', onclick: (ev) => {
      ev.stopPropagation();
      // «+»: все эмодзи и котики MKW вместо списка действий
      const pick = emojiPicker({ onCat: (n) => doReact(`mkw:${n}`), onEmoji: (e) => doReact(e), compact: true });
      listBox.replaceWith(pick); more.remove(); panel.classList.add('wide'); el.classList.remove('picked');
      const pr2 = p.getBoundingClientRect(), hh = panel.offsetHeight;
      const top = parseFloat(panel.style.top) || 8;
      panel.style.top = `${Math.max(8, Math.min(pr2.height - hh - 8, top))}px`;
    } }, mi('add'));
    const listBox = h('div', { class: 'ch-mm-list' }, ...[
        item('reply', 'Ответить', () => setReply(id, m)),
        (pinOf(chatById(cid)) || {}).id === id
          ? item('pin', 'Открепить', () => unpinMsg(cid).then(() => toast('Сообщение откреплено')).catch(() => toast('Не получилось открепить')))
          : item('pin', 'Закрепить', () => pinMsg(cid, id, m).then(() => toast('Сообщение закреплено')).catch(() => toast('Не получилось закрепить'))),
        m.text && !isVoice && !isCat ? item('copy', 'Копировать', () => { try { navigator.clipboard.writeText(m.text); toast('Скопировано'); } catch { toast('Не получилось скопировать'); } }) : null,
        mine && m.text && !isVoice && !m.track && !isCat ? item('edit', 'Изменить', () => setEdit(id, m)) : null,
        mine ? item('trash', 'Удалить у всех', () => deleteMsg(cid, id).catch(() => toast('Удаление заработает после обновления правил базы')), true) : null,
      ].filter(Boolean));
    const panel = h('div', { class: 'ch-mm-p' },
      h('div', { class: 'ch-mm-rx' }, ...QUICK_RX.map((e) => h('button', { type: 'button', class: `${myR === e ? 'on' : ''}${catOf(e) ? ' cat' : ''}`, title: catOf(e) ? catName(catOf(e)) : e, onclick: () => doReact(e) }, rxNode(e))), more),
      listBox);
    const wrap = h('div', { class: 'ch-mm' }, h('div', { class: 'ch-mm-bg', onclick: close }), panel);
    p.appendChild(wrap);
    el.classList.add('picked');
    const r = el.getBoundingClientRect(), pr = p.getBoundingClientRect();
    const ph = 300, below = r.bottom + ph < pr.bottom - 8;
    panel.style.top = `${Math.max(8, Math.min(pr.height - ph - 8, (below ? r.bottom + 8 : r.top - ph - 8) - pr.top))}px`;
    const left = el.classList.contains('me') && !fine ? r.right - pr.left - 312 : r.left - pr.left;
    panel.style.left = `${Math.max(8, Math.min(pr.width - 320, left))}px`;
    requestAnimationFrame(() => wrap.classList.add('show'));
    closeMenu = close;
  };
  // компьютер: правая кнопка мыши и кнопки при наведении
  list.addEventListener('contextmenu', (e) => { const el = e.target.closest('.ch-msg'); if (!el) return; e.preventDefault(); openMenu(el); });
  list.addEventListener('click', (e) => {
    const b = e.target.closest('.ch-hov button'); if (!b) return;
    const el = b.closest('.ch-msg'); const id = el.dataset.id; const m = byId.get(id); if (!m) return;
    const act = b.dataset.act;
    if (act === 'reply') setReply(id, m); else if (act === 'edit') setEdit(id, m); else openMenu(el);
  });
  list.addEventListener('dblclick', (e) => {
    const el = e.target.closest('.ch-msg'); if (!el || e.target.closest('button, img, .ch-voice')) return;
    const id = el.dataset.id, m = byId.get(id); if (!m) return;
    react(cid, id, '❤️', (m.rx || {})[me()]).catch(() => {});
  });
  // телефон: свайп влево — ответить, долгое нажатие — меню, двойное касание — ❤️
  let g = null, lastTap = { id: '', t: 0 };
  list.addEventListener('touchstart', (e) => {
    const el = e.target.closest('.ch-msg');
    if (!el || e.touches.length !== 1 || e.target.closest('.ch-vbars, .ch-vplay')) { g = null; return; }
    const t = e.touches[0];
    g = { el, x: t.clientX, y: t.clientY, dx: 0, mode: '', timer: 0 };
    g.timer = setTimeout(() => { if (g && !g.mode) { g.mode = 'long'; if (navigator.vibrate) navigator.vibrate(12); openMenu(el); } }, 430);
  }, { passive: true });
  list.addEventListener('touchmove', (e) => {
    if (!g) return;
    const t = e.touches[0]; const mx = t.clientX - g.x, my = t.clientY - g.y;
    if (!g.mode) {
      if (Math.abs(mx) < 9 && Math.abs(my) < 9) return;
      clearTimeout(g.timer);
      g.mode = mx < 0 && Math.abs(mx) > Math.abs(my) * 1.4 ? 'swipe' : 'scroll';
    }
    if (g.mode === 'swipe') {
      e.preventDefault();
      g.dx = Math.max(-96, Math.min(0, mx));
      g.el.style.transform = `translateX(${g.dx}px)`;
      const ok = g.dx < -58;
      if (ok !== g.el.classList.contains('swipe-ok')) { g.el.classList.toggle('swipe-ok', ok); if (ok && navigator.vibrate) navigator.vibrate(8); }
    }
  }, { passive: false });
  const touchEnd = () => {
    if (!g) return;
    clearTimeout(g.timer);
    const el = g.el;
    if (g.mode === 'swipe') {
      el.style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1)'; el.style.transform = '';
      setTimeout(() => { el.style.transition = ''; }, 240);
      el.classList.remove('swipe-ok');
      if (g.dx < -58) { const m = byId.get(el.dataset.id); if (m) setReply(el.dataset.id, m); }
    } else if (!g.mode) {
      const now = Date.now(), id = el.dataset.id;
      if (lastTap.id === id && now - lastTap.t < 300) { const m = byId.get(id); if (m) react(cid, id, '❤️', (m.rx || {})[me()]).catch(() => {}); lastTap = { id: '', t: 0 }; }
      else lastTap = { id, t: now };
    }
    g = null;
  };
  list.addEventListener('touchend', touchEnd); list.addEventListener('touchcancel', touchEnd);

  flashPin = (id) => flash(id);
  paintStatus(); paintFire(); paintBlock(); paintPin();
  if (offTicks) offTicks();
  offTicks = onChats(() => {
    const c = chatById(cid);
    if (cv.group && c) {
      if (!(c.members || []).includes(me())) { closeChat(); return; }
      if (c.name && c.name !== cv.title) { cv.title = c.name; whoName.textContent = c.name; }
      cv.members = c.members;
    }
    paintTicks(); paintFire(); paintBlock(); paintStatus(); paintPin();
    if (keyOf() !== viewKey) render();
  });
  list.replaceChildren(h('p', { class: 'ch-empty', text: 'Загрузка…' }));
  try {
    unsubMsgs = onSnapshot(query(collection(db, 'chats', cid, 'msgs'), orderBy('at', 'desc'), limit(100)), (s) => {
      lastDocs = s.docs;
      render();
      if (chatById(cid) && !document.hidden) markRead(cid);
    }, () => { list.replaceChildren(h('p', { class: 'ch-empty', text: 'Чат недоступен. Проверьте интернет и откройте снова.' })); });
  } catch { /* ignore */ }
  if (fine) setTimeout(() => input.focus({ preventScroll: true }), 350);
}
