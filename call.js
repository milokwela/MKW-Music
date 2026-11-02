// Звонки друзьям — до 4 человек, с демонстрацией экрана. Звук и видео идут напрямую между устройствами (WebRTC),
// а «договариваются» они через Firestore:
//   calls/{id}           — { host, members: [до 4 uid], in: [кто сейчас в звонке], muted: {uid: true}, ping: {uid: время}, declined: [uid], screen: uid, at }
//   calls/{id}/sig/{sid} — { from, to, kind: 'offer' | 'answer', sid, sdp, at } — описание соединения для конкретного человека
// Каждый с каждым соединяется напрямую (при 4 людях — 6 соединений).
// Чтобы звонок подключался сразу: звонящий готовит соединение заранее, пока у друга звонит телефон,
// поэтому после «Принять» остаётся один короткий ответ.
import { db } from './firebase.js?v=0.27.1';
import { doc, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where, limit, onSnapshot, arrayUnion, arrayRemove } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { h, toast, openSheet, closeSheet } from './ui.js?v=0.27.1';
import { mi } from './icons2.js?v=0.27.1';
import { me, isFriend, friendIds, friendCards, cardOf } from './friends.js?v=0.27.1';
import { avSrc } from './avatar.js?v=0.27.1';
import { RECOGNIZE_URL } from './shazam-config.js?v=0.27.1';
import { pushTo, myNick } from './push.js?v=0.27.1';
import * as player from './player.js?v=0.27.1';

const MAX = 4;
let ice = null, iceP = null;
function iceServers() {
  if (ice) return Promise.resolve(ice);
  if (iceP) return iceP;
  iceP = (async () => {
    let list = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
    const w = String(RECOGNIZE_URL || '').replace(/\/$/, '');
    if (w) {
      try {
        const c = new AbortController(); const t = setTimeout(() => c.abort(), 4000);
        const r = await fetch(`${w}/turn`, { signal: c.signal }); clearTimeout(t);
        if (r.ok) { const j = await r.json(); if (Array.isArray(j.iceServers) && j.iceServers.length) list = j.iceServers; }
      } catch { /* только STUN */ }
    }
    ice = list; iceP = null;
    return ice;
  })();
  return iceP;
}
const hasTurn = () => (ice || []).some((s) => [].concat(s.urls || []).some((u) => /^turns?:/.test(u)));
// заранее узнаём серверы для звонков — открыли чаты, значит, скоро могут позвонить
export function warmCalls() { iceServers().catch(() => {}); }

