// Интерфейс плеера: мини-плеер, большой плеер, очередь, таймер сна.
import { $, h, icon, setIcon, artEl, trackRow, openSheet, closeSheet, sheetItem, highlightCurrent, toast, emptyState } from './ui.js?v=0.10.0';
import { openArtistFor } from './artist.js?v=0.10.0';
import { renderCarousel, initCarousel } from './carousel.js?v=0.10.0';
import * as player from './player.js?v=0.10.0';
import * as store from './store.js?v=0.10.0';
import { likeToggle, openTrackMenu } from './menu.js?v=0.10.0';
import { formatTime } from './utils.js?v=0.10.0';
import { youtubeEnabled } from './youtube.js?v=0.10.0';

const { queue, st } = player;
let seeking = false;
let lastTrackId = null;

function openFull() { const f = $('#full-player'); f.style.transform = ''; f.classList.remove('dragging'); f.classList.add('open'); }
function closeFull() { const f = $('#full-player'); f.style.transform = ''; f.classList.remove('dragging'); f.classList.remove('open'); }

// Жест: тянем мини-плеер вверх — шторка открывается; тянем большой вниз — закрывается.
function initDrag() {
  const full = $('#full-player');
  const mini = $('#mini-player');
  const H = () => window.innerHeight;
  let sx0 = 0, sy = 0, dy = 0, t0 = 0, mode = null, on = false;
  const start = (m) => (e) => {
    if (m === 'close' && e.target.closest('button, input, .fp-seek') && !e.target.closest('.fp-top')) return;
    if (m === 'close' && e.target.closest('#fp-art') && !e.target.closest('.fp-top')) { /* вертикаль разрешена, горизонталь отменит move */ }
    if (m === 'close' && full.querySelector('.fp-inner').scrollTop > 0) return;
    const pt = e.touches[0]; sy = pt.clientY; sx0 = pt.clientX; dy = 0; t0 = Date.now(); mode = m; on = true;
  };
  const move = (e) => {
    if (!on) return;
    dy = e.touches[0].clientY - sy;
    if (mode === 'close' && !full.classList.contains('dragging') && Math.abs(e.touches[0].clientX - sx0) > Math.abs(dy)) { on = false; return; }
    if (mode === 'open') {
      if (dy > 0) dy = 0;
      if (dy < -8) { full.classList.add('dragging'); if (e.cancelable) e.preventDefault(); }
      if (full.classList.contains('dragging')) full.style.transform = `translateY(${Math.max(0, H() + dy)}px)`;
    } else {
      if (dy < 0) dy = 0;
      if (dy > 8) { full.classList.add('dragging'); if (e.cancelable) e.preventDefault(); }
      if (full.classList.contains('dragging')) full.style.transform = `translateY(${dy}px)`;
    }
  };
  const end = () => {
    if (!on) return; on = false;
    const dragging = full.classList.contains('dragging');
    const v = Math.abs(dy) / Math.max(1, Date.now() - t0);
    if (!dragging) return;
    const far = Math.abs(dy) > H() * 0.25 || v > 0.6;
    full.classList.remove('dragging');
    full.style.transform = '';
    if (mode === 'open') { if (far) full.classList.add('open'); else full.classList.remove('open'); }
    else if (far) full.classList.remove('open');
    swallow = true; setTimeout(() => { swallow = false; }, 350);
  };
  let swallow = false;
  mini.addEventListener('touchstart', start('open'), { passive: true });
  full.addEventListener('touchstart', start('close'), { passive: true });
  for (const el of [mini, full]) {
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
  }
  mini.addEventListener('click', (e) => { if (swallow) { e.stopPropagation(); e.preventDefault(); } }, true);
}

// Высота дока (мини-плеер + меню) → CSS-переменная, чтобы контент и тосты не прятались под ним.
function initDock() {
  const dock = document.getElementById('dock');
  const set = () => document.documentElement.style.setProperty('--dock-h', `${dock.offsetHeight}px`);
  set();
  if (window.ResizeObserver) new ResizeObserver(set).observe(dock);
  window.addEventListener('resize', set);
}
export function isFullOpen() { return $('#full-player').classList.contains('open'); }
export { closeFull };

function renderTrack() {
  const t = queue.current;
  document.body.classList.toggle('has-mini', Boolean(t));
  $('#mini-player').hidden = !t;
  if (!t) { closeFull(); lastTrackId = null; return; }

  $('#mini-title').textContent = t.title;
  $('#mini-artist').textContent = t.artist;
  $('#mini-art').replaceChildren(artEl(t));
  $('#fp-title').textContent = t.title;
  $('#fp-artist').textContent = t.artist;
  $('#full-player').classList.toggle('wave-mode', Boolean(t.wave));
  renderCarousel();
  $('#fp-dur').textContent = formatTime(st.duration);
  $('#fp-bg').style.backgroundImage = t.artwork ? `url("${t.artwork}")` : 'none';
  document.title = `${t.title} · MKW`;
  highlightCurrent(t.id);
  lastTrackId = t.id;
  renderLike();
  renderState();
}

