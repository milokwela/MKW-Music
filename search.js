// Экран поиска.
import { searchTracks } from './catalog.js';
import { $, h, trackRow, emptyState, toast } from './ui.js';
import { openTrackMenu } from './menu.js';
import * as player from './player.js';
import { debounce } from './utils.js';

let currentUser = null;
let results = [];
let controller = null;
let seq = 0;

const histKey = () => `mkw.searchhist.${currentUser || 'anon'}`;
function getHistory() {
  try { return JSON.parse(localStorage.getItem(histKey()) || '[]'); } catch { return []; }
}
function pushHistory(term) {
  const list = [term, ...getHistory().filter((x) => x.toLowerCase() !== term.toLowerCase())].slice(0, 8);
  try { localStorage.setItem(histKey(), JSON.stringify(list)); } catch { /* ignore */ }
}
function clearHistory() {
  try { localStorage.removeItem(histKey()); } catch { /* ignore */ }
}

function renderHistory() {
  const box = $('#search-history');
  const list = getHistory();
  if (!list.length || $('#search-input').value.trim()) { box.replaceChildren(); return; }
  box.replaceChildren(
    ...list.map((term) => h('button', { class: 'chip', type: 'button', onclick: () => { $('#search-input').value = term; run(term); } }, term)),
    h('button', { class: 'chip', type: 'button', 'aria-label': 'Очистить историю', onclick: () => { clearHistory(); renderHistory(); } }, 'Очистить'));
}

function renderResults() {
  const box = $('#search-results');
  box.replaceChildren(...results.map((t, i) => trackRow(t, {
    onPlay: () => player.playTracks(results, i),
    onMore: () => openTrackMenu(t),
    current: player.queue.current?.id === t.id,
  })));
}

async function run(term) {
  const q = term.trim();
  const status = $('#search-status');
  if (!q) {
    results = [];
    renderResults();
    status.replaceChildren();
    renderHistory();
    return;
  }
  if (controller) controller.abort();
  controller = new AbortController();
  const mine = ++seq;
  $('#search-history').replaceChildren();
  status.textContent = 'Ищу…';
  try {
    const found = await searchTracks(q, controller.signal);
    if (mine !== seq) return;
    results = found;
    renderResults();
    status.replaceChildren();
    if (!found.length) status.replaceChildren(emptyState('search', 'Ничего не нашлось. Попробуйте по-другому'));
    else pushHistory(q);
  } catch (e) {
    if (e.name === 'AbortError' || mine !== seq) return;
    console.error(e);
    results = [];
    renderResults();
    status.textContent = 'Не получилось найти. Проверьте интернет и попробуйте ещё раз';
  }
}

export function initSearch() {
  const input = $('#search-input');
  const clear = $('#search-clear');
  const live = debounce(() => run(input.value), 450);
  input.addEventListener('input', () => { clear.hidden = !input.value; live(); });
  $('#search-form').addEventListener('submit', (e) => { e.preventDefault(); live.cancel(); run(input.value); input.blur(); });
  clear.addEventListener('click', () => { input.value = ''; clear.hidden = true; live.cancel(); run(''); input.focus(); });
}

export function setSearchUser(nick) {
  currentUser = nick;
  results = [];
  seq += 1;
  if (controller) controller.abort();
  renderResults();
  $('#search-input').value = '';
  $('#search-clear').hidden = true;
  $('#search-status').replaceChildren();
  renderHistory();
}

export function showSearchTip() { renderHistory(); }
export { toast };
