// Импорт музыки из других сервисов (1.6): Яндекс Музыка, Spotify и любые другие.
// Напрямую чужие аккаунты читать нельзя (сервисы этого не разрешают), поэтому импорт идёт по списку песен:
// текст «Исполнитель - Название» по строкам или файл CSV/TXT, который отдают сервисы переноса музыки.
// Каждую песню ищем в каталоге MKW и складываем в «Любимое» или в новый плейлист.
import { h, toast, openSheet, closeSheet } from './ui.js';
import { mi } from './icons2.js';
import { searchTracks } from './catalog.js';
import * as store from './store.js';

const MAX = 300;
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s*[([][^)\]]*[)\]]/g, ' ').replace(/\s(feat|ft)\.?\s.*$/, '').replace(/[^a-zа-я0-9]+/g, ' ').trim();

// строка CSV с кавычками → ячейки
function csvRow(line, sep) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === sep) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/** Текст или CSV → [{ artist, title }]. Понимает Exportify (Spotify), TuneMyMusic, «Исполнитель - Название». */
export function parseList(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const out = [];
  const head = lines[0].toLowerCase();
  const sep = head.includes('\t') ? '\t' : head.includes(';') && !head.includes(',') ? ';' : ',';
  const cols = csvRow(lines[0], sep).map((c) => c.toLowerCase());
  const ti = cols.findIndex((c) => /^(track name|track|title|название|трек|song|name)$/.test(c));
  const ai = cols.findIndex((c) => /^(artist name\(s\)|artist name|artists?|исполнитель|артист)$/.test(c));
  if (ti >= 0 && ai >= 0 && cols.length > 1) {
    for (const l of lines.slice(1)) { const r = csvRow(l, sep); if (r[ti]) out.push({ artist: (r[ai] || '').split(/[;,]/)[0].trim(), title: r[ti] }); }
  } else {
    for (let l of lines) {
      l = l.replace(/^\d+[.)]\s*/, '');
      const m = l.split(/\s+[-–—]\s+|\t+/);
      if (m.length >= 2) out.push({ artist: m[0].trim(), title: m.slice(1).join(' - ').trim() });
      else if (l.length > 1) out.push({ artist: '', title: l });
    }
  }
  const seen = new Set();
  return out.filter((x) => { const k = `${norm(x.artist)}|${norm(x.title)}`; if (!x.title || seen.has(k)) return false; seen.add(k); return true; }).slice(0, MAX);
}

async function findOne(x) {
  let list = [];
  try { list = await searchTracks(`${x.artist} ${x.title}`.trim()); } catch { list = []; }
  const wt = norm(x.title), wa = norm(x.artist).split(' ')[0] || '';
  let best = null, bs = 0;
  list.slice(0, 12).forEach((t, i) => {
    const tt = norm(t.title), ta = norm(t.artist);
    let s = 0;
    if (tt === wt) s += 5; else if (tt.includes(wt) || wt.includes(tt)) s += 3;
    if (wa && ta.includes(wa)) s += 4; else if (!wa) s += 1;
    s -= i * 0.15;
    if (s > bs) { bs = s; best = t; }
  });
  return bs >= (wa ? 6 : 4) ? best : null;
}

