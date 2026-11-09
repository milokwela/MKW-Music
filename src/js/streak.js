// MKW Огонёк: общайтесь с другом каждый день — и огонёк растёт.
// Огонёк заводится кнопкой «Завести MKW огонёк» в чате. День засчитывается, когда за день написали ОБА.
// Хранится в документе чата в поле read (там можно хранить любые ключи — правила базы менять не нужно):
//   read.g_<uid> — последний день, когда этот человек писал;  read.gs — день, когда завели огонёк;
//   read.gx — огонёк потушен вручную (день);  read.gl — сколько дней было у погасшего огонька; read.gld — день, когда погас.
// (0.30: старые огоньки на ключах f_/fs сброшены у всех — заводятся заново кнопкой)
import { db } from './firebase.js';
import { doc, setDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { h, toast, openSheet, closeSheet } from './ui.js';
import { srvNow } from './clock.js';

// День огонька — общий для всех, по московскому времени и по часам сервера.
// Раньше считали по часам и поясу каждого телефона: у друзей в разных часовых поясах «сегодня» не совпадало,
// и огонёк оставался серым, хотя вы переписывались весь день.
export const today = () => Math.floor((srvNow() + 3 * 3600000) / 864e5);
const FIRE = '<path d="M12 2c.6 3.2-1 5-2.4 6.6C8.2 10.2 7 11.7 7 14a5 5 0 0 0 10 0c0-1.3-.4-2.4-1-3.4-.3 1.2-1 2-2 2.4.6-2.6-.3-5.2-2-7.4.1 1.7-.4 2.9-1.3 3.8C11 7.6 12.4 5 12 2zm0 20a8 8 0 0 1-8-8c0-3.7 2.2-6 3.7-7.6C9.4 4.6 10.6 3.3 10 0c5.3 2.3 7.3 6 7.6 8.3.5-.6.8-1.4.9-2.3C20.6 8 22 10.9 22 14a10 10 0 0 1-10 8z" fill="currentColor" transform="translate(0 1) scale(.92)"/>';
export const LEVELS = [
  { from: 1, l: 1, name: 'Искра', hint: '1–2 дня' },
  { from: 3, l: 2, name: 'Пламя', hint: '3–6 дней' },
  { from: 7, l: 3, name: 'Жар', hint: 'неделя' },
  { from: 14, l: 4, name: 'Пожар', hint: '2 недели' },
  { from: 21, l: 5, name: 'Синий огонь', hint: '3 недели' },
  { from: 30, l: 6, name: 'Чёрное пламя', hint: 'месяц и больше' },
];
const levelOf = (n) => [...LEVELS].reverse().find((x) => n >= x.from) || LEVELS[0];

// состояние огонька по документу чата
export function streakOf(chat, me, other) {
  const r = (chat && chat.read) || {};
  const t = today();
  const a = Number(r[`g_${me}`]) || 0, b = Number(r[`g_${other}`]) || 0;
  const fs = Number(r.gs) || 0;
  const both = Math.min(a, b);
  if (!fs || (r.gx && Number(r.gx) >= fs)) return { state: 'none', lost: Number(r.gl) || 0, lostDay: Number(r.gld) || 0 };
  // оба писали вчера или сегодня — огонёк жив
  const alive = both >= t - 1 || (fs >= t - 1 && Math.max(a, b) >= t - 1);
  if (!alive) return { state: 'lost', n: Math.max(0, both - fs + 1), lostDay: Math.max(both, fs) + 1, lost: Math.max(0, both - fs + 1) };
  const n = both >= fs ? both - fs + 1 : 0;
  const todayDone = a >= t && b >= t;
  return { state: todayDone ? 'lit' : 'grey', n, mineToday: a >= t, theirToday: b >= t, level: levelOf(Math.max(1, n)) };
}

// огонёк группы: день засчитывается, когда за день написала хотя бы половина участников (не меньше двух).
// read.gd — последний засчитанный день, read.gs — день, когда огонёк завели.
export const groupNeed = (n) => Math.max(2, Math.ceil(n / 2));
export function groupStreak(chat, me) {
  const r = (chat && chat.read) || {};
  const t = today();
  const fs = Number(r.gs) || 0, gd = Number(r.gd) || 0;
  if (!fs || (r.gx && Number(r.gx) >= fs)) return { state: 'none', lost: Number(r.gl) || 0, group: true };
  const alive = gd >= t - 1 || fs >= t - 1;
  const n = gd >= fs ? gd - fs + 1 : 0;
  if (!alive) return { state: 'lost', n, lost: n, group: true };
  const members = (chat.members || []);
  const wrote = members.filter((u) => (Number(r[`g_${u}`]) || 0) >= t).length;
  return { state: gd >= t ? 'lit' : 'grey', n, mineToday: (Number(r[`g_${me}`]) || 0) >= t, wrote, need: groupNeed(members.length), level: levelOf(Math.max(1, n)), group: true };
}
export const streakAny = (chat, me, other) => (chat && chat.group ? groupStreak(chat, me) : streakOf(chat, me, other));
// при отправке в группу: отмечаем себя и, если набралась половина, засчитываем день
export function groupPatch(chat, me) {
  const t = today();
  const r = (chat && chat.read) || {};
  const patch = { [`g_${me}`]: t };
  const fs = Number(r.gs) || 0, gd = Number(r.gd) || 0;
  if (fs && !(r.gx && Number(r.gx) >= fs) && (gd >= t - 1 || fs >= t - 1) && gd < t) {
    const members = (chat.members || []);
    const wrote = members.filter((u) => u === me || (Number(r[`g_${u}`]) || 0) >= t).length;
    if (wrote >= groupNeed(members.length)) patch.gd = t;
  }
  return patch;
}

export function fireIcon(st, big) {
  const el = h('span', { class: `fire${st.state === 'grey' ? ' grey' : st.state === 'lost' ? ' lost' : ` l${(st.level || LEVELS[0]).l}`}${big ? ' big' : ''}`, title: 'MKW Огонёк' });
  el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${FIRE}</svg>`;
  if (!big && st.n) el.appendChild(document.createTextNode(String(st.n)));
  return el;
}

// при отправке сообщения: только отмечаем свой день (огонёк сам не заводится — для этого кнопка)
export function streakPatch(chat, me) {
  return { [`g_${me}`]: today() };
}

// завести огонёк (или завести заново после того, как погас)
export async function startStreak(cid, me, group) {
  const t = today();
  if (group) await setDoc(doc(db, 'chats', cid), { read: { gs: t, gx: 0, gd: 0, [`g_${me}`]: t } }, { merge: true });
  else await setDoc(doc(db, 'chats', cid), { members: cid.split('_'), read: { gs: t, gx: 0, [`g_${me}`]: t } }, { merge: true });
}

// восстановить погасший огонёк: 3 раза в месяц
const RKEY = () => `mkw.fire.restore.${new Date().toISOString().slice(0, 7)}`;
export const restoresLeft = () => { try { return Math.max(0, 3 - Number(localStorage.getItem(RKEY()) || 0)); } catch { return 0; } };
async function restore(cid, chat, me, other) {
  if (restoresLeft() <= 0) { toast('В этом месяце восстановления закончились'); return false; }
  const r = chat.read || {};
  const y = today() - 1;
  // день разрыва считаем пройденным: оба «написали» вчера, начало огонька сохраняется
  const fs = Number(r.gs) || y;
  if (chat.group) {
    await setDoc(doc(db, 'chats', cid), { read: { gd: Math.max(Number(r.gd) || 0, y), gs: Math.min(fs, y), gx: 0 } }, { merge: true });
    try { localStorage.setItem(RKEY(), String(3 - restoresLeft() + 1)); } catch { /* ignore */ }
    toast('Огонёк группы восстановлен! Напишите сегодня');
    return true;
  }
  await setDoc(doc(db, 'chats', cid), { read: { [`g_${me}`]: Math.max(Number(r[`g_${me}`]) || 0, y), [`g_${other}`]: Math.max(Number(r[`g_${other}`]) || 0, y), gs: Math.min(fs, y), gx: 0 } }, { merge: true });
  try { localStorage.setItem(RKEY(), String(3 - restoresLeft() + 1)); } catch { /* ignore */ }
  toast('Огонёк восстановлен! Напишите друг другу сегодня');
  return true;
}
async function stop(cid, n) {
  await setDoc(doc(db, 'chats', cid), { read: { gx: today(), gl: n || 0, gld: today() } }, { merge: true });
  toast('Огонёк потушен. Завести новый можно кнопкой в чате');
}

export function openStreak(cid, chat, me, other, nick) {
  const st = streakAny(chat, me, other);
  const grp = Boolean(chat && chat.group);
  const lvl = st.level || LEVELS[0];
  const head = st.state === 'none' ? 'Огонька пока нет'
    : st.state === 'lost' ? 'Огонёк погас'
    : st.state === 'grey' ? (grp ? `Сегодня написали ${st.wrote} из ${st.need} нужных` : st.mineToday ? `Ждём ответ от ${nick}` : 'Огонёк гаснет — напишите сегодня')
    : 'Сегодня огонёк горит';
  const sub = st.state === 'none' ? `Заведите огонёк с ${nick} и общайтесь каждый день — он будет расти и менять цвет`
    : st.state === 'lost' ? `Было дней: ${st.lost || st.n || 0}. Можно восстановить (осталось ${restoresLeft()} из 3 в этом месяце) или завести заново`
    : `${lvl.name} · дней подряд: ${st.n}. ${grp ? 'День засчитывается, когда за день пишет хотя бы половина группы' : 'День засчитывается, когда пишете оба'}`;
  const btns = [];
  if (st.state === 'none' || st.state === 'lost') btns.push(h('button', { class: 'btn', type: 'button', onclick: async () => { await startStreak(cid, me, grp); closeSheet(); } }, st.state === 'lost' ? 'Завести заново' : 'Завести MKW огонёк'));
  if (st.state === 'lost' && (st.lost || st.n)) btns.push(h('button', { class: 'btn', type: 'button', onclick: async () => { if (await restore(cid, chat, me, other)) closeSheet(); } }, `Восстановить (${restoresLeft()} из 3)`));
  if (st.state === 'lit' || st.state === 'grey') btns.push(h('button', { class: 'btn tonal', type: 'button', onclick: async () => { if (!confirmStop.dataset.ok) { confirmStop.dataset.ok = '1'; confirmStop.textContent = 'Точно потушить? Нажмите ещё раз'; return; } await stop(cid, st.n); closeSheet(); } }, 'Потушить огонёк'));
  const confirmStop = btns[btns.length - 1] || h('i');
  const big = fireIcon(st.state === 'none' ? { state: 'grey' } : st, true);
  openSheet('MKW Огонёк', h('div', { class: 'fs-sheet' },
    h('div', { class: 'fs-big', style: `--fc:${getComputedStyle(document.body).getPropertyValue('--primary')}` }, big, st.n ? h('b', { text: String(st.n) }) : null, h('div', { text: head, style: 'font-weight:800' }), h('small', { text: sub })),
    h('div', { class: 'fs-lvls' }, ...LEVELS.map((x) => h('div', { class: `fs-lvl${st.n >= x.from && (st.level || {}).l === x.l ? ' on' : ''}` }, fireIcon({ state: 'lit', level: x }, true), h('span', { text: x.name }), h('small', { text: `с ${x.from} ${x.from === 1 ? 'дня' : 'дней'}` })))),
    h('div', { class: 'fs-btns' }, ...btns)));
}

// напоминание: огонёк серый (вы сегодня ещё не писали), один раз в день на чат
export function greyReminders(list, me, otherOf, nickOf, notify) {
  const t = today();
  for (const c of list) {
    const o = otherOf(c); if (!o || c.group) continue;
    const st = streakOf(c, me, o);
    if (st.state !== 'grey' || st.mineToday || st.n < 1) continue;
    const k = `mkw.fire.grey.${c.id}`;
    if (new Date().getHours() < 12) continue; // напоминаем во второй половине дня
    try { if (localStorage.getItem(k) === String(t)) continue; localStorage.setItem(k, String(t)); } catch { continue; }
    nickOf(o).then((nick) => notify(`Огонёк с ${nick} гаснет`, `Напишите ${nick} сегодня, чтобы сохранить ${st.n} ${st.n === 1 ? 'день' : 'дней'}`, `fire-${c.id}`));
  }
}

// анимация: огонёк зажёгся / стал ярче. Видят оба — каждый у себя, когда открывает чат (один раз на событие)
export function fireEventKey(st, chat) {
  if (!st || (st.state !== 'lit' && st.state !== 'grey')) return '';
  const gs = Number(((chat && chat.read) || {}).gs) || 0;
  return `${gs}:${st.state === 'lit' ? (st.level || LEVELS[0]).l : 0}`;
}
export function playFire(host, cid, st, chat, nick) {
  const key = fireEventKey(st, chat); if (!key || !host) return;
  const k = `mkw.fire.anim.${cid}`;
  try { if (localStorage.getItem(k) === key) return; localStorage.setItem(k, key); } catch { return; }
  const lit = st.state === 'lit';
  const lvl = st.level || LEVELS[0];
  const first = !lit || (lvl.l === 1 && st.n <= 1);
  const title = !lit ? 'MKW огонёк заведён!' : first ? 'Огонёк зажёгся!' : `Новый уровень: ${lvl.name}`;
  const sub = !lit ? `Напишите друг другу сегодня — и он загорится` : first ? `Вы с ${nick} общались весь день` : `${st.n} ${st.n % 10 === 1 && st.n % 100 !== 11 ? 'день' : st.n % 10 >= 2 && st.n % 10 <= 4 && (st.n % 100 < 10 || st.n % 100 >= 20) ? 'дня' : 'дней'} подряд с ${nick}`;
  const ic = fireIcon(lit ? st : { state: 'lit', level: LEVELS[0] }, true);
  const box = h('div', { class: `fire-pop l${lit ? lvl.l : 1}${lit ? '' : ' start'}`, role: 'status' },
    h('div', { class: 'fp-glow' }), h('div', { class: 'fp-sparks' }, ...Array.from({ length: 12 }, (_, i) => h('i', { style: `--a:${i * 30}deg;--d:${(i % 3) * 0.06}s` }))),
    h('div', { class: 'fp-ic' }, ic), h('b', { text: title }), h('small', { text: sub }));
  host.appendChild(box);
  const end = () => { box.classList.add('out'); setTimeout(() => box.remove(), 500); };
  box.addEventListener('click', end);
  setTimeout(end, 2600);
}