// ---------- состояние текущего звонка ----------
let cur = null;
export const inCall = () => Boolean(cur);
const canShare = () => Boolean(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && !/android|iphone|ipad|ipod/i.test(navigator.userAgent);

function setInCall(v) { document.documentElement.classList.toggle('in-call', v); }

// маршруты соединения собираем быстро: как только нашёлся внешний адрес (или TURN), через 250 мс отправляем
function gathered(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((res) => {
    let done = false, quick = 0;
    const fin = () => { if (done) return; done = true; clearTimeout(slow); clearTimeout(quick); res(); };
    const slow = setTimeout(fin, 2000);
    const want = hasTurn() ? / typ relay / : / typ (srflx|relay) /;
    pc.addEventListener('icecandidate', (e) => { if (!e.candidate) fin(); else if (!quick && want.test(` ${e.candidate.candidate} `)) quick = setTimeout(fin, 250); });
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') fin(); });
  });
}

// кто начинает соединение в паре: звонящий, иначе тот, у кого uid «меньше»
function offerer(a, b) { const host = cur && cur.data && cur.data.host; if (a === host) return a; if (b === host) return b; return a < b ? a : b; }
const newSid = () => Math.random().toString(36).slice(2, 10);

async function newPeer(uid, sid) {
  dropPeer(uid);
  const pc = new RTCPeerConnection({ iceServers: await iceServers(), bundlePolicy: 'max-bundle' });
  const entry = { pc, sid: sid || newSid(), audio: null, an: null, micId: '', makingOffer: false, ready: false, offeredAt: 0, video: null, ss: [] };
  cur.pcs.set(uid, entry);
  cur.local.getTracks().forEach((t) => pc.addTrack(t, cur.local));
  if (cur.screen) entry.ss = cur.screen.getTracks().map((t) => pc.addTrack(t, cur.screen));
  pc.ontrack = (e) => {
    const s = e.streams[0] || new MediaStream([e.track]);
    if (e.track.kind === 'audio' && (!entry.micId || entry.micId === s.id)) {
      entry.micId = s.id;
      if (!entry.audio) { entry.audio = h('audio', { autoplay: '', playsinline: '' }); document.body.appendChild(entry.audio); }
      entry.audio.srcObject = s;
      entry.audio.play().catch(() => {});
      entry.an = levelMeter(s);
    } else {
      // демонстрация экрана (картинка и, если есть, звук вкладки)
      entry.video = s;
      s.onremovetrack = () => { if (!s.getVideoTracks().length) { entry.video = null; paintScreen(); } };
      e.track.addEventListener('ended', () => { entry.video = null; paintScreen(); });
      paintScreen();
    }
    paint();
  };
  // нужно что-то поменять в соединении (включили или выключили показ экрана) — договариваемся заново
  pc.onnegotiationneeded = async () => {
    if (!entry.ready || !cur) return;
    try { entry.makingOffer = true; await pc.setLocalDescription(); await gathered(pc); await sendSig(uid, 'offer', entry.sid, pc.localDescription.sdp); }
    catch (err) { console.warn('renegotiate', err); }
    finally { entry.makingOffer = false; }
  };
  pc.onconnectionstatechange = () => {
    if (!cur || cur.pcs.get(uid) !== entry) return;
    const st = pc.connectionState;
    if (st === 'connected') {
      clearTimeout(entry.lost);
      if (!entry.ready) {
        entry.ready = true;
        // показ экрана включили, пока соединялись, — досылаем
        if (pc.getTransceivers().some((t) => !t.mid && t.sender && t.sender.track)) pc.onnegotiationneeded();
      }
    }
    if (st === 'disconnected') { clearTimeout(entry.lost); entry.lost = setTimeout(() => { if (pc.connectionState !== 'connected') reconnect(uid); }, 4000); }
    if (st === 'failed') reconnect(uid);
    paint();
  };
  return entry;
}
// связь пропала — переподключаемся (начинает тот же, кто начинал)
function reconnect(uid) {
  if (!cur || !(cur.data.in || []).includes(uid)) return;
  if (offerer(me(), uid) === me()) { toast('Связь пропала — переподключаю…'); offerTo(uid, true).catch(() => {}); }
}
function dropPeer(uid) {
  const e = cur && cur.pcs.get(uid); if (!e) return;
  clearTimeout(e.lost);
  try { e.pc.close(); } catch { /* ignore */ }
  if (e.audio) { e.audio.srcObject = null; e.audio.remove(); }
  cur.pcs.delete(uid);
  paintScreen();
}

async function sendSig(to, kind, sid, sdp) {
  await addDoc(collection(db, 'calls', cur.id, 'sig'), { from: me(), to, kind, sid, sdp, at: Date.now() });
}
async function offerTo(uid, fresh) {
  if (!cur || cur.offering.has(uid)) return;
  cur.offering.add(uid);
  try {
    let e = cur.pcs.get(uid);
    if (!e || fresh) e = await newPeer(uid);
    e.makingOffer = true;
    await e.pc.setLocalDescription(await e.pc.createOffer());
    await gathered(e.pc);
    if (!cur || cur.pcs.get(uid) !== e) return;
    e.offeredAt = Date.now();
    await sendSig(uid, 'offer', e.sid, e.pc.localDescription.sdp);
  } catch (err) { console.warn('offer', err); }
  finally { const e = cur && cur.pcs.get(uid); if (e) e.makingOffer = false; if (cur) cur.offering.delete(uid); }
}
async function onSig(m) {
  if (!cur || m.to !== me()) return;
  try {
    if (m.kind === 'offer') {
      let e = cur.pcs.get(m.from);
      if (!e || e.sid !== m.sid) e = await newPeer(m.from, m.sid); // новое соединение
      const pc = e.pc;
      const collision = e.makingOffer || pc.signalingState !== 'stable';
      const polite = offerer(me(), m.from) !== me();
      if (collision && !polite) return; // встречное предложение — уступает вежливая сторона
      if (collision) await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
      await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc);
      if (cur && cur.pcs.get(m.from) === e) await sendSig(m.from, 'answer', e.sid, pc.localDescription.sdp);
    } else if (m.kind === 'answer') {
      const e = cur.pcs.get(m.from);
      if (e && e.sid === m.sid && e.pc.signalingState === 'have-local-offer') await e.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
    }
  } catch (err) { console.warn('call sig', err); }
}

