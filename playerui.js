// Интерфейс плеера: мини-плеер, большой плеер, очередь, таймер сна.
import { $, h, icon, setIcon, artEl, trackRow, openSheet, closeSheet, sheetItem, highlightCurrent, toast, emptyState } from './ui.js';
import * as player from './player.js';
import * as store from './store.js';
import { likeToggle, openTrackMenu } from './menu.js';
import { formatTime } from './utils.js';
import { youtubeEnabled } from './youtube.js';

const { queue, st } = player;
let seeking = false;
let lastTrackId = null;

function openFull() { $('#full-player').classList.add('open'); }
function closeFull() { $('#full-player').classList.remove('open'); }
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
  $('#fp-art').replaceChildren(t.artwork ? h('img', { src: t.artwork.replace(/\/\d+x\d+(bb)?\./, '/600x600bb.'), alt: '' }) : icon('music'));
  $('#fp-dur').textContent = formatTime(st.duration);
  document.title = `${t.title} · MKW`;
  highlightCurrent(t.id);
  lastTrackId = t.id;
  renderLike();
  renderState();
}

function renderLike() {
  const t = queue.current;
  const liked = t ? store.isLiked(t.id) : false;
  const btn = $('#fp-like');
  btn.classList.toggle('on', liked);
  setIcon(btn.querySelector('svg'), liked ? 'heart-fill' : 'heart');
}

function renderState() {
  const playIcon = st.playing ? 'pause' : 'play';
  setIcon($('#mini-toggle svg'), playIcon);
  setIcon($('#fp-toggle svg'), playIcon);
  const badge = $('#fp-badge');
  badge.textContent = st.mode === 'yt' ? 'YouTube' : st.mode === 'preview' ? 'Фрагмент 30 сек' : st.loading ? 'Загрузка…' : '';
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
  $('#fp-more').addEventListener('click', () => { if (queue.current) openTrackMenu(queue.current); });

  const seek = $('#fp-seek');
  seek.addEventListener('input', () => {
    seeking = true;
    $('#fp-cur').textContent = formatTime((seek.value / 1000) * st.duration);
  });
  seek.addEventListener('change', () => {
    player.seek((seek.value / 1000) * st.duration);
    seeking = false;
  });

  player.onPlayer((ev) => {
    if (ev === 'track') renderTrack();
    else if (ev === 'state' || ev === 'queue' || ev === 'sleep') renderState();
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
