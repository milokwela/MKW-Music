// Голосовое управление (бета): «MKW, следующая», «MKW, громче», «Музыка, лайк», «MKW, включи Баста».
// Работает через распознавание речи браузера (Chrome, Яндекс Браузер, Edge, Safari). Слушает, пока вкладка открыта.
import { seenOnline } from './clock.js';
import { toast, openSheet, h } from './ui.js';
import * as player from './player.js';
import * as store from './store.js';
import { dislike, startWave, waveActive } from './wave.js';
import { searchTracks } from './catalog.js';
import { mi } from './icons2.js';
import { openFull, closeFull, isFullOpen } from './playerui.js';
import { startCloud, stopCloud, cloudSttPossible } from './stt.js';
import { friendIds, friendCards, loadFriends, friendsLoaded } from './friends.js';
import { startCall } from './call.js';
import { avSrc } from './avatar.js';
import { closeSheet } from './ui.js';
import { setWinter } from './winter.js';
import { setTheme } from './theme.js';

const KEY = 'mkw.voice';
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, on = false, restartTimer = 0, lastCmd = 0, badge = null, armedUntil = 0, armTimer = 0;
const handled = new Set();

// 'browser' — распознавание самого браузера (Chrome, Edge, Safari), 'cloud' — через сервер MKW (Яндекс Браузер, Opera, Firefox)
const EKEY = 'mkw.voice.engine';
let engine = 'browser';
const preferCloud = () => { try { return localStorage.getItem(EKEY) === 'cloud'; } catch { return false; } };
export const voiceSupported = () => Boolean(SR) || cloudSttPossible();
export const voiceOn = () => on;

// как браузер может услышать «MKW»: эм кей дабл ю, мкв, эмкейви, эм ка вэ, эмкавэ, а также просто «музыка»
const WAKE = /(?:^|\s)(?:эй\s+|окей\s+|ok\s+|hey\s+)?(?:mkw|m\s?k\s?w|мкв[а-яa-z]*|м\s?к\s?в|мк\s?в|м\s?кв|мкб|мкф|нкв|эм\s?к[эеа]\s?в[эеиа]?|эм\s?ка\s?в[эеиа]|эмкав[а-яa-z]*|эмкв[а-яa-z]*|эм\s?кв[эеа]|м\s?кв[эеа]|мкве|эмк\s?вэ|эмкэв[а-яa-z]*|эм\s?кв|эмка|макв[а-яa-z]*|мк\s?ви|эм\s?кей(?:\s?(?:дабл\s?(?:ю|в|ви)|ви|в|вэ))?|эмк[эе]й[а-яa-z]*|music|музык(?:а|у|ой|е)?|музычк[а-я]*)(?=\s|$)\s*/

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
  ['Что-нибудь новое · поспокойнее · пободрее', 'настроение MKW Волны'],
  ['Быстрее · медленнее · скорость полтора · обычная скорость', 'скорость воспроизведения'],
  ['Включи плейлист Ночной драйв', 'ваш плейлист по названию'],
  ['Найди Земфира', 'открыть поиск с запросом'],
  ['Покажи очередь', 'что играет дальше'],
  ['Тёмная тема · светлая тема · выключи снег', 'оформление'],
  ['Мои лайки', 'включить лайки'],
  ['Включи Баста · поставь Луна', 'найти и включить'],
  ['Включить Баста · включить Луна Знаешь', 'найти и сразу включить песню или исполнителя'],
  ['Позвони Лере · позвонить', 'звонок другу. Без имени — покажу список, скажите номер: «два» или «второй»'],
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