// кто говорит — подсвечиваем
let actx = null;
function levelMeter(stream) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const src = actx.createMediaStreamSource(stream), an = actx.createAnalyser(); an.fftSize = 256;
    src.connect(an);
    return an;
  } catch { return null; }
}
const loud = (an) => { if (!an) return 0; const d = new Uint8Array(an.frequencyBinCount); an.getByteFrequencyData(d); return d.reduce((a, b) => a + b, 0) / d.length; };

// ---------- окно звонка ----------
const cards = new Map();
async function nickOf(uid) { if (!cards.has(uid)) cards.set(uid, await cardOf(uid).catch(() => ({ uid, nick: 'друг' }))); return cards.get(uid); }

function paint() {
  if (!cur || !cur.ui) return;
  const d = cur.data || {}, inn = d.in || [], members = d.members || [];
  const others = members.filter((x) => x !== me());
  const waiting = inn.length <= 1;
  const allDeclined = others.length && others.every((x) => (d.declined || []).includes(x));
  cur.ui.status.textContent = waiting ? (allDeclined ? 'Не отвечает' : 'Звоним…') : timer();
  cur.ui.tiles.replaceChildren(...[me(), ...others].map((uid) => {
    const c = cards.get(uid) || { nick: '…' };
    const here = inn.includes(uid);
    const e = cur.pcs.get(uid);
    const st = e ? e.pc.connectionState : '';
    const t = h('div', { class: `cl-tile${here ? ' here' : ''}${(d.muted || {})[uid] ? ' muted' : ''}${d.screen === uid ? ' sharing' : ''}`, 'data-uid': uid },
      h('span', { class: 'cl-tav' }, h('img', { src: avSrc(c.avatar), alt: '' })),
      h('b', { text: uid === me() ? 'Вы' : c.nick || 'друг' }),
      h('small', { text: d.screen === uid ? 'показывает экран' : (d.muted || {})[uid] ? 'микрофон выключен' : here ? (uid === me() || st === 'connected' ? 'в звонке' : st === 'failed' || st === 'disconnected' ? 'переподключение…' : 'соединение…') : (d.declined || []).includes(uid) ? 'отклонил(а)' : 'звоним…' }));
    if (!cards.has(uid)) nickOf(uid).then(paint);
    return t;
  }));
  cur.ui.mute.classList.toggle('off', cur.muted);
  cur.ui.mute.replaceChildren(mi(cur.muted ? 'mic-off' : 'mic'), h('span', { text: cur.muted ? 'Включить' : 'Микрофон' }));
  cur.ui.add.hidden = members.length >= MAX;
  if (cur.ui.share) {
    cur.ui.share.classList.toggle('on', Boolean(cur.screen));
    cur.ui.share.lastChild.textContent = cur.screen ? 'Остановить' : 'Экран';
  }
  paintScreen();
}
const timer = () => { const s = Math.floor((Date.now() - (cur.t0 || Date.now())) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// показ экрана: у смотрящих — большое видео, у показывающего — плашка «Вы показываете экран»
function paintScreen() {
  if (!cur || !cur.ui) return;
  const area = cur.ui.screen;
  const who = cur.data && cur.data.screen;
  if (cur.screen) {
    area.hidden = false; cur.ui.box.classList.add('has-screen', 'me-share');
    if (!area.querySelector('.cs-mine')) area.replaceChildren(h('div', { class: 'cs-mine' }, mi('screen'), h('span', { text: 'Вы показываете экран' }), h('button', { class: 'btn tonal', type: 'button', onclick: stopShare }, 'Остановить')));
    return;
  }
  cur.ui.box.classList.remove('me-share');
  const e = who && who !== me() ? cur.pcs.get(who) : null;
  const stream = e && e.video;
  if (!stream || !stream.getVideoTracks().some((t) => t.readyState === 'live')) {
    area.hidden = true; area.replaceChildren(); cur.ui.box.classList.remove('has-screen'); return;
  }
  area.hidden = false; cur.ui.box.classList.add('has-screen');
  let v = area.querySelector('video');
  if (!v || v.srcObject !== stream) {
    v = h('video', { autoplay: '', playsinline: '' });
    v.srcObject = stream;
    v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
    const c = cards.get(who) || { nick: 'друг' };
    area.replaceChildren(v,
      h('div', { class: 'cs-bar' }, h('span', { text: `${c.nick || 'Друг'} показывает экран` }),
        h('button', { class: 'cs-full', type: 'button', 'aria-label': 'На весь экран', title: 'На весь экран', onclick: () => { const el = v; (el.requestFullscreen || el.webkitRequestFullscreen || el.webkitEnterFullscreen || (() => {})).call(el); } }, mi('fullscreen'))));
  }
}

async function startShare() {
  if (!cur || cur.screen) { stopShare(); return; }
  if (!canShare()) { toast('Показывать экран можно с компьютера'); return; }
  let s;
  try { s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 } }, audio: true }); }
  catch { return; } // передумали в окне выбора
  if (!cur) { s.getTracks().forEach((t) => t.stop()); return; }
  cur.screen = s;
  const v = s.getVideoTracks()[0];
  if (v) { v.contentHint = 'detail'; v.addEventListener('ended', stopShare); }
  cur.pcs.forEach((e) => { e.ss = s.getTracks().map((t) => e.pc.addTrack(t, s)); });
  try { await updateDoc(doc(db, 'calls', cur.id), { screen: me() }); } catch { /* ignore */ }
  paint();
  toast('Вы показываете экран');
}
async function stopShare() {
  if (!cur || !cur.screen) return;
  const s = cur.screen; cur.screen = null;
  cur.pcs.forEach((e) => { e.ss.forEach((sn) => { try { e.pc.removeTrack(sn); } catch { /* ignore */ } }); e.ss = []; });
  s.getTracks().forEach((t) => t.stop());
  try { if (cur.data.screen === me()) await updateDoc(doc(db, 'calls', cur.id), { screen: '' }); } catch { /* ignore */ }
  paint();
}

