// Раздел «Чаты» в нижнем меню: все переписки с друзьями, как в мессенджере.
// Сверху — недавние и непрочитанные, ниже — друзья, с которыми ещё не переписывались.
import { $, h, toast, openSheet, closeSheet, setKids } from './ui.js';
import { pinnedChats, isPinned, togglePin, isMuted, setMute, muteLabel } from './chatprefs.js';
import { mi } from './icons2.js';
import { chatList, isUnread, onChats, openChat, otherOf, clearedAt, blockedByMe, openCid, openGroup, groupAvatar, createGroupSheet, chatId, setBlocked } from './chat.js';
import { me, friendIds, friendCards, loadFriends, friendsLoaded, onFriends, requestIds } from './friends.js';
import { avSrc } from './avatar.js';
import { nickMarks } from './dev.js';
import { seenText, isOnline } from './userpage.js';
import { pickAndCall } from './call.js';
import { streakAny, fireIcon } from './streak.js';
import { setNotify } from './notify.js';

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
  const cleared = c && c.last && (Number(c.last.at) || 0) <= clearedAt(c);
  const blocked = c && blockedByMe(u.uid);
  const preview = blocked ? 'Заблокирован(а)' : cleared ? 'Нет сообщений' : c && c.last ? `${mine ? 'Вы: ' : ''}${c.last.text}` : isOnline(u.seen) && u.now ? `Слушает: ${u.now}` : seenText(u.seen) || 'Напишите первым';
  const cidOf = chatId(me(), u.uid);
  return h('button', { type: 'button', 'data-uid': u.uid, 'data-cid': cidOf, class: `cl-row${unread && !cleared ? ' unread' : ''}${blocked ? ' blocked' : ''}${openCid() === cidOf ? ' on' : ''}`, style: `animation-delay:${Math.min(i, 10) * 30}ms`, onclick: () => openChat(u.uid, u) },
    h('span', { class: 'cl-av' }, h('img', { src: avSrc(u.avatar), alt: '', loading: 'lazy' }), isOnline(u.seen) ? h('i', { class: 'online-dot' }) : null),
    h('span', { class: 'cl-body' },
      h('span', { class: 'cl-top' }, h('b', { text: u.nick || 'друг' }), ...nickMarks(u), ...(() => { const st = streakAny(c, me(), u.uid); return st.state === 'lit' || st.state === 'grey' ? [fireIcon(st)] : []; })(), c ? h('time', { text: when(c.at) }) : null),
      h('span', { class: 'cl-prev' }, h('span', { text: preview }), ...flags(cidOf), unread && !cleared ? h('i', { class: `cl-dot${isMuted(cidOf) ? ' muted' : ''}` }) : null)));
}
// значки «закреплён» и «без уведомлений»
const flags = (cid) => [isMuted(cid) ? h('span', { class: 'cl-flag', title: muteLabel(cid) }, mi('bell-off')) : null, isPinned(cid) ? h('span', { class: 'cl-flag pin', title: 'Закреплён' }, mi('pin')) : null].filter(Boolean);

// «Удалить из чатов»: переписка пропадает из списка у вас, пока не придёт новое сообщение
const HK = 'mkw.chat.hidden';
const hiddenMap = () => { try { return JSON.parse(localStorage.getItem(HK) || '{}'); } catch { return {}; } };
function hideChat(cid) { const m = hiddenMap(); m[cid] = Date.now(); try { localStorage.setItem(HK, JSON.stringify(m)); } catch { /* ignore */ } }
const isHidden = (c) => { const t = hiddenMap()[c.id]; return Boolean(t) && (Number(c.at) || 0) <= t; };

