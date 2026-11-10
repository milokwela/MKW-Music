"""Проверка приложения в эмуляторе: скриншоты + разговор со страницей через DevTools WebView.
Ничего не меняет в боевых данных: вход пробуется с заведомо несуществующим ником."""
import json
import re
import subprocess
import sys
import time
import urllib.request

OUT = sys.argv[1]
PKG = 'ru.mkwmusic.app'
REPORT = {}


def sh(*args, timeout=60):
    try:
        r = subprocess.run(['adb', *args], capture_output=True, text=True, timeout=timeout)
        return (r.stdout or '') + (r.stderr or '')
    except Exception as e:  # noqa: BLE001
        return f'ERR {e}'


def shot(name):
    try:
        with open(f'{OUT}/{name}.png', 'wb') as f:
            subprocess.run(['adb', 'exec-out', 'screencap', '-p'], stdout=f, timeout=60)
    except Exception as e:  # noqa: BLE001
        print('shot failed', name, e)


def ui():
    sh('shell', 'uiautomator', 'dump', '/sdcard/ui.xml')
    return sh('shell', 'cat', '/sdcard/ui.xml')


def tap_text(*labels):
    xml = ui()
    for m in re.finditer(r'<node[^>]*?text="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml):
        t = m.group(1).strip()
        if any(t.lower() == l.lower() for l in labels):
            x = (int(m.group(2)) + int(m.group(4))) // 2
            y = (int(m.group(3)) + int(m.group(5))) // 2
            sh('shell', 'input', 'tap', str(x), str(y))
            return t
    return None


def log(*a):
    print(*a, flush=True)


# ---------- 0. есть ли у эмулятора интернет ----------
REPORT['net_ping_ip'] = sh('shell', 'ping', '-c', '2', '-W', '3', '8.8.8.8', timeout=30)[-300:]
REPORT['net_ping_host'] = sh('shell', 'ping', '-c', '2', '-W', '3', 'mkwmusic.ru', timeout=30)[-300:]
REPORT['net_dns'] = sh('shell', 'getprop', 'net.dns1').strip() + ' ' + sh('shell', 'getprop', 'net.dns2').strip()
log('net:', REPORT['net_ping_ip'][-120:], '|', REPORT['net_ping_host'][-160:], '|', REPORT['net_dns'])

# ---------- 1. первый запуск: диалог настройки, разрешения ----------
sh('shell', 'am', 'force-stop', PKG)
sh('shell', 'pm', 'revoke', PKG, 'android.permission.POST_NOTIFICATIONS')
sh('shell', 'am', 'start', '-n', f'{PKG}/.MainActivity')
time.sleep(8)
shot('01_first_run')
REPORT['first_run_dialog'] = 'Настроим MKW Music' in ui()
log('dialog:', REPORT['first_run_dialog'])
log('tap continue:', tap_text('Продолжить'))
time.sleep(3)
shot('02_notif_permission')
log('tap allow 1:', tap_text('Allow', 'ALLOW', 'Разрешить'))
time.sleep(3)
shot('03_battery_dialog')
log('tap allow 2:', tap_text('Allow', 'ALLOW', 'Разрешить'))
time.sleep(3)
shot('04_after_dialogs')
if 'Нет соединения' in ui():
    log('offline page, retry:', tap_text('Повторить'))
    time.sleep(10)
    shot('04b_after_retry')

# ---------- 2. страница загрузилась? ждём экран входа ----------
pid = ''
for _ in range(10):
    pid = (sh('shell', 'pidof', PKG).strip().split() or [''])[0]
    if pid:
        break
    time.sleep(1)
log('pid', pid)
sh('forward', 'tcp:9222', f'localabstract:webview_devtools_remote_{pid}')
ws = None
try:
    import websocket
    page = None
    for _ in range(20):
        try:
            pages = json.load(urllib.request.urlopen('http://127.0.0.1:9222/json', timeout=10))
            page = next((p for p in pages if p.get('type') == 'page' and 'mkwmusic' in p.get('url', '')), None)
            if page:
                break
        except Exception as e:  # noqa: BLE001
            log('devtools wait', e)
        if _ % 5 == 4 and 'Нет соединения' in ui():
            log('retry:', tap_text('Повторить'))
        time.sleep(2)
    REPORT['page_url'] = page.get('url') if page else None
    ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=40, suppress_origin=True)