// окно звонка можно перетаскивать за верхнюю полосу (и свёрнутую плашку тоже)
const POS = 'mkw.call.pos';
function placeBox(box, x, y) {
  const w = box.offsetWidth, hgt = box.offsetHeight;
  const nx = Math.max(8, Math.min(window.innerWidth - w - 8, x)), ny = Math.max(8, Math.min(window.innerHeight - hgt - 8, y));
  box.style.left = `${nx}px`; box.style.top = `${ny}px`;
  box.classList.add('placed');
  return [nx, ny];
}
function dragBox(box, handle) {
  let sx = 0, sy = 0, bx = 0, by = 0, moved = false, id = null;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const r = box.getBoundingClientRect();
    sx = e.clientX; sy = e.clientY; bx = r.left; by = r.top; moved = false; id = e.pointerId;
    handle.setPointerCapture(id);
  });
  handle.addEventListener('pointermove', (e) => {
    if (id !== e.pointerId) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!moved && Math.hypot(dx, dy) < 6) return;
    moved = true; box.classList.add('dragging');
    placeBox(box, bx + dx, by + dy);
  });
  const up = (e) => {
    if (id !== e.pointerId) return;
    id = null; box.classList.remove('dragging');
    if (moved) {
      box.dataset.dragged = '1'; setTimeout(() => { delete box.dataset.dragged; }, 50);
      const r = box.getBoundingClientRect();
      try { localStorage.setItem(POS, JSON.stringify({ x: r.left / window.innerWidth, y: r.top / window.innerHeight })); } catch { /* ignore */ }
    }
  };
  handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
  handle.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) box.classList.toggle('mini'); });
  window.addEventListener('resize', () => { if (box.classList.contains('placed')) { const r = box.getBoundingClientRect(); placeBox(box, r.left, r.top); } });
}

