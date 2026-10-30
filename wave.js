// MKW Волна: бесконечная очередь, которая подстраивается под вкус и реакцию (пропуски / дослушивания).
import { searchTracks } from './catalog.js?v=0.10.2';
import { peekYouTubeId, prefetchYouTubeIds } from './youtube.js?v=0.10.2';
import * as player from './player.js?v=0.10.2';
import * as store from './store.js?v=0.10.2';
import { $, toast } from './ui.js?v=0.10.2';
import { shuffled } from './utils.js?v=0.10.2';
import { norm, isArtistBlocked, blockedArtists, dislikedTracks, dislikeTrack } from './taste.js?v=0.10.2';

const SKEY = 'mkw.wave';
let active = false;
let filling = false;
let score = {};          // исполнитель → вес (растёт от лайков/дослушиваний, падает от пропусков)
let played = new Set();  // id, уже игравшие в этой волне
let streak = 0;          // подряд пропусков


function seedScores() {
  score = {};
  const add = (t, w) => { const a = norm(t.artist); if (a) score[a] = (score[a] || 0) + w; };
  store.state.likes.forEach((t) => add(t, 3));
  store.state.history.slice(0, 60).forEach((t) => add(t, 1));
  try {
    const saved = JSON.parse(localStorage.getItem(SKEY) || '{}');
    for (const [a, w] of Object.entries(saved)) score[a] = (score[a] || 0) + w;
  } catch { /* ignore */ }
}
function persist() {
  try {
    const keep = Object.fromEntries(Object.entries(score).filter(([, w]) => Math.abs(w) >= 1).slice(0, 80));
    localStorage.setItem(SKEY, JSON.stringify(keep));
  } catch { /* ignore */ }
}

function pickArtist(exclude = new Set()) {
  const bl = blockedArtists();
  const entries = Object.entries(score).filter(([a, w]) => w > -2 && !exclude.has(a) && !bl.has(a));
  if (!entries.length) return null;
  // взвешенный случайный выбор; чуть исследуем новое (вес +1)
  const weights = entries.map(([, w]) => Math.max(0.2, w + 1));
  let r = Math.random() * weights.reduce((x, y) => x + y, 0);
  for (let i = 0; i < entries.length; i++) { r -= weights[i]; if (r <= 0) return entries[i][0]; }
  return entries[0][0];
}

async function refill(n = 8) {
  if (!active || filling) return;
  filling = true;
  try {
    const liked = new Set(store.state.likes.map((t) => t.id));
    const used = new Set();
    let pool = [];
    for (let k = 0; k < 3 && pool.length < n * 2; k++) {
      const a = pickArtist(used);
      if (!a) break;
      used.add(a);
      const found = await searchTracks(a).catch(() => []);
      const own = found.filter((t) => norm(t.artist).includes(a) || a.includes(norm(t.artist)));
      pool.push(...shuffled(own.length ? own : found).slice(0, 8));
    }
    // немного нового звучания: похожие жанры из лайков
    const genres = [...new Set(store.state.likes.map((t) => t.genre).filter(Boolean))];
    if (genres.length && Math.random() < 0.5) {
      const g = genres[Math.floor(Math.random() * genres.length)];
      pool.push(...shuffled(await searchTracks(g).catch(() => [])).slice(0, 4));
    }
    const have = new Set(player.queue.items.map((t) => t.id));
    const seen = new Set();
    pool = pool.filter((t) => {
      if (!t.id || dislikedSet().has(t.id) || have.has(t.id) || played.has(t.id) || seen.has(t.id) || (score[norm(t.artist)] ?? 0) <= -2 || isArtistBlocked(t.artist)) return false;
      seen.add(t.id);
      return true;
    });
    await prefetchYouTubeIds(pool);
    // сначала треки, для которых видео уже известно (быстро и без траты лимита YouTube), и лайкнутые
    const cached = pool.filter((t) => peekYouTubeId(t));
    const fresh = pool.filter((t) => !peekYouTubeId(t));
    const pick = [...shuffled(cached), ...shuffled(fresh).slice(0, cached.length < 4 ? 2 : 0)].slice(0, n);
    pick.sort((a, b) => (liked.has(b.id) ? 1 : 0) - (liked.has(a.id) ? 1 : 0) || Math.random() - 0.5);
    for (const t of pick) player.addToQueue({ ...t, wave: true });
  } finally {
    filling = false;
  }
}

