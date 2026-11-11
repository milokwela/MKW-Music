// MKW Волна 5: бесконечная очередь, которая учится на ваших реакциях.
// Как думает:
//  • вкус к исполнителям — лайки, плейлисты, витрина профиля, история с затуханием по времени, дослушивания, пропуски, дизлайки;
//  • восемь «источников» песен: любимые исполнители, их свежие релизы, радио похожих песен, открытия (похожие исполнители,
//    которых вы не слушали), ваши лайки, любимые исполнители и треки слушателей с похожим вкусом, жанровые чарты, общий чарт;
//  • какой источник вам заходит, волна выясняет сама: дослушали и лайкнули — источник получает больше места,
//    быстро пропустили — меньше (многорукий бандит, выбор Томпсона). Отдельно для каждого настроения;
//  • обучаемая оценка: маленькая модель по 12 признакам песни (исполнитель, жанр, язык, новизна, популярность…)
//    подстраивает веса под вас после каждого дослушивания, пропуска, лайка и дизлайка;
//  • «поток»: что вы дослушали или лайкнули, то и становится зерном для следующих похожих песен;
//  • знакомство с новым: сначала самые известные песни нового исполнителя, а понравившемуся треку даётся «второй шанс»;
//  • настроение: «Мой вайб», «Открытия», «Любимое», «Спокойнее», «Бодрее»;
//  • не повторяет песни, которые вы слышали в волне за последние 3 дня, одного исполнителя чаще раза в 3 трека
//    и один жанр больше двух раз подряд; не ставит караоке, минусовки и прочий мусор;
//  • учитывает язык, версии slowed / sped up, жанры и время суток.
import { searchTracks } from './catalog.js';
import { peekYouTubeId, prefetchYouTubeIds } from './youtube.js';
import * as player from './player.js';
import * as store from './store.js';
import { $, h, toast } from './ui.js';
import { shuffled } from './utils.js';
import { norm, isArtistBlocked, blockedArtists, dislikedTracks, dislikeTrack, splitArtists } from './taste.js';
import { communityTaste, communityTracks } from './leaders.js';
import { artistTop, artistRadio, relatedArtists, chartTracks, genreChart, genreId, artistFresh } from './reco.js';
import { openFull } from './playerui.js';
import { markDaily } from './daily.js';

const SKEY = 'mkw.wave2';
const AKEY = 'mkw.wave3.arms';
const AKEY5 = 'mkw.wave5.arms';
const MKEY = 'mkw.wave5.model';
const DKEY = 'mkw.wave5.done';
const SEENKEY = 'mkw.wave3.seen';
const MOODKEY = 'mkw.wave3.mood';
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
let ctracks = [];        // любимые треки слушателей с похожим вкусом
let expo = {};           // исполнитель → сколько раз уже звучал в этой волне (усталость)
let lastGenres = []; // жанры последних дослушанных песен — волна держит настроение
let flow = [];           // последние песни, которые зашли: зёрна для «похожего»
const SKIPKEY = 'mkw.wave.skips';
let skips = (() => { try { return JSON.parse(localStorage.getItem(SKIPKEY) || '{}'); } catch { return {}; } })();
const part = (hr) => (hr < 6 ? 0 : hr < 12 ? 1 : hr < 18 ? 2 : 3); // ночь / утро / день / вечер

const VARIANT = /slow|sped|speed|nightcore|reverb|ускор|замедл|remix|ремикс/i;
const CYR = /[а-яё]/i;
const CALM = /lo-?fi|chill|acoustic|piano|ambient|sad|ballad|slowed|reverb|sleep|night|акуст|спокой|грус|медлен|колыбел|jazz|soul|r&b|singer|songwriter|classical|ambient/i;
const ENERGY = /phonk|sped|speed ?up|hardstyle|drill|trap|edm|dance|electro|techno|house|drum|bass|rock|metal|punk|workout|gym|фонк|рок|танц|club|hip-?hop|rap|рэп/i;
// караоке, минусовки, трибьюты и «8D» в волне не нужны
const JUNK = /karaoke|караоке|tribute|instrumental version|минусовка|\(минус\)|8d audio|bass ?boost|ringtone|рингтон|cover version|made famous|originally performed|in the style of|backing track|lullaby version/i;
const isJunk = (t) => JUNK.test(`${t.title} ${t.album || ''} ${t.artist}`);
const artistsOf = (t) => splitArtists(t.artist).map(norm).filter(Boolean);
// «отпечаток» песни: одно и то же название без версий и скобок
const fp = (t) => `${norm(String(t.title || '').replace(/\s*[(\[].*?[)\]]/g, '').replace(/\s*[-–—].*$/, '')).replace(/[^a-zа-яё0-9]/gi, '')}|${artistsOf(t)[0] || ''}`;

// ---------- настроение ----------
export const MOODS = [
  { id: 'vibe', name: 'Мой вайб' },
  { id: 'discover', name: 'Открытия', arm: { new: 2.2, radio: 1.5, community: 1.4, ctrack: 1.4, genre: 1.3, fresh: 0.9, fam: 0.45, liked: 0.25, chart: 0.8 } },
  { id: 'fav', name: 'Любимое', arm: { fam: 1.8, liked: 2.4, fresh: 1.5, radio: 0.8, new: 0.25, community: 0.3, ctrack: 0.3, genre: 0.3, chart: 0.2 } },
  { id: 'calm', name: 'Спокойнее', re: CALM },
  { id: 'energy', name: 'Бодрее', re: ENERGY },
];
let mood = (() => { try { return localStorage.getItem(MOODKEY) || 'vibe'; } catch { return 'vibe'; } })();
const moodOf = () => MOODS.find((m) => m.id === mood) || MOODS[0];

