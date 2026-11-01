// MKW Волна 2: бесконечная очередь под ваш вкус.
// Как думает:
//  • вкус = вес каждого исполнителя (лайки, история с затуханием по времени, дослушивания, пропуски, дизлайки);
//  • «похожие» берутся из графа связанных исполнителей Deezer (JSONP, без ключа);
//  • баланс «знакомое / новое» меняется на лету: много пропусков — больше любимого, дослушиваете — больше открытий;
//  • учитывает привычки: язык (кириллица / латиница), любите ли вы версии slowed / sped up;
//  • не повторяет песню в другой версии, не ставит одного исполнителя чаще раза в 3 трека;
//  • помнит жанры, время суток (утро / вечер), быстрые пропуски конкретных песен;
//  • «радио по треку»: соседи текущего исполнителя; плюс вкусы людей с похожими любимыми исполнителями.
import { searchTracks } from './catalog.js?v=0.22.0';
import { peekYouTubeId, prefetchYouTubeIds } from './youtube.js?v=0.22.0';
import * as player from './player.js?v=0.22.0';
import * as store from './store.js?v=0.22.0';
import { $, toast } from './ui.js?v=0.22.0';
import { shuffled } from './utils.js?v=0.22.0';
import { norm, isArtistBlocked, blockedArtists, dislikedTracks, dislikeTrack, splitArtists } from './taste.js?v=0.22.0';
import { jsonp } from './jsonp.js?v=0.22.0';
import { communityTaste } from './leaders.js?v=0.22.0';

const SKEY = 'mkw.wave2';
const RKEY = 'mkw.wave.related';
const DAY = 86400000;
let active = false;
let filling = false;
let score = {};          // исполнитель → вес
let fresh = {};          // исполнитель → вес только из этой сессии (импульс)
let played = new Set();  // id и «отпечатки» песен, уже бывших в этой волне
let streak = 0;          // подряд пропусков
let explore = 0.35;      // доля открытий, меняется от реакции
let prefs = { cyr: 0.5, variant: 0 };
let genre = {};          // жанр → вес
let hourArt = {};        // исполнители, которых вы слушаете в это время суток
let community = {};      // исполнители, которых любят люди с похожим вкусом
const SKIPKEY = 'mkw.wave.skips';
let skips = (() => { try { return JSON.parse(localStorage.getItem(SKIPKEY) || '{}'); } catch { return {}; } })();
const part = (h) => (h < 6 ? 0 : h < 12 ? 1 : h < 18 ? 2 : 3); // ночь / утро / день / вечер

const VARIANT = /slow|sped|speed|nightcore|reverb|ускор|замедл|remix|ремикс/i;
const CYR = /[а-яё]/i;
const artistsOf = (t) => splitArtists(t.artist).map(norm).filter(Boolean);
// «отпечаток» песни: одно и то же название без версий и скобок
const fp = (t) => `${norm(String(t.title || '').replace(/\s*[(\[].*?[)\]]/g, '').replace(/\s*[-–—].*$/, '')).replace(/[^a-zа-яё0-9]/gi, '')}|${artistsOf(t)[0] || ''}`;