function buildUi() {
  const status = h('div', { class: 'call-status', text: 'Звоним…' });
  const tiles = h('div', { class: 'call-tiles' });
  const screen = h('div', { class: 'call-screen', hidden: '' });
  const mute = h('button', { class: 'call-btn', type: 'button', onclick: toggleMute }, mi('mic'), h('span', { text: 'Микрофон' }));
  const share = canShare() ? h('button', { class: 'call-btn share', type: 'button', onclick: startShare }, mi('screen'), h('span', { text: 'Экран' })) : null;
  const add = h('button', { class: 'call-btn', type: 'button', onclick: addPeople }, mi('person-add'), h('span', { text: 'Добавить' }));
  const end = h('button', { class: 'call-btn end', type: 'button', onclick: () => leave() }, mi('call-end'), h('span', { text: 'Завершить' }));
  const min = h('button', { class: 'call-min', type: 'button', 'aria-label': 'Свернуть', title: 'Свернуть', onclick: (e) => { e.stopPropagation(); box.classList.toggle('mini'); } }, h('i'));
  const top = h('div', { class: 'call-top', title: 'Перетащите, чтобы подвинуть окно' }, h('span', { class: 'call-grip' }), h('b', { text: 'Звонок MKW' }), status, min);
  const box = h('div', { class: 'call-ui' }, top, screen, tiles, h('div', { class: 'call-bar' }, mute, share, add, end));
  box.addEventListener('click', (e) => { if (box.dataset.dragged) return; if (box.classList.contains('mini') && !e.target.closest('.call-btn, .call-min')) box.classList.remove('mini'); });
  document.body.appendChild(box);
  dragBox(box, top);
  try {
    const p = JSON.parse(localStorage.getItem(POS) || 'null');
    if (p && window.innerWidth >= 700) requestAnimationFrame(() => placeBox(box, p.x * window.innerWidth, p.y * window.innerHeight));
  } catch { /* ignore */ }
  requestAnimationFrame(() => box.classList.add('show'));
  return { box, status, tiles, screen, mute, share, add, end };
}

// «говорит» — обводка у плитки + таймер
let loop = 0;
function tick() {
  if (!cur) return;
  if (cur.ui && !document.hidden) {
    cur.ui.box.querySelectorAll('.cl-tile').forEach((t) => {
      const uid = t.dataset.uid; const e = cur.pcs.get(uid);
      const lv = uid === me() ? (cur.muted ? 0 : loud(cur.myAn)) : loud(e && e.an);
      t.classList.toggle('talk', lv > 18);
    });
    if ((cur.data.in || []).length > 1) cur.ui.status.textContent = timer();
  }
  loop = requestAnimationFrame(tick);
}

async function toggleMute() {
  if (!cur) return;
  cur.muted = !cur.muted;
  cur.local.getAudioTracks().forEach((t) => { t.enabled = !cur.muted; });
  paint();
  try { await updateDoc(doc(db, 'calls', cur.id), { [`muted.${me()}`]: cur.muted }); } catch { /* ignore */ }
}

async function addPeople() {
  if (!cur) return;
  const members = cur.data.members || [];
  const ids = friendIds().filter((x) => !members.includes(x));
  if (!ids.length) { toast('Больше некого добавить — пригласите друзей в MKW'); return; }
  const list = h('div', { class: 'lb-list' }, h('p', { class: 'profile-note', text: 'Загрузка…' }));
  openSheet(`Добавить в звонок (ещё ${MAX - members.length})`, list);
  const cs = await friendCards(ids.slice(0, 60));
  list.replaceChildren(...cs.map((u) => h('button', { type: 'button', class: 'lb-row fr-pick', onclick: async () => {
    if (!cur) return;
    if ((cur.data.members || []).length >= MAX) { toast('В звонке может быть до 4 человек'); return; }
    try {
      await updateDoc(doc(db, 'calls', cur.id), { members: arrayUnion(u.uid) });
      closeSheet(); toast(`Звоним ${u.nick}…`);
      pushTo(u.uid, 'call', 'Звонок MKW', `${myNick()} зовёт вас в общий звонок`, `call-${cur.id}`, `./#call=${cur.id}`);
    } catch { toast('Не получилось. Админу нужно обновить правила Firestore'); }
  } }, h('span', { class: 'lb-av' }, h('img', { src: avSrc(u.avatar), alt: '' })), h('div', { class: 'lb-body' }, h('div', { class: 'lb-nick' }, h('span', { text: u.nick }))), h('span', { class: 'fr-send' }, mi('add')))));
}

async function getMic() {
  return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
}

