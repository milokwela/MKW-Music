// «О MKW»: обращение к слушателям (бета) и опрос «какое обновление следующее».
// Голос хранится в polls/{id}/votes/{uid} — один голос на человека, можно передумать.
import { db } from './firebase.js';
import { getDocs, collection, doc, setDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { h, toast, openSheet, closeSheet, isSheetOpen } from './ui.js';
import { mi } from './icons2.js';
import * as store from './store.js';
import { stSrc } from './stickers.js';
import { plural } from './utils.js';

export const POLL_ID = 'next-2026-11';
const OPTIONS = [
  { t: 'Зимнее оформление', s: 'Снег, новогодние стикеры и праздничный вид приложения', i: 'sparkle' },
  { t: 'Улучшения музыки', s: 'Поиск, рекомендации, MKW Волна, тексты песен', i: 'headphones' },
  { t: 'Оптимизация', s: 'Быстрее, плавнее, меньше батареи и интернета', i: 'rocket' },
];
const BETA_TEXT = 'Дорогие пользователи MKW! Приложение сейчас в бета-версии — это этап разработки, поэтому в нём ещё есть баги и недочёты. Мы каждый день стараемся всё исправлять и улучшать. Спасибо, что вы с нами!';

export function betaCard() {
  return h('div', { class: 'beta-card' },
    h('img', { class: 'beta-st', src: stSrc(10), alt: '', loading: 'lazy' }),
    h('div', {}, h('b', { text: 'MKW в бета-версии' }), h('p', { text: BETA_TEXT })));
}

// один раз после обновления — обращение со стикером
// голосование завершено (10 ноября 2026): напоминаний больше нет, в «О MKW» остаются итоги
// с 13 ноября 2026 — один раз предлагаем выбрать логотип MKW
export function maybeShowBetaNote() { showLogoPoll(); }

let cache = null, localVote = -1;
async function loadVotes() {
  try {
    const s = await getDocs(collection(db, 'polls', POLL_ID, 'votes'));
    const counts = OPTIONS.map(() => 0); let mine = -1;
    s.docs.forEach((d) => { const o = Number(d.data().o); if (o >= 0 && o < OPTIONS.length) { counts[o] += 1; if (d.id === store.state.uid) mine = o; } });
    // свой голос только что отправлен, а сервер ещё не показал — учитываем его сами
    if (localVote >= 0 && mine !== localVote) { if (mine >= 0) counts[mine] -= 1; counts[localVote] += 1; mine = localVote; }
    cache = { counts, mine }; if (mine >= 0) { try { localStorage.setItem('mkw.pollvote', String(mine)); } catch { /* ignore */ } }
  } catch { cache = cache || { counts: OPTIONS.map(() => 0), mine: -1, err: true }; }
  return cache;
}

export function pollCard() {
  const body = h('div', { class: 'poll-opts' });
  const foot = h('small', { class: 'poll-foot' });
  const paint = (d) => {
    const total = d.counts.reduce((a, b) => a + b, 0);
    const top = Math.max(...d.counts);
    body.replaceChildren(...OPTIONS.map((o, i) => {
      const pct = total ? Math.round((d.counts[i] / total) * 100) : 0;
      const win = total > 0 && d.counts[i] === top;
      return h('div', { class: `poll-opt voted done${win ? ' mine win' : ''}`, style: `--w:${pct}%` },
        h('span', { class: 'poll-ic' }, mi(o.i)),
        h('span', { class: 'poll-t' }, h('b', { text: o.t }), h('small', { text: win ? 'Победитель голосования — уже в приложении' : 'Тоже сделали в этом обновлении' })),
        h('span', { class: 'poll-pct', text: `${pct}%` }),
        win ? h('i', { class: 'poll-ck' }, mi('trophy')) : h('i', { class: 'poll-ck ok' }, mi('check')));
    }));
    foot.textContent = d.err ? 'Итоги появятся, когда будет связь с сервером.'
      : `Голосование завершено · ${total} ${plural(total, 'голос', 'голоса', 'голосов')}. Спасибо всем, кто выбирал!`;
  };
  paint(cache || { counts: OPTIONS.map(() => 0), mine: -1 });
  loadVotes().then(paint);
  return h('div', { class: 'poll-card poll-done' },
    h('div', { class: 'poll-win' }, h('img', { src: stSrc(49), alt: '', loading: 'lazy' }),
      h('div', {}, h('b', { text: 'Итоги голосования: сделали всё' }), h('p', { text: 'Победило зимнее оформление. Но мы решили не выбирать и выпустили сразу всё: зиму, улучшения музыки и оптимизацию.' }))),
    h('div', { class: 'poll-head' }, h('b', { text: 'Какое обновление хотели следующим' }), h('span', { class: 'poll-tag', text: 'Итоги' })),
    body, foot);
}

// ---------- Опрос «Какой логотип подходит MKW» (ноябрь 2026) ----------
// Голос: polls/logo-2026-11/votes/{uid} = { o, at } — один на человека, можно передумать.
export const LOGO_POLL = 'logo-2026-11';
const LOGOS = [
  { t: 'Нынешний', s: 'Стеклянный, сейчас на иконке', img: 'assets/ic5-512.png' },
  { t: 'Звезда', s: 'Мягкая, бело-сиреневая', img: 'assets/mkw-logo-a.webp' },
  { t: 'Цветок', s: 'Объёмный, белый', img: 'assets/mkw-logo-b.webp' },
];
const LSEEN = 'mkw.logopoll.seen';
const lget = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lput = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
let lcache = null, lmine = -1;
const lempty = () => ({ counts: LOGOS.map(() => 0), mine: Number(lget('mkw.logovote') ?? -1) });
async function loadLogo() {
  try {
    const sn = await getDocs(collection(db, 'polls', LOGO_POLL, 'votes'));
    const counts = LOGOS.map(() => 0); let mine = -1;
    sn.docs.forEach((d) => { const o = Number(d.data().o); if (o >= 0 && o < LOGOS.length) { counts[o] += 1; if (d.id === store.state.uid) mine = o; } });
    if (lmine >= 0 && mine !== lmine) { if (mine >= 0) counts[mine] -= 1; counts[lmine] += 1; mine = lmine; }
    lcache = { counts, mine };
    if (mine >= 0) lput('mkw.logovote', String(mine));
  } catch { lcache = lcache || { ...lempty(), err: true }; }
  return lcache;
}
async function voteLogo(i) {
  const uid = store.state.uid;
  if (!uid) { toast('Войдите, чтобы проголосовать'); return false; }
  const prev = lcache || lempty();
  lmine = i; lput('mkw.logovote', String(i));
  try { await setDoc(doc(db, 'polls', LOGO_POLL, 'votes', uid), { o: i, at: Date.now() }); return true; }
  catch { lmine = prev.mine; toast('Не получилось отправить голос, попробуйте ещё раз'); return false; }
}

export function logoPollCard(onVoted) {
  const grid = h('div', { class: 'lp-grid' });
  const foot = h('small', { class: 'poll-foot' });
  const paint = (d) => {
    const total = d.counts.reduce((a, b) => a + b, 0);
    const voted = d.mine >= 0;
    grid.replaceChildren(...LOGOS.map((o, i) => {
      const pct = total ? Math.round((d.counts[i] / total) * 100) : 0;
      return h('button', {
        class: `lp-opt${d.mine === i ? ' mine' : ''}${voted ? ' voted' : ''}`, type: 'button', style: `--w:${voted ? pct : 0}%`,
        onclick: async () => {
          if (d.mine === i) return;
          const optimistic = { counts: [...d.counts], mine: i };
          if (d.mine >= 0) optimistic.counts[d.mine] -= 1;
          optimistic.counts[i] += 1;
          paint(optimistic);
          if (await voteLogo(i)) { loadLogo().then(paint); if (onVoted) onVoted(i); } else paint(d);
        },
      },
      h('img', { src: o.img, alt: o.t, loading: 'lazy', decoding: 'async' }),
      h('b', { text: o.t }),
      h('small', { text: o.s }),
      voted ? h('span', { class: 'lp-pct', text: `${pct}%` }) : null,
      d.mine === i ? h('i', { class: 'poll-ck' }, mi('check')) : null);
    }));
    foot.textContent = d.err ? 'Результаты появятся, когда будет связь с сервером.'
      : voted ? `${total} ${plural(total, 'голос', 'голоса', 'голосов')} · передумали — нажмите на другой вариант`
        : 'Нажмите на логотип, который нравится больше. Результаты увидите сразу после голоса.';
  };
  paint(lcache || lempty());
  loadLogo().then(paint);
  return h('div', { class: 'poll-card lp-card' },
    h('div', { class: 'poll-head' }, h('b', { text: 'Какой логотип подходит MKW?' }), h('span', { class: 'poll-tag', text: 'Опрос' })),
    h('p', { class: 'lp-sub', text: 'Выбираем новую иконку приложения и логотип. Победитель появится на иконке и на сайте.' }),
    grid, foot);
}

function showLogoPoll() {
  if (lget(LSEEN) || lget('mkw.logovote') !== null) return;
  let tries = 0;
  const show = () => {
    if (!store.state.uid || isSheetOpen() || document.hidden || document.querySelector('.app-gate, .beta-pop, .nw, .inc, .rc')) {
      if (++tries < 40) setTimeout(show, 4000);
      return;
    }
    lput(LSEEN, '1');
    openSheet('Выберите логотип MKW', h('div', { class: 'fbi-box' },
      logoPollCard(() => setTimeout(closeSheet, 1400)),
      h('p', { class: 'fb-note', text: 'Опрос всегда есть в Профиль → меню → О MKW.' }),
      h('button', { class: 'btn tonal block', type: 'button', text: 'Позже', onclick: closeSheet })));
  };
  show();
}
