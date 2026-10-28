// Точка входа: вход в аккаунт, навигация, тема, профиль.
import { watchAuth, signIn, signUp, authErrorText } from './auth.js';
import { startStore, stopStore, onStore, flushListened } from './store.js';
import { initSearch, setSearchUser } from './search.js';
import { initLibrary, render as renderLibrary, resetLibrary } from './library.js';
import { initPlayerUI, resetPlayerUI, closeFull } from './playerui.js';
import { buildProfile, updateProfile, resetProfile } from './profile.js';
import { initViz } from './viz.js';
import { initWave } from './wave.js';
import { initTheme } from './theme.js';
import * as player from './player.js';
import { $, $$ } from './ui.js';

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
    buildProfile(user.nick);
    setSearchUser(user.nick);
    resetLibrary();
    showView('search');
    player.warmUp();
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

function boot() {
  initTheme();
  initAuthForm();
  initNav();
  initSearch();
  initLibrary();
  initPlayerUI();
  initWave();
  initViz();
  initListenFlush();
  onStore((what) => { if (!$('#view-profile').hidden && (what === 'profile' || what === 'likes' || what === 'playlists' || what === 'history')) updateProfile(); });
  watchAuth(onUser);
}

boot();