// подписки на документ звонка и на адресованные мне сообщения
function attach(id) {
  cur.unsubDoc = onSnapshot(doc(db, 'calls', id), (s) => {
    if (!cur) return;
    if (!s.exists()) { finish('Звонок завершён'); return; }
    const prevIn = (cur.data && cur.data.in) || [];
    cur.data = s.data();
    const inn = cur.data.in || [];
    inn.forEach((x) => cur.ever.add(x));
    if (inn.length > 1 && !cur.t0) cur.t0 = Date.now();
    prevIn.filter((x) => !inn.includes(x) && x !== me()).forEach((x) => { dropPeer(x); nickOf(x).then((c) => toast(`${c.nick} вышел(а) из звонка`)); });
    if (!inn.includes(me()) && cur.joined) { finish('Звонок завершён'); return; }
    // все остальные вышли — звонок закончен
    if (cur.t0 && inn.length <= 1) { leave('Звонок завершён'); return; }
    if (inn.includes(me())) {
      for (const x of (cur.data.members || [])) {
        if (x === me() || offerer(me(), x) !== me() || (cur.data.declined || []).includes(x)) continue;
        const e = cur.pcs.get(x);
        if (inn.includes(x)) {
          // друг взял трубку: если заготовка устарела (больше 25 с) — отправляем свежую
          if (!e) offerTo(x);
          else if (e.pc.signalingState === 'have-local-offer' && Date.now() - e.offeredAt > 25000) offerTo(x, true);
        } else if (!e && cur.data.host === me()) offerTo(x); // ещё звонит — готовим соединение заранее
      }
    }
    (cur.data.declined || []).forEach((x) => { if (!inn.includes(x) && cur.pcs.has(x)) dropPeer(x); });
    // если все, кому звонили, отклонили — завершаем
    const others = (cur.data.members || []).filter((x) => x !== me());
    if (inn.length <= 1 && others.length && others.every((x) => (cur.data.declined || []).includes(x))) { setTimeout(() => leave('Не отвечает'), 1500); }
    paint();
  }, () => finish('Звонок завершён'));
  cur.unsubSig = onSnapshot(query(collection(db, 'calls', id, 'sig'), where('to', '==', me()), limit(60)), (s) => {
    const fresh = [];
    s.docChanges().forEach((ch) => {
      if (ch.type !== 'added') return;
      const m = ch.doc.data();
      if (Date.now() - (m.at || 0) < 120000 && !cur.seen.has(ch.doc.id)) { cur.seen.add(ch.doc.id); fresh.push(m); }
      deleteDoc(ch.doc.ref).catch(() => {});
    });
    // по порядку: сначала старые предложения, потом новые
    fresh.sort((a, b) => (a.at || 0) - (b.at || 0)).forEach((m) => { cur.sigQ = cur.sigQ.then(() => onSig(m)); });
  }, () => { /* ignore */ });
  // «я ещё тут» раз в 20 секунд — по этому видно, что звонок живой
  cur.alive = setInterval(() => { updateDoc(doc(db, 'calls', id), { [`ping.${me()}`]: Date.now() }).catch(() => {}); }, 20000);
}

async function begin(id, data) {
  cur = { id, data, local: null, pcs: new Map(), offering: new Set(), muted: false, t0: 0, seen: new Set(), ever: new Set(data.in || []), joined: false, screen: null, sigQ: Promise.resolve() };
  setInCall(true);
  cur.ui = buildUi();
  iceServers().catch(() => {});
  try { cur.local = await getMic(); }
  catch { finish('Нет доступа к микрофону. Разрешите его в настройках браузера'); return false; }
  if (!cur) return false;
  cur.myAn = levelMeter(cur.local);
  if (player.st.playing) { cur.resume = true; player.pause(); }
  attach(id);
  tick();
  return true;
}

// Позвонить одному другу (или нескольким — до 4 вместе с вами)
export async function startCall(uids) {
  uids = [...new Set(uids)].filter((x) => x && x !== me()).slice(0, MAX - 1);
  if (cur) { toast('Вы уже в звонке'); cur.ui && cur.ui.box.classList.remove('mini'); return; }
  if (!uids.length || !uids.every(isFriend)) { toast('Звонить можно только друзьям'); return; }
  if (!window.RTCPeerConnection || !navigator.mediaDevices) { toast('Этот браузер не умеет звонить'); return; }
  const id = `${me()}_${Date.now().toString(36)}`;
  const data = { host: me(), members: [me(), ...uids], in: [me()], muted: {}, ping: { [me()]: Date.now() }, declined: [], at: Date.now() };
  try { await setDoc(doc(db, 'calls', id), data); }
  catch { toast('Звонок не начался. Админу нужно обновить правила Firestore'); return; }
  // пуш на телефон и компьютер — даже если у друга MKW закрыт
  uids.forEach((u) => pushTo(u, 'call', uids.length > 1 ? 'Общий звонок MKW' : 'Звонок MKW', `${myNick()} звонит вам`, `call-${id}`, `./#call=${id}`));
  if (!(await begin(id, data))) return;
  cur.joined = true;
  paint();
  // никто не взял трубку за 45 секунд — заканчиваем
  cur.noAnswer = setTimeout(() => { if (cur && cur.id === id && (cur.data.in || []).length <= 1) leave('Не отвечает'); }, 45000);
}

