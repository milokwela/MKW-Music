// Ежедневные задания: три задания в день. Выполнили все три — выбираете любой эмодзи или стикер MKW
// и ставите его рядом с ником (видят все: в профиле, в топе, в чатах). Каждый день — ещё один в коллекцию.
import { db } from './firebase.js?v=0.35.1';
import { doc, setDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import * as store from './store.js?v=0.35.1';
import { h, toast, openSheet, closeSheet } from './ui.js?v=0.35.1';
import { mi } from './icons2.js?v=0.35.1';
import { CATS, STICKERS, catSrc, stSrc, nickEmoSrc } from './stickers.js?v=0.35.1';

const KEY = 'mkw.daily.v1';
const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const midnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

const POOL = {
  listen: { title: 'Послушать музыку 20 минут', goal: 20, unit: 'мин', prog: () => Math.floor((store.diaryDays()[ymd()] || 0) / 60) },
  tracks: { title: 'Включить 8 разных песен', goal: 8, prog: () => new Set(store.state.history.filter((t) => Number(t.playedAt) >= midnight()).map((t) => t.id)).size },
  like: { title: 'Поставить 3 лайка песням', goal: 3, prog: () => store.state.likes.filter((t) => Number(t.likedAt) >= midnight()).length },
  wave: { title: 'Дослушать песню в MKW Волне', goal: 1 },
  msg: { title: 'Написать другу в чат', goal: 1 },
  share: { title: 'Отправить другу песню', goal: 1 },
  react: { title: 'Поставить реакцию на сообщение', goal: 1 },
  voice: { title: 'Отправить голосовое', goal: 1 },
  sticker: { title: 'Отправить стикер', goal: 1 },
};
const MUSIC = ['listen', 'tracks'], TASTE = ['like', 'wave'], SOCIAL = ['msg', 'share', 'react', 'voice', 'sticker'];

function hash(s) { let x = 2166136261; for (const c of String(s)) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619) >>> 0; } return x; }
function load() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { d = null; }
  if (!d || d.day !== ymd()) d = { day: ymd(), ev: {}, claimed: false, told: [] };
  return d;
}
let st = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* ignore */ } };
const fresh = () => { if (st.day !== ymd()) { st = load(); save(); } return st; };

// три задания на сегодня: одно «послушать», одно «вкус», одно с друзьями (если друзей нет — ещё одно музыкальное)
export function todayTasks(hasFriends = true) {
  const x = hash(`${ymd()}|${store.state.uid || ''}`);
  const pick = (list, k) => list[(x >>> k) % list.length];
  fresh();
  let ids = Array.isArray(st.tasks) && st.tasks.length === 3 && st.tasks.every((id) => POOL[id]) ? st.tasks : null;
  if (!ids) {
    const third = hasFriends ? pick(SOCIAL, 7) : MUSIC.find((t) => t !== pick(MUSIC, 0)) || 'tracks';
    ids = [pick(MUSIC, 0), pick(TASTE, 3), third];
    // запоминаем задания на весь день, когда уже известно, есть ли друзья
    if (store.state.uid && readyFn()) { st.tasks = ids; save(); }
  }
  return ids.map((id) => {
    const t = POOL[id];
    const have = t.prog ? t.prog() : (fresh().ev[id] || 0);
    return { id, title: t.title, goal: t.goal, have: Math.min(t.goal, have), done: have >= t.goal, unit: t.unit || '' };
  });
}

// событие из приложения: «написал другу», «отправил стикер»…
const subs = new Set();
export function onDaily(fn) { subs.add(fn); return () => subs.delete(fn); }
const emit = () => subs.forEach((f) => { try { f(); } catch { /* ignore */ } });
let friendsFn = () => true, readyFn = () => true;
export function setFriendsCheck(fn, ready) { friendsFn = fn; if (ready) readyFn = ready; }
export function markDaily(id) {
  if (!POOL[id]) return;
  fresh().ev[id] = (st.ev[id] || 0) + 1; save();
  check();
}
// поздравляем, когда задание выполнено
export function check() {
  const list = todayTasks(friendsFn());
  fresh();
  let changed = false;
  for (const t of list) if (t.done && !st.told.includes(t.id)) { st.told.push(t.id); changed = true; toast(`Задание выполнено: ${t.title.toLowerCase()} ✓`); }
  if (changed) {
    save();
    if (list.every((t) => t.done) && !st.claimed) setTimeout(() => toast('Все задания выполнены! В Профиле выберите эмодзи MKW для ника'), 1800);
    emit();
  }
}