function dislikedSet() { return dislikedTracks(); }
export function dislike() {
  const t = player.queue.current;
  if (!t) return;
  dislikeTrack(t.id);
  const a = norm(t.artist);
  score[a] = (score[a] || 0) - 3;
  persist();
  toast('Больше такое не поставлю');
  player.next();
}

function remaining() { return player.queue.items.length - player.queue.index - 1; }

function react(kind) {
  if (!active) return;
  const last = player.st.last;
  if (!last || !last.track || !last.track.wave) return;
  const a = norm(last.track.artist);
  const frac = last.duration > 0 ? last.time / last.duration : (last.time > 30 ? 1 : 0);
  if (kind === 'skip' && (last.time < 20 || frac < 0.3)) { score[a] = (score[a] || 0) - 1; streak += 1; }
  else if (kind === 'done' || frac > 0.7) { score[a] = (score[a] || 0) + 1; streak = 0; }
  played.add(last.track.id);
  persist();
  if (streak >= 4) { streak = 0; score = Object.fromEntries(Object.entries(score).map(([k, v]) => [k, v > 0 ? v * 0.6 : v])); refill(6); }
  if (remaining() < 4) refill(8);
}

function setActive(on) {
  active = on;
  const b = $('#wave-btn');
  if (b) b.classList.toggle('on', on);
  const sub = $('#wave-sub');
  if (sub) sub.textContent = on ? 'Играет. Нажмите, чтобы выключить' : 'Музыка под ваш вкус, подстраивается на лету';
  if (on) { player.queue.setShuffle(false); }
  const d = $('#fp-dislike');
  if (d) d.hidden = !on;
}

export async function startWave() {
  if (active) { setActive(false); toast('Волна выключена'); return; }
  seedScores();
  if (!Object.keys(score).length) {
    toast('Лайкните пару треков или послушайте что-нибудь, и волна подстроится');
    return;
  }
  played = new Set();
  streak = 0;
  setActive(true);
  const sub = $('#wave-sub');
  if (sub) sub.textContent = 'Подбираю…';
  await seedQueue();
}

async function seedQueue() {
  const liked = shuffled(store.state.likes).slice(0, 2).map((t) => ({ ...t, wave: true }));
  const used = new Set();
  let pool = [];
  for (let k = 0; k < 3; k++) {
    const a = pickArtist(used);
    if (!a) break;
    used.add(a);
    pool.push(...shuffled(await searchTracks(a).catch(() => [])).slice(0, 6));
  }
  await prefetchYouTubeIds(pool);
  pool = [...shuffled(pool.filter((t) => peekYouTubeId(t))), ...shuffled(pool.filter((t) => !peekYouTubeId(t))).slice(0, 2)];
  const start = [...liked, ...pool.filter((t) => !liked.some((l) => l.id === t.id)).map((t) => ({ ...t, wave: true }))].slice(0, 8);
  if (!start.length) { setActive(false); toast('Не получилось подобрать. Проверьте интернет'); return; }
  player.playTracks(start, 0);
  setActive(true);
}

export function initWave() {
  const b = $('#wave-btn');
  if (b) b.addEventListener('click', startWave);
  const d = $('#fp-dislike');
  if (d) d.addEventListener('click', dislike);
  store.onStore((what) => {
    if (what !== 'likes' || !active) return;
    const cur = player.queue.current;
    if (cur && cur.wave && store.isLiked(cur.id)) { const a = norm(cur.artist); score[a] = (score[a] || 0) + 2; persist(); }
  });
  player.onPlayer((what) => {
    if (what === 'skip' || what === 'done') react(what);
    if (what === 'queue' && active) {
      const cur = player.queue.current;
      if (cur && !cur.wave) setActive(false);   // человек запустил своё — волна заканчивается
    }
    if (what === 'track' && active && remaining() < 3) refill(8);
  });
}

export const waveActive = () => active;
