// Раздел «Чаты» в нижнем меню: все переписки с друзьями, как в мессенджере.
// Сверху — недавние и непрочитанные, ниже — друзья, с которыми ещё не переписывались.
import { $, h } from './ui.js?v=0.25.0';
import { mi } from './icons2.js?v=0.25.0';
import { chatList, isUnread, onChats, openChat, otherOf } from './chat.js?v=0.25.0';
import { me, friendIds, friendCards, loadFriends, friendsLoaded, onFriends, requestIds } from './friends.js?v=0.25.0';
import { avSrc } from './avatar.js?v=0.25.0';
import { nickMarks } from './dev.js?v=0.25.0';
import { seenText, isOnline } from './userpage.js?v=0.25.0';

let watching = false, filter = '', busy = false, again = false;

function when(t) {
  const d = new Date(Number(t) || 0), n = new Date();
  if (d.toDateString() === n.toDateString()) return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function row(u, c, i) {
  const unread = c && isUnread(c);
  const mine = c && c.last && c.last.from === me();
  const preview = c && c.last ? `${mine ? 'Вы: ' : ''}${c.last.text}` : isOnline(u.seen) && u.now ? `Слушает: ${u.now}` : seenText(u.seen) || 'Напишите первым';
  return h('button', { type: 'button', class: `cl-row${unread ? ' unread' : ''}`, style: `animation-delay:${Math.min(i, 10) * 30}ms`, onclick: () => openChat(u.uid, u) },
    h('span', { class: 'cl-av' }, h('img', { src: avSrc(u.avatar), alt: '', loading: 'lazy' }), isOnline(u.seen) ? h('i', { class: 'online-dot' }) : null),
    h('span', { class: 'cl-body' },
      h('span', { class: 'cl-top' }, h('b', { text: u.nick || 'друг' }), ...nickMarks(u), c ? h('time', { text: when(c.at) }) : null),
      h('span', { class: 'cl-prev' }, h('span', { text: preview }), unread ? h('i', { class: 'cl-dot' }) : null)));
}

export async function renderChats() {
  const root = $('#view-chats');
  if (!root) return;
  if (!watching) {
    watching = true;
    const re = () => { if (!root.hidden) renderChats(); };
    onChats(re); onFriends(re);
  }
  if (busy) { again = true; return; }
  busy = true;
  try {
    if (!root.firstChild) {
      const inp = h('input', { class: 'sheet-input cl-search', type: 'search', placeholder: 'Найти друга', autocomplete: 'off' });
      inp.addEventListener('input', () => { filter = inp.value.trim().toLowerCase(); renderChats(); });
      root.replaceChildren(h('h1', { class: 'view-title', text: 'Чаты' }), inp, h('div', { class: 'cl-req' }), h('div', { class: 'cl-list' }));
    }
    if (!friendsLoaded()) await loadFriends();
    const ids = friendIds();
    const chats = chatList();
    const withChat = new Map(chats.map((c) => [otherOf(c), c]));
    const cards = await friendCards([...new Set([...chats.map(otherOf), ...ids])].filter(Boolean).slice(0, 80), 60000);
    const byId = new Map(cards.map((u) => [u.uid, u]));
    const pass = (u) => !filter || String(u.nick || '').toLowerCase().includes(filter);
    const talks = chats.map((c) => byId.get(otherOf(c))).filter((u) => u && pass(u));
    const rest = ids.filter((x) => !withChat.has(x)).map((x) => byId.get(x)).filter((u) => u && pass(u));
    const req = requestIds().length;
    root.querySelector('.cl-req').replaceChildren(...(req ? [h('button', { type: 'button', class: 'cl-reqbtn', onclick: () => document.querySelector('#bottom-nav .nav-btn[data-view="profile"]').click() || setTimeout(() => { const t = document.querySelector('.ptab[data-tab="friends"]'); if (t) t.click(); }, 300) }, mi('person-add'), h('span', { text: `Заявки в друзья: ${req}` }), h('i', { text: '›' }))] : []));
    const list = root.querySelector('.cl-list');
    if (!talks.length && !rest.length) {
      list.replaceChildren(h('div', { class: 'cl-empty' }, mi('chat'), h('b', { text: filter ? 'Никого не нашла' : 'Чатов пока нет' }),
        h('small', { text: filter ? 'Попробуйте другой ник' : 'Добавьте друзей в Профиль → Друзья. Когда друг примет заявку, здесь можно будет переписываться и отправлять песни.' })));
    } else {
      let i = 0;
      list.replaceChildren(
        ...talks.map((u) => row(u, withChat.get(u.uid), i++)),
        ...(rest.length ? [h('div', { class: 'section-title', text: talks.length ? 'Друзья' : 'Начните переписку' }), ...rest.map((u) => row(u, null, i++))] : []));
    }
  } finally { busy = false; if (again) { again = false; renderChats(); } }
}
