// Точка входа: вход в аккаунт, навигация, тема, профиль.
import { initLyrics } from './lyrics.js?v=0.13.0';
import { watchAuth, signIn, signUp, authErrorText } from './auth.js?v=0.13.0';
import { startStore, stopStore, onStore, flushListened } from './store.js?v=0.13.0';
import { initSearch, setSearchUser } from './search.js?v=0.13.0';
import { initLibrary, render as renderLibrary, resetLibrary } from './library.js?v=0.13.0';
import { initPlayerUI, resetPlayerUI, closeFull } from './playerui.js?v=0.13.0';
import { buildProfile, updateProfile, resetProfile } from './profile.js?v=0.13.0';
import { initArtist } from './artist.js?v=0.13.0';
import { initLiquidNav } from './glassnav.js?v=0.13.0';
import { initRowLens } from './rowlens.js?v=0.13.0';
import { readIncoming, showIncoming } from './share.js?v=0.13.0';
import { registerListener } from './stats.js?v=0.13.0';
import { offerInstall } from './install.js?v=0.13.0';
import { showMoved, showIconUpdate } from './moved.js?v=0.13.0';
import { initViz } from './viz.js?v=0.13.0';
import { initWave } from './wave.js?v=0.13.0';
import { initTheme } from './theme.js?v=0.13.0';
import * as player from './player.js?v=0.13.0';
import { $, $$ } from './ui.js?v=0.13.0';

// ---------- вход ----------
let authMode = 'login';
function setAuthMode(mode) {
  authMode = mode;
  $$('#auth-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $('#auth-submit').textContent = mode === 'login' ? 'Войти' : 'Создать аккаунт';
  $('#auth-pass').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('#auth-error').textContent = '';
}

function initAuthForm() {
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
  for (const v of ['search', 'library', 'profile']) $(`#view-${v}`).hidden = v !== name;
  $$('#bottom-nav .nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'library') renderLibrary();
  if (name === 'profile') updateProfile();
  window.scrollTo(0, 0);
}

function initNav() {
  $('#bottom-nav').addEventListener('click', (e) => {
    const b = e.target.closest('.nav-btn');
    if (b) { closeFull(); showView(b.dataset.view); }
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
  setTimeout(() => sp.classList.add('out'), 3200);
  setTimeout(() => sp.remove(), 3900);
}

function boot() {
  readIncoming();
  runSplash();
  initTheme();
  initAuthForm();
  initNav();
  initLiquidNav();
  initSearch();
  initLibrary();
  initPlayerUI();
  initLyrics();
  initWave();
  initViz();
  initArtist();
  initRowLens();
  initListenFlush();
  onStore((what) => { if (!$('#view-profile').hidden && (what === 'profile' || what === 'likes' || what === 'playlists' || what === 'history')) updateProfile(); });
  watchAuth(onUser);
}

boot();
