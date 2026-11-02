// Голосовые звонки друзьям — до 4 человек. Звук идёт напрямую между телефонами (WebRTC),
// а «договариваются» они через Firestore:
//   calls/{id}           — { host, members: [до 4 uid], in: [кто сейчас в звонке], muted: {uid: true}, ping: {uid: время}, declined: [uid], at }
//   calls/{id}/sig/{sid} — { from, to, kind: 'offer' | 'answer', sdp, at } — описание соединения для конкретного человека
// Каждый с каждым соединяется напрямую (при 4 людях — 6 соединений, для голоса это немного).
import { db } from './firebase.js?v=0.26.0';
import { doc, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where, limit, onSnapshot, arrayUnion, arrayRemove } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { h, toast, openSheet, closeSheet } from './ui.js?v=0.26.0';
import { mi } from './icons2.js?v=0.26.0';
import { me, isFriend, friendIds, friendCards, cardOf } from './friends.js?v=0.26.0';
import { avSrc } from './avatar.js?v=0.26.0';
import { RECOGNIZE_URL } from './shazam-config.js?v=0.26.0';
import * as player from './player.js?v=0.26.0';

const MAX = 4;
let ice = null;
async function iceServers() {
  if (ice) return ice;
  ice = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
  const w = String(RECOGNIZE_URL || '').replace(/\/$/, '');
  if (w) {
    try {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), 5000);
      const r = await fetch(`${w}/turn`, { signal: c.signal }); clearTimeout(t);
      if (r.ok) { const j = await r.json(); if (Array.isArray(j.iceServers) && j.iceServers.length) ice = j.iceServers; }
    } catch { /* только STUN */ }
  }
  return ice;
}

// ---------- состояние текущего звонка ----------
let cur = null; // { id, data, local, pcs: Map(uid → { pc, audio, an }), unsubDoc, unsubSig, muted, t0, ui }
export const inCall = () => Boolean(cur);

function setInCall(v) { document.documentElement.classList.toggle('in-call', v); }

// ждём, пока соберутся все варианты маршрута (без лишних записей в базу), но не дольше 3 секунд
function gathered(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((res) => {
    const t = setTimeout(res, 3000);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
  });
}

async function peer(uid) {
  if (cur.pcs.has(uid)) return cur.pcs.get(uid).pc;
  const pc = new RTCPeerConnection({ iceServers: await iceServers() });
  const entry = { pc, audio: null, an: null };
  cur.pcs.set(uid, entry);
  cur.local.getTracks().forEach((t) => pc.addTrack(t, cur.local));
  pc.ontrack = (e) => {
    if (!entry.audio) { entry.audio = h('audio', { autoplay: '', playsinline: '' }); document.body.appendChild(entry.audio); }
    entry.audio.srcObject = e.streams[0];
    entry.audio.play().catch(() => {});
    entry.an = levelMeter(e.streams[0]);
    paint();
  };
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') { toast('Связь с одним из участников пропала'); dropPeer(uid); } paint(); };
  return pc;
}
function dropPeer(uid) {
  const e = cur && cur.pcs.get(uid); if (!e) return;
  try { e.pc.close(); } catch { /* ignore */ }
  if (e.audio) { e.audio.srcObject = null; e.audio.remove(); }
  cur.pcs.delete(uid);
}

