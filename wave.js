// MKW Волна: бесконечная очередь, которая подстраивается под вкус и реакцию (пропуски / дослушивания).
import { searchTracks } from './catalog.js?v=0.17.0';
import { peekYouTubeId, prefetchYouTubeIds } from './youtube.js?v=0.17.0';
import * as player from './player.js?v=0.17.0';
import * as store from './store.js?v=0.17.0';
import { $, toast } from './ui.js?v=0.17.0';
import { shuffled } from './utils.js?v=0.17.0';
import { norm, isArtistBlocked, blockedArtists, dislikedTracks, dislikeTrack } from './taste.js?v=0.17.0';

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
  store.state.history.slice(0, 60).forEach((t, i) => add(t, i < 15 ? 1.5 : 1));
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

function interleave(list) {
  // не ставим одного исполнителя подряд
  const out = [];
  const rest = [...list];
  while (rest.length) {
    const last = out.length ? norm(out[out.length - 1].artist) : '';
    let i = rest.findIndex((t) => norm(t.artist) !== last);
    if (i < 0) i = 0;
    out.push(rest.splice(i, 1)[0]);
  }
  return out;
}

function topGenres() {
  const cnt = {};
  [...store.state.likes, ...store.state.history.slice(0, 40)].forEach((t) => { if (t.genre) cnt[t.genre] = (cnt[t.genre] || 0) + 1; });
  return Object.entries(cnt).sort((x, y) => y[1] - x[1]).map(([g]) => g).slice(0, 5);
}

async function gather(round) {
  const used = new Set();
  const pool = [];
  const familiar = round === 0 ? 3 : 4;
  for (let k = 0; k < familiar; k++) {
    const a = pickArtist(used);
    if (!a) break;
    used.add(a);
    const found = await searchTracks(a).catch(() => []);
    const own = found.filter((t) => norm(t.artist).includes(a) || a.includes(norm(t.artist)));
    pool.push(...shuffled(own.length ? own : found).slice(0, 8));
  }
  // открытия: новые исполнители из любимых жанров
  const genres = topGenres();
  if (genres.length && (round > 0 || Math.random() < 0.6)) {
    const g = genres[Math.floor(Math.random() * genres.length)];
    const found = await searchTracks(g).catch(() => []);
    pool.push(...shuffled(found.filter((t) => (score[norm(t.artist)] ?? 0) <= 0)).slice(0, 6));
  }
  return pool;
}

async function refill(n = 10) {
  if (!active || filling) return;
  filling = true;
  try {
    const liked = new Set(store.state.likes.map((t) => t.id));
    const recent = new Set(store.state.history.slice(0, 30).map((t) => t.id));
    let added = 0;
    for (let round = 0; round < 3 && added < n; round++) {
      const have = new Set(player.queue.items.map((t) => t.id));
      const seen = new Set();
      const strict = round < 2;
      let pool = (await gather(round)).filter((t) => {
        if (!t.id || dislikedSet().has(t.id) || have.has(t.id) || seen.has(t.id) || (score[norm(t.artist)] ?? 0) <= -2 || isArtistBlocked(t.artist)) return false;
        if (strict && (played.has(t.id) || recent.has(t.id))) return false;
        seen.add(t.id);
        return true;
      });
      await prefetchYouTubeIds(pool);
      const cached = pool.filter((t) => peekYouTubeId(t));
      const fresh = pool.filter((t) => !peekYouTubeId(t));
      const want = n - added;
      let pick = [...shuffled(cached), ...shuffled(fresh)].slice(0, want);
      pick.sort((a2, b2) => (liked.has(b2.id) ? 1 : 0) - (liked.has(a2.id) ? 1 : 0) || Math.random() - 0.5);
      pick = interleave(pick);
      for (const t of pick) player.addToQueue({ ...t, wave: true });
      added += pick.length;
    }
    if (!added && active) { played = new Set(); setTimeout(() => { if (active && remaining() < 2) refill(10); }, 4000); }
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
  if (streak >= 4) { streak = 0; score = Object.fromEntries(Object.entries(score).map(([k, v]) => [k, v > 0 ? v * 0.6 : v])); refill(8); }
  if (remaining() < 5) refill(10);
}

function setActive(on) {
  active = on;
  const b = $('#wave-btn');
  if (b) b.classList.toggle('on', on);
  const sub = $('#wave-sub');
  if (sub) sub.textContent = on ? 'Играет. Нажмите, чтобы выключить' : 'Музыка под ваш вкус, подстраивается на лету';
  if (on) { player.queue.setShuffle(false); }
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
    if (what === 'track' && active && remaining() < 5) refill(10);
  });
}

export const waveActive = () => active;