// удержание (или правая кнопка мыши) на человеке — меню: закрепить, без уведомлений, заблокировать
function rowMenu(cid, title, uid, hasChat) {
  const btn = (ic, text, fn, danger) => h('button', { type: 'button', class: `ch-sm${danger ? ' danger' : ''}`, onclick: async () => { closeSheet(); try { await fn(); } catch { toast('Не получилось'); } renderChats(); } }, mi(ic), h('span', { text }));
  const H = 3600000;
  const muted = isMuted(cid);
  const items = [
    btn('pin', isPinned(cid) ? 'Открепить' : 'Закрепить сверху', async () => { const on = await togglePin(cid); toast(on ? 'Чат закреплён сверху' : 'Чат откреплён'); }),
    muted
      ? btn('bell', `Включить уведомления (${muteLabel(cid).toLowerCase()})`, async () => { await setMute(cid, 0); toast('Уведомления включены'); })
      : h('div', { class: 'cl-mute' }, h('small', { text: 'Без уведомлений' }), h('div', { class: 'cl-mute-row' },
        ...[['1 час', H], ['8 часов', 8 * H], ['1 день', 24 * H], ['Неделю', 7 * 24 * H], ['Навсегда', Infinity]].map(([t, ms]) => h('button', { type: 'button', class: 'chip', onclick: async () => {
          closeSheet(); try { await setMute(cid, ms); toast(ms === Infinity ? 'Уведомления выключены' : `Без уведомлений на ${t.toLowerCase()}`); } catch { toast('Не получилось'); } renderChats();
        } }, t)))),
    uid ? (blockedByMe(uid)
      ? btn('block', 'Разблокировать', async () => { await setBlocked(uid, false); toast('Разблокирован(а)'); })
      : btn('block', 'Заблокировать', async () => { await setBlocked(uid, true); toast('Заблокирован(а): сообщения и звонки от него(неё) не придут'); }, true)) : null,
    hasChat ? btn('trash', 'Удалить из чатов', async () => { hideChat(cid); toast('Чат убран из списка. Напишут снова — появится'); }, true) : null,
  ].filter(Boolean);
  if (navigator.vibrate) navigator.vibrate(12);
  openSheet(title, h('div', { class: 'cl-menu' }, ...items));
}
// жест на строке: долгое нажатие на телефоне, правая кнопка на компьютере
function holdable(el, open) {
  let t = 0, fired = false, x = 0, y = 0;
  el.addEventListener('touchstart', (e) => { fired = false; const p = e.touches[0]; x = p.clientX; y = p.clientY; clearTimeout(t); t = setTimeout(() => { fired = true; open(); }, 480); }, { passive: true });
  el.addEventListener('touchmove', (e) => { const p = e.touches[0]; if (Math.abs(p.clientX - x) > 10 || Math.abs(p.clientY - y) > 10) clearTimeout(t); }, { passive: true });
  el.addEventListener('touchend', (e) => { clearTimeout(t); if (fired && e.cancelable) e.preventDefault(); });
  el.addEventListener('touchcancel', () => clearTimeout(t));
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); clearTimeout(t); if (!fired) open(); fired = true; setTimeout(() => { fired = false; }, 400); });
  el.addEventListener('click', (e) => { if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; } }, true);
  return el;
}

// строка группы
function groupRow(c, cards, i) {
  const unread = isUnread(c);
  const cleared = c.last && (Number(c.last.at) || 0) <= clearedAt(c);
  const mine = c.last && c.last.from === me();
  const preview = cleared ? 'Нет сообщений' : c.last ? `${mine ? 'Вы' : (c.last.nick || 'Кто-то')}: ${c.last.text}` : 'Группа';
  const st = streakAny(c, me(), '');
  return h('button', { type: 'button', 'data-cid': c.id, class: `cl-row group${unread && !cleared ? ' unread' : ''}${openCid() === c.id ? ' on' : ''}`, style: `animation-delay:${Math.min(i, 10) * 30}ms`, onclick: () => openGroup(c.id) },
    h('span', { class: 'cl-av' }, groupAvatar(c, cards)),
    h('span', { class: 'cl-body' },
      h('span', { class: 'cl-top' }, h('b', { text: c.name || 'Группа' }), h('span', { class: 'cl-gtag', text: String((c.members || []).length) }), ...(st.state === 'lit' || st.state === 'grey' ? [fireIcon(st)] : []), h('time', { text: when(c.at) })),
      h('span', { class: 'cl-prev' }, h('span', { text: preview }), ...flags(c.id), unread && !cleared ? h('i', { class: `cl-dot${isMuted(c.id) ? ' muted' : ''}` }) : null)));
}

