// Точка входа: вход в аккаунт, навигация, тема, профиль.
import { initLyrics } from './lyrics.js?v=0.19.0';
import { initPerf } from './perf.js?v=0.19.0';
import { watchAuth, signIn, signUp, authErrorText } from './auth.js?v=0.19.0';
import { startStore, stopStore, onStore, flushListened } from './store.js?v=0.19.0';
import { initSearch, setSearchUser } from './search.js?v=0.19.0';
import { initLibrary, render as renderLibrary, resetLibrary } from './library.js?v=0.19.0';
import { initPlayerUI, resetPlayerUI, closeFull } from './playerui.js?v=0.19.0';
import { buildProfile, updateProfile, resetProfile } from './profile.js?v=0.19.0';
import { initArtist, closeArtist } from './artist.js?v=0.19.0';
import { initUserPage, closeUserPage } from './userpage.js?v=0.19.0';
import { initMotion, viewDirection, animateView } from './motion.js?v=0.19.0';
import { initLiquidNav } from './glassnav.js?v=0.19.0';
import { initRowLens } from './rowlens.js?v=0.19.0';
import { readIncoming, showIncoming } from './share.js?v=0.19.0';
import { registerListener } from './stats.js?v=0.19.0';
import { offerInstall } from './install.js?v=0.19.0';
import { showMoved, showIconUpdate } from './moved.js?v=0.19.0';
import { showNews } from './news.js?v=0.19.0';
import { initViz } from './viz.js?v=0.19.0';
import { initWave } from './wave.js?v=0.19.0';
import { initTheme } from './theme.js?v=0.19.0';
import * as player from './player.js?v=0.19.0';
import { $, $$ } from './ui.js?v=0.19.0';

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
function showView(name) {
  const dir = viewDirection(name);
  for (const v of ['search', 'library', 'profile']) $(`#view-${v}`).hidden = v !== name;
  animateView($(`#view-${name}`), dir);
  document.body.classList.toggle('on-profile', name === 'profile');
  $$('#bottom-nav .nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'library') renderLibrary();
  if (name === 'profile') updateProfile();
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
function onUser(user) {
  if (user) {
    $('#auth-screen').hidden = true;
    $('#app').hidden = false;
    startStore(user.uid);
    registerListener(user.uid);
    buildProfile(user.nick);
    setSearchUser(user.nick);
    resetLibrary();
    showView('search');
    player.warmUp();
    setTimeout(showIncoming, 600);
    setTimeout(showMoved, 1200);
    setTimeout(showIconUpdate, 2600);
    setTimeout(showNews, 3700);
    setTimeout(offerInstall, 9000);
  } else {
    flushListened();
    player.stop();
    stopStore();
    resetPlayerUI();
    resetProfile();
    $('#app').hidden = true;
    $('#auth-screen').hidden = false;
    setAuthMode('login');
  }
}

function runSplash() {
  const sp = document.getElementById('splash');
  if (!sp) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { sp.remove(); return; }
  sp.classList.add('go');
  setTimeout(() => sp.classList.add('out'), 2900);
  setTimeout(() => sp.remove(), 3600);
}

function boot() {
  readIncoming();
  runSplash();
  initMotion();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  initTheme();
  initAuthForm();
  initNav();
  initLiquidNav();
  initSearch();
  initLibrary();
  initPlayerUI();
  initLyrics();
  initPerf();
  initWave();
  initViz();
  initArtist();
  initUserPage();
  initRowLens();
  initListenFlush();
  onStore((what) => { if (!$('#view-profile').hidden && (what === 'profile' || what === 'likes' || what === 'playlists' || what === 'history')) updateProfile(); });
  watchAuth(onUser);
}

boot();