// ---------- источники и обучение (выбор Томпсона) ----------
const ARM_WHY = { fam: 'Любимый исполнитель', radio: 'Похоже на то, что вам зашло', new: 'Открытие для вас', liked: 'Из ваших лайков', community: 'Любят слушатели с похожим вкусом', fresh: 'Новинка любимого исполнителя', ctrack: 'Любимый трек слушателей с похожим вкусом', genre: 'Популярное в вашем жанре', chart: 'Популярное сейчас' };
const PRIOR = { fam: [2.5, 2], radio: [3, 2], new: [2.5, 2], liked: [1.5, 2], community: [1.5, 2], genre: [2, 2], chart: [1, 2.2], fresh: [2.2, 2], ctrack: [1.6, 2] };
// сколько «знакомого» (исполнители, которых вы уже слушаете, и ваши лайки) в волне — остальное новое
const SHARE = { vibe: 0.3, discover: 0.12, fav: 0.7, calm: 0.35, energy: 0.35 };
// статистика источников — своя для каждого настроения: в «Открытиях» заходит одно, в «Любимом» другое
let armSets = (() => {
  try { const v = JSON.parse(localStorage.getItem(AKEY5) || 'null'); if (v && typeof v === 'object') return v; } catch { /* ignore */ }
  let old = {}; try { old = JSON.parse(localStorage.getItem(AKEY) || '{}'); } catch { /* ignore */ }   // опыт Волны 3–4 не теряем
  return { vibe: { ...old } };
})();
const armsNow = () => { if (!armSets[mood]) armSets[mood] = { ...(armSets.vibe || {}) }; return armSets[mood]; };
const armOf = (k) => { const v = armsNow()[k]; return Array.isArray(v) && v.length === 2 ? v : PRIOR[k]; };
const saveArms = () => { try { localStorage.setItem(AKEY5, JSON.stringify(armSets)); } catch { /* ignore */ } };
function gamma(k) {
  if (k < 1) return gamma(k + 1) * Math.random() ** (1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { const u1 = Math.random(), u2 = Math.random(); x = Math.sqrt(-2 * Math.log(u1 || 1e-9)) * Math.cos(2 * Math.PI * u2); v = 1 + c * x; } while (v <= 0);
    v = v * v * v; const u = Math.random();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
const betaSample = ([a, b]) => { const x = gamma(Math.max(0.5, a)), y = gamma(Math.max(0.5, b)); return x / (x + y); };
function rewardArm(src, good, w = 1) {
  if (!PRIOR[src]) return;
  const [a, b] = armOf(src);
  // старые наблюдения понемногу забываются, чтобы волна успевала за сменой вкуса
  const decay = (a + b) > 60 ? 0.97 : 1;
  armsNow()[src] = good ? [a * decay + w, b * decay] : [a * decay, b * decay + w];
  saveArms();
}
function allocate(total) {
  const m = moodOf().arm || {};
  const th = Object.keys(PRIOR).map((k) => ({ k, v: betaSample(armOf(k)) * (m[k] ?? 1) * (k === 'new' ? 0.6 + explore : 1) }));
  if (!store.state.likes.length) th.forEach((x) => { if (x.k === 'liked') x.v = 0; });
  if (!ctracks.length) th.forEach((x) => { if (x.k === 'ctrack') x.v = 0; });
  const sum = th.reduce((s, x) => s + x.v, 0) || 1;
  const out = {};
  th.sort((a, b) => b.v - a.v).forEach((x, i) => { out[x.k] = Math.max(i < 3 ? 1 : 0, Math.round((x.v / sum) * total)); });
  return out;
}

// ---------- обучаемая оценка (Волна 5) ----------
// Логистическая модель по признакам песни. Стартует с разумных весов и после каждой вашей реакции чуть сдвигается.
const W0 = [0, 1.1, 0.7, 0.6, 0.6, 0.6, 0, 0.4, 0.4, 0.5, -0.8, 0.1];
let model = (() => { try { const m = JSON.parse(localStorage.getItem(MKEY) || 'null'); if (m && Array.isArray(m.w) && m.w.length === W0.length && m.w.every(Number.isFinite)) return m; } catch { /* ignore */ } return { w: W0.slice(), n: 0 }; })();
const sig = (x) => 1 / (1 + Math.exp(-x));
const r2 = (x) => Math.round(x * 100) / 100;
function feats(t, liked) {
  const as = artistsOf(t);
  const g = t.genre ? norm(t.genre) : '';
  const cyr = CYR.test(`${t.artist} ${t.title}`);
  const mx = (m) => as.reduce((v, a) => Math.max(v, m[a] || 0), 0);
  return [1,
    r2(Math.tanh(Math.max(...as.map((a) => weight(a)), -3) / 4)),      // 1 — вкус к исполнителю
    g ? r2(Math.tanh((genre[g] || 0) / 5)) : 0,                         // 2 — вкус к жанру
    r2(cyr ? prefs.cyr * 2 - 1 : 1 - prefs.cyr * 2),                    // 3 — язык как обычно у вас
    VARIANT.test(t.title) ? (prefs.variant > 0.25 ? 1 : -1) : 0,        // 4 — slowed / sped up / remix
    liked.has(t.id) ? 1 : 0,                                            // 5 — уже в лайках
    as.some((a) => (score[a] || 0) > 1.2) ? 0 : 1,                      // 6 — новый для вас исполнитель
    r2(Math.tanh(mx(hourArt) / 3)),                                     // 7 — слушаете в это время суток
    r2(Math.tanh(mx(community) / 3)),                                   // 8 — любят слушатели с похожим вкусом
    g && lastGenres.includes(g) ? 1 : 0,                                // 9 — жанр того, что только что зашло
    t.duration && t.duration < 80 ? 1 : 0,                              // 10 — короткий кусочек
    t.pop ? r2(Math.min(1, t.pop / 900) * 2 - 1) : 0,                   // 11 — популярность
  ];
}
const predict = (x) => sig(x.reduce((s, v, i) => s + v * model.w[i], 0));
function learn(x, y, k = 1) {
  if (!Array.isArray(x) || x.length !== W0.length) return;
  const err = y - predict(x), lr = 0.06 * k;
  for (let i = 0; i < W0.length; i++) model.w[i] = Math.max(-4, Math.min(4, model.w[i] + lr * (err * x[i] - 0.01 * (model.w[i] - W0[i]))));
  model.n = Math.min(100000, (model.n || 0) + k);
}

// что уже дослушивали в волне: первые разы песня «растёт», потом может надоесть
let doneMap = (() => { try { return JSON.parse(localStorage.getItem(DKEY) || '{}'); } catch { return {}; } })();

// ---------- память о прослушанном в волне (3 дня) ----------
let seen = (() => { try { return JSON.parse(localStorage.getItem(SEENKEY) || '{}'); } catch { return {}; } })();
function markSeen(t) {
  seen[fp(t)] = Date.now();
  const e = Object.entries(seen); if (e.length > 700) seen = Object.fromEntries(e.sort((a, b) => b[1] - a[1]).slice(0, 600));
  try { localStorage.setItem(SEENKEY, JSON.stringify(seen)); } catch { /* ignore */ }
}
const seenRecently = (t) => Date.now() - (seen[fp(t)] || 0) < 3 * DAY;

function seedScores() {
  score = {}; fresh = {};
  const now = Date.now();
  const add = (t, w) => { for (const a of artistsOf(t)) score[a] = (score[a] || 0) + w; };
  // лайки: свежие весят больше (полураспад ~60 дней)
  for (const t of store.state.likes) add(t, 2 + 3 * Math.pow(0.5, (now - (Number(t.likedAt) || now)) / (60 * DAY)));
  // история: затухание по позиции и по времени
  store.state.history.slice(0, 80).forEach((t, i) => add(t, (i < 15 ? 1.4 : 0.8) * Math.pow(0.5, (now - (Number(t.playedAt) || now)) / (14 * DAY))));
  // плейлисты: раз добавили, значит нравится
  let pl = 0;
  for (const p of store.state.playlists || []) for (const t of (p.tracks || [])) { if (pl++ > 200) break; add(t, 1.2); }
  // витрина профиля: любимые исполнители и треки, которые вы сами выбрали
  try {
    const nick = (store.state.profile && store.state.profile.nick) || '';
    const c = nick ? JSON.parse(localStorage.getItem(`mkw.pcustom.${nick}`) || 'null') : null;
    if (c) { for (const a of (c.favArtists || [])) { const k = norm(a); if (k) score[k] = (score[k] || 0) + 4; } for (const t of (c.favTracks || [])) add(t, 3); }
  } catch { /* ignore */ }
  try {
    const saved = JSON.parse(localStorage.getItem(SKEY) || '{}');
    for (const [a, w] of Object.entries(saved)) score[a] = (score[a] || 0) + w * 0.85; // старые реакции понемногу забываются
  } catch { /* ignore */ }
  genre = {}; hourArt = {};
  const nowPart = part(new Date().getHours());
  for (const t of store.state.likes) if (t.genre) genre[norm(t.genre)] = (genre[norm(t.genre)] || 0) + 1;
  for (const t of store.state.history.slice(0, 120)) {
    if (t.genre) genre[norm(t.genre)] = (genre[norm(t.genre)] || 0) + 0.5;
    if (t.playedAt && part(new Date(Number(t.playedAt)).getHours()) === nowPart) for (const a of artistsOf(t)) hourArt[a] = (hourArt[a] || 0) + 1;
  }
  try { const g = JSON.parse(localStorage.getItem(`${SKEY}.g`) || '{}'); for (const [k, w] of Object.entries(g)) genre[k] = (genre[k] || 0) + w; } catch { /* ignore */ }
  const sample = [...store.state.likes, ...store.state.history.slice(0, 60)];
  if (sample.length) {
    prefs.cyr = sample.filter((t) => CYR.test(`${t.artist} ${t.title}`)).length / sample.length;
    prefs.variant = sample.filter((t) => VARIANT.test(t.title)).length / sample.length;
  }
}
function persist() {
  try { localStorage.setItem(`${SKEY}.g`, JSON.stringify(Object.fromEntries(Object.entries(genre).filter(([, w]) => Math.abs(w) > 0.5).slice(0, 40)))); } catch { /* ignore */ }
  try { const e = Object.entries(skips).sort((a, b) => b[1].at - a[1].at).slice(0, 300); skips = Object.fromEntries(e); localStorage.setItem(SKIPKEY, JSON.stringify(skips)); } catch { /* ignore */ }
  try { localStorage.setItem(MKEY, JSON.stringify({ w: model.w.map((v) => Math.round(v * 1000) / 1000), n: model.n })); } catch { /* ignore */ }
  try { const e = Object.entries(doneMap).sort((a, b) => b[1][1] - a[1][1]).slice(0, 500); doneMap = Object.fromEntries(e); localStorage.setItem(DKEY, JSON.stringify(doneMap)); } catch { /* ignore */ }
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
  const ws = entries.map((a) => Math.max(0.15, weight(a) + 0.8) ** 1.3 * (1 + Math.min(1, (hourArt[a] || 0) * 0.15)));
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
  // любимые треки слушателей: сначала тех исполнителей, что близки вашему вкусу
  const all = await communityTracks().catch(() => []);
  const near = (t) => artistsOf(t).reduce((m, a) => Math.max(m, (community[a] || 0) + ((score[a] || 0) > 0 ? 1 : 0)), 0);
  ctracks = all.filter((t) => t && t.id && t.title && !artistsOf(t).some((a) => isArtistBlocked(a) || (score[a] || 0) < -1))
    .map((t) => { const { by, ...clean } = t; return { t: clean, w: near(t) }; }).sort((a, b) => b.w - a.w).slice(0, 30).map((x) => x.t);
}

// популярные треки исполнителя (Deezer), запасной путь — поиск iTunes
async function topOf(artist, n) {
  const own = (list) => list.filter((t) => artistsOf(t).some((x) => x.includes(artist) || artist.includes(x)));
  const top = own(await artistTop(artist, Math.max(n, 10)).catch(() => []));
  if (top.length >= Math.min(3, n)) return top.slice(0, n);
  return own(await searchTracks(artist).catch(() => [])).slice(0, n);
}

async function discoverArtists(n) {
  const seeds = new Set();
  for (const t of flow.slice(-2)) for (const a of artistsOf(t).slice(0, 1)) seeds.add(a);
  const cur = player.queue.current;
  if (cur && seeds.size < 2) for (const a of artistsOf(cur).slice(0, 1)) if (weight(a) > -1) seeds.add(a);
  for (let k = seeds.size; k < 3; k++) { const a = pickArtist(seeds); if (a) seeds.add(a); }
  const cand = new Map();
  for (const s of seeds) {
    const rel = await relatedArtists(s).catch(() => []);
    rel.forEach((x, i) => {
      const a = norm(x.name);
      if (!a || (score[a] || 0) > 1.5 || (score[a] || 0) < -1 || isArtistBlocked(a)) return;
      let w = (25 - i) / 25 + Math.max(0, weight(s)) / 10;
      const cyr = CYR.test(x.name);
      w *= cyr ? 0.4 + prefs.cyr : 1.4 - prefs.cyr;
      const prev = cand.get(a);
      cand.set(a, { w: Math.max(prev ? prev.w : 0, w) + (prev ? 0.4 : 0), seed: s, name: x.name });
    });
  }
  return [...cand.entries()].sort((a, b) => b[1].w - a[1].w).slice(0, n * 2).sort(() => Math.random() - 0.5).slice(0, n).map((x) => x[1]);
}

const cap = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());
const tag = (list, src, why) => list.map((t) => ({ ...t, _src: src, waveWhy: why || ARM_WHY[src] }));

async function fromArm(arm, count) {
  if (count <= 0) return [];
  const out = [];
  if (arm === 'fam') {
    const used = new Set();
    for (let k = 0; k < Math.min(4, Math.ceil(count / 2)); k++) {
      const a = pickArtist(used); if (!a) break; used.add(a);
      // у давно любимых берём и песни поглубже, не только первые хиты
      out.push(...tag(shuffled(await topOf(a, (score[a] || 0) > 6 ? 25 : 12)).slice(0, 4), 'fam'));
    }
  } else if (arm === 'radio') {
    const seeds = [...new Set(flow.slice(-3).flatMap((t) => artistsOf(t).slice(0, 1)))];
    if (!seeds.length) { const a = pickArtist(); if (a) seeds.push(a); }
    for (const s of seeds.slice(-2)) {
      const seedT = flow.slice().reverse().find((t) => artistsOf(t)[0] === s);
      const why = seedT ? `Похоже на «${seedT.title}»` : `Похоже на ${cap(s)}`;
      const rad = (await artistRadio(s).catch(() => [])).filter((t) => !artistsOf(t).includes(s) || Math.random() < 0.25);
      out.push(...tag(shuffled(rad).slice(0, Math.max(3, count)), 'radio', why));
    }
  } else if (arm === 'new') {
    const fresh2 = await discoverArtists(Math.max(1, Math.ceil(count / 2))).catch(() => []);
    // знакомство с новым исполнителем лучше начинать с его самых известных песен
    for (const x of fresh2) out.push(...tag((await topOf(norm(x.name), 4)).slice(0, 2), 'new', `Открытие: похоже на ${cap(x.seed)}`));
  } else if (arm === 'liked') {
    const recent = new Set(store.state.history.slice(0, 40).map((t) => t.id));
    out.push(...tag(shuffled(store.state.likes.filter((t) => !recent.has(t.id))).slice(0, count + 2), 'liked'));
  } else if (arm === 'community') {
    const list = Object.entries(community).filter(([a]) => !isArtistBlocked(a) && (score[a] || 0) > -1).sort((a, b) => b[1] - a[1]).slice(0, 8);
    for (const [a] of shuffled(list).slice(0, 2)) out.push(...tag((await topOf(a, 4)).slice(0, 2), 'community'));
  } else if (arm === 'genre') {
    // любимые жанры → самое популярное в них (чарты iTunes; работает даже без Deezer)
    const gs = Object.entries(genre).filter(([g, w]) => w > 0 && genreId(g)).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const ids = [...new Set((gs.length ? shuffled(gs).slice(0, 2) : [['', 1]]).map(([g]) => genreId(g)))];
    const cc = prefs.cyr > 0.35 ? 'RU' : 'US';
    for (const id of ids) {
      const ch = await genreChart(id, cc).catch(() => []);
      out.push(...tag(shuffled(ch).slice(0, Math.max(3, Math.ceil(count / ids.length) + 2)), 'genre'));
    }
  } else if (arm === 'fresh') {
    const used = new Set();
    for (let k = 0; k < 3 && out.length < count + 1; k++) {
      const a = pickArtist(used); if (!a) break; used.add(a);
      if ((score[a] || 0) < 1.5) continue;                       // новинки — только тех, кого вы правда слушаете
      const list = await artistFresh(a).catch(() => []);
      out.push(...tag(shuffled(list).slice(0, 2), 'fresh', `Новинка: ${cap(a)}`));
    }
  } else if (arm === 'ctrack') {
    out.push(...tag(shuffled(ctracks).slice(0, count + 1), 'ctrack'));
  } else if (arm === 'chart') {
    const ch = await chartTracks().catch(() => []);
    out.push(...tag(shuffled(ch.filter((t) => (CYR.test(`${t.artist} ${t.title}`) ? prefs.cyr > 0.25 : prefs.cyr < 0.85))).slice(0, count + 1), 'chart'));
  }
  return out;
}

async function gather(n) {
  const alloc = allocate(Math.round(n * 1.8) + 4);
  const parts = await Promise.all(Object.entries(alloc).map(([arm, c]) => fromArm(arm, c).catch(() => [])));
  return parts.flat();
}

// оценка трека: вкус к исполнителю + привычки + настроение + немного случайности
function rate(t, liked) {
  const as = artistsOf(t);
  let s = Math.max(...as.map((a) => weight(a)), 0) * 0.4 + Math.random() * 1.1;
  if (liked.has(t.id)) s += t._src === 'liked' ? 0.6 : 1;
  if (VARIANT.test(t.title)) s += prefs.variant > 0.25 ? 0.8 : -1.2;
  const cyr = CYR.test(`${t.artist} ${t.title}`);
  s += (cyr ? prefs.cyr - 0.5 : 0.5 - prefs.cyr) * 1.2;
  if (t._src === 'new') s += explore * 1.5;
  if (t._src === 'radio') s += 0.6;
  if (t.genre) s += Math.max(-1.5, Math.min(1.5, (genre[norm(t.genre)] || 0) * 0.12));
  s += Math.min(1, as.reduce((m, a) => Math.max(m, hourArt[a] || 0), 0) * 0.15);
  s += Math.min(0.8, as.reduce((m, a) => Math.max(m, community[a] || 0), 0) * 0.2);
  const sk = skips[t.id]; if (sk) s -= sk.n * 1.5 * Math.pow(0.5, (Date.now() - (sk.at || 0)) / (20 * DAY)); // пропуски со временем забываются
  if (peekYouTubeId(t)) s += 0.4; // полный трек точно доступен
  // держим «поток»: жанр, который вы только что дослушали, — чуть выше
  if (t.genre && lastGenres.includes(norm(t.genre))) s += 0.6;
  // короткие кусочки и интро в волне не нужны
  if (t.duration && t.duration < 80) s -= 1.5;
  // усталость: исполнитель уже несколько раз звучал в этой волне
  s -= Math.max(0, as.reduce((m, a) => Math.max(m, expo[a] || 0), 0) - 2) * 0.35;
  // «второй шанс»: дослушанная раз-другой песня нравится всё больше, а заслушанная без лайка надоедает
  const dn = doneMap[fp(t)]; if (dn) s += dn[0] <= 2 ? 0.45 : (liked.has(t.id) ? 0 : -0.5);
  // обучаемая оценка: чем больше реакций, тем сильнее ей доверяем
  const x = feats(t, liked); t._fx = x;
  s += (predict(x) - 0.5) * 3 * Math.min(1, (model.n || 0) / 25);
  const md = moodOf();
  // «Мой вайб» ночью — спокойнее, утром — бодрее
  if (md.id === 'vibe') { const hr = new Date().getHours(), txt = `${t.title} ${t.genre || ''}`; if (hr < 6 || hr >= 23) s += CALM.test(txt) ? 0.5 : ENERGY.test(txt) ? -0.5 : 0; else if (hr >= 7 && hr < 11) s += ENERGY.test(txt) ? 0.3 : 0; }
  if (md.re) { const txt = `${t.title} ${t.artist} ${t.genre || ''} ${t.album || ''}`; s += md.re.test(txt) ? 1.6 : (md.id === 'calm' ? (ENERGY.test(txt) ? -1.6 : 0) : (CALM.test(txt) ? -1.6 : 0)); }
  return s;
}

// Главное: волна не должна превращаться в «ваши лайки по кругу». Берём заданную долю знакомого,
// остальное — новые для вас исполнители, похожие на ваш вкус. Один новый исполнитель — не чаще раза
// за 12 песен, знакомый — не больше двух раз.
const isKnown = (t, liked) => liked.has(t.id) || artistsOf(t).some((a) => (score[a] || 0) > 1.2);
function selectMix(pool, n, liked, before, relax = false) {
  const recentA = new Map();
  for (const t of before.slice(-12)) for (const a of artistsOf(t)) recentA.set(a, (recentA.get(a) || 0) + 1);
  const per = new Map();
  const ok = (x, lim) => artistsOf(x.t).every((a) => (recentA.get(a) || 0) + (per.get(a) || 0) < lim);
  const take = (x, to) => { to.push(x); for (const a of artistsOf(x.t)) per.set(a, (per.get(a) || 0) + 1); };
  const scored = pool.map((t) => ({ t, s: rate(t, liked), k: isKnown(t, liked) })).sort((a, b) => b.s - a.s);
  const nk = Math.round(n * (SHARE[mood] ?? 0.3));
  const K = [], U = [];
  for (const x of scored) {
    if (x.k) { if (K.length < nk && ok(x, 2)) take(x, K); } else if (U.length < n - nk && ok(x, 1)) take(x, U);
  }
  // нового не хватило — добираем знакомым (и наоборот), но всё так же без повторов исполнителей
  for (const x of scored) { if (K.length + U.length >= n) break; if (!K.includes(x) && !U.includes(x) && ok(x, 2)) take(x, x.k ? K : U); }
  // совсем мало вариантов (например, нет сети для подбора) — лучше повтор исполнителя, чем тишина
  if (relax) for (const x of scored) { if (K.length + U.length >= n) break; if (!K.includes(x) && !U.includes(x)) take(x, x.k ? K : U); }
  // знакомые песни — равномерно между новыми
  const out = [];
  const u = U.map((x) => x.t), k = K.map((x) => x.t);
  const every = k.length ? Math.max(2, Math.round((u.length + k.length) / k.length)) : 0;
  while (u.length || k.length) {
    if (k.length && (!u.length || (every && out.length % every === 1))) out.push(k.shift()); else out.push(u.shift());
  }
  return spread(out, before);
}

// раскладываем так, чтобы один исполнитель не повторялся чаще раза в 3 трека, а источники чередовались
function spread(list, before) {
  const out = [];
  const rest = [...list];
  const recentA = () => [...before.slice(-2), ...out.slice(-2)].flatMap(artistsOf);
  while (rest.length) {
    const r = recentA();
    const lastSrc = out.length ? out[out.length - 1]._src : '';
    const g2 = [...before.slice(-2), ...out].slice(-2).map((t) => norm(t.genre || ''));
    const run = g2.length === 2 && g2[0] && g2[0] === g2[1] ? g2[0] : '';   // один жанр уже дважды подряд
    let i = rest.findIndex((t) => !artistsOf(t).some((a) => r.includes(a)) && t._src !== lastSrc && (!run || norm(t.genre || '') !== run));
    if (i < 0) i = rest.findIndex((t) => !artistsOf(t).some((a) => r.includes(a)) && t._src !== lastSrc);
    if (i < 0) i = rest.findIndex((t) => !artistsOf(t).some((a) => r.includes(a)));
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
      const seenNow = new Set();
      const strict = round < 2;
      let pool = (await gather(n - added)).filter((t) => {
        const f = fp(t);
        if (!t.id || !t.title || isJunk(t) || dis.has(t.id) || (skips[t.id] && skips[t.id].n >= 2 && Date.now() - (skips[t.id].at || 0) < 30 * DAY) || have.has(t.id) || have.has(f) || seenNow.has(f) || artistsOf(t).some((a) => weight(a) <= -1.5 || isArtistBlocked(a))) return false;
        if (strict && (played.has(t.id) || played.has(f) || recent.has(t.id) || recent.has(f) || (seenRecently(t) && !liked.has(t.id)))) return false;
        seenNow.add(f);
        return true;
      });
      await prefetchYouTubeIds(pool);
      if (!active || !player.queue.current) break; // пока искали, музыку остановили (смахнули плеер) — ничего не добавляем
      const pick = selectMix(pool, n - added, liked, player.queue.items, round === 2);
      for (const t of pick) { const { _src, _fx, ...clean } = t; player.addToQueue({ ...clean, wave: true, waveSrc: _src, waveNew: !isKnown(t, liked), waveFx: _fx }); }
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
  if (t.genre) genre[norm(t.genre)] = (genre[norm(t.genre)] || 0) - 0.8;
  learn(t.waveFx, 0, 2);                                   // дизлайк — самый сильный сигнал
  if (t.waveSrc) rewardArm(t.waveSrc, false, 2);
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
  const t = last.track;
  const as = artistsOf(t);
  const frac = last.duration > 0 ? last.time / last.duration : (last.time > 30 ? 1 : 0);
  played.add(t.id); played.add(fp(t)); markSeen(t);
  for (const a of as) expo[a] = (expo[a] || 0) + 1;
  if (kind === 'skip' && (last.time < 25 || frac < 0.3)) {
    // быстрый пропуск — сильный сигнал, поздний — слабый
    const w = last.time < 10 ? 1.4 : 0.8;
    for (const a of as) { score[a] = (score[a] || 0) - w; fresh[a] = (fresh[a] || 0) - w; }
    if (t.genre) genre[norm(t.genre)] = (genre[norm(t.genre)] || 0) - 0.4;
    if (last.time < 15) { const k = t.id; skips[k] = { n: ((skips[k] && skips[k].n) || 0) + 1, at: Date.now() }; }
    if (t.waveSrc) rewardArm(t.waveSrc, false, last.time < 10 ? 1 : 0.6);
    learn(t.waveFx, 0, last.time < 10 ? 1.2 : 0.7);
    streak += 1;
    if (t.waveNew) explore = Math.max(0.15, explore - 0.06); else explore = Math.min(0.6, explore + 0.03);
  } else if (kind === 'done' || frac > 0.7) {
    for (const a of as) { score[a] = (score[a] || 0) + 1; fresh[a] = (fresh[a] || 0) + 1.2; }
    if (t.genre) { genre[norm(t.genre)] = (genre[norm(t.genre)] || 0) + 0.3; lastGenres = [norm(t.genre), ...lastGenres.filter((g) => g !== norm(t.genre))].slice(0, 3); }
    if (t.waveSrc) rewardArm(t.waveSrc, true, 1);
    learn(t.waveFx, 1, 1);
    { const k = fp(t), d = doneMap[k]; doneMap[k] = [((d && d[0]) || 0) + 1, Date.now()]; }
    markDaily('wave');
    flow.push(t); if (flow.length > 6) flow.shift();
    streak = 0;
    if (t.waveNew) explore = Math.min(0.6, explore + 0.05);
  }
  persist();
  if (streak >= 3) {
    // три пропуска подряд: настроение сменилось — сбрасываем импульс и «поток», больше проверенного
    streak = 0; fresh = {}; flow = flow.slice(-1); explore = Math.max(0.15, explore - 0.1);
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
  if (sub) sub.textContent = on ? `Играет · ${moodOf().name}. Нажмите, чтобы выключить` : 'Музыка под ваш вкус, учится на каждом треке';
  if (on) { player.queue.setShuffle(false); }
  paintWhy();
}

export async function startWave(fromTrack) {
  if (active && !fromTrack) { setActive(false); toast('Волна выключена'); return; }
  seedScores();
  if (!Object.keys(score).length && !fromTrack) {
    toast('Лайкните пару треков или послушайте что-нибудь, и волна подстроится');
    return;
  }
  played = new Set(); expo = {};
  streak = 0;
  explore = mood === 'discover' ? 0.55 : mood === 'fav' ? 0.2 : 0.35;
  flow = fromTrack ? [fromTrack] : store.state.history.slice(0, 3).reverse();
  loadCommunity();
  setActive(true);
  const sub = $('#wave-sub');
  if (sub) sub.textContent = 'Подбираю…';
  // сразу открываем большой плеер — волна начинается с песни на весь экран
  try { openFull(); } catch { /* ignore */ }
  await seedQueue(fromTrack);
}

async function seedQueue(fromTrack) {
  const recent = new Set(store.state.history.slice(0, 15).map((t) => t.id));
  const md = moodOf();
  let first = [];
  if (fromTrack) first = [{ ...fromTrack, wave: true, waveSrc: 'radio', waveWhy: 'С этого трека начинается волна' }];
  // Быстрый старт: музыка начинается сразу с любимой песни, которую давно не включали, а подбор идёт уже под неё —
  // не нужно ждать «Подбираю…» в тишине. В режиме «Открытия» ждём подбор: там первой должна быть новая песня.
  let quick = null;
  if (!fromTrack && md.id !== 'discover') {
    const dis0 = dislikedTracks();
    const cand = store.state.likes.filter((t) => t && t.id && t.title && !recent.has(t.id) && !dis0.has(t.id) && !isJunk(t) && !(skips[t.id] && skips[t.id].n >= 2)
      && (!md.re || md.re.test(`${t.title} ${t.artist} ${t.genre || ''} ${t.album || ''}`)) && !artistsOf(t).some((a) => isArtistBlocked(a)));
    if (cand.length) {
      const ranked = cand.map((t) => ({ t, s: Math.max(...artistsOf(t).map((a) => weight(a)), 0) * 0.3 + (peekYouTubeId(t) ? 1 : 0) + Math.random() * 2 })).sort((a, b) => b.s - a.s);
      quick = { ...ranked[0].t, wave: true, waveSrc: 'liked', waveNew: false };
      first = [quick];
      player.playTracks([quick], 0);
      setActive(true);
    }
  }
  let pool = await gather(12);
  await prefetchYouTubeIds(pool);
  const liked = new Set(store.state.likes.map((t) => t.id));
  const seenF = new Set(first.map(fp));
  const dis = dislikedTracks();
  pool = pool.filter((t) => !isJunk(t));
  const strictPool = pool.filter((t) => { const f = fp(t); if (!t.id || seenF.has(f) || recent.has(t.id) || dis.has(t.id) || (seenRecently(t) && !liked.has(t.id))) return false; seenF.add(f); return true; });
  // мало нового (слушаете одно и то же) — разрешаем и недавнее, лишь бы волна началась
  if (strictPool.length >= 4) pool = strictPool;
  else { const s2 = new Set(first.map(fp)); pool = pool.filter((t) => { const f = fp(t); if (!t.id || s2.has(f) || dis.has(t.id)) return false; s2.add(f); return true; }); }
  let mix = selectMix(pool, 10 - first.length, liked, first, true);
  // первой — уверенное попадание (знакомый исполнитель), дальше уже открытия
  if (!first.length && md.id !== 'discover') { const i = mix.findIndex((t) => isKnown(t, liked) && peekYouTubeId(t)); const j = i >= 0 ? i : mix.findIndex((t) => isKnown(t, liked)); if (j > 0) mix = [mix[j], ...mix.slice(0, j), ...mix.slice(j + 1)]; }
  const start = [...first, ...mix].slice(0, 10).map((t) => { const { _src, _fx, ...clean } = t; return { ...clean, wave: true, waveSrc: _src || clean.waveSrc, waveNew: !isKnown(t, liked), waveFx: _fx }; });
  if (quick) {
    // первая песня уже играет — просто дописываем подобранное в очередь (если волну за это время не выключили)
    if (!active || !player.queue.current) return;
    const have = new Set(player.queue.items.flatMap((t) => [t.id, fp(t)]));
    for (const t of start.slice(1)) if (!have.has(t.id) && !have.has(fp(t))) player.addToQueue(t);
    if (remaining() < 5) refill(10);
    return;
  }
  if (!start.length) { setActive(false); toast('Не получилось подобрать. Проверьте интернет'); return; }
  player.playTracks(start, 0);
  setActive(true);
}

// подпись «Волна · почему» в плеере убрана — просто убираем её, если осталась
function paintWhy() {
  const el = document.getElementById('fp-why');
  if (el) el.remove();
}

function paintMoods() {
  const b = $('#wave-btn');
  if (!b) return;
  let box = $('#wave-moods');
  if (!box) { box = h('div', { id: 'wave-moods', role: 'group', 'aria-label': 'Настроение волны' }); b.after(box); }
  box.replaceChildren(...MOODS.map((m) => h('button', { type: 'button', class: `wm-chip${m.id === mood ? ' on' : ''}`, onclick: () => {
    mood = m.id;
    try { localStorage.setItem(MOODKEY, mood); } catch { /* ignore */ }
    paintMoods();
    if (active) {
      // настроение сменили во время волны — перестраиваем то, что впереди
      const keep = player.queue.items.slice(0, player.queue.index + 1);
      if (player.queue.items.length > keep.length && player.trimQueue) player.trimQueue(keep.length);
      explore = mood === 'discover' ? 0.55 : mood === 'fav' ? 0.2 : 0.35;
      setActive(true);
      refill(10);
      toast(`Волна: ${m.name}`);
    } else startWave();
  } }, m.name)));
}

export function initWave() {
  const b = $('#wave-btn');
  if (b) b.addEventListener('click', () => startWave());
  const d = $('#fp-dislike');
  if (d) d.addEventListener('click', dislike);
  paintMoods();
  store.onStore((what) => {
    if (what !== 'likes' || !active) return;
    const cur = player.queue.current;
    if (cur && cur.wave && store.isLiked(cur.id)) {
      for (const a of artistsOf(cur)) { score[a] = (score[a] || 0) + 2; fresh[a] = (fresh[a] || 0) + 2; }
      if (cur.waveNew) explore = Math.min(0.6, explore + 0.08);
      if (cur.waveSrc) rewardArm(cur.waveSrc, true, 2);
      learn(cur.waveFx, 1, 2);
      // лайк — сильный сигнал: следующие песни будут похожи на эту
      flow.push(cur); if (flow.length > 6) flow.shift();
      persist();
    }
  });
  player.onPlayer((what) => {
    if (what === 'skip' || what === 'done') react(what);
    if (what === 'queue' && active) {
      const cur = player.queue.current;
      if (!cur || !cur.wave) setActive(false);   // запустили своё или остановили — волна заканчивается
    }
    if (what === 'track') { paintWhy(); if (active && player.queue.current && remaining() < 5) refill(10); }
  });
}

export const waveActive = () => active;
// для проверки: что волна сейчас думает (включается только с localStorage mkw.debug = 1)
export const waveDebug = () => ({ active, mood, explore, model, arms: armSets, expo, ctracks: ctracks.length, flow: flow.map((t) => t.title), lastGenres, top: Object.entries(score).sort((a, b) => b[1] - a[1]).slice(0, 8) });
