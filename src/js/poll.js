// «О MKW»: обращение к слушателям (бета) и опрос «какое обновление следующее».
// Голос хранится в polls/{id}/votes/{uid} — один голос на человека, можно передумать.
import { db } from './firebase.js';
import { getDocs, collection } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { h } from './ui.js';
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
export function maybeShowBetaNote() {}

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