// ---------- эмодзи у ника ----------
const ALL = [...CATS.map((c) => ({ id: `c${c.n}`, name: c.name, src: catSrc(c.n) })), ...STICKERS.map((s) => ({ id: `s${s.n}`, name: s.name, src: stSrc(s.n) }))];
export const myNickEmo = () => String((store.state.profile || {}).nemo || '');
export const ownedEmo = () => { const o = (store.state.profile || {}).nemoOwned; return Array.isArray(o) ? o.map(String) : []; };
export const canClaim = () => todayTasks(friendsFn()).every((t) => t.done) && !fresh().claimed;
async function saveEmo(patch) {
  if (!store.state.uid) return;
  Object.assign(store.state.profile, patch);
  try { await setDoc(doc(db, 'users', store.state.uid), patch, { merge: true }); } catch { toast('Не получилось сохранить'); }
  window.dispatchEvent(new CustomEvent('mkw-nemo'));
  emit();
}
export function openNickEmo() {
  const owned = new Set(ownedEmo());
  const cur = myNickEmo();
  const claim = canClaim();
  const grid = h('div', { class: 'ne-grid' }, ...ALL.map((e) => {
    const has = owned.has(e.id);
    return h('button', { type: 'button', class: `ne-cell${has ? ' own' : ''}${cur === e.id ? ' cur' : ''}${!has && !claim ? ' locked' : ''}`, title: e.name, onclick: async () => {
      if (has) { await saveEmo({ nemo: cur === e.id ? '' : e.id }); closeSheet(); toast(cur === e.id ? 'Эмодзи у ника убран' : 'Эмодзи стоит рядом с ником'); return; }
      if (!claim) { toast('Выполните 3 задания на сегодня — и выберите любой'); return; }
      fresh().claimed = true; save();
      await saveEmo({ nemoOwned: [...owned, e.id].slice(-60), nemo: e.id });
      closeSheet(); toast(`«${e.name}» теперь ваш и стоит рядом с ником!`);
    } }, h('img', { src: e.src, alt: '', loading: 'lazy' }), !has && !claim ? h('i', { class: 'ne-lock' }, mi('lock')) : null);
  }));
  openSheet('Эмодзи у ника', h('div', { class: 'ne-sheet' },
    h('p', { class: 'profile-note', text: claim ? 'Задания выполнены! Выберите любой эмодзи или стикер — он станет вашим навсегда и встанет рядом с ником.'
      : owned.size ? 'Нажмите на свой эмодзи, чтобы поставить его у ника (или убрать). Новый — за 3 выполненных задания в день.' : 'Выполните 3 ежедневных задания — и выберите любой эмодзи MKW. Он встанет рядом с ником, и его увидят все.' }),
    grid));
}

// карточка на главной
export function dailyCard() {
  const list = todayTasks(friendsFn());
  const n = list.filter((t) => t.done).length;
  const claim = n === 3 && !fresh().claimed;
  const cur = nickEmoSrc(myNickEmo());
  return h('div', { class: `dl-card${n === 3 ? ' all' : ''}` },
    h('div', { class: 'dl-head' },
      h('b', { text: 'Задания на сегодня' }), h('span', { class: 'dl-n', text: `${n}/3` }),
      h('button', { type: 'button', class: 'dl-emo', title: 'Эмодзи у ника', 'aria-label': 'Эмодзи у ника', onclick: openNickEmo }, cur ? h('img', { src: cur, alt: '' }) : mi('emoji'))),
    ...list.map((t) => h('div', { class: `dl-row${t.done ? ' done' : ''}` },
      h('i', { class: 'dl-ck' }, t.done ? mi('check') : null),
      h('span', { class: 'dl-t', text: t.title }),
      h('small', { text: t.done ? 'готово' : `${t.have}/${t.goal}${t.unit ? ` ${t.unit}` : ''}` }),
      h('i', { class: 'dl-bar', style: `--p:${t.have / t.goal}` }))),
    claim ? h('button', { type: 'button', class: 'btn dl-claim', onclick: openNickEmo }, mi('emoji'), ' Выбрать эмодзи MKW для ника')
      : n === 3 ? h('small', { class: 'dl-foot', text: 'Всё выполнено! Завтра — новые задания и ещё один эмодзи' })
        : h('small', { class: 'dl-foot', text: 'Выполните все три — и выберите эмодзи MKW рядом с ником' }));
}

export function initDaily() {
  setInterval(() => { if (!document.hidden) check(); }, 20000);
  store.onStore((w) => { if (w === 'likes' || w === 'history') setTimeout(check, 500); });
}