// ---------- «умное» узнавание: похожие слова тоже считаются ----------
function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length; if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const near = (w, v) => { const d = lev(w, v); return v.length <= 3 ? d === 0 : v.length <= 5 ? d <= 1 : d <= 2; };
// как может прозвучать «МКВ» и «Музыка» (слитно, без пробелов)
const WAKE_WORDS = ['мкв', 'мква', 'мкве', 'эмкв', 'эмквэ', 'эмкве', 'эмкава', 'эмкавэ', 'эмкаве', 'эмкэвэ', 'эмкувэ', 'эмкейдаблю', 'эмкейви', 'mkw', 'эмкаву', 'музыка', 'музыку', 'музыке', 'музычка'];
// ищем слово-сигнал в любом месте фразы, склеивая до трёх соседних слов («эм ка вэ» → «эмкавэ»)
function fuzzyWake(t) {
  const w = t.split(' ');
  for (let i = 0; i < w.length; i++) {
    let glued = '';
    for (let k = 0; k < 3 && i + k < w.length; k++) {
      glued += w[i + k];
      if (glued.length >= 3 && WAKE_WORDS.some((v) => near(glued, v))) return { rest: w.slice(i + k + 1).join(' ') };
    }
  }
  return null;
}
// словарь команд: опечатки распознавания («следуюшая», «гормче») исправляем до ближайшего слова
const VOCAB = ['следующая', 'следующий', 'следующую', 'дальше', 'пропусти', 'предыдущая', 'предыдущий', 'назад', 'верни', 'пауза', 'стоп', 'замолчи', 'играй', 'продолжи', 'включи', 'громче', 'тише', 'погромче', 'потише', 'громкость', 'лайк', 'дизлайк', 'нравится', 'перемешай', 'повтор', 'волна', 'волну', 'текст', 'слова', 'сначала', 'заново', 'таймер', 'открой', 'закрой', 'плеер', 'лайки', 'играет'];
function fixWords(t) { return t.split(' ').map((w) => (w.length < 4 || VOCAB.includes(w) ? w : VOCAB.find((v) => near(w, v)) || w)).join(' '); }

