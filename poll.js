// «О MKW»: обращение к слушателям (бета) и опрос «какое обновление следующее».
// Голос хранится в polls/{id}/votes/{uid} — один голос на человека, можно передумать.
import { db } from './firebase.js?v=0.35.3';
import { doc, setDoc, getDocs, collection } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { h, toast } from './ui.js?v=0.35.3';
import { mi } from './icons2.js?v=0.35.3';
import * as store from './store.js?v=0.35.3';
import { stSrc } from './stickers.js?v=0.35.3';
import { srvNow } from './clock.js?v=0.35.3';
import { plural } from './utils.js?v=0.35.3';

export const POLL_ID = 'next-2026-11';
const OPTIONS = [
  { t: 'Зимнее оформление', s: 'Снег, новогодние стикеры и праздничный вид приложения', i: 'sparkle' },
  { t: 'Улучшения музыки', s: 'Поиск, рекомендации, MKW Волна, тексты песен', i: 'headphones' },
  { t: 'Оптимизация', s: 'Быстрее, плавнее, меньше батареи и интернета', i: 'rocket' },
];
const RESULTS_AT = 'в понедельник, 9 ноября';
const BETA_TEXT = 'Дорогие пользователи MKW! Приложение сейчас в бета-версии — это этап разработки, поэтому в нём ещё есть баги и недочёты. Мы каждый день стараемся всё исправлять и улучшать. Спасибо, что вы с нами!';

export function betaCard() {
  return h('div', { class: 'beta-card' },
    h('img', { class: 'beta-st', src: stSrc(10), alt: '', loading: 'lazy' }),
    h('div', {}, h('b', { text: 'MKW в бета-версии' }), h('p', { text: BETA_TEXT })));
}

// один раз после обновления — обращение со стикером
export function maybeShowBetaNote() {
  try { if (localStorage.getItem('mkw.betanote.v1') === '1') return; localStorage.setItem('mkw.betanote.v1', '1'); } catch { return; }
  const box = h('div', { class: 'beta-pop', role: 'dialog' },
    h('div', { class: 'beta-pop-c' },
      h('img', { class: 'beta-pop-st', src: stSrc(10), alt: '' }),
      h('b', { text: 'Спасибо, что вы с нами!' }),
      h('p', { text: BETA_TEXT }),
      h('p', { class: 'beta-pop-s', text: 'А ещё — проголосуйте, каким будет следующее обновление: Профиль → О MKW.' }),
      h('button', { type: 'button', class: 'btn', onclick: () => { box.classList.remove('show'); setTimeout(() => box.remove(), 300); } }, 'Хорошо ❤')));
  document.body.appendChild(box);
  requestAnimationFrame(() => box.classList.add('show'));
}

let cache = null, localVote = -1;
async function loadVotes() {
  try {
    const s = await getDocs(collection(db, 'polls', POLL_ID, 'votes'));
    const counts = OPTIONS.map(() => 0); let mine = -1;
    s.docs.forEach((d) => { const o = Number(d.data().o); if (o >= 0 && o < OPTIONS.length) { counts[o] += 1; if (d.id === store.state.uid) mine = o; } });
    // свой голос только что отправлен, а сервер ещё не показал — учитываем его сами
    if (localVote >= 0 && mine !== localVote) { if (mine >= 0) counts[mine] -= 1; counts[localVote] += 1; mine = localVote; }
    cache = { counts, mine };
  } catch { cache = cache || { counts: OPTIONS.map(() => 0), mine: -1, err: true }; }
  return cache;
}

export function pollCard() {
  const body = h('div', { class: 'poll-opts' });
  const foot = h('small', { class: 'poll-foot' });
  const paint = (d) => {
    const total = d.counts.reduce((a, b) => a + b, 0);
    const voted = d.mine >= 0;
    body.replaceChildren(...OPTIONS.map((o, i) => {
      const pct = total ? Math.round((d.counts[i] / total) * 100) : 0;
      return h('button', { type: 'button', class: `poll-opt${d.mine === i ? ' mine' : ''}${voted ? ' voted' : ''}`, style: `--w:${voted ? pct : 0}%`, onclick: () => vote(i) },
        h('span', { class: 'poll-ic' }, mi(o.i)),
        h('span', { class: 'poll-t' }, h('b', { text: o.t }), h('small', { text: o.s })),
        voted ? h('span', { class: 'poll-pct', text: `${pct}%` }) : null,
        d.mine === i ? h('i', { class: 'poll-ck' }, mi('check')) : null);
    }));
    foot.textContent = d.err ? 'Опрос заработает, когда админ обновит правила базы.'
      : `${total} ${plural(total, 'голос', 'голоса', 'голосов')} · результаты ${RESULTS_AT}. Голосовать необязательно${voted ? ', можно передумать' : ''}`;
  };
  const vote = async (i) => {
    if (!store.state.uid) { toast('Войдите, чтобы проголосовать'); return; }
    const prev = cache ? cache.mine : -1;
    if (prev === i) return;
    try {
      await setDoc(doc(db, 'polls', POLL_ID, 'votes', store.state.uid), { o: i, at: srvNow() });
      localVote = i;
      if (cache) { if (prev >= 0) cache.counts[prev] -= 1; cache.counts[i] += 1; cache.mine = i; }
      paint(cache || { counts: OPTIONS.map((_, k) => (k === i ? 1 : 0)), mine: i });
      toast('Голос учтён — спасибо!');
      loadVotes().then(paint);
    } catch { toast('Не получилось. Админу нужно обновить правила базы'); }
  };
  paint(cache || { counts: OPTIONS.map(() => 0), mine: -1 });
  loadVotes().then(paint);
  return h('div', { class: 'poll-card' },
    h('div', { class: 'poll-head' }, h('b', { text: 'Какое обновление хотите следующим?' }), h('span', { class: 'poll-tag', text: 'Опрос' })),
    body, foot);
}
