// Точка входа: вход в аккаунт, навигация, тема, профиль.
import { watchAuth, signIn, signUp, logOut, authErrorText } from './auth.js';
import { startStore, stopStore } from './store.js';
import { initSearch, setSearchUser } from './search.js';
import { initLibrary, render as renderLibrary, resetLibrary } from './library.js';
import { initPlayerUI, resetPlayerUI, isFullOpen, closeFull } from './playerui.js';
import * as player from './player.js';
import { $, $$ } from './ui.js';
import { APP_VERSION } from './config.js';
import { youtubeEnabled } from './youtube.js';

// ---------- тема ----------
const THEME_KEY = 'mkw.theme';
function getTheme() { try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch { return 'auto'; } }
function applyTheme(mode) {
  if (mode === 'light' || mode === 'dark') document.documentElement.dataset.theme = mode;
  else delete document.documentElement.dataset.theme;
  $$('#theme-row .chip').forEach((c) => c.classList.toggle('active', c.dataset.themeSet === mode));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#a8326a';
}
function setTheme(mode) {
  try { localStorage.setItem(THEME_KEY, mode); } catch { /* ignore */ }
  applyTheme(mode);
}

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
let currentView = 'search';
function showView(name) {
  currentView = name;
  for (const v of ['search', 'library', 'profile']) $(`#view-${v}`).hidden = v !== name;
  $$('#bottom-nav .nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'library') renderLibrary();
  window.scrollTo(0, 0);
}

function initNav() {
  $('#bottom-nav').addEventListener('click', (e) => {
    const b = e.target.closest('.nav-btn');
    if (b) { closeFull(); showView(b.dataset.view); }
  });
  $('#theme-row').addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme-set]');
    if (b) setTheme(b.dataset.themeSet);
  });
  $('#logout-btn').addEventListener('click', () => logOut());
  // Кнопка «назад» на телефоне сворачивает большой плеер, а не закрывает сайт.
  window.addEventListener('popstate', () => { if (isFullOpen()) closeFull(); });
}

// ---------- состояние входа ----------
function onUser(user) {
  if (user) {
    $('#auth-screen').hidden = true;
    $('#app').hidden = false;
    $('#profile-nick').textContent = user.nick;
    $('#profile-avatar').textContent = user.nick.slice(0, 1);
    $('#yt-status').textContent = youtubeEnabled()
      ? 'Играют полные треки через YouTube. Если трек не нашёлся, играет фрагмент 30 сек.'
      : 'Сейчас играют фрагменты по 30 секунд. Полные треки включатся после подключения YouTube-ключа.';
    startStore(user.uid);
    setSearchUser(user.nick);
    resetLibrary();
    showView('search');
    player.warmUp();
  } else {
    player.stop();
    stopStore();
    resetPlayerUI();
    $('#app').hidden = true;
    $('#auth-screen').hidden = false;
    setAuthMode('login');
  }
}

function boot() {
  applyTheme(getTheme());
  $('#app-version').textContent = `MKW ${APP_VERSION}`;
  initAuthForm();
  initNav();
  initSearch();
  initLibrary();
  initPlayerUI();
  watchAuth(onUser);
}

boot();