function seedScores() {
  score = {}; fresh = {};
  const now = Date.now();
  const add = (t, w) => { for (const a of artistsOf(t)) score[a] = (score[a] || 0) + w; };
  // лайки: свежие весят больше (полураспад ~60 дней)
  for (const t of store.state.likes) add(t, 2 + 3 * Math.pow(0.5, (now - (Number(t.likedAt) || now)) / (60 * DAY)));
  // история: затухание по позиции и по времени
  store.state.history.slice(0, 80).forEach((t, i) => add(t, (i < 15 ? 1.4 : 0.8) * Math.pow(0.5, (now - (Number(t.playedAt) || now)) / (14 * DAY))));
  try {
    const saved = JSON.parse(localStorage.getItem(SKEY) || '{}');
    for (const [a, w] of Object.entries(saved)) score[a] = (score[a] || 0) + w * 0.85; // старые реакции понемногу забываются
  } catch { /* ignore */ }
  // жанры и время суток
  genre = {}; hourArt = {};
  const nowPart = part(new Date().getHours());
  for (const t of store.state.likes) if (t.genre) genre[norm(t.genre)] = (genre[norm(t.genre)] || 0) + 1;
  for (const t of store.state.history.slice(0, 120)) {
    if (t.genre) genre[norm(t.genre)] = (genre[norm(t.genre)] || 0) + 0.5;
    if (t.playedAt && part(new Date(Number(t.playedAt)).getHours()) === nowPart) for (const a of artistsOf(t)) hourArt[a] = (hourArt[a] || 0) + 1;
  }
  try { const g = JSON.parse(localStorage.getItem(`${SKEY}.g`) || '{}'); for (const [k, w] of Object.entries(g)) genre[k] = (genre[k] || 0) + w; } catch { /* ignore */ }
  // привычки
  const sample = [...store.state.likes, ...store.state.history.slice(0, 60)];
  if (sample.length) {
    prefs.cyr = sample.filter((t) => CYR.test(`${t.artist} ${t.title}`)).length / sample.length;
    prefs.variant = sample.filter((t) => VARIANT.test(t.title)).length / sample.length;
  }
}
function persist() {
  try { localStorage.setItem(`${SKEY}.g`, JSON.stringify(Object.fromEntries(Object.entries(genre).filter(([, w]) => Math.abs(w) > 0.5).slice(0, 40)))); } catch { /* ignore */ }
  try { const e = Object.entries(skips).sort((a, b) => b[1].at - a[1].at).slice(0, 300); skips = Object.fromEntries(e); localStorage.setItem(SKIPKEY, JSON.stringify(skips)); } catch { /* ignore */ }
  try {
    const keep = Object.fromEntries(Object.entries(score).filter(([, w]) => Math.abs(w) >= 0.8).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 120));
    localStorage.setItem(SKEY, JSON.stringify(keep));
  } catch { /* ignore */ }
}

const weight = (a) => (score[a] || 0) + (fresh[a] || 0) * 1.5;

function pickArtist(exclude = new Set()) {
  const bl = blockedArtists();
  const entries = Object.keys(score).filter((a) => weight(a) > -1.5 && !exclude.has(a) && !bl.has(a));
  if (!entries.length) return null;
  const ws = entries.map((a) => Math.max(0.15, weight(a) + 0.8) ** 1.3);
  let r = Math.random() * ws.reduce((x, y) => x + y, 0);
  for (let i = 0; i < entries.length; i++) { r -= ws[i]; if (r <= 0) return entries[i]; }
  return entries[0];
}

// люди, у которых в любимых есть ваши исполнители, часто любят и других — берём их
async function loadCommunity() {
  community = {};
  const lists = await communityTaste().catch(() => []);
  const mine = new Set(Object.entries(score).filter(([, w]) => w > 1).map(([a]) => a));
  for (const l of lists) {
    const ns = l.map(norm);
    const overlap = ns.filter((a) => mine.has(a)).length;
    if (!overlap) continue;
    for (const a of ns) if (!mine.has(a)) community[a] = (community[a] || 0) + overlap;
  }
}

// ---------- похожие исполнители (Deezer) ----------
let relCache = null;
function relStore() { if (!relCache) { try { relCache = JSON.parse(localStorage.getItem(RKEY) || '{}'); } catch { relCache = {}; } } return relCache; }
function relSave() { try { const e = Object.entries(relCache).sort((a, b) => b[1].at - a[1].at).slice(0, 150); localStorage.setItem(RKEY, JSON.stringify(Object.fromEntries(e))); } catch { /* ignore */ } }
async function related(artist) {
  const c = relStore()[artist];
  if (c && Date.now() - c.at < 7 * DAY) return c.v;
  let v = [];
  try {
    const s = await jsonp(`https://api.deezer.com/search/artist?limit=3&q=${encodeURIComponent(artist)}`);
    const hit = ((s && s.data) || []).find((x) => norm(x.name) === artist) || (s && s.data && s.data[0]);
    if (hit) {
      const r = await jsonp(`https://api.deezer.com/artist/${hit.id}/related?limit=20`);
      v = ((r && r.data) || []).map((x) => ({ name: x.name, fans: x.nb_fan || 0 }));
    }
  } catch { /* нет сети */ }
  relStore()[artist] = { v, at: Date.now() }; relSave();
  return v;
}

