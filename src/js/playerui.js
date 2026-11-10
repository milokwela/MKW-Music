// Интерфейс плеера: мини-плеер, большой плеер, очередь, таймер сна.
import { openOutput, hasOutput } from './output.js';
import { mi } from './icons2.js';
import { $, h, icon, setIcon, artEl, trackRow, openSheet, closeSheet, sheetItem, highlightCurrent, toast, emptyState } from './ui.js';
import { openArtistFor, openArtist, artistLinks } from './artist.js';
import { renderCarousel, initCarousel } from './carousel.js';
import * as player from './player.js';
import * as store from './store.js';
import { likeToggle, openTrackMenu } from './menu.js';
import { formatTime, safeUrl } from './utils.js';
import { youtubeEnabled } from './youtube.js';

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
  let sx0 = 0, sy = 0, dy = 0, dx = 0, t0 = 0, mode = null, on = false, hs = false;
  const start = (m) => (e) => {
    if (m === 'close' && e.target.closest('button, input, .fp-seek') && !e.target.closest('.fp-top')) return;
    if (m === 'close' && e.target.closest('#fp-art') && !e.target.closest('.fp-top')) { /* вертикаль разрешена, горизонталь отменит move */ }
    if (m === 'close' && full.querySelector('.fp-inner').scrollTop > 0) return;
    // очередь и текст листаются сами — шторку плеера они не сворачивают
    if (m === 'close' && e.target.closest('#fp-q2, #fp-lyrics, .p2q-list')) return;
    const pt = e.touches[0]; sy = pt.clientY; sx0 = pt.clientX; dy = 0; dx = 0; hs = false; t0 = Date.now(); mode = m; on = true;
  };
  const move = (e) => {
    if (!on) return;
    dy = e.touches[0].clientY - sy;
    dx = e.touches[0].clientX - sx0;
    // мини-плеер вбок — смахнуть (убрать и поставить на паузу)
    if (mode === 'open' && !full.classList.contains('dragging') && (hs || (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2))) {
      hs = true;
      if (e.cancelable) e.preventDefault();
      mini.classList.add('hswipe');
      // translate/rotate, а не transform: у мини-плеера есть анимация появления, она перебивает transform
      mini.style.translate = `${dx}px 0`; mini.style.rotate = `${dx / 60}deg`;
      mini.style.opacity = String(Math.max(0.25, 1 - Math.abs(dx) / (mini.offsetWidth || 360)));
      return;
    }
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
    if (hs) {
      hs = false;
      const w = mini.offsetWidth || 360;
      const v = Math.abs(dx) / Math.max(1, Date.now() - t0);
      mini.classList.remove('hswipe');
      swallow = true; setTimeout(() => { swallow = false; }, 350);
      if (Math.abs(dx) > w * 0.33 || (v > 0.6 && Math.abs(dx) > 40)) dismissMini(dx > 0 ? 1 : -1);
      else { mini.style.translate = ''; mini.style.rotate = ''; mini.style.opacity = ''; }
      return;
    }
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
  full.addEventListener('click', (e) => { if (swallow) { e.stopPropagation(); e.preventDefault(); } }, true);

  // То же самое мышью на компьютере: зажать мини-плеер и потянуть вверх, зажать плеер и потянуть вниз
  const fake = (e) => ({ touches: [{ clientX: e.clientX, clientY: e.clientY }], target: e.target, cancelable: true, preventDefault: () => e.preventDefault() });
  const mouseStart = (m) => (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if (m === 'close' && e.target.closest('#fp-lyrics, #fp-art, .fp-seek, input, button:not(#fp-close)')) return;
    if (m === 'open' && e.target.closest('#mini-toggle, #mini-next')) return;
    start(m)(fake(e));
    const mv = (ev) => { move(fake(ev)); if (full.classList.contains('dragging')) document.body.classList.add('drag-mouse'); };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); document.body.classList.remove('drag-mouse'); end(); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };
  mini.addEventListener('pointerdown', mouseStart('open'));
  full.addEventListener('pointerdown', mouseStart('close'));
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
export { closeFull, openFull };

