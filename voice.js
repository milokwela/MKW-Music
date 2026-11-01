// Голосовое управление (бета): «MKW, следующая», «MKW, громче», «Музыка, лайк», «MKW, включи Баста».
// Работает через распознавание речи браузера (Chrome, Яндекс Браузер, Edge, Safari). Слушает, пока вкладка открыта.
import { toast, openSheet, h } from './ui.js?v=0.21.0';
import * as player from './player.js?v=0.21.0';
import * as store from './store.js?v=0.21.0';
import { dislike, startWave, waveActive } from './wave.js?v=0.21.0';
import { searchTracks } from './catalog.js?v=0.21.0';
import { mi } from './icons2.js?v=0.21.0';
import { openFull, closeFull, isFullOpen } from './playerui.js?v=0.21.0';

const KEY = 'mkw.voice';
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, on = false, restartTimer = 0, lastCmd = 0, badge = null, armedUntil = 0, armTimer = 0;
const handled = new Set();

export const voiceSupported = () => Boolean(SR);
export const voiceOn = () => on;

// как браузер может услышать «MKW»: эм кей дабл ю, мкв, эмкейви, эм ка вэ, эмкавэ, а также просто «музыка»
const WAKE = /(?:^|\s)(?:эй\s+|окей\s+|ok\s+)?(?:mkw|m\.?\s?k\.?\s?w|мкв|м\s?к\s?в|эм\s?к[эеа]й(?:\s?(?:дабл\s?(?:ю|в|ви)|ви|в|вэ))?|эмк[эе]й\w*|эм\s?ка\s?в[эеи]|эмкав\w*|эм\s?кв|эмка|макв\w*|мкф|мк\s?ви|music|музыка|музыку|музычка)[\s,.!:?-]*/i;

export const VOICE_COMMANDS = [
  ['Следующая · дальше · пропусти · другую', 'следующий трек'],
  ['Предыдущая · назад · верни', 'прошлый трек'],
  ['Пауза · стоп · замолчи', 'пауза'],
  ['Играй · продолжи · включи', 'продолжить'],
  ['Громче · тише', 'на 15%'],
  ['Громкость 50 · на всю · без звука · верни звук', 'точная громкость'],
  ['Вперёд на 30 секунд · назад на 10', 'перемотка'],
  ['Сначала · заново', 'трек с начала'],
  ['Лайк · нравится · в избранное', 'лайк'],
  ['Убери лайк · дизлайк · не нравится', 'снять лайк / дизлайк'],
  ['Перемешай · повтор', 'режимы очереди'],
  ['Текст · покажи слова', 'текст песни'],
  ['Открой плеер · закрой плеер', 'большой плеер'],
  ['Что играет', 'назовёт трек'],
  ['Таймер на 20 минут', 'таймер сна'],
  ['Волна · выключи волну', 'MKW Волна'],
  ['Мои лайки', 'включить лайки'],
  ['Включи Баста · поставь Луна', 'найти и включить'],
  ['Поиск, Библиотека, Профиль', 'переход по разделам'],
];

const NUM = { ноль: 0, один: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10, пятнадцать: 15, двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90, сто: 100, полминуты: 30, минуту: 60 };
function num(t) {
  const d = t.match(/(\d+)/);
  if (d) return Number(d[1]);
  let sum = 0, any = false;
  for (const w of t.split(/\s+/)) if (w in NUM) { sum += NUM[w]; any = true; }
  return any ? sum : null;
}