async function discoverArtists(n) {
  // берём 2–3 любимых исполнителя и их «соседей», которых вы ещё не слушали
  const seeds = new Set();
  // «радио по треку»: соседи текущего исполнителя важнее всего
  const cur = player.queue.current;
  if (cur && Math.random() < 0.6) for (const a of artistsOf(cur).slice(0, 1)) if (weight(a) > -1) seeds.add(a);
  for (let k = seeds.size; k < 3; k++) { const a = pickArtist(seeds); if (a) seeds.add(a); }
  const cand = new Map();
  for (const [a, w] of Object.entries(community)) if (!isArtistBlocked(a) && (score[a] || 0) <= 1.5 && (score[a] || 0) > -1) cand.set(a, 0.6 + Math.min(1.5, w * 0.4));
  for (const s of seeds) {
    const rel = await related(s);
    rel.forEach((x, i) => {
      const a = norm(x.name);
      if (!a || (score[a] || 0) > 1.5 || (score[a] || 0) < -1 || isArtistBlocked(a)) return;
      // ближе в списке — похожее; язык как у вас — плюс
      let w = (20 - i) / 20 + Math.max(0, weight(s)) / 10;
      const cyr = CYR.test(x.name);
      w *= cyr ? 0.4 + prefs.cyr : 1.4 - prefs.cyr;
      cand.set(a, Math.max(cand.get(a) || 0, w));
    });
  }
  return [...cand.entries()].sort((a, b) => b[1] - a[1]).slice(0, n * 2).sort(() => Math.random() - 0.5).slice(0, n).map((x) => x[0]);
}

function topGenres() {
  const cnt = {};
  [...store.state.likes, ...store.state.history.slice(0, 40)].forEach((t) => { if (t.genre) cnt[t.genre] = (cnt[t.genre] || 0) + 1; });
  return Object.entries(cnt).sort((x, y) => y[1] - x[1]).map(([g]) => g).slice(0, 5);
}

function ownTracks(found, a) {
  const own = found.filter((t) => artistsOf(t).some((x) => x.includes(a) || a.includes(x)));
  return own.length ? own : [];
}

async function gather(round) {
  const used = new Set();
  const pool = [];
  const nFam = Math.max(2, Math.round(5 * (1 - explore)));
  const nNew = Math.max(1, Math.round(4 * explore));
  for (let k = 0; k < nFam; k++) {
    const a = pickArtist(used);
    if (!a) break;
    used.add(a);
    const found = await searchTracks(a).catch(() => []);
    pool.push(...shuffled(ownTracks(found, a)).slice(0, 6).map((t) => ({ ...t, _src: 'fam' })));
  }
  const fresh2 = await discoverArtists(nNew).catch(() => []);
  for (const a of fresh2) {
    const found = await searchTracks(a).catch(() => []);
    // у нового исполнителя берём самые популярные (первые в выдаче) треки
    pool.push(...ownTracks(found, a).slice(0, 4).map((t) => ({ ...t, _src: 'new' })));
  }
  // запасной путь открытий: жанры
  if (!fresh2.length || round > 0) {
    const genres = topGenres();
    if (genres.length) {
      const g = genres[Math.floor(Math.random() * genres.length)];
      const found = await searchTracks(g).catch(() => []);
      pool.push(...shuffled(found.filter((t) => artistsOf(t).every((a) => (score[a] ?? 0) <= 0))).slice(0, 5).map((t) => ({ ...t, _src: 'new' })));
    }
  }
  return pool;
}

