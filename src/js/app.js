// Точка входа: вход в аккаунт, навигация, тема, профиль.
import { linkFonts } from './profile.js';
import { watchContrib, initBadgeView } from './contrib.js';
import { initLanding } from './landing.js';
import { appGate } from './appgate.js';
import { initLyrics } from './lyrics.js';
import { initPerf } from './perf.js';
import { watchAuth, signIn, signUp, authErrorText } from './auth.js';
import { startStore, stopStore, onStore, flushListened } from './store.js';
import { initSearch, setSearchUser } from './search.js';
import { initLibrary, render as renderLibrary, resetLibrary } from './library.js';
import { initPlayerUI, resetPlayerUI, closeFull } from './playerui.js';
import { buildProfile, updateProfile, resetProfile } from './profile.js';
import { initArtist, closeArtist } from './artist.js';
import { initUserPage, closeUserPage } from './userpage.js';
import { initMotion, viewDirection, animateView } from './motion.js';
import { initLiquidNav } from './glassnav.js';
import { initRowLens } from './rowlens.js';
import { readIncoming, showIncoming } from './share.js';
import { registerListener } from './stats.js';
import { offerInstall } from './install.js';
import { showFounderNote } from './incident.js';
import { showIconUpdate } from './moved.js';
import { showNews, NEWS_VER } from './news.js';
import { maybeShowBetaNote } from './poll.js';
import { initHome } from './home.js';
import { startNotify, stopNotify } from './notify.js';
import { renderChats } from './chats.js';
import { startUpdateWatch } from './update.js';
import { initViz } from './viz.js';
import { initBoost, hold } from './boost.js';
import { initBack } from './back.js';
import { initClock } from './clock.js';
import { chatOpen, closeChat } from './chat.js';
import { initWave, waveDebug } from './wave.js';
import { initTheme } from './theme.js';
import { initWinter } from './winter.js';
import { checkWebView } from './wvcheck.js';
import { initTelemetry } from './telemetry.js';
import { initInbox, openInbox } from './inbox.js';
import { qualityDebug } from './quality.js';
import { initOffline } from './offline.js';
import { offlineStart } from './offui.js';
import { initPlayer2 } from './player2.js';
import * as player from './player.js';
import { $, $$, toast, isSheetOpen } from './ui.js';

// Новый слушатель: после регистрации — только предложение установить (его показывает offerInstall) и подсказка про Волну
function welcomeNew() {
  try { if (localStorage.getItem('mkw.newuser') !== '1') return; localStorage.removeItem('mkw.newuser'); localStorage.setItem('mkw.news', NEWS_VER); } catch { return; }
  const tip = () => { if (isSheetOpen() || document.querySelector('.nw:not(.out), .call-in')) { setTimeout(tip, 5000); return; } toast('Чтобы настроить MKW Волну под себя, лайкните пару треков'); };
  setTimeout(tip, 14000);
}
import { initApkHandoff } from './apkhandoff.js';