function parse(text) {
  const t = text.toLowerCase().replace(/ё/g, 'е').trim();
  if (!t) return null;
  if (/(убер|убра|сним|снят|удали|отмен)\w*\s+(мой\s+|этот\s+)?лайк/.test(t)) return { cmd: 'unlike' };
  if (/дизлайк|не нрав|не то|фу\b/.test(t)) return { cmd: 'dislike' };
  if (/(выключи|останови|стоп)\s+волн/.test(t)) return { cmd: 'wave-off' };
  if (/волн/.test(t)) return { cmd: 'wave' };
  if (/что\s+(сейчас\s+)?(игра|звуч)|как(ая|ой)\s+(это\s+)?(песн|трек)|что\s+за\s+(песн|трек)/.test(t)) return { cmd: 'what' };
  if (/таймер|усни|выключи через/.test(t)) return { cmd: 'sleep', n: num(t) || 30 };
  if (/(перемотай|мотни|промотай)?\s*(вперед|вперёд)\s+(на\s+)?/.test(t) && /(секунд|минут|\d)/.test(t)) return { cmd: 'seek', n: (num(t) || 10) * (/минут/.test(t) ? 60 : 1) };
  if (/назад\s+на\s+/.test(t)) return { cmd: 'seek', n: -(num(t) || 10) * (/минут/.test(t) ? 60 : 1) };
  if (/громкост|на\s+всю|максимал|без\s+звука|выключи\s+звук|верни\s+звук|включи\s+звук/.test(t)) {
    if (/на\s+всю|максимал/.test(t)) return { cmd: 'vol', n: 100 };
    if (/без\s+звука|выключи\s+звук/.test(t)) return { cmd: 'mute' };
    if (/верни\s+звук|включи\s+звук/.test(t)) return { cmd: 'unmute' };
    const n = num(t); if (n != null) return { cmd: 'vol', n: Math.min(100, n) };
  }
  if (/погромче|громче|прибав|louder/.test(t)) return { cmd: 'louder' };
  if (/потише|тише|убав|quieter/.test(t)) return { cmd: 'quieter' };
  if (/лайк|нрав|в избранн|сердечк|like|класс/.test(t)) return { cmd: 'like' };
  if (/следующ|дальше|пропус|скип|некст|next|другую|другой|переключи/.test(t)) return { cmd: 'next' };
  if (/сначала|заново|с начала|повтори (трек|песню)|ещё раз/.test(t)) return { cmd: 'restart' };
  if (/предыдущ|назад|верни|прошл|previous/.test(t)) return { cmd: 'prev' };
  if (/перемеша|вперемешку|шафл|shuffle/.test(t)) return { cmd: 'shuffle' };
  if (/повтор|репит|repeat|зацикл/.test(t)) return { cmd: 'repeat' };
  if (/текст|слова|караоке/.test(t)) return { cmd: 'lyrics' };
  if (/(закрой|сверни|убери)\s+плеер/.test(t)) return { cmd: 'close' };
  if (/(открой|покажи|разверни)\s+плеер/.test(t)) return { cmd: 'open' };
  if (/мои\s+лайки|любимое|избранное/.test(t)) return { cmd: 'likes' };
  if (/^(открой\s+)?(поиск|главн)/.test(t)) return { cmd: 'nav', v: 'search' };
  if (/^(открой\s+)?библиотек/.test(t)) return { cmd: 'nav', v: 'library' };
  if (/^(открой\s+)?профил/.test(t)) return { cmd: 'nav', v: 'profile' };
  if (/пауз|стоп|останов|замолч|выключи музыку|pause|stop|тихо/.test(t)) return { cmd: 'pause' };
  const m = t.match(/(?:включи|поставь|найди|запусти|хочу|play)\s+(?:песню\s+|трек\s+|мне\s+)?(.{2,})$/);
  if (m && !/^(музыку|музыка|песню|трек|дальше|звук|плеер)$/.test(m[1].trim())) return { cmd: 'search', q: m[1].trim() };
  if (/играй|продолж|включи|плей|воспроизв|play|старт|поехали|давай/.test(t)) return { cmd: 'play' };
  return null;
}

let muteVol = 0;
function say(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text); u.lang = 'ru-RU'; u.rate = 1.05;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

