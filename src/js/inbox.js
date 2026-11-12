// «Сообщения» — только для создателя MKW (Настройки → внизу). Три вкладки:
//   Ошибки — что прислали слушатели (текст, скриншоты, видео, телефон и версия);
//   Оценки — оценки оптимизации 0–10, среднее и разброс;
//   Статистика — анонимные данные о работе MKW на разных телефонах за 7 дней (telemetry.js).
import { db, auth } from './firebase.js';
import { doc, getDoc, getDocs, collection, query, where, orderBy, limit, getCountFromServer, writeBatch } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { h, toast, openSheet, closeSheet } from './ui.js';
import { mi } from './icons2.js';
import { openImage } from './viewer.js';
import { OWNER_UID } from './auth.js';
import { RATE_TEXT, RATE_VER } from './feedback.js';

export const isOwnerMe = () => Boolean(auth.currentUser && auth.currentUser.uid === OWNER_UID);
const Q_NAMES = ['Экономия', 'Лёгкий', 'Сбаланс.', 'Максимум'];
const TIERS = ['слабый', 'средний', 'мощный'];

export async function unreadCount() {
  if (!isOwnerMe()) return 0;
  try { return (await getCountFromServer(query(collection(db, 'reports'), where('read', '==', false)))).data().count; } catch { return 0; }
}

