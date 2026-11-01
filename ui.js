// Общие кирпичики интерфейса: создание элементов, иконки, уведомления, нижние шторки, строка трека.
import { artUrl } from './utils.js?v=0.13.1';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(name, cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', cls ? `icon ${cls}` : 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.appendChild(use);
  return svg;
}

export function setIcon(svg, name) {
  const use = svg.querySelector('use');
  if (use) use.setAttribute('href', `#i-${name}`);
}

// h('div', { class: 'x', onclick: fn, text: 'привет' }, child1, 'текст')
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ---------- уведомление ----------
let toastTimer = null;
export function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- нижняя шторка ----------
export function openSheet(title, content) {
  const sheet = $('#sheet');
  sheet.replaceChildren(...[h('div', { class: 'sheet-handle' }), title ? h('h2', { class: 'sheet-title', text: title }) : null, content].filter(Boolean));
  sheet.scrollTop = 0;
  $('#sheet-overlay').classList.add('open');
  sheet.classList.add('open');
}

export function closeSheet() {
  $('#sheet').classList.remove('open');
  $('#sheet-overlay').classList.remove('open');
}

export function isSheetOpen() { return $('#sheet').classList.contains('open'); }

export function sheetItem(iconName, label, onClick, danger = false) {
  return h('button', { class: danger ? 'sheet-item danger' : 'sheet-item', type: 'button', onclick: onClick }, icon(iconName), label);
}

// Запрос текста (создание плейлиста и т.п.) в шторке. Возвращает Promise<string|null>.
export function askText(title, placeholder, initial = '', okLabel = 'Готово') {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; closeSheet(); resolve(v); };
    const input = h('input', { type: 'text', maxlength: '60', placeholder, value: initial });
    const form = h('form', { onsubmit: (e) => { e.preventDefault(); finish(input.value.trim() || null); } },
      h('label', { class: 'field' }, input),
      h('div', { style: 'display:flex;gap:8px;justify-content:flex-end' },
        h('button', { class: 'btn text', type: 'button', onclick: () => finish(null) }, 'Отмена'),
        h('button', { class: 'btn', type: 'submit' }, okLabel)));
    openSheet(title, form);
    const cancel = () => finish(null);
    $('#sheet-overlay').addEventListener('click', cancel, { once: true });
    setTimeout(() => { input.focus(); input.select(); }, 280);
  });
}

// ---------- обложки и строки треков ----------
export function artEl(track, extraClass = '') {
  const box = h('div', { class: `track-art ${extraClass}`.trim() });
  const fallback = () => box.replaceChildren(icon('music'));
  if (track.artwork) {
    const img = h('img', { src: artUrl(track.artwork, 200), alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', fallback);
    box.appendChild(img);
  } else {
    fallback();
  }
  return box;
}

function withEq(art) {
  art.appendChild(h('span', { class: 'eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')));
  return art;
}

// Скелетон (мерцающие заглушки) на время загрузки.
export function skeleton(n = 6) {
  return h('div', { class: 'list skeleton' }, Array.from({ length: n }, () => h('div', { class: 'track-row' },
    h('div', { class: 'main' }, h('div', { class: 'track-art sk' }),
      h('div', { class: 'track-info' }, h('div', { class: 'sk-line w60' }), h('div', { class: 'sk-line w35' }))))));
}

// Плавное появление дочерних элементов по очереди.
export function animateIn(el) {
  if (!el) return;
  el.classList.remove('enter');
  void el.offsetWidth;
  el.classList.add('enter');
  setTimeout(() => el.classList.remove('enter'), 1000);
}

// opts: { onPlay, onMore, current, sub }
export function trackRow(track, opts = {}) {
  const unavailable = !track.previewUrl && !opts.allowNoPreview;
  const row = h('div', { class: 'track-row', 'data-tid': track.id },
    h('button', { class: 'main', type: 'button', onclick: opts.onPlay },
      withEq(artEl(track)),
      h('div', { class: 'track-info' },
        h('div', { class: 'track-title', text: track.title }),
        h('div', { class: 'track-sub', text: opts.sub ?? track.artist }))),
    opts.onMore ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Действия', onclick: opts.onMore }, icon('more')) : null);
  if (opts.current) row.classList.add('current');
  if (unavailable && opts.dimUnavailable) row.classList.add('unavailable');
  return row;
}

export function highlightCurrent(trackId) {
  $$('.track-row[data-tid]').forEach((r) => r.classList.toggle('current', r.dataset.tid === String(trackId)));
}

export function emptyState(iconName, text) {
  return h('div', { class: 'empty' }, icon(iconName), h('div', { text }));
}

document.addEventListener('DOMContentLoaded', () => {
  $('#sheet-overlay').addEventListener('click', closeSheet);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