// оценка трека: вкус к исполнителю + привычки + немного случайности
function rate(t, liked) {
  const as = artistsOf(t);
  let s = Math.max(...as.map((a) => weight(a)), 0) * 0.4 + Math.random() * 1.2;
  if (liked.has(t.id)) s += 1.2;
  if (VARIANT.test(t.title)) s += prefs.variant > 0.25 ? 0.8 : -1.2;
  const cyr = CYR.test(`${t.artist} ${t.title}`);
  s += (cyr ? prefs.cyr - 0.5 : 0.5 - prefs.cyr) * 1.2;
  if (t._src === 'new') s += explore * 1.5;
  if (t.genre) s += Math.max(-1.5, Math.min(1.5, (genre[norm(t.genre)] || 0) * 0.12));
  s += Math.min(1, as.reduce((m, a) => Math.max(m, hourArt[a] || 0), 0) * 0.15);
  s += Math.min(0.8, as.reduce((m, a) => Math.max(m, community[a] || 0), 0) * 0.2);
  const sk = skips[t.id]; if (sk) s -= sk.n * 1.5;
  if (peekYouTubeId(t)) s += 0.5; // полный трек точно доступен
  return s;
}

// раскладываем так, чтобы один исполнитель не повторялся чаще раза в 3 трека
function spread(list, before) {
  const out = [];
  const rest = [...list];
  const recentA = () => [...before.slice(-2), ...out.slice(-2)].flatMap(artistsOf);
  while (rest.length) {
    const r = recentA();
    let i = rest.findIndex((t) => !artistsOf(t).some((a) => r.includes(a)));
    if (i < 0) i = 0;
    out.push(rest.splice(i, 1)[0]);
  }
  return out;
}

async function refill(n = 10) {
  if (!active || filling) return;
  filling = true;
  try {
    const liked = new Set(store.state.likes.map((t) => t.id));
    const recent = new Set(store.state.history.slice(0, 40).flatMap((t) => [t.id, fp(t)]));
    const dis = dislikedTracks();
    let added = 0;
    for (let round = 0; round < 3 && added < n; round++) {
      const have = new Set(player.queue.items.flatMap((t) => [t.id, fp(t)]));
      const seen = new Set();
      const strict = round < 2;
      const perArtist = {};
      let pool = (await gather(round)).filter((t) => {
        const f = fp(t);
        if (!t.id || dis.has(t.id) || (skips[t.id] && skips[t.id].n >= 2) || have.has(t.id) || have.has(f) || seen.has(f) || artistsOf(t).some((a) => weight(a) <= -1.5 || isArtistBlocked(a))) return false;
        if (strict && (played.has(t.id) || played.has(f) || recent.has(t.id) || recent.has(f))) return false;
        seen.add(f);
        return true;
      });
      await prefetchYouTubeIds(pool);
      pool = pool.map((t) => ({ t, s: rate(t, liked) })).sort((a, b) => b.s - a.s).map((x) => x.t)
        .filter((t) => { const a = artistsOf(t)[0]; perArtist[a] = (perArtist[a] || 0) + 1; return perArtist[a] <= 2; });
      const pick = spread(pool.slice(0, n - added), player.queue.items);
      for (const t of pick) { const { _src, ...clean } = t; player.addToQueue({ ...clean, wave: true, waveNew: _src === 'new' }); }
      added += pick.length;
    }
    if (!added && active) { played = new Set(); setTimeout(() => { if (active && remaining() < 2) refill(10); }, 4000); }
  } finally {
    filling = false;
  }
}

export function dislike() {
  const t = player.queue.current;
  if (!t) return;
  dislikeTrack(t.id);
  for (const a of artistsOf(t)) { score[a] = (score[a] || 0) - 2.5; fresh[a] = (fresh[a] || 0) - 1; }
  explore = Math.max(0.15, explore - 0.05);
  persist();
  toast('Больше такое не поставлю');
  player.next();
}