async function join(id, data) {
  if (!(await begin(id, data))) return;
  try { await updateDoc(doc(db, 'calls', id), { in: arrayUnion(me()), [`ping.${me()}`]: Date.now() }); cur.joined = true; }
  catch { finish('Не получилось подключиться'); return; }
  paint();
}

export async function leave(reason) {
  if (!cur) return;
  const c = cur, id = c.id, last = (c.data.in || []).filter((x) => x !== me()).length === 0;
  // кто так и не взял трубку — получит «пропущенный звонок»
  if (c.data.host === me()) {
    (c.data.members || []).filter((x) => x !== me() && !c.ever.has(x) && !(c.data.declined || []).includes(x))
      .forEach((x) => pushTo(x, 'missed', 'Пропущенный звонок', `${myNick()} звонил(а) вам в MKW`, `call-${id}`, `./#chat=${me()}`));
  }
  try {
    if (last) await deleteDoc(doc(db, 'calls', id));
    else await updateDoc(doc(db, 'calls', id), { in: arrayRemove(me()), ...(c.data.screen === me() ? { screen: '' } : {}) });
  } catch { /* ignore */ }
  finish(reason || 'Звонок завершён');
}

function finish(text) {
  if (!cur) return;
  const c = cur; cur = null;
  cancelAnimationFrame(loop); clearInterval(c.alive); clearTimeout(c.noAnswer);
  try { c.unsubDoc && c.unsubDoc(); c.unsubSig && c.unsubSig(); } catch { /* ignore */ }
  c.pcs.forEach((e) => { clearTimeout(e.lost); try { e.pc.close(); } catch { /* ignore */ } if (e.audio) e.audio.remove(); });
  if (c.local) c.local.getTracks().forEach((t) => t.stop());
  if (c.screen) c.screen.getTracks().forEach((t) => t.stop());
  if (c.ui) { c.ui.box.classList.remove('show'); setTimeout(() => c.ui.box.remove(), 350); }
  setInCall(false);
  if (text) toast(text);
  if (c.resume) player.toggle();
}

// ---------- входящие звонки ----------
let unsubIn = null, ringing = null;
export function watchCalls(onRing) {
  if (unsubIn || !me()) return;
  try {
    unsubIn = onSnapshot(query(collection(db, 'calls'), where('members', 'array-contains', me()), limit(20)), (s) => {
      s.docs.forEach((d) => {
        const c = d.data();
        if (cur && cur.id === d.id) return;
        if ((c.in || []).includes(me()) || (c.declined || []).includes(me())) return;
        const last = Math.max(Number(c.at) || 0, ...Object.values(c.ping || {}).map(Number));
        if (last < Date.now() - 60000) { if (last < Date.now() - 600000) deleteDoc(d.ref).catch(() => {}); return; } // старый «повисший» звонок убираем
        if (!(c.in || []).length) return;
        // звонок только от друзей (или от друга в общем звонке)
        if (!isFriend(c.host) && !(c.in || []).some((x) => x !== me() && isFriend(x))) return;
        if (cur) { decline(d.id); return; } // уже в другом звонке — «занято»
        if (ringing && ringing.id === d.id) return;
        ring(d.id, c, onRing);
      });
      if (ringing && !s.docs.some((d) => d.id === ringing.id)) stopRing('Звонок завершён');
    }, () => { /* старые правила */ });
  } catch { /* ignore */ }
}
export function stopCalls() { if (unsubIn) { unsubIn(); unsubIn = null; } stopRing(); if (cur) leave(); }

// мелодия звонка без файлов: два коротких гудка каждые 2 секунды
let ringTimer = 0;
function ringtone(on) {
  clearInterval(ringTimer);
  if (!on) return;
  const beep = () => {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume().catch(() => {});
      [0, 0.28].forEach((dt) => { const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = 660; g.gain.setValueAtTime(0.0001, actx.currentTime + dt); g.gain.exponentialRampToValueAtTime(0.18, actx.currentTime + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dt + 0.22); o.connect(g).connect(actx.destination); o.start(actx.currentTime + dt); o.stop(actx.currentTime + dt + 0.25); });
    } catch { /* ignore */ }
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  };
  beep(); ringTimer = setInterval(beep, 2000);
}