const when = (t) => {
  const d = new Date(t || 0), now = new Date();
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `сегодня ${hm}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `вчера ${hm}`;
  return `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} ${hm}`;
};
const envLine = (e = {}) => [
  e.model || e.brand || '', e.os ? `Android ${e.os}` : '', e.app ? `приложение ${e.app}` : `сайт ${e.site || ''}`,
  e.ram ? `${Math.round(e.ram / 102.4) / 10} ГБ` : '', e.hz ? `${e.hz} Гц` : '', e.wv ? `WebView ${e.wv}` : '',
  e.q >= 0 ? `графика: ${Q_NAMES[e.q] || e.q}${e.qm === 'auto' ? ' (авто)' : ''}` : '',
].filter(Boolean).join(' · ');

async function loadAtt(rid, a) {
  const ids = Array.from({ length: a.parts }, (_, j) => `${a.i}-${String(j).padStart(3, '0')}`);
  const snaps = await Promise.all(ids.map((id) => getDoc(doc(db, 'reports', rid, 'parts', id))));
  if (snaps.some((s) => !s.exists())) throw new Error('missing');
  return snaps.map((s) => s.data().d).join('');
}

function playVideo(dataUrl) {
  let blobUrl = dataUrl;
  try {
    const [head, b64] = dataUrl.split(',');
    const bin = atob(b64); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    blobUrl = URL.createObjectURL(new Blob([u8], { type: (/data:([^;]+)/.exec(head) || [])[1] || 'video/mp4' }));
  } catch { /* играем как есть */ }
  const v = h('video', { src: blobUrl, controls: '', playsinline: '', autoplay: '' });
  const step = window.__mkwStep;
  const close = (fromBack) => { box.remove(); if (blobUrl.startsWith('blob:')) URL.revokeObjectURL(blobUrl); if (step && fromBack !== true) step.close('report-video'); };
  const box = h('div', { class: 'rv-video', role: 'dialog' }, v,
    h('button', { type: 'button', class: 'iv2-btn rv-x', 'aria-label': 'Закрыть', onclick: () => close() }, mi('close')));
  if (step) step.open('report-video', () => close(true));
  document.body.appendChild(box);
}

function attTile(rid, a) {
  const tile = h('button', { type: 'button', class: `rp-att ${a.type}` },
    a.thumb ? h('img', { src: a.thumb, alt: '' }) : h('span', { class: 'fb-ph' }, mi(a.type === 'video' ? 'play' : 'image')),
    a.type === 'video' ? h('span', { class: 'fb-dur' }, mi('play'), a.dur ? ` ${Math.floor(a.dur / 60)}:${String(a.dur % 60).padStart(2, '0')}` : '') : null,
    h('small', { class: 'rp-size', text: a.size < 1048576 ? `${Math.max(1, Math.round(a.size / 1024))} КБ` : `${(a.size / 1048576).toFixed(1)} МБ` }));
  let cache = null;
  tile.addEventListener('click', async () => {
    if (tile.classList.contains('busy')) return;
    tile.classList.add('busy');
    try {
      cache = cache || await loadAtt(rid, a);
      if (a.type === 'video') playVideo(cache); else openImage(cache, 'Вложение');
    } catch { toast('Вложение не загрузилось (возможно, отправка прервалась)'); }
    tile.classList.remove('busy');
  });
  return tile;
}

async function removeReport(r) {
  const b = writeBatch(db);
  for (const a of r.att || []) for (let j = 0; j < a.parts; j++) b.delete(doc(db, 'reports', r.id, 'parts', `${a.i}-${String(j).padStart(3, '0')}`));
  b.delete(doc(db, 'reports', r.id));
  await b.commit();
}

function reportCard(r, onGone) {
  const card = h('div', { class: `rp-card${r.read ? '' : ' new'}` },
    h('div', { class: 'rp-head' },
      h('button', { type: 'button', class: 'rp-nick', text: r.nick || 'слушатель', onclick: async () => { try { const m = await import('./userpage.js'); closeSheet(); m.openUserPage(r.uid); } catch { /* ignore */ } } }),
      r.kind === 'rate' ? h('span', { class: 'rp-score', style: `--k:${(r.score || 0) / 10}`, text: `${r.score}/10` }) : null,
      h('span', { class: 'rp-time', text: when(r.at) })),
    r.kind === 'rate' ? h('div', { class: 'rp-rate-t', text: RATE_TEXT[r.score] || '' }) : null,
    r.text ? h('p', { class: 'rp-text', text: r.text }) : null,
    r.up ? h('p', { class: 'rp-warn', text: 'Вложения не догрузились — человек мог закрыть приложение во время отправки' }) : null,
    (r.att || []).length ? h('div', { class: 'rp-atts' }, ...(r.att || []).map((a) => attTile(r.id, a))) : null,
    h('div', { class: 'rp-env', text: envLine(r.env) }),
    h('div', { class: 'rp-acts' },
      h('button', { type: 'button', class: 'btn tonal small', onclick: async (e) => {
        const btn = e.currentTarget;
        if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.textContent = 'Точно удалить?'; setTimeout(() => { btn.dataset.sure = ''; btn.textContent = 'Удалить'; }, 3000); return; }
        btn.disabled = true;
        try { await removeReport(r); card.remove(); onGone(r); } catch { toast('Не получилось удалить'); btn.disabled = false; }
      } }, 'Удалить')));
  return card;
}

// ---------- статистика ----------

function statsView(rows) {
  if (!rows.length) return h('p', { class: 'profile-note', text: 'Пока нет данных. Статистика приходит раз в день с каждого телефона, где включена «Анонимная статистика».' });
  const ids = new Set(rows.map((r) => r.id.split('_')[1]));
  const sum = (f) => rows.reduce((s, r) => s + (Number(f(r)) || 0), 0);
  const pr = sum((r) => r.pr), bad = sum((r) => r.bad);
  const hot = rows.filter((r) => r.th >= 2).length;
  const err = sum((r) => r.err);
  const bootRows = rows.filter((r) => r.boot > 0);
  const kpi = (v, t) => h('div', { class: 'st-kpi' }, h('b', { text: v }), h('small', { text: t }));
  // по моделям: худшие по плавности сверху
  const by = new Map();
  for (const r of rows) {
    const d = r.dev || {};
    const k = d.model || d.brand || 'неизвестно';
    const m = by.get(k) || { k, ids: new Set(), pr: 0, bad: 0, med: 0, medN: 0, hot: 0, n: 0, q: [0, 0, 0, 0], boot: 0, bootN: 0, ram: d.ram, hz: d.hz, tier: d.tier, wv: d.wv, fg: 0 };
    m.ids.add(r.id.split('_')[1]); m.n += 1; m.pr += r.pr || 0; m.bad += r.bad || 0; m.fg += r.fg || 0;
    if (r.med) { m.med += r.med; m.medN += 1; }
    if (r.th >= 2) m.hot += 1;
    if (r.q >= 0 && r.q <= 3) m.q[r.q] += 1;
    if (r.boot) { m.boot += r.boot; m.bootN += 1; }
    by.set(k, m);
  }
  const models = [...by.values()].sort((a, b) => (b.pr ? b.bad / b.pr : 0) - (a.pr ? a.bad / a.pr : 0) || b.ids.size - a.ids.size);
  const qAll = [0, 0, 0, 0]; for (const r of rows) if (r.q >= 0 && r.q <= 3) qAll[r.q] += 1;
  const errs = new Map(); for (const r of rows) for (const m of r.errs || []) errs.set(m, (errs.get(m) || 0) + 1);
  const ver = new Map(); for (const r of rows) { const v = r.v ? `приложение ${r.v}` : `сайт ${r.s}`; ver.set(v, (ver.get(v) || 0) + 1); }
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  return h('div', { class: 'st-box' },
    h('div', { class: 'st-kpis' },
      kpi(String(ids.size), 'устройств за 7 дней'),
      kpi(pct(bad, pr), 'замеров с рывками'),
      kpi(pct(hot, rows.length), 'дней с нагревом'),
      kpi(bootRows.length ? `${(bootRows.reduce((s, r) => s + r.boot, 0) / bootRows.length / 1000).toFixed(1)} с` : '—', 'запуск в среднем')),
    h('div', { class: 'st-h', text: 'Уровень графики сейчас' }),
    h('div', { class: 'st-bars' }, ...qAll.map((n, i) => h('div', { class: 'st-bar' }, h('span', { text: Q_NAMES[i] }), h('i', { style: `--w:${rows.length ? n / rows.length : 0}` }), h('b', { text: String(n) })))),
    h('div', { class: 'st-h', text: 'Телефоны (сверху — где больше рывков)' }),
    h('div', { class: 'st-table' },
      h('div', { class: 'st-tr head' }, h('span', { text: 'Модель' }), h('span', { text: 'Рывки' }), h('span', { text: 'Кадр' }), h('span', { text: 'Нагрев' })),
      ...models.slice(0, 25).map((m) => h('div', { class: 'st-tr' },
        h('span', { class: 'st-model' }, h('b', { text: m.k }), h('small', { text: [`${m.ids.size} устр.`, m.ram ? `${Math.round(m.ram / 102.4) / 10} ГБ` : '', m.hz ? `${m.hz} Гц` : '', m.tier >= 0 ? TIERS[m.tier] : '', m.wv ? `WV ${m.wv}` : '', m.bootN ? `запуск ${(m.boot / m.bootN / 1000).toFixed(1)} с` : ''].filter(Boolean).join(' · ') })),
        h('span', { class: m.pr && m.bad / m.pr > 0.3 ? 'bad' : '', text: pct(m.bad, m.pr) }),
        h('span', { text: m.medN ? `${Math.round(m.med / m.medN)} мс` : '—' }),
        h('span', { class: m.hot ? 'bad' : '', text: m.hot ? `${m.hot} дн.` : 'нет' })))),
    h('div', { class: 'st-h', text: 'Версии' }),
    h('p', { class: 'profile-note', text: [...ver.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`).join(' · ') }),
    h('div', { class: 'st-h', text: `Ошибки в коде: ${err}` }),
    errs.size ? h('ul', { class: 'st-errs' }, ...[...errs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([m, n]) => h('li', {}, h('b', { text: `×${n} ` }), m))) : h('p', { class: 'profile-note', text: 'Нет' }),
    h('p', { class: 'profile-note', text: '«Рывки» — доля замеров при прокрутке, где телефон не успевал рисовать кадры. «Кадр» — средний шаг кадра при прокрутке (8 мс — 120 Гц, 16 мс — 60 Гц). Данные анонимные: без ников и аккаунтов.' }));
}