let wasLiked = false;
function renderLike() {
  const t = queue.current;
  const liked = t ? store.isLiked(t.id) : false;
  const btn = $('#fp-like');
  if (liked && !wasLiked) { btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop'); }
  wasLiked = liked;
  btn.classList.toggle('on', liked);
  setIcon(btn.querySelector('svg'), liked ? 'heart-fill' : 'heart');
}

function renderState() {
  document.body.classList.toggle('is-playing', st.playing);
  $('#full-player').classList.toggle('playing', st.playing);
  const playIcon = st.playing ? 'pause' : 'play';
  setIcon($('#mini-toggle svg'), playIcon);
  setIcon($('#fp-toggle svg'), playIcon);
  const badge = $('#fp-badge');
  badge.textContent = queue.current?.wave ? 'MKW Волна' : st.mode === 'yt' ? 'MKW' : st.mode === 'preview' ? (queue.current?.auId ? 'MKW · Audius' : 'MKW · фрагмент') : st.loading ? 'Загрузка…' : '';
  badge.classList.toggle('yt', st.mode === 'yt');
  $('#fp-note').textContent = st.message || (st.mode === 'preview' && !youtubeEnabled() ? 'Полные треки появятся после подключения YouTube-ключа' : '');
  $('#fp-shuffle').classList.toggle('on', queue.shuffle);
  $('#fp-repeat').classList.toggle('on', queue.repeat !== 'off');
  setIcon($('#fp-repeat svg'), queue.repeat === 'one' ? 'repeat-one' : 'repeat');
  const sleep = $('#fp-sleep');
  sleep.classList.toggle('on', Boolean(st.sleepAt));
}

function renderTime() {
  const d = st.duration > 0 ? st.duration : 0;
  const pct = d ? Math.min(100, (st.time / d) * 100) : 0;
  $('#mini-progress').style.width = `${pct}%`;
  $('#full-player').style.setProperty('--prog', `${pct}%`);
  if (!seeking) $('#fp-seek').style.setProperty('--val', `${pct}%`);
  if (!seeking) {
    $('#fp-seek').value = d ? Math.round((st.time / d) * 1000) : 0;
    $('#fp-cur').textContent = formatTime(st.time);
  }
  $('#fp-dur').textContent = formatTime(d);
}

// ---------- очередь ----------
function openQueue() {
  const box = h('div');
  const draw = () => {
    if (!queue.length) { box.replaceChildren(emptyState('queue', 'Очередь пуста')); return; }
    box.replaceChildren(...queue.items.map((t, i) => h('div', { class: 'queue-row' },
      trackRow(t, { onPlay: () => player.jumpTo(i), current: i === queue.index }),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Убрать из очереди', onclick: () => { player.removeFromQueue(i); } }, icon('close')))));
    const cur = box.querySelector('.current');
    if (cur) setTimeout(() => cur.scrollIntoView({ block: 'center' }), 50);
  };
  draw();
  openSheet(`Очередь · ${queue.length}`, box);
  const off = player.onPlayer((ev) => {
    if (!$('#sheet').classList.contains('open')) { off(); return; }
    if (ev === 'queue' || ev === 'track') draw();
  });
}

// ---------- таймер сна ----------
function openSleep() {
  const mk = (label, min) => sheetItem('timer', label, () => {
    closeSheet();
    player.setSleep(min);
    toast(min ? `Остановлюсь через ${label}` : 'Таймер выключен');
  });
  const box = h('div', mk('15 мин', 15), mk('30 мин', 30), mk('45 мин', 45), mk('60 мин', 60), mk('90 мин', 90));
  if (st.sleepAt) box.appendChild(sheetItem('close', 'Выключить таймер', () => { closeSheet(); player.setSleep(0); toast('Таймер выключен'); }, true));
  openSheet(st.sleepAt ? `Сон: осталось ${Math.max(1, Math.round((st.sleepAt - Date.now()) / 60000))} мин` : 'Таймер сна', box);
}

export function initPlayerUI() {
  initCarousel();
  initDock();
  initDrag();
  $('#mini-open').addEventListener('click', openFull);
  $('#mini-toggle').addEventListener('click', player.toggle);
  $('#mini-next').addEventListener('click', player.next);
  $('#fp-close').addEventListener('click', closeFull);
  $('#fp-toggle').addEventListener('click', player.toggle);
  $('#fp-next').addEventListener('click', player.next);
  $('#fp-prev').addEventListener('click', player.prev);
  $('#fp-shuffle').addEventListener('click', player.toggleShuffle);
  $('#fp-repeat').addEventListener('click', player.cycleRepeat);
  $('#fp-queue').addEventListener('click', openQueue);
  $('#fp-sleep').addEventListener('click', openSleep);
  $('#fp-like').addEventListener('click', () => { if (queue.current) likeToggle(queue.current); });
  $('#fp-artist').addEventListener('click', () => { if (queue.current) openArtistFor(queue.current.artist); });
  $('#fp-more').addEventListener('click', () => { if (queue.current) openTrackMenu(queue.current); });

  const seek = $('#fp-seek');
  let lastSeek = 0;
  seek.addEventListener('input', () => {
    seeking = true;
    $('#fp-cur').textContent = formatTime((seek.value / 1000) * st.duration);
    seek.style.setProperty('--val', `${seek.value / 10}%`);
    if (st.duration && Date.now() - lastSeek > 250) { lastSeek = Date.now(); player.seek((seek.value / 1000) * st.duration); }
  });
  seek.addEventListener('change', () => {
    player.seek((seek.value / 1000) * st.duration);
    seeking = false;
  });

  player.onPlayer((ev) => {
    if (ev === 'track') renderTrack();
    else if (ev === 'state' || ev === 'queue' || ev === 'sleep') { renderState(); if (ev === 'queue' && queue.current) renderCarousel(); }
    else if (ev === 'time') renderTime();
    else if (ev === 'error') { toast(st.message); renderState(); }
    else if (ev === 'end') toast('Это последний трек в очереди');
    if (ev === 'queue' && !queue.current) renderTrack();
  });
  store.onStore((what) => { if (what === 'likes') renderLike(); });
  renderTrack();
}

export function resetPlayerUI() {
  closeFull();
  lastTrackId = null;
}
