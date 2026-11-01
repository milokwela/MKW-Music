// Экран поиска: iTunes, поиск по YouTube и рекомендации.
import { searchTracks } from './catalog.js?v=0.17.0';
import { searchYouTube, youtubeEnabled, prefetchYouTubeIds, autoYouTube } from './youtube.js?v=0.17.0';
import { $, h, trackRow, emptyState, toast, skeleton, animateIn } from './ui.js?v=0.17.0';
import { openTrackMenu } from './menu.js?v=0.17.0';
import * as player from './player.js?v=0.17.0';
import * as store from './store.js?v=0.17.0';
import { debounce, shuffled } from './utils.js?v=0.17.0';
import { isArtistBlocked } from './taste.js?v=0.17.0';
import { searchAudius, audiusEnabled } from './audius.js?v=0.17.0';
import { getSourceMode } from './sources.js?v=0.17.0';
import { youtubeQuotaOut } from './youtube.js?v=0.17.0';
import { initShazam } from './shazam.js?v=0.17.0';
import { looksLikeUrl, resolveLink } from './links.js?v=0.17.0';

let currentUser = null;
let results = [];
let recs = [];
let recsLoaded = false;
let recsShown = 20;
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

const inputEmpty = () => !$('#search-input').value.trim();
const syncWave = () => { const b = $('#wave-btn'); if (b) b.hidden = !inputEmpty(); };

function renderHistory() {
  const box = $('#search-history');
  const list = getHistory();
  if (!list.length || !inputEmpty()) { box.replaceChildren(); return; }
  box.replaceChildren(
    ...list.map((term) => h('button', { class: 'chip', type: 'button', onclick: () => { $('#search-input').value = term; $('#search-clear').hidden = false; run(term, true); } }, term)),
    h('button', { class: 'chip', type: 'button', onclick: () => { clearHistory(); renderHistory(); } }, 'Очистить'));
}

function renderRecs() {
  const box = $('#search-recs');
  if (!recs.length || !inputEmpty()) { box.replaceChildren(); return; }
  animateIn(box);
  box.replaceChildren(
    h('div', { class: 'section-title', text: 'Для вас' }),
    h('div', { class: 'list' }, recs.slice(0, recsShown).map((t, i) => trackRow(t, {
      onPlay: () => player.playTracks(recs, i),
      onMore: () => openTrackMenu(t),
      current: player.queue.current?.id === t.id,
    }))),
    recsShown < recs.length ? h('div', { style: 'text-align:center;margin:14px 0' }, h('button', { class: 'chip', type: 'button', onclick: () => { recsShown += 20; renderRecs(); } }, `Показать ещё (${recs.length - recsShown})`)) : null);
}

// Рекомендации: берём исполнителей из лайков и истории и ищем их другие треки.
async function loadRecs() {
  if (recsLoaded) return;
  const seen = [...store.state.likes, ...store.state.history];
  if (!seen.length) return;
  recsLoaded = true;
  const artists = shuffled([...new Set(seen.map((t) => t.artist).filter((a) => a && !isArtistBlocked(a)))]).slice(0, 8);
  const batches = await Promise.allSettled(artists.map((a) => searchTracks(a)));
  const known = new Set(seen.map((t) => t.id));
  const pool = [];
  const ids = new Set();
  for (const b of batches) {
    if (b.status !== 'fulfilled') continue;
    for (const t of b.value) {
      if (known.has(t.id) || ids.has(t.id) || isArtistBlocked(t.artist)) continue;
      ids.add(t.id);
      pool.push(t);
    }
  }
  recs = shuffled(pool).slice(0, 60);
  recsShown = 20;
  renderRecs();
  prefetchYouTubeIds(recs);
}

function renderResults() {
  const box = $('#search-results');
  box.replaceChildren(...results.map((t, i) => trackRow(t, {
    onPlay: () => player.playTracks(results, i),
    onMore: () => openTrackMenu(t),
    current: player.queue.current?.id === t.id,
  })));
  if (results.length) { animateIn(box); prefetchYouTubeIds(results); }
}

function renderMore(term) {
  const box = $('#search-more');
  if (!term || !youtubeEnabled()) { box.replaceChildren(); return; }
  const btn = h('button', { class: 'btn tonal', type: 'button' }, 'Не нашли? Искать на YouTube');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Ищу на YouTube…';
    try {
      const found = await searchYouTube(term);
      const have = new Set(results.map((t) => t.id));
      results = [...results, ...found.filter((t) => !have.has(t.id))];
      renderResults();
      box.replaceChildren();
      if (!found.length) toast('На YouTube тоже пусто');
    } catch (e) {
      console.error(e);
      btn.disabled = false;
      btn.textContent = 'Не получилось. Попробовать снова';
      toast(String(e.message || e).includes('Лимит') ? e.message : 'YouTube не ответил');
    }
  });
  box.replaceChildren(btn);
}

