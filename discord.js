// Статус в Discord: «Слушает MKW Music» — трек, исполнитель, обложка и сколько осталось.
// Браузер сам не может говорить с Discord, поэтому на компьютере работает маленький помощник MKW Discord:
// сайт сообщает ему, что играет (только на ваш компьютер, адрес 127.0.0.1), а он передаёт это в Discord.
import * as player from './player.js?v=0.27.0';
import { h, toast, openSheet } from './ui.js?v=0.27.0';
import { mi } from './icons2.js?v=0.27.0';

// Application ID приложения «MKW Music» в Discord Developer Portal (его имя Discord пишет в «Слушает …»)
export const DISCORD_APP_ID = '';
export const HELPER_EXE = 'https://github.com/milokwela/MKW-Music/releases/download/discord-helper/MKW-Discord.exe';
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
  const s = await helperStatus();
  if (!s) { showDiscordGuide(); return true; }
  lastSig = ''; send();
  toast(s.discord ? 'Готово: в Discord видно, что вы слушаете' : 'Помощник запущен — откройте Discord');
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
  openSheet('Статус в Discord', h('div', { class: 'pw-form dc' },
    h('div', { class: 'dc-prev' },
      h('small', { text: 'Слушает MKW Music' }),
      h('div', { class: 'dc-card' }, h('img', { src: 'ic5-192.png', alt: '' }), h('div', {}, h('b', { text: 'Название трека' }), h('span', { text: 'Исполнитель' }), h('i', {}, h('i'))))),
    h('p', { class: 'profile-note', text: 'Друзья в Discord увидят, что вы слушаете в MKW: трек, исполнителя, обложку и сколько осталось — как у Яндекс Музыки и Spotify.' }),
    discordReady() ? null : h('p', { class: 'dc-warn', text: 'Скоро: статус в Discord появится в следующем обновлении.' }),
    h('ol', { class: 'inst-steps' },
      h('li', {}, 'Скачайте помощник MKW Discord ', mac ? h('a', { href: HELPER_JS, target: '_blank', rel: 'noopener', text: 'mkw-discord.js' }) : h('a', { href: HELPER_EXE, target: '_blank', rel: 'noopener', text: 'MKW-Discord.exe' }), mac ? ' и запустите: node mkw-discord.js' : ' и запустите его. Если Windows предупредит — «Подробнее» → «Выполнить в любом случае»'),
      h('li', { text: 'Откройте Discord (приложение на компьютере)' }),
      h('li', { text: 'Включите здесь «Статус в Discord». Если браузер спросит доступ к устройствам в локальной сети — разрешите: так сайт достучится до помощника на вашем компьютере' })),
    st,
    h('a', { class: 'btn dc-dl', href: mac ? HELPER_JS : HELPER_EXE, target: '_blank', rel: 'noopener' }, mi('install'), h('span', { text: mac ? 'Скачать для macOS / Linux' : 'Скачать для Windows' }))));
}