async function run({ cmd, q, n, v }) {
  const t = player.queue.current;
  if (cmd === 'next') { player.next(); toast('Следующий трек'); }
  else if (cmd === 'prev') { player.previousTrack(); toast('Предыдущий трек'); }
  else if (cmd === 'pause') { player.pause(); toast('Пауза'); }
  else if (cmd === 'play') { if (!player.st.playing) player.toggle(); toast('Играю'); }
  else if (cmd === 'louder') { const x = player.setVolume(player.getVolume() + 0.15); toast(`Громкость ${Math.round(x * 100)}%`); }
  else if (cmd === 'quieter') { const x = player.setVolume(player.getVolume() - 0.15); toast(`Громкость ${Math.round(x * 100)}%`); }
  else if (cmd === 'vol') { const x = player.setVolume(n / 100); toast(`Громкость ${Math.round(x * 100)}%`); }
  else if (cmd === 'mute') { muteVol = player.getVolume() || 0.7; player.setVolume(0); toast('Без звука'); }
  else if (cmd === 'unmute') { player.setVolume(muteVol || 0.8); toast('Звук включён'); }
  else if (cmd === 'seek') { player.seek(Math.max(0, player.st.time + n)); toast(n > 0 ? `Вперёд на ${n} с` : `Назад на ${-n} с`); }
  else if (cmd === 'restart') { player.seek(0); toast('С начала'); }
  else if (cmd === 'like') { if (t && !store.isLiked(t.id)) { store.toggleLike(t).catch(() => {}); toast('Добавлено в лайки'); } else toast('Уже в лайках'); }
  else if (cmd === 'unlike') { if (t && store.isLiked(t.id)) { store.toggleLike(t).catch(() => {}); toast('Лайк снят'); } }
  else if (cmd === 'dislike') { dislike(); }
  else if (cmd === 'shuffle') { player.toggleShuffle(); toast(player.queue.shuffle ? 'Вперемешку' : 'По порядку'); }
  else if (cmd === 'repeat') { player.cycleRepeat(); toast(player.queue.repeat === 'one' ? 'Повтор трека' : player.queue.repeat === 'all' ? 'Повтор очереди' : 'Без повтора'); }
  else if (cmd === 'lyrics') { if (!isFullOpen()) openFull(); setTimeout(() => { const b = document.getElementById('fp-lyrics-btn'); if (b && !b.classList.contains('on')) b.click(); }, 350); }
  else if (cmd === 'open') openFull();
  else if (cmd === 'close') closeFull();
  else if (cmd === 'what') { const s = t ? `${t.artist} — ${t.title}` : 'Сейчас ничего не играет'; toast(s); say(t ? `Сейчас играет ${t.artist}, ${t.title}` : s); }
  else if (cmd === 'sleep') { player.setSleep(n); toast(`Выключу через ${n} мин`); }
  else if (cmd === 'wave') { if (!waveActive()) startWave(); toast('Включаю MKW Волну'); }
  else if (cmd === 'wave-off') { if (waveActive()) startWave(); }
  else if (cmd === 'likes') { const l = store.state.likes; if (l.length) { player.playTracks(l, 0); toast('Включаю ваши лайки'); } else toast('Лайков пока нет'); }
  else if (cmd === 'nav') { closeFull(); const b = document.querySelector(`#bottom-nav .nav-btn[data-view="${v}"]`); if (b) b.click(); }
  else if (cmd === 'search') {
    toast(`Ищу «${q}»…`);
    const found = await searchTracks(q).catch(() => []);
    if (found.length) { player.playTracks(found.slice(0, 20), 0); toast(`Включаю: ${found[0].artist} — ${found[0].title}`); }
    else toast('Ничего не нашлось');
  }
}

// Подсветка экрана по краям: «слушаю вас»
function arm(ms = 5000) {
  armedUntil = Date.now() + ms;
  document.documentElement.classList.add('voice-listen');
  clearTimeout(armTimer);
  armTimer = setTimeout(() => document.documentElement.classList.remove('voice-listen'), ms);
}
function disarm(ok) {
  armedUntil = 0;
  clearTimeout(armTimer);
  document.documentElement.classList.toggle('voice-ok', Boolean(ok));
  setTimeout(() => document.documentElement.classList.remove('voice-listen', 'voice-ok'), ok ? 650 : 0);
}