// смахнули мини-плеер: пауза и прячем, пока снова не включат музыку
let miniGone = false;
// в Волне кнопка текста стоит в ряду управления — справа от «вперёд»
function placeLyricsBtn(wave) {
  const b = $('#fp-lyrics-btn'), row = $('#full-player .fp-controls'), extra = $('#full-player .fp-extra');
  if (!b || !row || !extra) return;
  if ($('#full-player').classList.contains('fp2')) { if (b.parentElement !== extra) extra.prepend(b); return; }   // в новом виде плеера кнопка текста всегда внизу
  if (wave && b.parentElement !== row) { const nx = $('#fp-next'); if (nx && nx.parentElement === row) nx.after(b); else row.appendChild(b); }
  else if (!wave && b.parentElement !== extra) extra.prepend(b);
}
function dismissMini(dir) {
  const mini = $('#mini-player');
  mini.classList.add('gone');
  mini.style.translate = `${dir * 115}% 0`; mini.style.rotate = `${dir * 9}deg`;
  mini.style.opacity = '0';
  if (navigator.vibrate) navigator.vibrate(10);
  setTimeout(() => {
    // музыка останавливается совсем: плеер прячется, а песня в списках больше не горит как играющая
    try { player.stop(); } catch { /* ignore */ }
    mini.classList.remove('gone'); mini.style.translate = ''; mini.style.rotate = ''; mini.style.opacity = '';
  }, 300);
}
function showMiniAgain() {
  if (!miniGone || !queue.current) return;
  miniGone = false;
  const mini = $('#mini-player');
  mini.hidden = false; document.body.classList.add('has-mini');
  mini.classList.add('back'); setTimeout(() => mini.classList.remove('back'), 400);
}

function renderTrack() {
  const t = queue.current;
  if (miniGone && t && player.st.playing) miniGone = false;
  document.body.classList.toggle('has-mini', Boolean(t) && !miniGone);
  $('#mini-player').hidden = !t || miniGone;
  if (!t) { closeFull(); lastTrackId = null; highlightCurrent(''); return; }

  $('#mini-title').textContent = t.title;
  $('#mini-artist').textContent = t.artist;
  $('#mini-art').replaceChildren(artEl(t));
  $('#fp-title').textContent = t.title;
  artistLinks($('#fp-artist'), t.artist);
  $('#full-player').classList.toggle('wave-mode', Boolean(t.wave));
  placeLyricsBtn(Boolean(t.wave));
  renderCarousel();
  $('#fp-dur').textContent = formatTime(st.duration);
  $('#fp-bg').style.backgroundImage = safeUrl(t.artwork) ? `url("${safeUrl(t.artwork)}")` : 'none';
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
  badge.textContent = queue.current?.wave ? 'MKW Волна' : st.mode === 'yt' ? 'MKW' : st.mode === 'preview' ? (st.full ? 'MKW · фон' : queue.current?.auId ? 'MKW · Audius' : 'MKW · фрагмент') : st.loading ? 'Загрузка…' : '';
  badge.classList.toggle('yt', st.mode === 'yt' || st.full);
  // откуда звук в фоне + «не та песня»
  let src = $('#fp-src');
  if (!src) { src = h('div', { id: 'fp-src', class: 'fp-src', hidden: '' }); $('#fp-note').after(src); }
  const info = player.currentStreamInfo();
  if (info) {
    const names = { youtube: 'YouTube', soundcloud: 'SoundCloud', audius: 'Audius', cobalt: 'YouTube', mirror: 'YouTube' };
    src.hidden = false;
    src.replaceChildren(h('span', { text: `Фон: ${names[info.src] || 'YouTube'}${info.label && info.src !== 'youtube' && info.src !== 'mirror' && info.src !== 'cobalt' ? ` · ${info.label}` : ''}` }),
      h('button', { type: 'button', class: 'fp-wrong', onclick: () => { if (player.wrongVersion()) toast('Ищу правильную версию…'); } }, 'Не та песня?'));
  } else src.hidden = true;
  $('#fp-note').textContent = st.message || (st.mode === 'preview' && !st.full && !youtubeEnabled() ? 'Полные треки появятся после подключения YouTube-ключа' : '');
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
  // у каждого исполнителя своя ссылка; нажали мимо имён — список исполнителей
  $('#fp-artist').addEventListener('click', (e) => { const one = e.target.closest('.ar-link'); if (one) { openArtist(one.dataset.artist); return; } if (queue.current && e.currentTarget.querySelectorAll('.ar-link').length <= 1) openArtistFor(queue.current.artist); });
  $('#fp-artist').addEventListener('keydown', (e) => { const one = e.target.closest('.ar-link'); if (one && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); openArtist(one.dataset.artist); } });
  $('#fp-more').addEventListener('click', () => { if (queue.current) openTrackMenu(queue.current); });
  if (hasOutput()) { // только в Android-приложении: куда идёт звук и громкость телефона
    const out = h('button', { class: 'icon-btn', id: 'fp-out', type: 'button', 'aria-label': 'Подключить устройство' }, mi('headphones'));
    out.addEventListener('click', openOutput);
    $('#fp-more').before(out);
  }

  const seek = $('#fp-seek');
  seek.addEventListener('input', () => {
    seeking = true;
    $('#fp-cur').textContent = formatTime((seek.value / 1000) * st.duration);
    seek.style.setProperty('--val', `${seek.value / 10}%`);
  });
  seek.addEventListener('change', () => {
    player.seek((seek.value / 1000) * st.duration);
    seeking = false;
  });

  player.onPlayer((ev) => {
    if (ev === 'track') renderTrack();
    if ((ev === 'state' || ev === 'track') && miniGone && player.st.playing) showMiniAgain();
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
