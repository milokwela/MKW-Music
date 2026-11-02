// MKW Огонёк: общайтесь с другом каждый день — и огонёк растёт.
// Огонёк начинается, как только вы написали другу. День засчитывается, когда за день написали ОБА.
// Хранится в документе чата в поле read (там можно хранить любые ключи — правила базы менять не нужно):
//   read.f_<uid> — последний день, когда этот человек писал;  read.fs — день начала огонька;
//   read.fx — огонёк потушен вручную (день);  read.fl — сколько дней было у погасшего огонька; read.fld — день, когда погас.
import { db } from './firebase.js?v=0.29.1';
import { doc, setDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { h, toast, openSheet, closeSheet } from './ui.js?v=0.29.1';

export const today = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 864e5);
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
  const a = Number(r[`f_${me}`]) || 0, b = Number(r[`f_${other}`]) || 0;
  const fs = Number(r.fs) || 0;
  const both = Math.min(a, b);
  if (!fs || (r.fx && Number(r.fx) >= fs)) return { state: 'none', lost: Number(r.fl) || 0, lostDay: Number(r.fld) || 0 };
  // оба писали вчера или сегодня — огонёк жив
  const alive = both >= t - 1 || (fs >= t - 1 && Math.max(a, b) >= t - 1);
  if (!alive) return { state: 'lost', n: Math.max(0, both - fs + 1), lostDay: Math.max(both, fs) + 1, lost: Math.max(0, both - fs + 1) };
  const n = both >= fs ? both - fs + 1 : 0;
  const todayDone = a >= t && b >= t;
  return { state: todayDone ? 'lit' : 'grey', n, mineToday: a >= t, theirToday: b >= t, level: levelOf(Math.max(1, n)) };
}

export function fireIcon(st, big) {
  const el = h('span', { class: `fire${st.state === 'grey' ? ' grey' : st.state === 'lost' ? ' lost' : ` l${(st.level || LEVELS[0]).l}`}${big ? ' big' : ''}`, title: 'MKW Огонёк' });
  el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${FIRE}</svg>`;
  if (!big && st.n) el.appendChild(document.createTextNode(String(st.n)));
  return el;
}

// при отправке сообщения: отмечаем свой день, при необходимости зажигаем новый огонёк
export function streakPatch(chat, me, other) {
  const st = streakOf(chat, me, other);
  const t = today();
  const patch = { [`f_${me}`]: t };
  if (st.state === 'none' || st.state === 'lost') {
    patch.fs = t; patch.fx = 0;
    if (st.state === 'lost' && st.lost) { patch.fl = st.lost; patch.fld = today(); }
  }
  return patch;
}

// восстановить погасший огонёк: 3 раза в месяц
const RKEY = () => `mkw.fire.restore.${new Date().toISOString().slice(0, 7)}`;
export const restoresLeft = () => { try { return Math.max(0, 3 - Number(localStorage.getItem(RKEY()) || 0)); } catch { return 0; } };
async function restore(cid, chat, me, other) {
  if (restoresLeft() <= 0) { toast('В этом месяце восстановления закончились'); return false; }
  const r = chat.read || {};
  const y = today() - 1;
  // день разрыва считаем пройденным: оба «написали» вчера, начало огонька сохраняется
  const fs = Number(r.fs) || y;
  await setDoc(doc(db, 'chats', cid), { read: { [`f_${me}`]: Math.max(Number(r[`f_${me}`]) || 0, y), [`f_${other}`]: Math.max(Number(r[`f_${other}`]) || 0, y), fs: Math.min(fs, y), fx: 0 } }, { merge: true });
  try { localStorage.setItem(RKEY(), String(3 - restoresLeft() + 1)); } catch { /* ignore */ }
  toast('Огонёк восстановлен! Напишите друг другу сегодня');
  return true;
}
async function stop(cid, n) {
  await setDoc(doc(db, 'chats', cid), { read: { fx: today(), fl: n || 0, fld: today() } }, { merge: true });
  toast('Огонёк потушен. Напишите — и начнётся новый');
}

export function openStreak(cid, chat, me, other, nick) {
  const st = streakOf(chat, me, other);
  const lvl = st.level || LEVELS[0];
  const head = st.state === 'none' ? 'Огонька пока нет'
    : st.state === 'lost' ? 'Огонёк погас'
    : st.state === 'grey' ? (st.mineToday ? `Ждём ответ от ${nick}` : 'Огонёк гаснет — напишите сегодня')
    : 'Сегодня огонёк горит';
  const sub = st.state === 'none' ? `Напишите ${nick} — и огонёк зажжётся. Общайтесь каждый день, чтобы он рос`
    : st.state === 'lost' ? `Было дней: ${st.lost || st.n || 0}. Можно восстановить (осталось ${restoresLeft()} из 3 в этом месяце) или начать заново — просто напишите`
    : `${lvl.name} · дней подряд: ${st.n}. День засчитывается, когда пишете оба`;
  const btns = [];
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
    const o = otherOf(c); if (!o) continue;
    const st = streakOf(c, me, o);
    if (st.state !== 'grey' || st.mineToday || st.n < 1) continue;
    const k = `mkw.fire.grey.${c.id}`;
    if (new Date().getHours() < 12) continue; // напоминаем во второй половине дня
    try { if (localStorage.getItem(k) === String(t)) continue; localStorage.setItem(k, String(t)); } catch { continue; }
    nickOf(o).then((nick) => notify(`Огонёк с ${nick} гаснет`, `Напишите ${nick} сегодня, чтобы сохранить ${st.n} ${st.n === 1 ? 'день' : 'дней'}`, `fire-${c.id}`));
  }
}