function rateSummary(list) {
  const rated = list.filter((r) => r.kind === 'rate' && r.ver === RATE_VER);
  if (!rated.length) return h('p', { class: 'profile-note', text: `Оценок оптимизации ${RATE_VER} пока нет.` });
  const avg = rated.reduce((s, r) => s + r.score, 0) / rated.length;
  const dist = Array(11).fill(0); rated.forEach((r) => { dist[r.score] += 1; });
  const max = Math.max(...dist);
  return h('div', { class: 'rt-sum' },
    h('div', { class: 'rt-avg' }, h('b', { text: avg.toFixed(1) }), h('span', { text: `из 10 · ${rated.length} ${rated.length % 10 === 1 && rated.length % 100 !== 11 ? 'оценка' : rated.length % 10 >= 2 && rated.length % 10 <= 4 && (rated.length % 100 < 12 || rated.length % 100 > 14) ? 'оценки' : 'оценок'}` })),
    h('div', { class: 'rt-dist' }, ...dist.map((n, i) => h('div', { class: 'rt-col', title: RATE_TEXT[i] }, h('i', { style: `--h:${max ? n / max : 0};--k:${i / 10}` }), h('small', { text: String(i) })))));
}

// ---------- окно ----------

export async function openInbox() {
  if (!isOwnerMe()) return;
  let tab = 'bug';
  let list = [];
  let stats = null;
  const body = h('div', { class: 'ib-body' }, h('p', { class: 'profile-note', text: 'Загрузка…' }));
  const tabs = h('div', { class: 'ib-tabs' });
  const paintTabs = () => {
    const nb = list.filter((r) => r.kind === 'bug' && !r.read).length, nr = list.filter((r) => r.kind === 'rate' && !r.read).length;
    const t = (id, name, n) => h('button', { type: 'button', class: `chip${tab === id ? ' active' : ''}`, onclick: () => { tab = id; paint(); } }, name, n ? h('span', { class: 'ib-n', text: String(n) }) : null);
    tabs.replaceChildren(t('bug', 'Ошибки', nb), t('rate', 'Оценки', nr), t('stats', 'Статистика', 0));
  };
  const gone = (r) => { list = list.filter((x) => x.id !== r.id); paintTabs(); window.dispatchEvent(new Event('mkw-inbox')); };
  const paint = async () => {
    paintTabs();
    if (tab === 'stats') {
      if (!stats) {
        body.replaceChildren(h('p', { class: 'profile-note', text: 'Считаю…' }));
        const d = new Date(); d.setDate(d.getDate() - 6);
        const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        try { stats = (await getDocs(query(collection(db, 'perf'), where('day', '>=', from), limit(2000)))).docs.map((s) => ({ id: s.id, ...s.data() })); }
        catch (e) { body.replaceChildren(h('p', { class: 'profile-note', text: `Не загрузилось: ${(e && e.code) || 'ошибка'}. Опубликованы ли новые правила Firestore?` })); return; }
      }
      if (tab === 'stats') body.replaceChildren(statsView(stats));
      return;
    }
    const items = list.filter((r) => r.kind === tab);
    body.replaceChildren(...[
      tab === 'rate' ? rateSummary(list) : null,
      ...(items.length ? items.map((r) => reportCard(r, gone)) : [h('p', { class: 'profile-note', text: tab === 'bug' ? 'Сообщений об ошибках пока нет.' : 'Оценок пока нет.' })])].filter(Boolean));
    // открыли вкладку — всё в ней прочитано
    const unread = items.filter((r) => !r.read);
    if (unread.length) {
      const b = writeBatch(db); unread.forEach((r) => b.update(doc(db, 'reports', r.id), { read: true }));
      b.commit().then(() => { unread.forEach((r) => { r.read = true; }); paintTabs(); window.dispatchEvent(new Event('mkw-inbox')); }).catch(() => {});
    }
  };
  openSheet('Сообщения', h('div', { class: 'ib-box' }, tabs, body));
  try {
    list = (await getDocs(query(collection(db, 'reports'), orderBy('at', 'desc'), limit(200)))).docs.map((s) => ({ id: s.id, ...s.data() }));
  } catch (e) {
    body.replaceChildren(h('p', { class: 'profile-note', text: `Не загрузилось: ${(e && e.code) || 'ошибка'}. Опубликуйте новые правила Firestore (я присылал текстом).` }));
    return;
  }
  if (!list.some((r) => r.kind === 'bug') && list.some((r) => r.kind === 'rate')) tab = 'rate';
  paint();
}

/** Пришли по уведомлению «новое сообщение» (#reports) — открыть «Сообщения». */
export function initInbox() {
  const go = () => {
    if (location.hash !== '#reports') return;
    const t = setInterval(() => {
      if (!auth.currentUser) return;
      clearInterval(t);
      try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }
      if (isOwnerMe()) openInbox();
    }, 500);
    setTimeout(() => clearInterval(t), 20000);
  };
  window.addEventListener('hashchange', go);
  go();
}