async function run(term, explicit = false) {
  const q = term.trim();
  syncWave();
  const status = $('#search-status');
  if (!q) {
    results = [];
    renderResults();
    status.replaceChildren();
    renderMore('');
    renderHistory();
    renderRecs();
    return;
  }
  if (controller) controller.abort();
  controller = new AbortController();
  const mine = ++seq;
  if (looksLikeUrl(q)) {
    if (!explicit) return;
    status.replaceChildren(skeleton(3));
    const r = await resolveLink(q);
    if (mine !== seq) return;
    status.replaceChildren();
    if (r.track) { results = [r.track]; renderResults(); renderMore(''); toast('Трек найден по ссылке'); return; }
    if (r.query) { $('#search-input').value = r.query; return run(r.query, true); }
    results = []; renderResults(); status.textContent = r.error; return;
  }
  $('#search-history').replaceChildren();
  $('#search-recs').replaceChildren();
  renderMore('');
  status.replaceChildren(skeleton(6));

  // При явном поиске (Enter) сразу ищем и на YouTube: у этих треков видео уже известно, они стартуют мгновенно.
  const mode = getSourceMode();
  const useItunes = mode === 'all' || mode === 'itunes';
  const useAudius = mode === 'all' || mode === 'audius';
  const wantYt = youtubeEnabled() && (mode === 'youtube' ? true : (mode === 'all' && explicit && autoYouTube()));
  if (mode === 'youtube' && !explicit) { status.replaceChildren(); results = []; renderResults(); status.textContent = 'Нажмите Enter, чтобы искать на YouTube'; return; }
  let ytError = '';
  const ytPromise = wantYt ? searchYouTube(q).catch((e) => { ytError = String(e.message || e); return []; }) : Promise.resolve([]);

  const auPromise = (audiusEnabled() && useAudius) ? searchAudius(q, controller.signal).catch(() => []) : Promise.resolve([]);
  let found = [];
  let failed = false;
  try {
    found = useItunes ? await searchTracks(q, controller.signal) : [];
  } catch (e) {
    if (e.name === 'AbortError' || mine !== seq) return;
    console.error(e);
    failed = true;
  }
  if (mine !== seq) return;
  results = found;
  renderResults();
  status.replaceChildren();

  {
    const au = await auPromise;
    if (mine !== seq) return;
    if (au.length) { const have = new Set(results.map((t) => t.id)); results = [...results, ...au.filter((t) => !have.has(t.id))]; renderResults(); }
  }

  if (wantYt) {
    const ytFound = await ytPromise;
    if (mine !== seq) return;
    const have = new Set(results.map((t) => t.id));
    results = [...results, ...ytFound.filter((t) => !have.has(t.id))];
    renderResults();
  }

  if (ytError && !results.length) status.textContent = ytError.includes('Лимит') ? 'Лимит YouTube на сегодня закончился (сбросится вечером). Выберите другой источник в Профиле' : 'YouTube не ответил';
  else if (ytError) toast(ytError.includes('Лимит') ? 'Лимит YouTube закончился: показаны остальные источники' : 'YouTube не ответил');
  if (!results.length && !ytError) {
    if (failed) status.textContent = 'Каталог не ответил. Проверьте интернет';
    else status.replaceChildren(emptyState('search', 'Ничего не нашлось'));
  } else if (results.length) {
    pushHistory(q);
  }
  renderMore(wantYt || mode !== 'all' ? '' : q);
}

export function initSearch() {
  const input = $('#search-input');
  const clear = $('#search-clear');
  const live = debounce(() => run(input.value), 450);
  input.addEventListener('input', () => { clear.hidden = !input.value; syncWave(); live(); });
  $('#search-form').addEventListener('submit', (e) => { e.preventDefault(); live.cancel(); run(input.value, true); input.blur(); });
  initShazam((term) => { input.value = term; clear.hidden = false; run(term, true); });
  clear.addEventListener('click', () => { input.value = ''; clear.hidden = true; live.cancel(); run(''); input.focus(); });
  store.onStore((what) => { if (what === 'likes' || what === 'history') loadRecs(); });
}

export function setSearchUser(nick) {
  currentUser = nick;
  let hr = new Date().getHours();
  try { hr = Number(new Intl.DateTimeFormat('ru-RU', { hour: 'numeric', hour12: false, timeZone: 'Asia/Barnaul' }).format(new Date())) % 24; } catch { /* локальное время */ }
  const hi = hr < 5 ? 'Доброй ночи' : hr < 12 ? 'Доброе утро' : hr < 18 ? 'Добрый день' : 'Добрый вечер';
  $('#search-hello').textContent = `${hi}, ${nick}`;
  results = [];
  recs = [];
  recsLoaded = false;
  seq += 1;
  if (controller) controller.abort();
  renderResults();
  renderMore('');
  $('#search-input').value = '';
  $('#search-clear').hidden = true;
  $('#search-status').replaceChildren();
  $('#search-recs').replaceChildren();
  renderHistory();
}