const norm = (x) => String(x || '').toLowerCase().replace(/ё/g, 'е').replace(/[-–—_.,!?:;«»"()]/g, ' ').replace(/\s+/g, ' ').trim();
function parse(text) {
  const p = parse0(text);
  if (p) return p;
  const fixed = fixWords(norm(text));
  return fixed !== norm(text) ? parse0(fixed) : null;
}
function parse0(text) {
  const t = norm(text);
  if (!t) return null;
  const call = t.match(/(?:^|\s)(?:позвон[а-я]*|набер[а-я]*|набрать|созвон[а-я]*|звякн[а-я]*|сделай\s+звонок|звонок)(?:\s+(.*))?$/);
  if (call) return { cmd: 'call', q: (call[1] || '').replace(/^(?:другу|подруге|мне|пожалуйста)\s*/g, '').trim() };
  if (/(убер|убра|сним|снят|удали|отмен)[а-яa-z]*\s+(мой\s+|этот\s+)?лайк/.test(t)) return { cmd: 'unlike' };
  if (/дизлайк|не нрав|не то|фу\b/.test(t)) return { cmd: 'dislike' };
  // --- 0.37: оформление, скорость, настроение волны, плейлисты, поиск, очередь ---
  if (/(выключи|убери|отключи|спрячь)\s+(снег|зим|гирлянд|новогод)/.test(t)) return { cmd: 'winter', v: false };
  if (/(включи|верни|покажи)\s+(снег|зим|гирлянд|новогод)/.test(t)) return { cmd: 'winter', v: true };
  if (/(темн|тёмн|ночн)[а-я]*\s+тем/.test(t)) return { cmd: 'theme', v: 'dark' };
  if (/(светл|дневн)[а-я]*\s+тем/.test(t)) return { cmd: 'theme', v: 'light' };
  if (/скорост|быстрее|побыстрее|ускор|медленнее|помедленнее|замедл/.test(t)) {
    if (/обычн|нормальн|стандартн|верни|сброс|один(?!\s+и)|\b1\b(?![.,])/.test(t) && !/полтор|1[.,]5|два|\b2\b/.test(t)) return { cmd: 'rate', n: 1 };
    if (/полтор|1[.,]5|один и пять/.test(t)) return { cmd: 'rate', n: 1.5 };
    if (/в два|два раза|двойн|\b2\b|двух/.test(t)) return { cmd: 'rate', n: 2 };
    if (/1[.,]25/.test(t)) return { cmd: 'rate', n: 1.25 };
    if (/0[.,]75|три четверт/.test(t)) return { cmd: 'rate', n: 0.75 };
    if (/медленнее|помедленнее|замедл/.test(t)) return { cmd: 'rate', d: -0.25 };
    return { cmd: 'rate', d: 0.25 };
  }
  if (/(что\s*-?\s*нибудь|что\s*-?\s*то|хочу)\s+(нов|незнаком)|^открытия$|волн[а-я]*\s+открыт/.test(t)) return { cmd: 'mood', v: 'discover' };
  if (/поспокойнее|спокойнее|что\s*-?\s*нибудь\s+спокойн|расслаб/.test(t)) return { cmd: 'mood', v: 'calm' };
  if (/пободрее|бодрее|повеселее|энергичн|что\s*-?\s*нибудь\s+(бодр|весел)/.test(t)) return { cmd: 'mood', v: 'energy' };
  { const pl = t.match(/(?:включи|поставь|играй|открой)\s+(?:мой\s+)?плейлист\s+(.+)$/); if (pl) return { cmd: 'playlist', q: pl[1].trim() }; }
  { const f = t.match(/^(?:найди|поищи|ищи|найти)\s+(.+)$/); if (f) return { cmd: 'find', q: f[1].trim() }; }
  if (/очеред|что\s+(будет\s+)?дальше|что\s+следующ/.test(t)) return { cmd: 'queue' };
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
  // «включи / включить / вруби / поставь / найди / сыграй / хочу послушать» + название или исполнитель
  const m = t.match(/(?:^|\s)(?:включи(?:те|ть)?|вруби(?:те|ть)?|поставь(?:те)?|поставить|найди(?:те)?|найти|запусти(?:те|ть)?|сыграй(?:те)?|воспроизведи|хочу(?:\s+послушать)?|давай|послушать|play)\s+(?:мне\s+|пожалуйста\s+|песню\s+|песня\s+|трек\s+|исполнителя\s+|группу\s+|что\s+нибудь\s+(?:от|из|у)?\s*|альбом\s+)*(.{2,})$/);
  if (m && !/^(музыку|музыка|песню|трек|дальше|звук|плеер|обратно|снова|еще|ещё|ее|её|его|это|эту)$/.test(m[1].trim())) return { cmd: 'search', q: m[1].trim() };
  if (/играй|продолж|включи|плей|воспроизв|play|старт|поехали|давай/.test(t)) return { cmd: 'play' };
  return null;
}

let muteVol = 0;
function say(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text); u.lang = 'ru-RU'; u.rate = 1.05;
    u.onend = () => { speakingUntil = Date.now() + 700; }; speakingUntil = Date.now() + 4000; speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

async function run({ cmd, q, n, v, d }) {
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
  else if (cmd === 'winter') { setWinter(v); toast(v ? 'Зимнее оформление включено' : 'Зимнее оформление выключено'); }
  else if (cmd === 'theme') { setTheme(v); toast(v === 'dark' ? 'Тёмная тема' : 'Светлая тема'); }
  else if (cmd === 'rate') {
    const r = Math.max(0.5, Math.min(2, n || Math.round((player.getRate() + d) * 4) / 4)); player.setRate(r);
    toast(r === 1 ? 'Обычная скорость' : `Скорость ${String(r).replace('.', ',')}x`);
  }
  else if (cmd === 'mood') {
    const name = { discover: 'Открытия', calm: 'Спокойнее', energy: 'Бодрее' }[v];
    const chip = [...document.querySelectorAll('#wave-moods .wm-chip')].find((c) => c.textContent === name);
    if (chip) { if (!chip.classList.contains('on') || !waveActive()) chip.click(); toast(`Волна: ${name}`); } else if (!waveActive()) startWave();
  }
  else if (cmd === 'playlist') {
    const key = (x) => norm(x).replace(/\s+/g, '');
    const want = key(q), pls = store.state.playlists || [];
    const p = pls.find((x) => key(x.name) === want) || pls.find((x) => key(x.name).includes(want) || want.includes(key(x.name))) || pls.find((x) => near(key(x.name), want));
    if (p && (p.tracks || []).length) { player.playTracks(p.tracks, 0); toast(`Включаю плейлист «${p.name}»`); }
    else { toast(p ? 'В этом плейлисте пока пусто' : `Не нашла плейлист «${q}»`); say(p ? 'В этом плейлисте пока пусто' : 'Не нашла такой плейлист'); }
  }
  else if (cmd === 'find') {
    closeFull(); const b = document.querySelector('#bottom-nav .nav-btn[data-view="search"]'); if (b) b.click();
    const inp = document.getElementById('search-input'), form = document.getElementById('search-form');
    if (inp && form) { inp.value = q; inp.dispatchEvent(new Event('input', { bubbles: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); toast(`Ищу «${q}»`); }
  }
  else if (cmd === 'queue') { if (t) { if (!isFullOpen()) openFull(); setTimeout(() => { const b = document.getElementById('fp-queue'); if (b) b.click(); }, 350); } else toast('Очередь пуста'); }
  else if (cmd === 'wave') { if (!waveActive()) startWave(); toast('Включаю MKW Волну'); }
  else if (cmd === 'wave-off') { if (waveActive()) startWave(); }
  else if (cmd === 'likes') { const l = store.state.likes; if (l.length) { player.playTracks(l, 0); toast('Включаю ваши лайки'); } else toast('Лайков пока нет'); }
  else if (cmd === 'nav') { closeFull(); const b = document.querySelector(`#bottom-nav .nav-btn[data-view="${v}"]`); if (b) b.click(); }
  else if (cmd === 'call') await voiceCall(q);
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
  armTimer = setTimeout(() => { document.documentElement.classList.remove('voice-listen'); unduck(); }, ms);
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

// Музыка мешает услышать команду: пока MKW слушает, делаем тише и возвращаем громкость после команды
let duckVol = null;
function duck() { if (duckVol == null) { duckVol = player.getVolume(); if (duckVol > 0.3) player.setVolume(0.3); } }
function unduck() { if (duckVol != null) { player.setVolume(duckVol); duckVol = null; } }

let speakingUntil = 0;
function notUnderstood(heard) {
  showBadge(heard ? `Не поняла: «${heard}»` : 'Я вас не поняла');
  toast('Я вас не поняла. Скажите, например: «МКВ, следующая»');
  unduck(); disarm(false);
  document.documentElement.classList.add('voice-no'); setTimeout(() => document.documentElement.classList.remove('voice-no'), 700);
  say('Я вас не поняла');
}

// ---------- «позвони …»: по имени или по номеру из списка ----------
const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const lat = (x) => norm(x).split('').map((c) => (c in TR ? TR[c] : c)).join('').replace(/[^a-z0-9]/g, '')
  .replace(/x/g, 'ks').replace(/w/g, 'v').replace(/q/g, 'k').replace(/ph/g, 'f').replace(/y/g, 'i').replace(/c(?=[ei])/g, 'ts').replace(/c/g, 'k').replace(/(.)\1+/g, '$1');
const stem = (x) => x.replace(/[aeiou]+$/, '');
function matchFriend(q, cards) {
  const words = norm(q).split(' ').filter((w) => w.length >= 2 && !/^(другу|подруге|мне|пожалуйста|ко?|ему|ей)$/.test(w));
  let best = null, bestScore = 9;
  for (const u of cards) {
    const n = lat(u.nick || '');
    if (!n) continue;
    for (const w of [...words, words.join('')]) {
      const t = lat(w); if (t.length < 2) continue;
      const d = lev(t, n);
      const st = stem(t), sn = stem(n);
      const ok = d <= (n.length <= 4 ? 1 : 2) || (n.length >= 3 && t.startsWith(n.slice(0, Math.max(3, n.length - 1)))) || (t.length >= 3 && n.startsWith(t))
        || (st.length >= 2 && sn.length >= 2 && n.startsWith(st) && st.length >= Math.min(3, sn.length)); // «Лере», «Ане», «Максу» — падежи
      if (ok && d < bestScore) { best = u; bestScore = d; }
    }
  }
  return best;
}
const ORD = [[/перв/, 1], [/втор/, 2], [/трет/, 3], [/четв[её]р/, 4], [/пят(?:ый|ому|ого|ая|ой|ую)/, 5], [/шест(?:ой|ому|ого|ая|ую)/, 6], [/седьм/, 7], [/восьм/, 8], [/девят(?:ый|ому|ого|ая|ую)/, 9]];
function pickNumber(t) {
  for (const [re, n] of ORD) if (re.test(t)) return n;
  const n = num(t);
  return n != null && n >= 1 && n <= 9 ? n : null;
}
let pick = null;
function callFriend(u) {
  pick = null; closeSheet();
  toast(`Звоню ${u.nick || 'другу'}…`);
  startCall([u.uid]);
}
async function voiceCall(q) {
  try { if (!friendsLoaded()) await loadFriends(); } catch { /* ignore */ }
  const ids = friendIds();
  if (!ids.length) { toast('Звонить можно друзьям — добавьте их в Профиль → Друзья'); say('У вас пока нет друзей в MKW'); return; }
  const cards = (await friendCards(ids.slice(0, 40))).slice(0, 9);
  if (q) { const u = matchFriend(q, cards); if (u) { callFriend(u); return; } }
  if (cards.length === 1 && !q) { callFriend(cards[0]); return; }
  pick = { list: cards, until: Date.now() + 20000 };
  openSheet('Кому позвонить? Скажите номер', h('div', { class: 'lb-list vc-pick' }, ...cards.map((u, i) => h('button', { type: 'button', class: 'lb-row fr-pick', onclick: () => callFriend(u) },
    h('span', { class: 'vc-n', text: String(i + 1) }),
    h('span', { class: 'lb-av' }, h('img', { src: avSrc(u.avatar), alt: '' })),
    h('div', { class: 'lb-body' }, h('div', { class: 'lb-nick' }, h('span', { text: u.nick || 'друг' })), h('small', { class: 'lb-sub', text: seenOnline(u.seen) ? 'в сети' : 'не в сети' }))))));
  arm(20000);
  say(q ? 'Не нашла такого друга. Скажите номер из списка' : 'Кому позвонить? Скажите номер');
}
// пока открыт список «Кому позвонить?» — ждём номер или имя (без слова «МКВ»)
function tryPick(alts, isFinal) {
  if (!pick) return false;
  if (Date.now() > pick.until) { pick = null; return false; }
  for (const t of alts) {
    if (/отмен|никому|не надо|закрой/.test(t)) { pick = null; closeSheet(); toast('Звонок отменён'); disarm(false); unduck(); return true; }
    const n = pickNumber(t);
    if (n && pick.list[n - 1]) { const u = pick.list[n - 1]; unduck(); disarm(true); callFriend(u); return true; }
    if (isFinal) { const u = matchFriend(t.replace(WAKE, ' '), pick.list); if (u) { unduck(); disarm(true); callFriend(u); return true; } }
  }
  return false;
}

// Whisper на тишине и музыке иногда «слышит» титры — такое не считаем командой
const JUNK = /субтитр|продолжение следует|спасибо за просмотр|подписывайтесь|редактор|dimatorzok|корректор|amara|музыкальная заставка|^[\s.,!?…«»"'()-]*$/i;

function onResult(e) {
  if (Date.now() < speakingUntil || (window.speechSynthesis && speechSynthesis.speaking)) return; // не слушаем самих себя
  lastHeard = Date.now();
  for (let i = e.resultIndex; i < e.results.length; i++) {
    const res = e.results[i];
    const key = `${sessionId}:${i}`;
    if (handled.has(key)) continue;
    // берём все варианты распознавания, а не только первый — так слышит лучше
    processAlts([...res].map((a) => norm(a.transcript)).filter(Boolean), res.isFinal, key);
  }
}

function processAlts(alts, isFinal, key) {
  if (!alts.length) return;
  if (tryPick(alts, isFinal)) { handled.add(key); return; }
  let rest = null;
  for (const text of alts) { const m = text.match(WAKE); if (m) { rest = text.slice(m.index + m[0].length).trim(); break; } }
  if (rest == null) for (const text of alts) { const f = fuzzyWake(text); if (f) { rest = f.rest; break; } }
  const armed = Date.now() < armedUntil;
  if (rest == null && !armed) return;
  if (rest != null && !armed) { arm(7000); duck(); showBadge('Слушаю…'); }
  else if (rest != null) arm(7000);
  const tries = rest != null ? [rest, ...alts.map((x) => x.replace(WAKE, ' ').trim())] : alts;
  let p = null;
  for (const x of tries) { if (x) { p = parse(x); if (p) break; } }
  if (p && (p.cmd === 'search' || p.cmd === 'call') && !isFinal) { showBadge(rest || alts[0]); return; } // название и имя дослушиваем до конца
  if (!p) {
    if (!isFinal) { if (rest) showBadge(rest); return; }
    const heard = rest != null ? rest : alts[0];
    if (heard) { handled.add(key); notUnderstood(heard); } // сказали что-то, но не команду
    return; // только «МКВ» — ждём команду, края светятся
  }
  if (Date.now() - lastCmd < 900) return;
  handled.add(key);
  lastCmd = Date.now();
  showBadge(rest || alts[0]);
  unduck();
  disarm(true);
  run(p);
}

// ---------- распознавание через сервер MKW ----------
let cloudN = 0, cloudWarned = false;
function onCloud(r) {
  if (!on) return;
  if (r.error === 'no-server') {
    toast('В этом браузере голосовое управление пока не работает. Откройте MKW в Chrome или Edge');
    setVoice(false); syncUi(); return;
  }
  if (r.error === 'offline') { if (!cloudWarned) { cloudWarned = true; toast('Нет интернета — голос заработает, когда сеть вернётся'); setTimeout(() => { cloudWarned = false; }, 60000); } return; }
  if (!r.text || JUNK.test(r.text)) return;
  if (Date.now() < speakingUntil) return;
  lastHeard = Date.now();
  processAlts([norm(r.text)], true, `c${++cloudN}`);
}
async function startCloudEngine() {
  engine = 'cloud';
  try { localStorage.setItem(EKEY, 'cloud'); } catch { /* ignore */ }
  try { await startCloud(onCloud, () => Date.now() < speakingUntil || Boolean(window.speechSynthesis && speechSynthesis.speaking) || document.documentElement.classList.contains('in-call')); running = true; return true; } // во время звонка разговор на сервер не отправляем
  catch { toast('Нет доступа к микрофону. Разрешите его в настройках сайта'); on = false; syncUi(); return false; }
}
// переключатель в настройках должен показать, что голос выключился
function syncUi() {
  document.documentElement.classList.toggle('voice-on', on);
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('mkw-voice', { detail: on }));
}

let sessionId = 0, running = false, lastHeard = 0, watchdog = 0, netFails = 0;
function start() {
  if (rec) { rec.onend = null; try { rec.abort(); } catch { /* ignore */ } }
  rec = new SR();
  rec.lang = 'ru-RU';
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 5;
  rec.onresult = (e) => { netFails = 0; onResult(e); };
  rec.onstart = () => { running = true; sessionId += 1; handled.clear(); };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      // Яндекс Браузер и другие не пускают к сервису распознавания Google — переходим на сервер MKW
      if (e.error === 'service-not-allowed' && cloudSttPossible()) { switchToCloud(); return; }
      toast('Нет доступа к микрофону. Разрешите его в настройках сайта'); setVoice(false); syncUi();
    } else if (e.error === 'network') {
      // «network» почти всегда значит, что у браузера нет своего распознавания (интернет при этом есть)
      if (navigator.onLine !== false && cloudSttPossible()) { netFails += 1; if (netFails >= 1) switchToCloud(); }
      else if (!cloudWarned) { cloudWarned = true; toast('Нет интернета — голос заработает, когда сеть вернётся'); setTimeout(() => { cloudWarned = false; }, 60000); }
    }
    // no-speech, aborted, audio-capture — просто перезапускаемся в onend
  };
  // браузер сам останавливает распознавание (тишина, минута работы) — сразу запускаем снова
  rec.onend = () => { running = false; if (on && engine === 'browser') { clearTimeout(restartTimer); restartTimer = setTimeout(restart, 150); } };
  rec.start();
}
function switchToCloud() {
  if (engine === 'cloud') return;
  engine = 'cloud';
  clearTimeout(restartTimer);
  if (rec) { rec.onend = null; rec.onerror = null; try { rec.abort(); } catch { /* ignore */ } rec = null; }
  running = false;
  startCloudEngine().then((ok) => { if (ok) toast('Голос работает через сервер MKW — скажите «МКВ, следующая»'); });
}
function restart() { if (!on || engine !== 'browser' || running || document.hidden) return; try { rec.start(); } catch { try { start(); } catch { /* ignore */ } } }

export function setVoice(v) {
  if (v && !voiceSupported()) { toast('Этот браузер не умеет распознавать речь. Попробуйте Chrome или Яндекс Браузер'); return false; }
  on = Boolean(v);
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignore */ }
  if (on) {
    netFails = 0;
    document.documentElement.classList.add('voice-on');
    if (!SR || preferCloud()) {
      startCloudEngine().then((ok) => { if (ok) toast('Скажите: «МКВ, следующая» или «Музыка, громче»'); });
      return on;
    }
    engine = 'browser';
    try {
      start(); toast('Скажите: «МКВ, следующая» или «Музыка, громче»');
      // сторож: если распознавание тихо умерло — поднимаем снова
      clearInterval(watchdog); watchdog = setInterval(() => { if (on && engine === 'browser' && !running) restart(); }, 4000);
    }
    catch { if (cloudSttPossible()) switchToCloud(); else { on = false; toast('Не получилось включить микрофон'); } }
  } else {
    clearTimeout(restartTimer); clearInterval(watchdog); unduck();
    if (rec) { rec.onend = null; try { rec.stop(); } catch { /* ignore */ } rec = null; }
    stopCloud();
    running = false; pick = null;
    document.documentElement.classList.remove('voice-on');
  }
  return on;
}

export function showVoiceGuide() {
  openSheet('Голосовое управление', h('div', {},
    h('p', { class: 'profile-note', text: 'Скажите «МКВ» или «Музыка» — края экрана засветятся цветом приложения, музыка станет тише: значит, я слушаю. Потом команду: «следующая», «громче», «включи Баста». Можно сразу одной фразой: «МКВ, лайк». Если команда незнакомая — отвечу «Я вас не поняла».' }),
    h('div', { class: 'gest-list' }, VOICE_COMMANDS.map(([words, what]) => h('div', { class: 'gest-item' }, h('span', { class: 'ge' }, mi('mic')), h('div', {}, h('b', { text: words }), h('small', { text: what }))))),
    h('p', { class: 'profile-note', text: 'Работает, пока приложение открыто. В Chrome, Edge и Safari речь распознаёт сам браузер. В Яндекс Браузере, Opera и Firefox — сервер MKW: туда уходят только короткие фразы, когда вы что-то сказали. Говорите чётко: «эм-ка-вэ» или «музыка».' })));
}

export function initVoice() {
  // после перезагрузки браузер снова спросит разрешение — включаем только по нажатию пользователя
  try { localStorage.setItem(KEY, '0'); } catch { /* ignore */ }
}

// вернулись в приложение — микрофон снова слушает
document.addEventListener('visibilitychange', () => { if (!document.hidden) restart(); });