async function sendSig(to, kind, sdp) {
  await addDoc(collection(db, 'calls', cur.id, 'sig'), { from: me(), to, kind, sdp, at: Date.now() });
}
async function offerTo(uid) {
  if (cur.offering.has(uid)) return;
  cur.offering.add(uid);
  try { await offerNow(uid); } finally { if (cur) cur.offering.delete(uid); }
}
async function offerNow(uid) {
  const pc = await peer(uid);
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  await sendSig(uid, 'offer', pc.localDescription.sdp);
}
async function onSig(m) {
  if (!cur || m.to !== me()) return;
  try {
    if (m.kind === 'offer') {
      if (cur.pcs.has(m.from)) dropPeer(m.from);
      const pc = await peer(m.from);
      await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc);
      await sendSig(m.from, 'answer', pc.localDescription.sdp);
    } else if (m.kind === 'answer') {
      const e = cur.pcs.get(m.from);
      if (e && e.pc.signalingState === 'have-local-offer') await e.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
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
  cur.ui.status.textContent = waiting ? (others.some((x) => (d.declined || []).includes(x)) && others.every((x) => (d.declined || []).includes(x)) ? 'Не отвечает' : 'Звоним…') : timer();
  cur.ui.tiles.replaceChildren(...[me(), ...others].map((uid) => {
    const c = cards.get(uid) || { nick: '…' };
    const here = inn.includes(uid);
    const t = h('div', { class: `cl-tile${here ? ' here' : ''}${(d.muted || {})[uid] ? ' muted' : ''}`, 'data-uid': uid },
      h('span', { class: 'cl-tav' }, h('img', { src: avSrc(c.avatar), alt: '' })),
      h('b', { text: uid === me() ? 'Вы' : c.nick || 'друг' }),
      h('small', { text: (d.muted || {})[uid] ? 'микрофон выключен' : here ? (uid === me() || (cur.pcs.get(uid) && cur.pcs.get(uid).pc.connectionState === 'connected') ? 'в звонке' : 'подключается…') : (d.declined || []).includes(uid) ? 'отклонил(а)' : 'звоним…' }));
    if (!cards.has(uid)) nickOf(uid).then(paint);
    return t;
  }));
  cur.ui.mute.classList.toggle('off', cur.muted);
  cur.ui.mute.replaceChildren(mi(cur.muted ? 'mic-off' : 'mic'), h('span', { text: cur.muted ? 'Включить' : 'Микрофон' }));
  cur.ui.add.hidden = members.length >= MAX;
}
const timer = () => { const s = Math.floor((Date.now() - (cur.t0 || Date.now())) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function buildUi() {
  const status = h('div', { class: 'call-status', text: 'Звоним…' });
  const tiles = h('div', { class: 'call-tiles' });
  const mute = h('button', { class: 'call-btn', type: 'button', onclick: toggleMute }, mi('mic'), h('span', { text: 'Микрофон' }));
  const add = h('button', { class: 'call-btn', type: 'button', onclick: addPeople }, mi('person-add'), h('span', { text: 'Добавить' }));
  const end = h('button', { class: 'call-btn end', type: 'button', onclick: () => leave() }, mi('call-end'), h('span', { text: 'Завершить' }));
  const min = h('button', { class: 'call-min', type: 'button', 'aria-label': 'Свернуть', onclick: (e) => { e.stopPropagation(); box.classList.toggle('mini'); } }, h('i'));
  const box = h('div', { class: 'call-ui' },
    h('div', { class: 'call-top' }, h('b', { text: 'Звонок MKW' }), status, min),
    tiles,
    h('div', { class: 'call-bar' }, mute, add, end));
  box.addEventListener('click', (e) => { if (box.classList.contains('mini') && !e.target.closest('.call-btn')) box.classList.remove('mini'); });
  document.body.appendChild(box);
  requestAnimationFrame(() => box.classList.add('show'));
  return { box, status, tiles, mute, add, end };
}

// «говорит» — обводка у плитки + таймер
let loop = 0;
function tick() {
  if (!cur) return;
  if (cur.ui) {
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
    if ((cur.data.members || []).length >= MAX) { toast('В звонке может быть до 4 человек'); return; }
    try { await updateDoc(doc(db, 'calls', cur.id), { members: arrayUnion(u.uid) }); closeSheet(); toast(`Звоним ${u.nick}…`); }
    catch { toast('Не получилось. Админу нужно обновить правила Firestore'); }
  } }, h('span', { class: 'lb-av' }, h('img', { src: avSrc(u.avatar), alt: '' })), h('div', { class: 'lb-body' }, h('div', { class: 'lb-nick' }, h('span', { text: u.nick }))), h('span', { class: 'fr-send' }, mi('add')))));
}

async function getMic() {
  return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
}

// подписки на документ звонка и на адресованные мне сообщения
function attach(id) {
  cur.unsubDoc = onSnapshot(doc(db, 'calls', id), (s) => {
    if (!s.exists()) { finish('Звонок завершён'); return; }
    const prevIn = (cur.data && cur.data.in) || [];
    cur.data = s.data();
    const inn = cur.data.in || [];
    if (inn.length > 1 && !cur.t0) cur.t0 = Date.now();
    prevIn.filter((x) => !inn.includes(x) && x !== me()).forEach((x) => { dropPeer(x); nickOf(x).then((c) => toast(`${c.nick} вышел(а) из звонка`)); });
    if (!inn.includes(me()) && cur.joined) { finish('Звонок завершён'); return; }
    // все остальные вышли — звонок закончен
    if (cur.t0 && inn.length <= 1) { leave('Звонок завершён'); return; }
    // каждая пара соединяется один раз: первым звонит тот, у кого uid «меньше» по алфавиту
    if (inn.includes(me())) inn.filter((x) => x !== me() && x > me() && !cur.pcs.has(x)).forEach((x) => offerTo(x).catch((e) => console.warn('offer', e)));
    // если все, кому звонили, отклонили — завершаем
    const others = (cur.data.members || []).filter((x) => x !== me());
    if (inn.length <= 1 && others.length && others.every((x) => (cur.data.declined || []).includes(x))) { setTimeout(() => leave('Не отвечает'), 1500); }
    paint();
  }, () => finish('Звонок завершён'));
  cur.unsubSig = onSnapshot(query(collection(db, 'calls', id, 'sig'), where('to', '==', me()), limit(50)), (s) => {
    s.docChanges().forEach((ch) => { if (ch.type === 'added') { const m = ch.doc.data(); if (Date.now() - (m.at || 0) < 120000 && !cur.seen.has(ch.doc.id)) { cur.seen.add(ch.doc.id); onSig(m); } deleteDoc(ch.doc.ref).catch(() => {}); } });
  }, () => { /* ignore */ });
  // «я ещё тут» раз в 20 секунд — по этому видно, что звонок живой
  cur.alive = setInterval(() => { updateDoc(doc(db, 'calls', id), { [`ping.${me()}`]: Date.now() }).catch(() => {}); }, 20000);
}