function remaining() { return player.queue.items.length - player.queue.index - 1; }

function react(kind) {
  if (!active) return;
  const last = player.st.last;
  if (!last || !last.track || !last.track.wave) return;
  const as = artistsOf(last.track);
  const frac = last.duration > 0 ? last.time / last.duration : (last.time > 30 ? 1 : 0);
  played.add(last.track.id); played.add(fp(last.track));
  if (kind === 'skip' && (last.time < 25 || frac < 0.3)) {
    // быстрый пропуск — сильный сигнал, поздний — слабый
    const w = last.time < 10 ? 1.4 : 0.8;
    for (const a of as) { score[a] = (score[a] || 0) - w; fresh[a] = (fresh[a] || 0) - w; }
    if (last.track.genre) genre[norm(last.track.genre)] = (genre[norm(last.track.genre)] || 0) - 0.4;
    if (last.time < 15) { const k = last.track.id; skips[k] = { n: ((skips[k] && skips[k].n) || 0) + 1, at: Date.now() }; }
    streak += 1;
    if (last.track.waveNew) explore = Math.max(0.15, explore - 0.06); else explore = Math.min(0.6, explore + 0.03);
  } else if (kind === 'done' || frac > 0.7) {
    for (const a of as) { score[a] = (score[a] || 0) + 1; fresh[a] = (fresh[a] || 0) + 1.2; }
    if (last.track.genre) genre[norm(last.track.genre)] = (genre[norm(last.track.genre)] || 0) + 0.3;
    streak = 0;
    if (last.track.waveNew) explore = Math.min(0.6, explore + 0.05);
  }
  persist();
  if (streak >= 3) {
    // три пропуска подряд: настроение сменилось — сбрасываем импульс, больше проверенного
    streak = 0; fresh = {}; explore = Math.max(0.15, explore - 0.1);
    const keep = player.queue.items.slice(0, player.queue.index + 2);
    if (player.queue.items.length > keep.length && player.trimQueue) player.trimQueue(keep.length);
    refill(8);
    toast('Подстраиваю волну под настроение');
  }
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
  explore = 0.35;
  loadCommunity();
  setActive(true);
  const sub = $('#wave-sub');
  if (sub) sub.textContent = 'Подбираю…';
  await seedQueue();
}

async function seedQueue() {
  // старт: 1–2 любимых трека для разгона, дальше знакомые исполнители и одно открытие
  const recent = new Set(store.state.history.slice(0, 15).map((t) => t.id));
  const liked = shuffled(store.state.likes.filter((t) => !recent.has(t.id))).slice(0, 2).map((t) => ({ ...t, wave: true }));
  const used = new Set();
  let pool = [];
  for (let k = 0; k < 3; k++) {
    const a = pickArtist(used);
    if (!a) break;
    used.add(a);
    pool.push(...shuffled(ownTracks(await searchTracks(a).catch(() => []), a)).slice(0, 5));
  }
  const nw = await discoverArtists(1).catch(() => []);
  for (const a of nw) pool.push(...ownTracks(await searchTracks(a).catch(() => []), a).slice(0, 2).map((t) => ({ ...t, waveNew: true })));
  await prefetchYouTubeIds(pool);
  const seen = new Set(liked.map(fp));
  pool = pool.filter((t) => { const f = fp(t); if (seen.has(f) || recent.has(t.id)) return false; seen.add(f); return true; });
  pool = [...shuffled(pool.filter((t) => peekYouTubeId(t))), ...shuffled(pool.filter((t) => !peekYouTubeId(t))).slice(0, 2)];
  const start = spread([...liked, ...pool.map((t) => ({ ...t, wave: true }))], []).slice(0, 8);
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
    if (cur && cur.wave && store.isLiked(cur.id)) {
      for (const a of artistsOf(cur)) { score[a] = (score[a] || 0) + 2; fresh[a] = (fresh[a] || 0) + 2; }
      if (cur.waveNew) explore = Math.min(0.6, explore + 0.08);
      persist();
    }
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
