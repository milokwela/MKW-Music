// Значок Contributor: выдаёт и забирает только создатель (Настройки → «Значок Contributor»).
// contrib/{uid} = { nick, on, at }. Получили — праздничное окно, забрали — грустный котик.
import { db, auth } from './firebase.js';
import { doc, setDoc, collection, onSnapshot, limit, query } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { h, toast, openSheet } from './ui.js';
import { mi } from './icons2.js';
import { srvNow } from './clock.js';

const SEED = new Set(['vilang']); // пока база пустая или старые правила
let ids = null, nicks = null, unsub = null, myId = '';
export function isContribU(u) {
  if (!u) return false;
  if (ids) return ids.has(u.uid) || (!u.uid && nicks.has(String(u.nick || '').toLowerCase()));
  return SEED.has(String(u.nick || '').trim().toLowerCase());
}
export function contribBadge(small = false) {
  return h('span', { class: `contrib-badge${small ? ' sm' : ''}`, title: 'Contributor MKW Music' }, h('img', { src: 'assets/mkw-cat2.webp', alt: '' }), h('b', { text: 'Contributor' }));
}
const HAD = 'mkw.contrib.had';
export function watchContrib(uid) {
  myId = uid;
  if (unsub) return;
  try {
    unsub = onSnapshot(query(collection(db, 'contrib'), limit(300)), (s) => {
      const on = s.docs.filter((d) => d.data().on);
      if (!s.docs.length) { ids = null; nicks = null; } else { ids = new Set(on.map((d) => d.id)); nicks = new Set(on.map((d) => String(d.data().nick || '').toLowerCase())); }
      window.dispatchEvent(new CustomEvent('mkw-contrib'));
      if (!ids || !myId) return;
      const mine = ids.has(myId);
      let had = null; try { had = localStorage.getItem(HAD); } catch { /* ignore */ }
      if (mine && had !== '1') { try { localStorage.setItem(HAD, '1'); } catch { /* ignore */ } if (had !== null || !s.metadata.fromCache) celebrate(); }
      if (!mine && had === '1') { try { localStorage.setItem(HAD, '0'); } catch { /* ignore */ } sad(); }
      if (!mine && had === null) { try { localStorage.setItem(HAD, '0'); } catch { /* ignore */ } }
    }, () => { ids = null; });
  } catch { /* ignore */ }
}
function pop(cls, kids) {
  const box = h('div', { class: `cb-pop ${cls}`, role: 'dialog' }, h('div', { class: 'cb-card' }, ...kids, h('button', { type: 'button', class: 'btn', onclick: () => { box.classList.remove('show'); setTimeout(() => box.remove(), 300); } }, 'Хорошо')));
  document.body.appendChild(box); requestAnimationFrame(() => box.classList.add('show'));
}
function celebrate() {
  pop('yay', [h('div', { class: 'cb-burst' }, ...Array.from({ length: 14 }, (_, i) => h('i', { style: `--a:${i * (360 / 14)}deg` }))),
    h('img', { class: 'cb-cat', src: 'assets/mkw-cat2.webp', alt: '' }), contribBadge(),
    h('b', { class: 'cb-t', text: 'Вы — Contributor MKW!' }), h('p', { text: 'Создатель выдал вам уникальный значок. Спасибо, что помогаете MKW Music! Его видят все — у ника, в топе и в профиле.' })]);
}
function sad() {
  pop('sad', [h('img', { class: 'cb-cat', src: 'assets/mkw-cat8.webp', alt: '' }), h('b', { class: 'cb-t', text: 'Увы…' }), h('p', { text: 'Создатель решил забрать у вас значок Contributor.' })]);
}
// для создателя: список людей — выдать или забрать
export async function openContribAdmin(listFn) {
  const box = h('div', { class: 'lb-list' }, h('p', { class: 'profile-note', text: 'Загрузка…' }));
  const q = h('input', { class: 'sheet-input', type: 'search', placeholder: 'Найти по нику' });
  openSheet('Значок Contributor', h('div', {}, h('p', { class: 'profile-note', text: 'Выдайте значок тем, кто помогает MKW. Забрать можно в любой момент.' }), q, box));
  const all = (await listFn().catch(() => [])) || [];
  const paint = () => {
    const f = q.value.trim().toLowerCase();
    const rows = all.filter((u) => !f || String(u.nick || '').toLowerCase().includes(f)).sort((a, b) => Number(isContribU(b)) - Number(isContribU(a)));
    box.replaceChildren(...rows.map((u) => {
      const on = isContribU(u);
      return h('div', { class: 'lb-row cb-row' }, h('div', { class: 'lb-body' }, h('div', { class: 'lb-nick' }, h('span', { text: u.nick || 'слушатель' }), on ? contribBadge(true) : null)),
        h('button', { type: 'button', class: `btn ${on ? 'tonal' : ''}`, onclick: async (e) => {
          e.currentTarget.disabled = true;
          try { try { await auth.currentUser.getIdToken(true); } catch {} await setDoc(doc(db, 'contrib', u.uid), { nick: String(u.nick || '').slice(0, 32), on: !on, at: srvNow() }); toast(on ? `Значок забран у ${u.nick}` : `${u.nick} получил(а) значок Contributor`); }
          catch (er) { console.warn(er); toast('Не получилось: ' + (er && er.code || 'ошибка') + '. Перезайдите в аккаунт milokwel'); }
          setTimeout(paint, 600);
        } }, on ? 'Забрать' : 'Выдать'));
    }));
  };
  q.addEventListener('input', paint);
  window.addEventListener('mkw-contrib', paint);
  paint();
}

// нажали на значок у ника (свой или чужой) — показываем его крупно с описанием
export function initBadgeView() {
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.contrib-badge, .fan-badge, .dev-badge, .nick-emo');
    if (!b || b.closest('#sheet, .cb-pop, .pe-mark, .cb-row, .lb-row')) return;
    e.preventDefault(); e.stopPropagation();
    let big, title, text;
    if (b.classList.contains('contrib-badge')) { big = contribBadge(); title = 'Contributor'; text = 'Уникальный значок. Его выдаёт создатель MKW Music тем, кто помогает приложению стать лучше.'; }
    else if (b.classList.contains('dev-badge')) { big = b.cloneNode(true); big.classList.remove('sm'); title = 'Разработчик MKW'; text = 'Создатель MKW Music — делает все обновления и разработку.'; }
    else if (b.classList.contains('fan-badge')) { big = b.cloneNode(true); big.classList.remove('sm'); const n = (b.textContent.match(/\d+/) || [''])[0]; title = `Фанат MKW #${n}`; text = `Номер по порядку: ${n}-й, кто нажал «Мне нравится MKW». Получить свой — Профиль → Изменить → Ник.`; }
    else { const src = b.tagName === 'IMG' ? b.src : (b.querySelector('img') || {}).src; big = h('img', { class: 'bv-emo', src, alt: '' }); title = 'Эмодзи у ника'; text = 'Награда за 3 выполненных ежедневных задания. Каждый день можно забрать ещё одного котика или стикер MKW.'; }
    openSheet('', h('div', { class: 'bv' }, h('div', { class: 'bv-stage' }, h('i', { class: 'achv-glow' }), big), h('b', { class: 'achv-t', text: title }), h('p', { class: 'achv-h', text })));
  }, true);
}