async function begin(id, data) {
  cur = { id, data, local: null, pcs: new Map(), offering: new Set(), muted: false, t0: 0, seen: new Set(), joined: false };
  setInCall(true);
  cur.ui = buildUi();
  try { cur.local = await getMic(); }
  catch { finish('Нет доступа к микрофону. Разрешите его в настройках браузера'); return false; }
  cur.myAn = levelMeter(cur.local);
  if (player.st.playing) { cur.resume = true; player.pause(); }
  attach(id);
  tick();
  return true;
}

// Позвонить одному другу (или нескольким — до 4 вместе с вами)
export async function startCall(uids) {
  uids = [...new Set(uids)].filter((x) => x && x !== me()).slice(0, MAX - 1);
  if (cur) { toast('Вы уже в звонке'); return; }
  if (!uids.length || !uids.every(isFriend)) { toast('Звонить можно только друзьям'); return; }
  if (!window.RTCPeerConnection || !navigator.mediaDevices) { toast('Этот браузер не умеет звонить'); return; }
  const id = `${me()}_${Date.now().toString(36)}`;
  const data = { host: me(), members: [me(), ...uids], in: [me()], muted: {}, ping: { [me()]: Date.now() }, declined: [], at: Date.now() };
  try { await setDoc(doc(db, 'calls', id), data); }
  catch { toast('Звонок не начался. Админу нужно обновить правила Firestore'); return; }
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
  const id = cur.id, last = (cur.data.in || []).filter((x) => x !== me()).length === 0;
  try {
    if (last) await deleteDoc(doc(db, 'calls', id));
    else await updateDoc(doc(db, 'calls', id), { in: arrayRemove(me()) });
  } catch { /* ignore */ }
  finish(reason || 'Звонок завершён');
}

function finish(text) {
  if (!cur) return;
  const c = cur; cur = null;
  cancelAnimationFrame(loop); clearInterval(c.alive); clearTimeout(c.noAnswer);
  try { c.unsubDoc && c.unsubDoc(); c.unsubSig && c.unsubSig(); } catch { /* ignore */ }
  c.pcs.forEach((e) => { try { e.pc.close(); } catch { /* ignore */ } if (e.audio) e.audio.remove(); });
  if (c.local) c.local.getTracks().forEach((t) => t.stop());
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
        const fresh = Math.max(Number(c.at) || 0, ...Object.values(c.ping || {}).map(Number)) > Date.now() - 60000;
        if (!fresh) { if (Math.max(Number(c.at) || 0, ...Object.values(c.ping || {}).map(Number)) < Date.now() - 600000) deleteDoc(d.ref).catch(() => {}); return; } // старый «повисший» звонок убираем
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
      [0, 0.28].forEach((dt) => { const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = 660; g.gain.setValueAtTime(0.0001, actx.currentTime + dt); g.gain.exponentialRampToValueAtTime(0.18, actx.currentTime + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dt + 0.22); o.connect(g).connect(actx.destination); o.start(actx.currentTime + dt); o.stop(actx.currentTime + dt + 0.25); });
    } catch { /* ignore */ }
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  };
  beep(); ringTimer = setInterval(beep, 2000);
}

async function ring(id, c, onRing) {
  stopRing();
  const host = await nickOf(c.host);
  const many = (c.members || []).length > 2;
  const box = h('div', { class: 'call-in' },
    h('span', { class: 'ci-av' }, h('img', { src: avSrc(host.avatar), alt: '' })),
    h('div', { class: 'ci-txt' }, h('b', { text: host.nick || 'Друг' }), h('small', { text: many ? `Общий звонок · ${(c.members || []).length} человек` : 'Входящий звонок MKW' })),
    h('button', { class: 'ci-btn no', type: 'button', 'aria-label': 'Отклонить', onclick: () => decline(id) }, mi('call-end')),
    h('button', { class: 'ci-btn yes', type: 'button', 'aria-label': 'Принять', onclick: () => { stopRing(); join(id, c); } }, mi('phone')));
  document.body.appendChild(box);
  requestAnimationFrame(() => box.classList.add('show'));
  ringing = { id, box, t: setTimeout(() => stopRing(), 45000) };
  ringtone(true);
  if (onRing) onRing(host.nick || 'Друг', many);
}
function stopRing(text) {
  ringtone(false);
  if (!ringing) return;
  clearTimeout(ringing.t);
  const b = ringing.box; b.classList.remove('show'); setTimeout(() => b.remove(), 350);
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