export function openImport() {
  if (!store.state.uid) { toast('Сначала войдите в аккаунт'); return; }
  let target = 'playlist', busy = false, stop = false;
  const area = h('textarea', { class: 'sheet-input imp-area', rows: '6', placeholder: 'Исполнитель - Название\nИсполнитель - Название\n…' });
  const file = h('input', { type: 'file', accept: '.csv,.txt,.tsv,text/plain,text/csv', hidden: '' });
  const count = h('small', { class: 'imp-count', text: 'Вставьте список или выберите файл' });
  const upd = () => { const n = parseList(area.value).length; count.textContent = n ? `Нашла песен в списке: ${n}${n >= MAX ? ` (за один раз — не больше ${MAX})` : ''}` : 'Вставьте список или выберите файл'; go.disabled = !n || busy; };
  area.addEventListener('input', upd);
  file.addEventListener('change', async () => { const f = file.files && file.files[0]; if (!f) return; try { area.value = await f.text(); upd(); } catch { toast('Не получилось прочитать файл'); } });
  const tgt = (id, ic, text) => h('button', { type: 'button', class: `chip imp-tgt${target === id ? ' active' : ''}`, 'data-id': id, onclick: (e) => { target = id; box.querySelectorAll('.imp-tgt').forEach((b) => b.classList.toggle('active', b === e.currentTarget)); } }, mi(ic), h('span', { text }));
  const bar = h('div', { class: 'imp-bar', hidden: '' }, h('i'));
  const status = h('small', { class: 'imp-status' });
  const go = h('button', { class: 'btn block', type: 'button', disabled: '' }, 'Импортировать');
  go.addEventListener('click', async () => {
    if (busy) { stop = true; return; }
    const list = parseList(area.value);
    if (!list.length) return;
    busy = true; stop = false; go.textContent = 'Остановить'; bar.hidden = false; area.disabled = true;
    const found = [], missed = [];
    for (let i = 0; i < list.length && !stop; i++) {
      status.textContent = `Ищу ${i + 1} из ${list.length}: ${list[i].artist ? `${list[i].artist} — ` : ''}${list[i].title}`;
      bar.firstChild.style.width = `${Math.round(((i + 1) / list.length) * 100)}%`;
      const t = await findOne(list[i]);
      if (t && !found.some((f) => f.id === t.id)) found.push(t); else if (!t) missed.push(list[i]);
      await new Promise((r) => setTimeout(r, 260)); // бережно к каталогу: не больше 3–4 запросов в секунду
    }
    let saved = 0;
    try {
      if (found.length) {
        status.textContent = 'Сохраняю…';
        if (target === 'likes') saved = await store.likeMany(found);
        else { await store.createPlaylistWith(`Импорт ${new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`, found); saved = found.length; }
      }
    } catch (e) { console.error(e); toast('Не получилось сохранить — проверьте интернет'); }
    busy = false; area.disabled = false; go.textContent = 'Импортировать'; go.disabled = false;
    const miss = missed.slice(0, 40).map((x) => `${x.artist ? `${x.artist} — ` : ''}${x.title}`);
    box.replaceChildren(
      h('div', { class: 'imp-done' }, h('i', {}, mi('check')), h('b', { text: `Готово: ${saved} из ${list.length}` }),
        h('small', { text: target === 'likes' ? 'Песни добавлены в «Любимое»' : 'Создан новый плейлист — он в Библиотеке → Плейлисты' })),
      miss.length ? h('details', { class: 'imp-miss' }, h('summary', { text: `Не нашлись в каталоге: ${missed.length}` }), h('ul', {}, ...miss.map((m) => h('li', { text: m })))) : null,
      h('button', { class: 'btn block', type: 'button', text: 'Отлично', onclick: closeSheet }));
  });
  const box = h('div', { class: 'imp' },
    h('p', { class: 'imp-note', text: 'Перенесите свою музыку в MKW. Нужен список песен — по одной в строке, «Исполнитель - Название», или файл CSV / TXT.' }),
    h('details', { class: 'imp-how' }, h('summary', { text: 'Где взять список' }),
      h('ul', {},
        h('li', { text: 'Яндекс Музыка: сервисы переноса музыки (например, TuneMyMusic) умеют прочитать ваш плейлист или «Мне нравится» и сохранить список в файл TXT или CSV.' }),
        h('li', { text: 'Spotify: Exportify сохраняет любой плейлист в CSV — выберите этот файл здесь.' }),
        h('li', { text: 'Любой другой сервис или заметки: просто вставьте строки «Исполнитель - Название».' }))),
    area,
    h('div', { class: 'imp-row' }, h('button', { class: 'btn tonal', type: 'button', onclick: () => file.click() }, mi('folder'), h('span', { text: 'Выбрать файл' })), count, file),
    h('div', { class: 'imp-tgts' }, h('small', { text: 'Куда сохранить' }), h('div', {}, tgt('playlist', 'playlist', 'Новый плейлист'), tgt('likes', 'heart', 'В «Любимое»'))),
    bar, status, go);
  openSheet('Импорт музыки', box);
}