// ---------- вход ----------
let authMode = 'login';
function setAuthMode(mode) {
  authMode = mode;
  $$('#auth-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $('#auth-tabs').classList.toggle('reg', mode === 'register');
  $('#auth-submit').textContent = mode === 'login' ? 'Войти' : 'Создать аккаунт';
  $('#auth-pass').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('#auth-sub').textContent = mode === 'login' ? 'С возвращением! Войдите, и музыка продолжится' : 'Пара секунд — и у вас своя музыка, лайки и плейлисты';
  $('#pass2-wrap').hidden = mode === 'login';
  $('#pw-meter').hidden = mode === 'login';
  $('#nick-hint').hidden = mode === 'login';
  $('#auth-error').textContent = '';
  $('#auth-form').classList.remove('swap'); void $('#auth-form').offsetWidth; $('#auth-form').classList.add('swap');
}

function paintAuthHints() {
  const nick = $('#auth-nick').value.trim(), pass = $('#auth-pass').value;
  const okNick = /^[a-zA-Z0-9]{3,20}$/.test(nick);
  $('#auth-nick').closest('.af').classList.toggle('valid', okNick);
  $('#nick-hint').classList.toggle('bad', Boolean(nick) && !okNick);
  let sc = 0;
  if (pass.length >= 6) sc += 1;
  if (pass.length >= 10) sc += 1;
  if (/\d/.test(pass) && /[a-zA-Zа-яА-Я]/.test(pass) && pass.length >= 8) sc += 1;
  const m = $('#pw-meter');
  m.dataset.s = pass ? String(Math.max(1, sc)) : '0';
  m.querySelector('span').textContent = !pass ? '' : sc <= 1 ? 'Слабый пароль' : sc === 2 ? 'Нормальный пароль' : 'Надёжный пароль';
}

function initAuthForm() {
  $('#auth-nick').addEventListener('input', paintAuthHints);
  $('#auth-pass').addEventListener('input', paintAuthHints);
  $('#auth-eye').addEventListener('click', () => {
    const p = $('#auth-pass'), show = p.type === 'password';
    p.type = show ? 'text' : 'password'; $('#auth-pass2').type = p.type;
    $('#auth-eye').classList.toggle('on', show);
  });
  $('#auth-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (b) setAuthMode(b.dataset.mode);
  });
  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#auth-submit');
    const err = $('#auth-error');
    err.textContent = '';
    btn.disabled = true;
    try {
      const nick = $('#auth-nick').value;
      const pass = $('#auth-pass').value;
      if (authMode === 'register' && pass !== $('#auth-pass2').value) { const er = new Error('mismatch'); er.userText = 'Пароли не совпадают'; throw er; }
      if (authMode === 'login') await signIn(nick, pass);
      else await signUp(nick, pass);
      $('#auth-pass').value = '';
    } catch (ex) {
      err.textContent = ex.userText || authErrorText(ex);
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- вкладки ----------
let profT = 0;
function showView(name) {
  const dir = viewDirection(name);
  for (const v of ['search', 'library', 'chats', 'profile']) $(`#view-${v}`).hidden = v !== name;
  hold(520);
  animateView($(`#view-${name}`), dir);
  document.body.classList.toggle('on-profile', name === 'profile');
  document.body.classList.toggle('on-chats', name === 'chats');
  if (name !== 'chats' && chatOpen()) closeChat();
  $$('#bottom-nav .nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'library') renderLibrary();
  // профиль пересчитывает статистику и достижения — делаем это после анимации перехода, чтобы вкладка открывалась без рывка
  if (name === 'profile') buildPending();
  if (name === 'profile') { clearTimeout(profT); profT = setTimeout(() => { if (!$('#view-profile').hidden) updateProfile(); }, 380); }
  if (name === 'chats') renderChats();
  window.scrollTo(0, 0);
}

function initNav() {
  $('#bottom-nav').addEventListener('click', (e) => {
    const b = e.target.closest('.nav-btn');
    if (b) { closeFull(); closeArtist(); closeUserPage(); showView(b.dataset.view); }
  });
}

// Сохраняем время прослушивания: раз в минуту и когда сайт уходит в фон.
function initListenFlush() {
  setInterval(flushListened, 60000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushListened(); });
  window.addEventListener('pagehide', flushListened);
}

// ---------- состояние входа ----------
let pendingNick = null;
function buildPending() { if (!pendingNick) return; const n = pendingNick; pendingNick = null; buildProfile(n); }
function onUser(user) {
  endSplash();
  if (user) {
    $('#auth-screen').hidden = true;
    $('#app').hidden = false;
    startStore(user.uid);
    watchContrib(user.uid);
    setTimeout(linkFonts, 2500);
    registerListener(user.uid);
    // профиль большой (статистика, задания, настройки) — собираем его, когда телефон освободится после запуска,
    // а если человек открыл «Профиль» раньше — сразу
    pendingNick = user.nick;
    if (window.requestIdleCallback) requestIdleCallback(buildPending, { timeout: 2500 }); else setTimeout(buildPending, 1200);
    setSearchUser(user.nick);
    resetLibrary();
    showView('search');
    player.warmUp();
    setTimeout(initHome, 1500);
    offlineStart();
    setTimeout(startNotify, 2500);
    setTimeout(showIncoming, 600);
    setTimeout(showIconUpdate, 2600);
    setTimeout(showNews, 3700);
    // обращение «MKW в бете» — один раз, когда не открыто другое окно
    const beta = () => { if (document.querySelector('.nw, .inc, .rc, .beta-pop')) { setTimeout(beta, 6000); return; } maybeShowBetaNote(); };
    setTimeout(beta, 12000);
    setTimeout(offerInstall, 9000);
    welcomeNew();
    setTimeout(() => showFounderNote(user.nick), 3200);
  } else {
    pendingNick = null;
    flushListened();
    stopNotify();
    player.stop();
    stopStore();
    resetPlayerUI();
    resetProfile();
    $('#app').hidden = true;
    $('#auth-screen').hidden = false;
    setAuthMode('login');
    initLanding();
  }
}

// Заставка уходит, как только приложение готово (но не раньше 1,4 с, чтобы анимация не обрывалась).
// Раньше она всегда висела почти 3 секунды, даже если всё уже загрузилось.
const SPLASH_T0 = performance.now();
let splashOut = false;
function endSplash() {
  if (splashOut) return; splashOut = true;
  const sp = document.getElementById('splash');
  if (!sp) return;
  const wait = Math.max(0, 1400 - (performance.now() - SPLASH_T0));
  setTimeout(() => { sp.classList.add('out'); setTimeout(() => sp.remove(), 650); }, wait);
}
function runSplash() {
  const sp = document.getElementById('splash');
  if (!sp) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { sp.remove(); return; }
  sp.classList.add('go');
  setTimeout(endSplash, 2900);   // страховка: вход так и не ответил
}

function boot() {
  if (appGate()) return; // старое приложение — только окно «Обновите»
  initPerf();            // движок плавности — первым: остальные модули сразу знают уровень графики
  initBadgeView();
  readIncoming();
  runSplash();
  initMotion();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  initTheme();
  initWinter();
  try { if (localStorage.getItem('mkw.debug') === '1') window.__mkw = { player, waveDebug, quality: qualityDebug, inbox: openInbox }; } catch { /* ignore */ }
  initAuthForm();
  initApkHandoff();
  initNav();
  initLiquidNav();
  initSearch();
  initLibrary();
  initPlayerUI();
  initPlayer2();
  initOffline();
  initLyrics();
  initWave();
  initClock();
  initBoost();
  initBack();
  initViz();
  initArtist();
  initUserPage();
  initRowLens();
  initListenFlush();
  startUpdateWatch();
  checkWebView();
  initTelemetry();
  initInbox();
  onStore((what) => { if (!$('#view-profile').hidden && (what === 'profile' || what === 'likes' || what === 'playlists' || what === 'history')) updateProfile(); });
  watchAuth(onUser);
  // встроенный браузер (Telegram, VK) иногда не отдаёт вход — не оставляем пустой экран
  setTimeout(() => {
    if (!$('#app').hidden || !$('#auth-screen').hidden) return;
    $('#auth-screen').hidden = false; setAuthMode('login'); initLanding();
    if (/Telegram|FBAN|FBAV|Instagram|VKAndroid|vkclient|; wv\)/i.test(navigator.userAgent)) $('#auth-sub').textContent = 'Если вход не срабатывает — откройте mkwmusic.ru в обычном браузере (⋮ → «Открыть в браузере»)';
  }, 7000);
}

boot();
