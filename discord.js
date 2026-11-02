// Статус в Discord: «Слушает MKW Music» — трек, исполнитель, обложка и сколько осталось.
// Браузер сам не может говорить с Discord, поэтому на компьютере работает маленький помощник MKW Discord:
// сайт сообщает ему, что играет (только на ваш компьютер, адрес 127.0.0.1), а он передаёт это в Discord.
import * as player from './player.js?v=0.27.2';
import { h, toast, openSheet } from './ui.js?v=0.27.2';
import { mi } from './icons2.js?v=0.27.2';

// Application ID приложения «MKW Music» в Discord Developer Portal (его имя Discord пишет в «Слушает …»)
export const DISCORD_APP_ID = '1566880916784029786';
export const HELPER_EXE = 'https://github.com/milokwela/MKW-Music/releases/download/discord-helper/MKW-Discord.exe';
export const PS_RUN = '[Net.ServicePointManager]::SecurityProtocol=3072;iex([Text.Encoding]::UTF8.GetString((iwr https://mkwmusic.ru/ds.ps1 -UseB).RawContentStream.ToArray()))';
export const HELPER_JS = 'https://github.com/milokwela/MKW-Music/releases/download/discord-helper/mkw-discord.js';
const URL_ = 'http://127.0.0.1:47331';
const KEY = 'mkw.discord';

export const discordPossible = () => !/android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
export const discordReady = () => Boolean(DISCORD_APP_ID);
export const discordOn = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };

async function call(path, body) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 1500);
  try {
    const r = await fetch(`${URL_}${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: c.signal } : { signal: c.signal });
    return r.ok ? await r.json() : null;
  } catch { return null; } finally { clearTimeout(t); }
}
export const helperStatus = () => call('/ping');

function nowPlaying() {
  const t = player.queue.current;
  if (!t) return { app: DISCORD_APP_ID, on: false };
  return { app: DISCORD_APP_ID, on: true, title: t.title, artist: t.artist, album: t.album || '', art: t.artwork || '', pos: player.st.time || 0, dur: player.st.duration || t.duration || 0, playing: Boolean(player.st.playing) };
}
let timer = 0, lastSig = '', missed = 0;
function sendSoon() { clearTimeout(timer); timer = setTimeout(send, 400); }
async function send() {
  if (!discordOn() || !discordReady()) return;
  const np = nowPlaying();
  const sig = `${np.title}|${np.artist}|${np.playing}|${Math.round((np.pos || 0) / 5)}`;
  if (sig === lastSig && missed === 0) return;
  const r = await call('/np', np);
  missed = r ? 0 : missed + 1;
  lastSig = r ? sig : '';
}

let started = false;
export function startDiscord() {
  if (started || !discordPossible()) return;
  started = true;
  player.onPlayer((ev) => { if (ev === 'track' || ev === 'state' || ev === 'end') sendSoon(); });
  // перемотка и «помощник запустили позже» — сверяемся раз в 15 секунд
  setInterval(() => { if (discordOn() && (player.st.playing || missed)) { lastSig = ''; send(); } }, 15000);
  window.addEventListener('pagehide', () => { if (discordOn()) navigator.sendBeacon && navigator.sendBeacon(`${URL_}/np`, new Blob([JSON.stringify({ app: DISCORD_APP_ID, on: false })], { type: 'text/plain' })); });
}

export async function setDiscord(v) {
  try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ }
  if (!v) { await call('/np', { app: DISCORD_APP_ID, on: false }); return false; }
  startDiscord();
  if (!(await helperStatus())) { showDiscordGuide(); toast('Сначала запустите помощника — это одна команда'); return true; }
  lastSig = ''; await send();
  await new Promise((r) => setTimeout(r, 1500)); // помощник подключается к Discord
  const s = await helperStatus();
  toast(s && s.discord ? 'Готово: в Discord видно, что вы слушаете' : 'Помощник запущен — откройте Discord');
  return true;
}

export function showDiscordGuide() {
  const st = h('div', { class: 'dc-status' }, h('span', { class: 'dc-dot' }), h('span', { text: 'Проверяю помощника…' }));
  const paint = async () => {
    const s = await helperStatus();
    st.dataset.ok = s ? (s.discord ? 'all' : 'helper') : 'none';
    st.lastChild.textContent = !s ? 'Помощник не запущен' : s.discord ? 'Всё работает: помощник и Discord подключены' : 'Помощник запущен, но Discord закрыт';
  };
  paint();
  const iv = setInterval(() => { if (!document.body.contains(st)) { clearInterval(iv); return; } paint(); }, 3000);
  const mac = /mac|linux/i.test(navigator.platform) && !/win/i.test(navigator.platform);
  // Windows: без скачивания — одна команда в «Выполнить» (Win+R). PowerShell встроен в Windows и подписан Microsoft,
  // поэтому его не блокируют ни SmartScreen, ни «Интеллектуальное управление приложениями»
  let auto = true;
  const cmd = () => `powershell -NoP -W Min -C "${auto ? '$mkwAuto=1;' : ''}${PS_RUN}"`;
  const code = h('code', { class: 'dc-cmd', text: cmd() });
  const copy = h('button', { class: 'btn dc-copy', type: 'button' }, mi('check'), h('span', { text: 'Скопировать команду' }));
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(cmd()); } catch {
      const r = document.createRange(); r.selectNodeContents(code); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); document.execCommand('copy');
    }
    copy.lastChild.textContent = 'Скопировано! Теперь Win+R → Ctrl+V → Enter';
    setTimeout(() => { copy.lastChild.textContent = 'Скопировать команду'; }, 6000);
  });
  const autoSw = h('button', { class: 'switch active', type: 'button', role: 'switch', 'aria-checked': 'true', onclick: () => { auto = !auto; autoSw.classList.toggle('active', auto); autoSw.setAttribute('aria-checked', String(auto)); code.textContent = cmd(); } }, h('i'));
  const win = [
    h('ol', { class: 'inst-steps' },
      h('li', { text: 'Нажмите «Скопировать команду» ниже' }),
      h('li', {}, 'Нажмите ', h('kbd', { text: 'Win' }), ' + ', h('kbd', { text: 'R' }), ', вставьте ', h('kbd', { text: 'Ctrl' }), ' + ', h('kbd', { text: 'V' }), ' и нажмите ', h('kbd', { text: 'Enter' }), '. Появится маленькое окно «MKW Discord» — пусть работает'),
      h('li', { text: 'Откройте Discord (приложение на компьютере) и включите здесь «Статус в Discord». Если браузер спросит про устройства в локальной сети — «Разрешить»' })),
    h('div', { class: 'set-row dc-auto' }, h('div', { class: 'set-txt' }, h('b', { text: 'Запускать вместе с Windows' }), h('small', { text: 'Тогда команду нужно ввести только один раз' })), autoSw),
    code, copy, st,
    h('p', { class: 'profile-note dc-small', text: 'Ничего не скачивается и не устанавливается: команда запускает встроенный в Windows PowerShell с открытым кодом помощника с mkwmusic.ru/ds.ps1. Он передаёт в Discord только название трека. Остановить — закрыть окно «MKW Discord»; убрать из автозапуска — Win+R → shell:startup → удалить «MKW Discord».' }),
  ];
  const other = [
    h('ol', { class: 'inst-steps' },
      h('li', {}, 'Скачайте помощник ', h('a', { href: HELPER_JS, target: '_blank', rel: 'noopener', text: 'mkw-discord.js' }), ' и запустите: node mkw-discord.js (нужен Node.js)'),
      h('li', { text: 'Откройте Discord (приложение на компьютере)' }),
      h('li', { text: 'Включите здесь «Статус в Discord»' })),
    st,
    h('a', { class: 'btn dc-dl', href: HELPER_JS, target: '_blank', rel: 'noopener' }, mi('install'), h('span', { text: 'Скачать для macOS / Linux' })),
  ];
  openSheet('Статус в Discord', h('div', { class: 'pw-form dc' },
    h('div', { class: 'dc-prev' },
      h('small', { text: 'Слушает MKW Music' }),
      h('div', { class: 'dc-card' }, h('img', { src: 'ic5-192.png', alt: '' }), h('div', {}, h('b', { text: 'Название трека' }), h('span', { text: 'Исполнитель' }), h('i', {}, h('i'))))),
    h('p', { class: 'profile-note', text: 'Друзья в Discord увидят, что вы слушаете в MKW: трек, исполнителя, обложку и сколько осталось — как у Яндекс Музыки и Spotify.' }),
    ...(mac ? other : win)));
}