function showBadge(txt) {
  if (!badge) { badge = h('div', { class: 'voice-badge' }); document.body.appendChild(badge); }
  badge.replaceChildren(mi('mic'), h('span', { text: txt }));
  badge.classList.add('show');
  clearTimeout(badge._t); badge._t = setTimeout(() => badge.classList.remove('show'), 2200);
}

function onResult(e) {
  for (let i = e.resultIndex; i < e.results.length; i++) {
    const res = e.results[i];
    const key = `${sessionId}:${i}`;
    if (handled.has(key)) continue;
    // берём все варианты распознавания, а не только первый — так слышит лучше
    const alts = [...res].map((a) => a.transcript.trim()).filter(Boolean);
    let rest = null;
    for (const text of alts) { const m = text.match(WAKE); if (m) { rest = text.slice(m.index + m[0].length); break; } }
    const armed = Date.now() < armedUntil;
    if (rest == null && !armed) continue;
    if (rest != null) arm();
    const tries = rest != null ? [rest, ...alts.map((x) => x.replace(WAKE, ' '))] : alts;
    let p = null;
    for (const x of tries) { p = parse(x); if (p) break; }
    if (p && p.cmd === 'search' && !res.isFinal) { showBadge(rest || alts[0]); continue; } // название дослушиваем до конца
    if (!p) { if (res.isFinal && rest) showBadge(`Не поняла: «${rest}»`); else if (rest) showBadge(rest || 'Слушаю…'); continue; }
    if (Date.now() - lastCmd < 900) continue;
    handled.add(key);
    lastCmd = Date.now();
    showBadge(rest || alts[0]);
    disarm(true);
    run(p);
  }
}

let sessionId = 0;
function start() {
  rec = new SR();
  rec.lang = 'ru-RU';
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 5;
  rec.onresult = onResult;
  rec.onstart = () => { sessionId += 1; handled.clear(); };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { toast('Нет доступа к микрофону. Разрешите его в настройках сайта'); setVoice(false); }
    if (e.error === 'network') toast('Распознавание речи без интернета не работает');
  };
  // браузер сам останавливает распознавание через какое-то время — перезапускаем
  rec.onend = () => { if (on) { clearTimeout(restartTimer); restartTimer = setTimeout(() => { try { rec.start(); } catch { /* уже запущено */ } }, 300); } };
  rec.start();
}

export function setVoice(v) {
  if (v && !SR) { toast('Этот браузер не умеет распознавать речь. Попробуйте Chrome или Яндекс Браузер'); return false; }
  on = Boolean(v);
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignore */ }
  if (on) {
    try { start(); toast('Скажите: «MKW, следующая»'); document.documentElement.classList.add('voice-on'); }
    catch { on = false; toast('Не получилось включить микрофон'); }
  } else {
    clearTimeout(restartTimer);
    if (rec) { rec.onend = null; try { rec.stop(); } catch { /* ignore */ } rec = null; }
    document.documentElement.classList.remove('voice-on');
  }
  return on;
}

export function showVoiceGuide() {
  openSheet('Голосовое управление', h('div', {},
    h('p', { class: 'profile-note', text: 'Скажите «MKW» или «Музыка» — края экрана засветятся, значит я слушаю. Потом команду: «следующая», «громче», «включи Баста». Можно сразу одной фразой: «MKW, лайк».' }),
    h('div', { class: 'gest-list' }, VOICE_COMMANDS.map(([words, what]) => h('div', { class: 'gest-item' }, h('span', { class: 'ge' }, mi('mic')), h('div', {}, h('b', { text: words }), h('small', { text: what }))))),
    h('p', { class: 'profile-note', text: 'Бета: работает, пока сайт открыт. Речь распознаёт браузер (в Chrome — сервис Google). Лучше всего слышит, когда музыка не слишком громкая.' })));
}

export function initVoice() {
  // после перезагрузки браузер снова спросит разрешение — включаем только по нажатию пользователя
  try { localStorage.setItem(KEY, '0'); } catch { /* ignore */ }
}
