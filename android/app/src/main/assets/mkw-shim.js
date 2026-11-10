/* MKW Music для Android: «мост» между сайтом и приложением.
 * Выполняется до загрузки страницы mkwmusic.ru (см. MainActivity.registerShim).
 * В WebView нет уведомлений, системных кнопок музыки и фонового режима — здесь они подключаются к приложению.
 * Сам сайт не меняется: он видит обычные Notification и navigator.mediaSession. */
(function () {
  'use strict';
  var B = window.MKWAndroid;
  if (!B || window.__mkwShim) return;
  window.__mkwShim = true;
  var INIT = __MKW_INIT__;
  window.__MKW_APP = INIT;

  function send(o) { try { B.postMessage(JSON.stringify(o)); } catch (e) { /* ignore */ } }
  function log(m) { try { console.log('[MKWSHIM] ' + m); } catch (e) { /* ignore */ } }

  /* ---------- уведомления ---------- */
  var perm = INIT.perm || 'default';
  var waiters = [];
  window.__mkwPerm = function (p) {
    perm = p === 'granted' ? 'granted' : 'denied';
    var w = waiters; waiters = [];
    w.forEach(function (f) { try { f(perm); } catch (e) { /* ignore */ } });
  };
  function clip(v, n) { v = v == null ? '' : String(v); return v.length > n ? v.slice(0, n) : v; }
  function notify(title, o) {
    o = o || {};
    send({ t: 'notify', title: clip(title, 120), body: clip(o.body, 400), tag: clip(o.tag, 64) });
  }
  function N(title, o) {
    o = o || {};
    this.title = String(title); this.body = clip(o.body, 400); this.tag = clip(o.tag, 64);
    this.onclick = null; this.onclose = null; this.onerror = null; this.onshow = null;
    notify(title, o);
  }
  N.prototype.close = function () { };
  N.prototype.addEventListener = function () { };
  N.prototype.removeEventListener = function () { };
  N.requestPermission = function (cb) {
    return new Promise(function (res) {
      var done = function (p) { try { if (typeof cb === 'function') cb(p); } catch (e) { /* ignore */ } res(p); };
      if (perm === 'granted') { done(perm); return; }
      waiters.push(done);
      send({ t: 'perm' });
    });
  };
  Object.defineProperty(N, 'permission', { get: function () { return perm; } });
  N.maxActions = 0;
  try { Object.defineProperty(window, 'Notification', { value: N, configurable: true, writable: true }); } catch (e) { window.Notification = N; }
  try {
    if (window.ServiceWorkerRegistration) {
      ServiceWorkerRegistration.prototype.showNotification = function (title, o) { notify(title, o); return Promise.resolve(); };
      ServiceWorkerRegistration.prototype.getNotifications = function () { return Promise.resolve([]); };
    }
  } catch (e) { log('sw notif ' + e); }

  /* ---------- музыка в шторке и в фоне (Media Session → приложение) ---------- */
  var handlers = {}, md = null, ps = 'none', timer = 0;
  function art(m) {
    try { var a = m && m.artwork; if (a && a.length) return String(a[a.length - 1].src || a[0].src || ''); } catch (e) { /* ignore */ }
    return '';
  }
  function pushMedia() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      send({ t: 'media', playing: ps === 'playing', title: clip(md && md.title, 160), artist: clip(md && md.artist, 160), art: clip(art(md), 600) });
    }, 150);
  }
  var ms = navigator.mediaSession;
  if (!ms) {
    ms = {};
    try { Object.defineProperty(navigator, 'mediaSession', { value: ms, configurable: true }); } catch (e) { log('no mediaSession ' + e); }
  }
  if (typeof window.MediaMetadata === 'undefined') {
    window.MediaMetadata = function (i) { i = i || {}; this.title = i.title || ''; this.artist = i.artist || ''; this.album = i.album || ''; this.artwork = i.artwork || []; };
  }
  var proto = Object.getPrototypeOf(ms) || {};
  function orig(name) { try { return Object.getOwnPropertyDescriptor(proto, name); } catch (e) { return null; } }
  var dMeta = orig('metadata'), dState = orig('playbackState');
  var origSet = typeof ms.setActionHandler === 'function' ? ms.setActionHandler.bind(ms) : null;
  ms.setActionHandler = function (n, f) {
    if (f) handlers[n] = f; else delete handlers[n];
    if (origSet) { try { origSet(n, f); } catch (e) { /* ignore */ } }
  };
  if (typeof ms.setPositionState !== 'function') ms.setPositionState = function () { };
  try {
    Object.defineProperty(ms, 'metadata', {
      configurable: true,
      get: function () { return md; },
      set: function (v) { md = v; try { if (dMeta && dMeta.set) dMeta.set.call(ms, v); } catch (e) { /* ignore */ } pushMedia(); }
    });
    Object.defineProperty(ms, 'playbackState', {
      configurable: true,
      get: function () { return ps; },
      set: function (v) { ps = String(v); try { if (dState && dState.set) dState.set.call(ms, v); } catch (e) { /* ignore */ } pushMedia(); }
    });
  } catch (e) { log('ms define ' + e); }
  // кнопки в шторке и на гарнитуре вызывают те же обработчики, что и системные кнопки в браузере
  window.__mkwAct = function (a) { var f = handlers[a]; if (f) { try { f({ action: a }); } catch (e) { /* ignore */ } } };

  /* ---------- «Продолжить с сайта» на экране входа ---------- */
  function injectHandoff() {
    var screen = document.getElementById('auth-screen');
    if (!screen || screen.hidden || document.getElementById('apk-handoff')) return;
    var form = document.getElementById('auth-form');
    if (!form || !form.parentNode) return;
    var box = document.createElement('div');
    box.id = 'apk-handoff';
    box.style.cssText = 'margin:14px 0 4px;text-align:center';
    var p = document.createElement('p');
    p.className = 'auth-hint';
    p.textContent = 'Уже входили на сайте mkwmusic.ru?';
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn tonal block';
    b.textContent = 'Продолжить с сайта';
    b.addEventListener('click', function () {
      p.textContent = 'Открыли браузер: подтвердите вход там и вернитесь в приложение';
      send({ t: 'handoff' });
    });
    box.appendChild(p);
    box.appendChild(b);
    form.parentNode.insertBefore(box, form.nextSibling);
  }
  function watchAuthScreen() {
    injectHandoff();
    var screen = document.getElementById('auth-screen');
    if (screen) new MutationObserver(injectHandoff).observe(screen, { attributes: true, attributeFilter: ['hidden'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchAuthScreen);
  else watchAuthScreen();

  /* ---------- вход из браузера: принимаем сессию Firebase, которую прислало приложение ---------- */
  window.__mkwAdopt = function (json) {
    try {
      var d = JSON.parse(json);
      if (!d || typeof d.k !== 'string' || d.k.indexOf('firebase:authUser:') !== 0 || !d.v || typeof d.v.uid !== 'string') { send({ t: 'adopt', ok: false }); return false; }
      var rq = indexedDB.open('firebaseLocalStorageDb', 1);
      rq.onupgradeneeded = function () { try { rq.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' }); } catch (e) { /* ignore */ } };
      rq.onerror = function () { send({ t: 'adopt', ok: false }); };
      rq.onsuccess = function () {
        var db = rq.result;
        try {
          var tx = db.transaction('firebaseLocalStorage', 'readwrite');
          tx.objectStore('firebaseLocalStorage').put({ fbase_key: d.k, value: d.v });
          tx.oncomplete = function () { db.close(); send({ t: 'adopt', ok: true }); location.reload(); };
          tx.onerror = function () { db.close(); send({ t: 'adopt', ok: false }); };
        } catch (e) { db.close(); send({ t: 'adopt', ok: false }); }
      };
      return true;
    } catch (e) { send({ t: 'adopt', ok: false }); return false; }
  };

  log('ready v' + INIT.v + ' perm=' + perm + ' mediaSession=' + !!navigator.mediaSession);
})();