async function ring(id, c, onRing) {
  stopRing();
  ringing = { id, box: null, t: 0 }; // сразу, чтобы не позвонить дважды
  iceServers().catch(() => {});
  const host = await nickOf(c.host);
  if (!ringing || ringing.id !== id) return;
  const many = (c.members || []).length > 2;
  const box = h('div', { class: 'call-in' },
    h('span', { class: 'ci-av' }, h('img', { src: avSrc(host.avatar), alt: '' })),
    h('div', { class: 'ci-txt' }, h('b', { text: host.nick || 'Друг' }), h('small', { text: many ? `Общий звонок · ${(c.members || []).length} человек` : 'Входящий звонок MKW' })),
    h('button', { class: 'ci-btn no', type: 'button', 'aria-label': 'Отклонить', onclick: () => decline(id) }, mi('call-end')),
    h('button', { class: 'ci-btn yes', type: 'button', 'aria-label': 'Принять', onclick: () => { stopRing(); join(id, c); } }, mi('phone')));
  document.body.appendChild(box);
  requestAnimationFrame(() => box.classList.add('show'));
  ringing.box = box;
  ringing.t = setTimeout(() => stopRing(), 45000);
  ringtone(true);
  if (onRing) onRing(host.nick || 'Друг', many, id);
}
function stopRing(text) {
  ringtone(false);
  if (!ringing) return;
  clearTimeout(ringing.t);
  const b = ringing.box;
  if (b) { b.classList.remove('show'); setTimeout(() => b.remove(), 350); }
  ringing = null;
  if (text) toast(text);
}
async function decline(id) {
  stopRing();
  try { await updateDoc(doc(db, 'calls', id), { declined: arrayUnion(me()) }); } catch { /* ignore */ }
}

// закрыли вкладку посреди звонка — выходим, чтобы у других не висело
window.addEventListener('pagehide', () => { if (cur) leave(); });

// Выбрать, кому звонить (до 3 друзей — вместе с вами 4 человека)
export async function pickAndCall() {
  if (cur) { cur.ui && cur.ui.box.classList.remove('mini'); return; }
  warmCalls();
  const ids = friendIds();
  if (!ids.length) { toast('Звонить можно друзьям. Добавьте их в Профиль → Друзья'); return; }
  const chosen = new Set();
  const go = h('button', { class: 'btn btn-primary call-go', type: 'button', disabled: '' }, mi('phone'), h('span', { text: 'Позвонить' }));
  const list = h('div', { class: 'lb-list call-pick' }, h('p', { class: 'profile-note', text: 'Загрузка…' }));
  const note = h('p', { class: 'profile-note', text: 'Выберите до 3 друзей — в звонке будет до 4 человек.' });
  go.addEventListener('click', () => { const u = [...chosen]; closeSheet(); startCall(u); });
  openSheet('Звонок друзьям', h('div', {}, note, list, go));
  const cs = await friendCards(ids.slice(0, 60));
  const online = (u) => Date.now() - (Number(u.seen) || 0) < 210000;
  list.replaceChildren(...cs.map((u) => {
    const b = h('button', { type: 'button', class: 'lb-row fr-pick', 'aria-pressed': 'false' },
      h('span', { class: 'lb-av' }, h('img', { src: avSrc(u.avatar), alt: '' }), online(u) ? h('i', { class: 'online-dot' }) : null),
      h('div', { class: 'lb-body' }, h('div', { class: 'lb-nick' }, h('span', { text: u.nick || 'друг' })), h('small', { class: 'lb-sub', text: online(u) ? 'в сети' : 'не в сети' })),
      h('span', { class: 'call-check' }, mi('check')));
    b.addEventListener('click', () => {
      if (chosen.has(u.uid)) chosen.delete(u.uid);
      else if (chosen.size >= MAX - 1) { toast('Можно выбрать до 3 друзей'); return; }
      else chosen.add(u.uid);
      b.setAttribute('aria-pressed', String(chosen.has(u.uid)));
      go.disabled = !chosen.size;
      go.querySelector('span').textContent = chosen.size > 1 ? `Позвонить (${chosen.size + 1} чел.)` : 'Позвонить';
    });
    return b;
  }));
}
