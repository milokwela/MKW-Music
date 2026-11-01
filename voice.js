// Голосовое управление (бета): «MKW, следующая», «MKW, громче», «Музыка, лайк», «MKW, включи Баста».
// Работает через распознавание речи браузера (Chrome, Яндекс Браузер, Edge, Safari). Слушает, пока вкладка открыта.
import { toast, openSheet, h } from './ui.js?v=0.18.0';
import * as player from './player.js?v=0.18.0';
import * as store from './store.js?v=0.18.0';
import { dislike, startWave, waveActive } from './wave.js?v=0.18.0';
import { searchTracks } from './catalog.js?v=0.18.0';
import { mi } from './icons2.js?v=0.18.0';

const KEY = 'mkw.voice';
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, on = false, restartTimer = 0, lastCmd = 0, badge = null;

export const voiceSupported = () => Boolean(SR);
export const voiceOn = () => on;

// как браузер может услышать «MKW»: эм кей дабл ю, мкв, эмкейви, эм ка вэ, а также просто «музыка»
const WAKE = /(?:^|\s)(?:mkw|m k w|мкв|м к в|эм\s?к[эеа]й(?:\s?(?:дабл\s?(?:ю|в)|ви|в))?|эмк[эе]й\w*|эм\s?ка\s?в[эе]|эмкав[эе]|эмка|макв[эе]|музыка|music)[\s,.!:]*/i;

export const VOICE_COMMANDS = [
  ['next', 'следующая, дальше, пропусти'],
  ['prev', 'предыдущая, назад'],
  ['pause', 'пауза, стоп'],
  ['play', 'играй, продолжи'],
  ['louder', 'громче'],
  ['quieter', 'тише'],
  ['like', 'лайк, нравится'],
  ['unlike', 'убери лайк'],
  ['dislike', 'дизлайк, не нравится'],
  ['wave', 'волна'],
  ['search', 'включи <исполнитель или песня>'],
];

function parse(text) {
  const t = text.toLowerCase().replace(/ё/g, 'е');
  if (/(убер|убра|сним|снят|удали|отмен)\w*\s+(мой\s+)?лайк/.test(t)) return { cmd: 'unlike' };
  if (/дизлайк|не нрав/.test(t)) return { cmd: 'dislike' };
  if (/лайк|нрав|в избранн|сердечк|like/.test(t)) return { cmd: 'like' };
  if (/следующ|дальше|пропус|скип|некст|next|другую|другой/.test(t)) return { cmd: 'next' };
  if (/предыдущ|назад|верни|прошл|previous/.test(t)) return { cmd: 'prev' };
  if (/погромче|громче|прибав|louder/.test(t)) return { cmd: 'louder' };
  if (/потише|тише|убав|quieter/.test(t)) return { cmd: 'quieter' };
  if (/пауз|стоп|останов|замолч|выключи музыку|pause|stop/.test(t)) return { cmd: 'pause' };
  if (/волн/.test(t)) return { cmd: 'wave' };
  const m = t.match(/(?:включи|поставь|найди|play)\s+(.{2,})$/);
  if (m && !/^(музыку|музыка|песню|трек|дальше)$/.test(m[1].trim())) return { cmd: 'search', q: m[1].trim() };
  if (/играй|продолж|включи|плей|воспроизв|play|старт/.test(t)) return { cmd: 'play' };
  return null;
}

async function run({ cmd, q }) {
  const t = player.queue.current;
  if (cmd === 'next') { player.next(); toast('Следующий трек'); }
  else if (cmd === 'prev') { player.previousTrack(); toast('Предыдущий трек'); }
  else if (cmd === 'pause') { player.pause(); toast('Пауза'); }
  else if (cmd === 'play') { if (!player.st.playing) player.toggle(); toast('Играю'); }
  else if (cmd === 'louder') { const v = player.setVolume(player.getVolume() + 0.15); toast(`Громкость ${Math.round(v * 100)}%`); }
  else if (cmd === 'quieter') { const v = player.setVolume(player.getVolume() - 0.15); toast(`Громкость ${Math.round(v * 100)}%`); }
  else if (cmd === 'like') { if (t && !store.isLiked(t.id)) { store.toggleLike(t).catch(() => {}); toast('Добавлено в лайки'); } else toast('Уже в лайках'); }
  else if (cmd === 'unlike') { if (t && store.isLiked(t.id)) { store.toggleLike(t).catch(() => {}); toast('Лайк снят'); } }
  else if (cmd === 'dislike') { dislike(); }
  else if (cmd === 'wave') { if (!waveActive()) startWave(); toast('Включаю MKW Волну'); }
  else if (cmd === 'search') {
    toast(`Ищу «${q}»…`);
    const found = await searchTracks(q).catch(() => []);
    if (found.length) { player.playTracks(found.slice(0, 20), 0); toast(`Включаю: ${found[0].artist} — ${found[0].title}`); }
    else toast('Ничего не нашлось');
  }
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
    const text = res[0].transcript.trim();
    const m = text.match(WAKE);
    if (!m) continue;
    const rest = text.slice(m.index + m[0].length);
    if (!res.isFinal) { if (rest) showBadge(rest); continue; }
    const p = parse(rest);
    if (!p) { showBadge(`Не поняла: «${rest || '…'}»`); continue; }
    if (Date.now() - lastCmd < 1200) continue;
    lastCmd = Date.now();
    showBadge(rest);
    run(p);
  }
}

function start() {
  rec = new SR();
  rec.lang = 'ru-RU';
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.onresult = onResult;
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { toast('Нет доступа к микрофону. Разрешите его в настройках сайта'); setVoice(false); }
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
    h('p', { class: 'profile-note', text: 'Скажите «MKW» или «Музыка», а потом команду. Например: «MKW, следующая», «Музыка, громче», «MKW, включи Баста».' }),
    h('div', { class: 'gest-list' }, VOICE_COMMANDS.map(([, words]) => h('div', { class: 'gest-item' }, h('span', { class: 'ge' }, mi('mic')), h('div', {}, h('b', { text: words }))))),
    h('p', { class: 'profile-note', text: 'Бета: работает, пока сайт открыт. Речь распознаёт браузер (в Chrome — сервис Google). Лучше всего слышит, когда музыка не слишком громкая.' })));
}

export function initVoice() {
  // после перезагрузки браузер снова спросит разрешение — включаем только по нажатию пользователя
  try { localStorage.setItem(KEY, '0'); } catch { /* ignore */ }
}