// компьютер: ширину списка чатов можно тянуть мышкой (узко — только аватарки)
const CLW = 'mkw.cl.w';
function applyClWidth(w) {
  const max = Math.max(260, Math.min(560, window.innerWidth * 0.45));
  let v = Math.round(Math.max(76, Math.min(max, w)));
  if (v < 170) v = 76; // узкий режим
  document.documentElement.style.setProperty('--cl-w', `${v}px`);
  document.documentElement.classList.toggle('cl-narrow', v < 170);
  return v;
}
function initResize() {
  if (document.getElementById('cl-resize')) return;
  let saved = 0; try { saved = Number(localStorage.getItem(CLW)) || 0; } catch { /* ignore */ }
  if (saved) applyClWidth(saved);
  const bar = h('div', { id: 'cl-resize', title: 'Потяните, чтобы изменить ширину. Двойной клик — сбросить' });
  let on = false;
  bar.addEventListener('pointerdown', (e) => { on = true; try { bar.setPointerCapture(e.pointerId); } catch { /* ignore */ } bar.classList.add('drag'); document.documentElement.classList.add('cl-dragging'); e.preventDefault(); });
  bar.addEventListener('pointermove', (e) => { if (!on) return; const left = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pane-l')) || 12; const raw = e.clientX - left; document.documentElement.style.setProperty('--cl-w', `${Math.max(76, Math.min(Math.max(260, Math.min(560, window.innerWidth * 0.45)), raw))}px`); document.documentElement.classList.toggle('cl-narrow', raw < 170); });
  const end = (e) => { if (!on) return; on = false; bar.classList.remove('drag'); document.documentElement.classList.remove('cl-dragging'); const left = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pane-l')) || 12; const v = applyClWidth(e.clientX - left); try { localStorage.setItem(CLW, String(v)); } catch { /* ignore */ } };
  bar.addEventListener('pointerup', end); bar.addEventListener('pointercancel', end);
  bar.addEventListener('dblclick', () => { document.documentElement.style.removeProperty('--cl-w'); document.documentElement.classList.remove('cl-narrow'); try { localStorage.removeItem(CLW); } catch { /* ignore */ } });
  document.body.appendChild(bar);
}

export async function renderChats() {
  const root = $('#view-chats');
  if (!root) return;
  initResize();
  if (!watching) {
    watching = true;
    const re = () => { if (!root.hidden) renderChats(); };
    onChats(re); onFriends(re);
    window.addEventListener('mkw-chatprefs', re);
  }
  if (busy) { again = true; return; }
  busy = true;
  try {
    if (!root.firstChild) {
      const inp = h('input', { class: 'sheet-input cl-search', type: 'search', placeholder: 'Найти друга', autocomplete: 'off' });
      inp.addEventListener('input', () => { filter = inp.value.trim().toLowerCase(); renderChats(); });
      root.replaceChildren(h('div', { class: 'cl-head' }, h('h1', { class: 'view-title', text: 'Чаты' }), h('button', { type: 'button', class: 'cl-callbtn cl-grpbtn', title: 'Новая группа', onclick: () => createGroupSheet() }, mi('group'), h('span', { text: 'Группа' })), h('button', { type: 'button', class: 'cl-callbtn', onclick: pickAndCall }, mi('phone'), h('span', { text: 'Звонок' }))), inp, h('div', { class: 'cl-req' }), h('div', { class: 'cl-list' }));
    }
    if (!friendsLoaded()) await loadFriends();
    const ids = friendIds();
    const chats = chatList();
    const dms = chats.filter((c) => !c.group);
    const groups = chats.filter((c) => c.group);
    const withChat = new Map(dms.filter((c) => !isHidden(c)).map((c) => [otherOf(c), c]));
    const gMembers = groups.flatMap((c) => (c.members || []).filter((x) => x !== me()).slice(0, 3));
    const cards = await friendCards([...new Set([...dms.map(otherOf), ...ids, ...gMembers])].filter(Boolean).slice(0, 120), 60000);
    const byId = new Map(cards.map((u) => [u.uid, u]));
    const pass = (u) => !filter || String(u.nick || '').toLowerCase().includes(filter);
    // переписки и группы вместе, по времени последнего сообщения
    const talks = chats.filter((c) => !isHidden(c)).map((c) => (c.group ? (!filter || String(c.name || '').toLowerCase().includes(filter) ? { c } : null) : (byId.get(otherOf(c)) && pass(byId.get(otherOf(c))) ? { u: byId.get(otherOf(c)), c } : null))).filter(Boolean);
    let rest = ids.filter((x) => !withChat.has(x)).map((x) => byId.get(x)).filter((u) => u && pass(u));
    // закреплённые — сверху, в порядке закрепления (и друзья без переписки тоже)
    const pins = pinnedChats();
    const cidOfT = (x) => (x.u ? chatId(me(), x.u.uid) : x.c.id);
    const pinnedRest = rest.filter((u) => pins.includes(chatId(me(), u.uid))).map((u) => ({ u, c: null }));
    rest = rest.filter((u) => !pins.includes(chatId(me(), u.uid)));
    const all = [...talks, ...pinnedRest];
    const top = all.filter((x) => pins.includes(cidOfT(x))).sort((a, b) => pins.indexOf(cidOfT(a)) - pins.indexOf(cidOfT(b)));
    talks.splice(0, talks.length, ...top, ...talks.filter((x) => !pins.includes(cidOfT(x))));
    const req = requestIds().length;
    // уведомления о звонках: браузер должен разрешить — просим одной кнопкой
    const askNotif = 'Notification' in window && Notification.permission === 'default';
    // iPhone в Safari: звонки и уведомления приходят, только если MKW добавлен на экран «Домой»
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = (window.navigator.standalone === true) || matchMedia('(display-mode: standalone)').matches;
    let iosHide = false; try { iosHide = localStorage.getItem('mkw.ioshint') === '1'; } catch { /* ignore */ }
    const iosTip = ios && !standalone && !iosHide ? h('div', { class: 'cl-ios' },
      h('b', {}, mi('phone'), h('span', { text: 'Чтобы на iPhone приходили звонки' })),
      h('ol', {},
        h('li', { text: 'Нажмите «Поделиться» внизу Safari (квадрат со стрелкой)' }),
        h('li', { text: 'Выберите «На экран «Домой»» → «Добавить»' }),
        h('li', { text: 'Откройте MKW с иконки на экране и разрешите уведомления' })),
      h('small', { text: 'В обычной вкладке Safari iPhone не пускает звонки и уведомления, когда MKW свёрнут.' }),
      h('button', { type: 'button', class: 'cl-ios-x', onclick: () => { try { localStorage.setItem('mkw.ioshint', '1'); } catch { /* ignore */ } renderChats(); } }, 'Понятно')) : null;
    const nb = askNotif ? h('button', { type: 'button', class: 'cl-reqbtn cl-notif', onclick: async () => { await setNotify(true); renderChats(); } }, mi('bell'), h('span', { text: 'Включите уведомления — чтобы не пропускать звонки, даже когда MKW закрыт' }), h('i', { text: '›' })) : null;
    root.querySelector('.cl-req').replaceChildren(...(iosTip ? [iosTip] : []), ...(nb ? [nb] : []), ...(req ? [h('button', { type: 'button', class: 'cl-reqbtn', onclick: () => document.querySelector('#bottom-nav .nav-btn[data-view="profile"]').click() || setTimeout(() => { const t = document.querySelector('.ptab[data-tab="friends"]'); if (t) t.click(); }, 300) }, mi('person-add'), h('span', { text: `Заявки в друзья: ${req}` }), h('i', { text: '›' }))] : []));
    const list = root.querySelector('.cl-list');
    if (!talks.length && !rest.length) {
      list.replaceChildren(h('div', { class: 'cl-empty' }, mi('chat'), h('b', { text: filter ? 'Никого не нашла' : 'Чатов пока нет' }),
        h('small', { text: filter ? 'Попробуйте другой ник' : 'Добавьте друзей в Профиль → Друзья. Когда друг примет заявку, здесь можно будет переписываться и отправлять песни.' })));
    } else {
      let i = 0;
      setKids(list, [
        ...talks.map((x) => (x.u ? holdable(row(x.u, x.c, i++), () => rowMenu(chatId(me(), x.u.uid), x.u.nick || 'Друг', x.u.uid, Boolean(x.c))) : holdable(groupRow(x.c, byId, i++), () => rowMenu(x.c.id, x.c.name || 'Группа', '', true)))),
        ...(rest.length ? [h('div', { class: 'section-title', text: talks.length ? 'Друзья' : 'Начните переписку' }), ...rest.map((u) => holdable(row(u, null, i++), () => rowMenu(chatId(me(), u.uid), u.nick || 'Друг', u.uid)))] : [])]);
    }
  } finally { busy = false; if (again) { again = false; renderChats(); } }
}