except Exception as e:  # noqa: BLE001
    REPORT['devtools_error'] = str(e)
    log('devtools failed', e)

_id = 0


def ev(expr, wait=True, timeout=40):
    """Выполнить JS на странице, вернуть значение."""
    global _id
    if not ws:
        return None
    _id += 1
    ws.send(json.dumps({'id': _id, 'method': 'Runtime.evaluate',
                        'params': {'expression': expr, 'awaitPromise': wait, 'returnByValue': True}}))
    end = time.time() + timeout
    while time.time() < end:
        try:
            m = json.loads(ws.recv())
        except Exception as e:  # noqa: BLE001
            return f'ERR {e}'
        if m.get('id') == _id:
            r = m.get('result', {})
            if 'exceptionDetails' in r:
                return 'EXC ' + json.dumps(r['exceptionDetails'], ensure_ascii=False)[:300]
            return r.get('result', {}).get('value')
    return 'TIMEOUT'


def wait_for(expr, secs=40):
    end = time.time() + secs
    while time.time() < end:
        if ev(expr) is True:
            return True
        time.sleep(2)
    return False


if ws:
    REPORT['auth_screen_visible'] = wait_for("(()=>{const s=document.getElementById('auth-screen');return !!s&&!s.hidden})()", 60)
    log('auth screen:', REPORT['auth_screen_visible'])
    time.sleep(2)
    shot('05_login_screen')

    REPORT['env'] = ev("""JSON.stringify({
      shim: !!window.__mkwShim, app: window.__MKW_APP || null,
      notification: typeof Notification, perm: (typeof Notification !== 'undefined') ? Notification.permission : null,
      mediaSession: !!navigator.mediaSession, push: 'PushManager' in window,
      handoffButton: !!document.getElementById('apk-handoff'),
      idb: typeof indexedDB, sw: 'serviceWorker' in navigator, ua: navigator.userAgent,
      host: location.hostname })""")
    log('env:', REPORT['env'])

    # ---------- 3. вход с несуществующим ником: должна быть «ошибка пароля», а не сетевая ----------
    ev("""(()=>{
      const n=document.getElementById('auth-nick'), p=document.getElementById('auth-pass');
      const set=(el,v)=>{el.focus();el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));};
      set(n,'smoketestzz9'); set(p,'wrongpass-123');
      document.getElementById('auth-submit').click(); return true; })()""")
    time.sleep(8)
    REPORT['login_error_text'] = ev("(document.getElementById('auth-error')||{}).textContent")
    log('login error:', REPORT['login_error_text'])
    shot('06_login_error')

    # ---------- 4. музыка в фоне: сервис и уведомление с кнопками ----------
    ev("""(()=>{ navigator.mediaSession.metadata = new MediaMetadata({title:'Smoke Title', artist:'Smoke Artist', artwork:[]});
      navigator.mediaSession.playbackState='playing'; return true; })()""")
    time.sleep(5)
    svc = sh('shell', 'dumpsys', 'activity', 'services', PKG)
    REPORT['playback_service_running'] = 'PlaybackService' in svc
    REPORT['playback_foreground'] = 'isForeground=true' in svc
    notif = sh('shell', 'dumpsys', 'notification', '--noredact')
    REPORT['media_notification'] = 'Smoke Title' in notif
    log('service:', REPORT['playback_service_running'], 'fg:', REPORT['playback_foreground'], 'notif:', REPORT['media_notification'])
    sh('shell', 'cmd', 'statusbar', 'expand-notifications')
    time.sleep(2)
    shot('07_media_notification')
    sh('shell', 'cmd', 'statusbar', 'collapse')

    # кнопка «пауза» → обработчик страницы. Два пути: медиаклавиша (гарнитура) и кнопка в шторке.
    ev("""(()=>{ window.__pausedFromNotif=false; navigator.mediaSession.setActionHandler('pause', ()=>{window.__pausedFromNotif=true}); return true; })()""")
    REPORT['media_dispatch_out'] = sh('shell', 'media', 'dispatch', 'pause').strip()[:300]
    time.sleep(3)
    REPORT['media_key_pause_reaches_page'] = ev('window.__pausedFromNotif')
    log('media key pause ->', REPORT['media_key_pause_reaches_page'], REPORT['media_dispatch_out'])
    ms = sh('shell', 'dumpsys', 'media_session')
    i = ms.find('MKW Music')
    REPORT['media_session_dump'] = ms[max(0, i - 200): i + 900] if i >= 0 else 'нет сессии MKW Music в dumpsys'

    # то же самое нажатием на кнопку «Pause» в шторке (плеер быстрых настроек работает через MediaSession)
    ev("""(()=>{ window.__pausedFromNotif=false; return true; })()""")
    sh('shell', 'cmd', 'statusbar', 'expand-notifications')
    time.sleep(2)
    xml = ui()
    tapped = None
    for m in re.finditer(r'<node[^>]*?content-desc="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml):
        if m.group(1).strip().lower() in ('pause', 'пауза'):
            x = (int(m.group(2)) + int(m.group(4))) // 2
            y = (int(m.group(3)) + int(m.group(5))) // 2
            sh('shell', 'input', 'tap', str(x), str(y))
            tapped = m.group(1)
            break
    REPORT['shade_pause_tapped'] = tapped
    time.sleep(3)
    REPORT['shade_pause_reaches_page'] = ev('window.__pausedFromNotif')
    log('shade pause tapped:', tapped, '->', REPORT['shade_pause_reaches_page'])
    shot('07b_after_shade_pause')
    sh('shell', 'cmd', 'statusbar', 'collapse')

    # ---------- 5. обычное уведомление от сайта ----------
    ev("""(()=>{ new Notification('Привет из смоука', {body:'Тест уведомления', tag:'smoke'}); return true; })()""")
    time.sleep(3)
    notif = sh('shell', 'dumpsys', 'notification', '--noredact')
    REPORT['site_notification'] = 'Привет из смоука' in notif
    log('site notification:', REPORT['site_notification'])

    # ---------- 6. приём сессии из браузера (проверяем запись в IndexedDB, не вход в аккаунт) ----------
    ev("""window.__mkwAdopt(JSON.stringify({k:'firebase:authUser:SMOKE:[DEFAULT]', v:{uid:'smoke-uid'}}))""")
    time.sleep(8)
    for _ in range(10):
        try:
            pages = json.load(urllib.request.urlopen('http://127.0.0.1:9222/json', timeout=10))
            page = next((p for p in pages if p.get('type') == 'page' and 'mkwmusic' in p.get('url', '')), None)
            ws.close()
            ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=40, suppress_origin=True)
            break
        except Exception as e:  # noqa: BLE001
            log('reconnect', e)
            time.sleep(2)
    REPORT['adopt_written'] = ev("""new Promise(res=>{const r=indexedDB.open('firebaseLocalStorageDb');
      r.onsuccess=()=>{try{const g=r.result.transaction('firebaseLocalStorage').objectStore('firebaseLocalStorage').get('firebase:authUser:SMOKE:[DEFAULT]');
        g.onsuccess=()=>res(JSON.stringify(g.result||null)); g.onerror=()=>res('err');}catch(e){res('exc '+e)}}; r.onerror=()=>res('open err');})""")
    log('adopt:', REPORT['adopt_written'])
    # убираем тестовую запись
    ev("""new Promise(res=>{const r=indexedDB.open('firebaseLocalStorageDb');r.onsuccess=()=>{try{const t=r.result.transaction('firebaseLocalStorage','readwrite');t.objectStore('firebaseLocalStorage').delete('firebase:authUser:SMOKE:[DEFAULT]');t.oncomplete=()=>res(true)}catch(e){res(false)}}})""")

    # ---------- 7. «Продолжить с сайта»: открывается браузер ----------
    REPORT['handoff_button_after_reload'] = wait_for("!!document.getElementById('apk-handoff')", 30)
    ev("document.querySelector('#apk-handoff button').click()")
    time.sleep(6)
    shot('08_handoff_browser')
    top = sh('shell', 'dumpsys', 'activity', 'activities')
    m = re.search(r'(topResumedActivity|mResumedActivity)[^\n]*', top)
    REPORT['after_handoff_foreground'] = m.group(0) if m else None
    log('foreground after handoff:', REPORT['after_handoff_foreground'])
    ui_text = ui()
    REPORT['browser_ui_has_apk_param'] = 'apk=handoff' in ui_text
    sh('shell', 'am', 'start', '-n', f'{PKG}/.MainActivity')
    time.sleep(3)
    shot('09_back_in_app')

with open(f'{OUT}/report.json', 'w', encoding='utf-8') as f:
    json.dump(REPORT, f, ensure_ascii=False, indent=2)
log(json.dumps(REPORT, ensure_ascii=False, indent=2))
