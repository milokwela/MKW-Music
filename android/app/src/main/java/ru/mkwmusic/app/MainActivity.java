package ru.mkwmusic.app;

import android.os.Handler;
import android.graphics.Color;
import android.annotation.SuppressLint;
import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.ScriptHandler;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * MKW Music для Android (beta): оболочка вокруг https://mkwmusic.ru.
 * Весь интерфейс живёт на сайте и обновляется вместе с ним. Здесь: окно, мост «сайт ↔ приложение»
 * (уведомления, музыка в фоне, вход через сайт), камера/микрофон по запросу сайта, выбор файлов, проверка обновлений.
 * Страницы других сайтов открываются в браузере.
 */
public class MainActivity extends Activity {
    private static final String HOME = "https://mkwmusic.ru/";
    private static final String TAG = "MKWApp";
    private static final int BG = 0xFF0D0A0B;
    private static final int REQ_FILE = 1001;
    private static final int REQ_PERM = 1002;
    private static final int REQ_NOTIF = 1003;
    private static final long UPDATE_EVERY_MS = 6L * 60 * 60 * 1000;
    private static final Pattern LOCAL_IMG = Pattern.compile("/mkw-[a-z0-9-]+\\.webp");

    /** Нужна службе музыки, чтобы передать кнопки шторки обратно на страницу. */
    static volatile MainActivity current;

    private FrameLayout root;
    private WebView web;
    private boolean debuggable;
    private boolean pageReady;
    private boolean offlineShown;
    private static final String SITE_ROOT = "https://mkwmusic.ru/";
    private OfflineStore offlineStore;
    private ShellCache shellCache;

    synchronized OfflineStore offline() {
        if (offlineStore == null) offlineStore = new OfflineStore(this, this::runJs);
        return offlineStore;
    }

    synchronized ShellCache shell() {
        if (shellCache == null) shellCache = new ShellCache(this);
        return shellCache;
    }
    private boolean pendingWave;
    private static final String WAVE_JS = "window.dispatchEvent(new Event('mkw-widget-wave'))";
    private String pendingAdopt;
    private boolean setupShowing;

    private ValueCallback<Uri[]> fileCallback;
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;
    private PermissionRequest pendingRequest;
    private String[] pendingResources;
    private Runnable afterNotif;

    private ScriptHandler shimHandler;
    private String shimTemplate;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        current = this;
        setVolumeControlStream(android.media.AudioManager.STREAM_MUSIC); // кнопки громкости всегда меняют громкость музыки
        debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (debuggable) WebView.setWebContentsDebuggingEnabled(true);
        Notifier.ensureChannels(this);

        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        root.setFitsSystemWindows(true);
        setContentView(root);

        web = new BgWebView(this);
        web.setBackgroundColor(BG);
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        configure(web);
        installBridge();
        interceptLocalImages();

        boolean restored = savedInstanceState != null && web.restoreState(savedInstanceState) != null;
        if (!restored) web.loadUrl(startUrl(getIntent()));
        if (savedInstanceState == null) handleIntent(getIntent());

        preferSmoothDisplay();
        if (savedInstanceState == null) showSplash();
        root.post(this::firstRunSetup);
        root.postDelayed(this::checkUpdate, 5000);
    }

    // ---------- заставка (только в приложении) ----------

    private WebView splash;
    private final Handler splashHandler = new Handler(android.os.Looper.getMainLooper());

    /** Заставка MKW: лого, «MKW Music», «created by MiloKwel». 3 секунды, нажатие пропускает. Пока она идёт, сайт уже грузится под ней. */
    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void showSplash() {
        String html;
        try (InputStream in = getAssets().open("splash.html")) {
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            html = out.toString("UTF-8");
        } catch (Exception e) {
            return; // нет файла — без заставки
        }
        splash = new WebView(this);
        splash.setBackgroundColor(Color.BLACK);
        WebSettings s = splash.getSettings();
        s.setJavaScriptEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        splash.setVerticalScrollBarEnabled(false);
        splash.setHorizontalScrollBarEnabled(false);
        splash.addJavascriptInterface(new Object() {
            @android.webkit.JavascriptInterface
            public void skip() { splashHandler.post(MainActivity.this::hideSplash); }
        }, "MKWSplash");
        splash.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return true; } // никуда не переходит
        });
        root.addView(splash, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        splash.loadDataWithBaseURL("about:blank", html, "text/html", "utf-8", null);
        splashStart = android.os.SystemClock.uptimeMillis();
        splashHandler.postDelayed(this::maybeHideSplash, 1600);
        splashHandler.postDelayed(this::hideSplash, 6000); // страховка, если сайт долго грузится
    }

    private long splashStart;
    private boolean splashPageDone;

    /** Убираем заставку не раньше 1,6 с и только когда сайт уже готов — чтобы под ней не мелькало ничего старого. */
    private void maybeHideSplash() {
        if (splash == null) return;
        if (splashPageDone && android.os.SystemClock.uptimeMillis() - splashStart >= 1600) hideSplash();
    }

    private void hideSplash() {
        final WebView v = splash;
        if (v == null) return;
        splash = null;
        splashHandler.removeCallbacksAndMessages(null);
        if (web != null) web.evaluateJavascript("(function(){var e=document.getElementById('splash');if(e)e.remove();})()", null);
        v.animate().alpha(0f).setDuration(300).withEndAction(() -> {
            root.removeView(v);
            v.destroy();
        }).start();
    }

    /** Пока работает служба музыки, страница не узнаёт, что приложение свёрнуто (см. BgWebView). */
    static void holdVisible(final boolean on) {
        final MainActivity m = current;
        if (m == null) return;
        m.runOnUiThread(() -> {
            if (m.web instanceof BgWebView) ((BgWebView) m.web).setHold(on);
        });
    }

    // ---------- WebView ----------

    private void configure(WebView view) {
        WebSettings s = view.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);
        s.setUserAgentString(s.getUserAgentString() + " MKWApp/" + versionName());
        // Рендерер страницы остаётся «важным» и в фоне — иначе Android усыпляет музыку при выключенном экране
        if (Build.VERSION.SDK_INT >= 26) view.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);

        view.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri uri = request.getUrl();
                if (isOurs(uri) || "about".equals(uri.getScheme())) return false;
                String scheme = uri.getScheme();
                if ("https".equals(scheme) || "http".equals(scheme) || "mailto".equals(scheme) || "tel".equals(scheme)) {
                    openExternal(uri);
                }
                return true;
            }

            @Override
            public void onPageStarted(WebView v, String url, android.graphics.Bitmap favicon) {
                pageReady = false;
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                pageReady = isOurs(url == null ? null : Uri.parse(url));
                if (pageReady && !offlineShown && offline().online()) shell().saveIndex(SITE_ROOT);
                if (pageReady && splash != null) {
                    v.evaluateJavascript("(function(){var e=document.getElementById('splash');if(e)e.remove();})()", null);
                    splashHandler.postDelayed(() -> { splashPageDone = true; maybeHideSplash(); }, 600);
                }
                if (pageReady && pendingWave) { pendingWave = false; v.postDelayed(() -> runJs(WAVE_JS), 1500); }
                if (pageReady && pendingAdopt != null) {
                    String json = pendingAdopt;
                    pendingAdopt = null;
                    adopt(json);
                }
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest request) {
                return localImage(request);
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                int code = error.getErrorCode();
                if (code == ERROR_HOST_LOOKUP || code == ERROR_CONNECT || code == ERROR_TIMEOUT || code == ERROR_IO) {
                    // нет интернета: открываем сохранённую копию MKW — скачанная музыка играет и без сети
                    String saved = shell().index();
                    if (saved != null && !offlineShown) {
                        offlineShown = true;
                        v.loadDataWithBaseURL(SITE_ROOT, saved, "text/html", "UTF-8", SITE_ROOT);
                    } else {
                        v.loadDataWithBaseURL(null, OFFLINE_HTML, "text/html", "UTF-8", null);
                    }
                }
            }

            @Override
            public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail detail) {
                runOnUiThread(() -> recreate());
                return true;
            }
        });

        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> handlePermission(request));
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                if (debuggable) Log.d("MKWWeb", m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
                return false;
            }

            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customCallback = callback;
                root.addView(view, new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                web.setVisibility(View.GONE);
                getWindow().getDecorView().setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
            }

            @Override
            public void onHideCustomView() {
                hideCustomView();
            }
        });

        view.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (url != null && url.startsWith("https://")) {
                openExternal(Uri.parse(url));
            } else {
                Toast.makeText(this, "Скачивание файлов в приложении пока не работает (beta)", Toast.LENGTH_LONG).show();
            }
        });
    }

    /** Стикеры и картинки MKW лежат внутри приложения: открываются сразу и без траты интернета. */
    private WebResourceResponse localImage(WebResourceRequest request) {
        try {
            Uri u = request.getUrl();
            if (!"GET".equals(request.getMethod())) return null;
            // библиотека Firebase (адрес с версией не меняется) — из памяти приложения: быстрее и работает без интернета
            if ("www.gstatic.com".equals(u.getHost()) && u.getPath() != null && u.getPath().startsWith("/firebasejs/")) {
                return shell().immutable(u.toString(), "text/javascript");
            }
            if (!isOurs(u)) return null;
            String path = u.getPath();
            if (path == null) return null;
            if (path.startsWith("/__offline/")) return offline().serve(path, request.getRequestHeaders());
            // код сайта той же версии, что вшита в приложение, берём из приложения — запуск без ожидания сети
            if ("/app.js".equals(path) || "/app.css".equals(path)) {
                String v = u.getQueryParameter("v");
                if (v == null) return null;
                // другая версия, чем вшита в приложение, — сохраняем её у себя, чтобы следующий запуск (и без сети) был мгновенным
                if (!v.equals(bundledVersion())) return shell().immutable(u.toString(), path.endsWith(".js") ? "text/javascript" : "text/css");
                Map<String, String> h = new HashMap<>();
                h.put("Cache-Control", "public, max-age=31536000, immutable");
                return new WebResourceResponse(path.endsWith(".js") ? "text/javascript" : "text/css", "utf-8", 200, "OK", h,
                        getAssets().open("site" + path));
            }
            if (!LOCAL_IMG.matcher(path).matches()) return null;
            InputStream in = getAssets().open("site" + path);
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "public, max-age=86400");
            return new WebResourceResponse("image/webp", null, 200, "OK", headers, in);
        } catch (IOException e) {
            return null; // такого файла в приложении нет — берём с сайта
        }
    }

    private String bundledVer;

    /** Версия сайта, код которой лежит внутри приложения (assets/site/version.json). */
    private synchronized String bundledVersion() {
        if (bundledVer == null) {
            bundledVer = "";
            try (InputStream in = getAssets().open("site/version.json")) {
                java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[256];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                bundledVer = new JSONObject(out.toString("UTF-8")).optString("v", "");
            } catch (Exception ignored) {
                // кода сайта в приложении нет — всё грузится из сети
            }
        }
        return bundledVer;
    }

    // ---------- громкость телефона и устройство вывода ----------

    private BtHelper btHelper;

    private BtHelper bt() {
        if (btHelper == null) btHelper = new BtHelper(this, s -> runJs("window.__mkwBt&&window.__mkwBt(" + s + ")"));
        return btHelper;
    }

    /** Системное окно выбора, куда играть звук: там же можно отключить колонку и вернуться на динамик телефона. */
    private void openOutputSwitcher() {
        try {
            if (Build.VERSION.SDK_INT >= 34 && android.media.MediaRouter2.getInstance(this).showSystemOutputSwitcher()) return;
        } catch (Exception e) {
            Log.w(TAG, "output switcher", e);
        }
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                startActivity(new Intent("com.android.settings.panel.action.MEDIA_OUTPUT")
                        .putExtra("com.android.settings.panel.extra.PACKAGE_NAME", getPackageName()));
                return;
            }
        } catch (Exception e) {
            Log.w(TAG, "output panel", e);
        }
        try {
            startActivity(new Intent(android.provider.Settings.ACTION_BLUETOOTH_SETTINGS));
        } catch (Exception e) {
            Log.w(TAG, "bluetooth settings", e);
        }
    }

    private void replyAudio() {
        try {
            android.media.AudioManager am = (android.media.AudioManager) getSystemService(AUDIO_SERVICE);
            JSONObject o = new JSONObject();
            int max = am.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC);
            o.put("vol", max > 0 ? am.getStreamVolume(android.media.AudioManager.STREAM_MUSIC) / (double) max : 0);
            String kind = "phone", name = "";
            int best = 0;
            for (android.media.AudioDeviceInfo d : am.getDevices(android.media.AudioManager.GET_DEVICES_OUTPUTS)) {
                int t = d.getType();
                int rank; String k;
                if (t == 8 || t == 26 || t == 27 || t == 23 || t == 30) { rank = 3; k = "bt"; }       // Bluetooth A2DP / LE / слуховой аппарат
                else if (t == 3 || t == 4 || t == 22) { rank = 2; k = "wired"; }                     // проводные и USB-наушники
                else continue;
                if (rank > best) {
                    best = rank; kind = k;
                    CharSequence pn = d.getProductName();
                    name = pn == null ? "" : pn.toString();
                }
            }
            o.put("kind", kind);
            if ("bt".equals(kind)) o.put("bat", bt().connectedBattery());
            o.put("name", clip(name, 80));
            runJs("window.__mkwAudio&&window.__mkwAudio(" + o + ")");
        } catch (Exception e) {
            Log.w(TAG, "audio state", e);
        }
    }

    private void setVolume(JSONObject o) {
        try {
            android.media.AudioManager am = (android.media.AudioManager) getSystemService(AUDIO_SERVICE);
            int max = am.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC);
            int cur = am.getStreamVolume(android.media.AudioManager.STREAM_MUSIC);
            int next;
            if (o.has("v")) next = (int) Math.round(Math.max(0, Math.min(1, o.optDouble("v", 0))) * max);
            else next = cur + (o.optInt("step", 0) > 0 ? 1 : -1) * Math.max(1, Math.round(max * 0.15f));
            next = Math.max(0, Math.min(max, next));
            am.setStreamVolume(android.media.AudioManager.STREAM_MUSIC, next, o.optBoolean("ui", false) ? android.media.AudioManager.FLAG_SHOW_UI : 0);
        } catch (Exception e) {
            Log.w(TAG, "set volume", e); // например, режим «Не беспокоить» запретил менять громкость
        }
        replyAudio();
    }

    private void interceptLocalImages() {
        try {
            ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                    return localImage(request);
                }
            });
        } catch (Exception e) {
            Log.w(TAG, "service worker client", e);
        }
    }

    // ---------- мост «сайт ↔ приложение» ----------

    private void installBridge() {
        try {
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
                    || !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                Log.w(TAG, "WebView без поддержки моста: уведомления и фон отключены");
                return;
            }
            Set<String> origins = new HashSet<>();
            origins.add("https://mkwmusic.ru");
            origins.add("https://www.mkwmusic.ru");
            WebViewCompat.addWebMessageListener(web, "MKWAndroid", origins, new WebViewCompat.WebMessageListener() {
                @Override
                public void onPostMessage(WebView v, WebMessageCompat message, Uri sourceOrigin,
                                          boolean isMainFrame, JavaScriptReplyProxy reply) {
                    if (!isMainFrame || !isOurs(sourceOrigin)) return;
                    String data = message.getData();
                    if (data == null || data.length() > 262144) return;
                    try {
                        handleMessage(new JSONObject(data));
                    } catch (Exception e) {
                        Log.w(TAG, "bad message", e);
                    }
                }
            });
            registerShim();
        } catch (Exception e) {
            Log.w(TAG, "bridge", e);
        }
    }

    private void registerShim() {
        try {
            String src = shimSource();
            if (src.isEmpty()) return;
            if (shimHandler != null) shimHandler.remove();
            Set<String> origins = new HashSet<>();
            origins.add("https://mkwmusic.ru");
            origins.add("https://www.mkwmusic.ru");
            shimHandler = WebViewCompat.addDocumentStartJavaScript(web, src, origins);
        } catch (Exception e) {
            Log.w(TAG, "shim", e);
        }
    }

    private String shimSource() {
        try {
            if (shimTemplate == null) {
                try (InputStream in = getAssets().open("mkw-shim.js")) {
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    byte[] buf = new byte[4096];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    shimTemplate = out.toString("UTF-8");
                }
            }
            JSONObject init = new JSONObject();
            init.put("v", versionName());
            init.put("perm", notifState());
            return shimTemplate.replace("__MKW_INIT__", init.toString());
        } catch (Exception e) {
            Log.w(TAG, "shim source", e);
            return "";
        }
    }

    private void handleMessage(JSONObject o) {
        String type = o.optString("t", "");
        switch (type) {
            case "media":
                String art = o.optString("art", "");
                PlaybackService.push(this, o.optString("title", ""), o.optString("artist", ""),
                        art.startsWith("https://") ? art : "", o.optBoolean("playing", false), o.optBoolean("wave", false));
                break;
            case "pos":
                PlaybackService.position(o.optDouble("d", 0), o.optDouble("p", 0), o.optDouble("r", 1));
                break;
            case "audio":
                replyAudio();
                break;
            case "vol":
                setVolume(o);
                break;
            case "btscan":
                bt().scan();
                break;
            case "btstop":
                bt().stop();
                break;
            case "btstate":
                bt().push();
                break;
            case "bton":
                bt().enable();
                break;
            case "btpair":
                if (!bt().pair(o.optString("a", ""))) runJs("window.__mkwBtFail&&window.__mkwBtFail()");
                bt().push();
                break;
            case "outswitch":
                openOutputSwitcher();
                break;
            case "bt":
                try {
                    startActivity(new Intent(android.provider.Settings.ACTION_BLUETOOTH_SETTINGS));
                } catch (Exception e) {
                    Log.w(TAG, "bluetooth settings", e);
                }
                break;
            case "notify":
                if (o.optString("tag", "").startsWith("call-")) {
                    Notifier.call(this, clip(o.optString("title", ""), 120), clip(o.optString("body", ""), 400),
                            clip(o.optString("tag", ""), 64));
                } else {
                    Notifier.message(this, clip(o.optString("title", ""), 120), clip(o.optString("body", ""), 400),
                            clip(o.optString("tag", ""), 64));
                }
                break;
            case "perm":
                requestNotifications(null);
                break;
            case "handoff":
                startHandoff();
                break;
            case "pinwidget": {
                int k = Math.max(0, Math.min(3, o.optInt("kind", 0)));
                if (!WidgetKit.pin(this, k)) {
                    new AlertDialog.Builder(this).setTitle("Добавить виджет")
                            .setMessage("Ваш рабочий стол не даёт добавить виджет из приложения. Сделайте так: долгое нажатие на пустом месте рабочего стола → «Виджеты» → MKW Music → выберите нужный и перетащите.")
                            .setPositiveButton("Понятно", null).show();
                }
                break;
            }
            case "off":
                offline().push();
                break;
            case "offdl":
                offline().download(o, o.optBoolean("wifiOnly", true));
                break;
            case "offput":
                offline().put(o);
                break;
            case "offrm":
                offline().remove(clip(o.optString("id", ""), 200));
                break;
            case "offclear":
                offline().clear();
                break;
            case "checkupdate":
                checkUpdateNow();
                break;
            case "fsi":
                if (o.optBoolean("open", false)) {
                    if (Notifier.fullScreenOk(this)) android.widget.Toast.makeText(this, "Уже включено: звонки откроются на весь экран", android.widget.Toast.LENGTH_SHORT).show();
                    else Notifier.openFullScreenSettings(this);
                }
                runJs("window.__mkwFsi=" + Notifier.fullScreenOk(this) + ";window.dispatchEvent(new Event('mkw-fsi'))");
                break;
            default:
                break;
        }
    }

    /** Выполнить код на странице — только если сейчас открыт наш сайт. */
    void runJs(final String js) {
        runOnUiThread(() -> {
            try {
                String url = web == null ? null : web.getUrl();
                if (url != null && isOurs(Uri.parse(url))) web.evaluateJavascript(js, null);
            } catch (Exception e) {
                Log.w(TAG, "runJs", e);
            }
        });
    }

    // ---------- вход «Продолжить с сайта» ----------

    /**
     * Приложение выдаёт одноразовый код и открывает в браузере mkwmusic.ru/?apk=handoff&s=код.
     * Если вы там уже вошли, страница вернёт сюда вход (mkwmusic://handoff) вместе с этим кодом.
     * Без совпадающего кода присланное игнорируется — чужая ссылка не сможет подменить ваш аккаунт.
     */
    private void startHandoff() {
        byte[] r = new byte[16];
        new SecureRandom().nextBytes(r);
        StringBuilder sb = new StringBuilder();
        for (byte b : r) sb.append(String.format("%02x", b));
        String nonce = sb.toString();
        prefs().edit().putString("ho_nonce", nonce).putLong("ho_exp", System.currentTimeMillis() + 10 * 60 * 1000L).apply();
        openExternal(Uri.parse(HOME + "?apk=handoff&s=" + nonce));
    }

    private void handleIntent(Intent in) {
        if (in == null) return;
        if (in.getBooleanExtra("widget_wave", false)) {
            in.removeExtra("widget_wave");
            if (pageReady) runJs(WAVE_JS); else pendingWave = true;
        }
        Uri d = in.getData();
        if (d == null || !"mkwmusic".equals(d.getScheme()) || !"handoff".equals(d.getHost())) return;
        String s = in.getStringExtra("s");
        String u = in.getStringExtra("u");
        in.setData(null);
        SharedPreferences p = prefs();
        String nonce = p.getString("ho_nonce", "");
        long exp = p.getLong("ho_exp", 0);
        p.edit().remove("ho_nonce").remove("ho_exp").apply();
        boolean ok = s != null && u != null && !nonce.isEmpty() && System.currentTimeMillis() <= exp
                && u.length() < 24000
                && MessageDigest.isEqual(nonce.getBytes(StandardCharsets.UTF_8), s.getBytes(StandardCharsets.UTF_8));
        if (!ok) {
            Toast.makeText(this, "Вход с сайта не подтверждён. Войдите по нику и паролю", Toast.LENGTH_LONG).show();
            return;
        }
        Toast.makeText(this, "Входим…", Toast.LENGTH_SHORT).show();
        if (pageReady) adopt(u); else pendingAdopt = u;
    }

    private void adopt(String json) {
        runJs("window.__mkwAdopt&&window.__mkwAdopt(" + JSONObject.quote(json) + ")");
    }

    // ---------- разрешения ----------

    private String notifState() {
        if (Notifier.enabled(this)) return "granted";
        return prefs().getBoolean("notif_asked", false) ? "denied" : "default";
    }

    /** Разрешение на уведомления (Android 13+): при отказе навсегда открываем настройки приложения. */
    private void requestNotifications(Runnable done) {
        if (Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            reportNotif();
            if (done != null) done.run();
            return;
        }
        boolean asked = prefs().getBoolean("notif_asked", false);
        if (asked && !shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)) {
            Toast.makeText(this, "Включите уведомления для MKW Music в настройках", Toast.LENGTH_LONG).show();
            try {
                startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()));
            } catch (Exception ignored) {
                // настроек нет — ничего не делаем
            }
            reportNotif();
            if (done != null) done.run();
            return;
        }
        prefs().edit().putBoolean("notif_asked", true).apply();
        afterNotif = done;
        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF);
    }

    private void reportNotif() {
        registerShim();
        runJs("window.__mkwPerm&&window.__mkwPerm('" + (Notifier.enabled(this) ? "granted" : "denied") + "')");
    }

    /** Один раз при первом запуске: уведомления и работа в фоне «без ограничений». */
    private void firstRunSetup() {
        SharedPreferences p = prefs();
        if (p.getBoolean("setup_done", false) || isFinishing()) return;
        setupShowing = true;
        new AlertDialog.Builder(this)
                .setTitle("Настроим MKW Music")
                .setMessage("Чтобы музыка играла при выключенном экране, а сообщения и звонки не пропадали, "
                        + "разрешите:\n\n• уведомления\n• работу без ограничений по батарее\n\n"
                        + "Камера и микрофон спросят отдельно — когда вы включите жесты, голос или распознавание песни.")
                .setCancelable(false)
                .setPositiveButton("Продолжить", (d, w) -> {
                    p.edit().putBoolean("setup_done", true).apply();
                    setupShowing = false;
                    requestNotifications(this::askBattery);
                })
                .setNegativeButton("Позже", (d, w) -> {
                    p.edit().putBoolean("setup_done", true).apply();
                    setupShowing = false;
                })
                .show();
    }

    private void askBattery() {
        try {
            PowerManager pm = getSystemService(PowerManager.class);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                        Uri.parse("package:" + getPackageName())));
            }
        } catch (Exception ignored) {
            // на этом телефоне окна нет — настройка в «Батарея» вручную
        }
    }

    private void handlePermission(PermissionRequest request) {
        if (!isOurs(request.getOrigin())) {
            request.deny();
            return;
        }
        List<String> resources = new ArrayList<>();
        List<String> needed = new ArrayList<>();
        for (String r : request.getResources()) {
            String perm = androidPermission(r);
            if (perm == null) continue;
            resources.add(r);
            if (checkSelfPermission(perm) != PackageManager.PERMISSION_GRANTED) needed.add(perm);
        }
        if (resources.isEmpty()) {
            request.deny();
            return;
        }
        if (needed.isEmpty()) {
            request.grant(resources.toArray(new String[0]));
            return;
        }
        if (pendingRequest != null) pendingRequest.deny();
        pendingRequest = request;
        pendingResources = resources.toArray(new String[0]);
        requestPermissions(needed.toArray(new String[0]), REQ_PERM);
    }

    private static String androidPermission(String webResource) {
        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(webResource)) return Manifest.permission.RECORD_AUDIO;
        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(webResource)) return Manifest.permission.CAMERA;
        return null;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == BtHelper.REQ) {
            if (bt().hasPerm()) bt().scan(); else bt().push();
            return;
        }
        if (requestCode == REQ_NOTIF) {
            reportNotif();
            Runnable next = afterNotif;
            afterNotif = null;
            if (next != null) next.run();
            return;
        }
        if (requestCode != REQ_PERM || pendingRequest == null) return;
        PermissionRequest request = pendingRequest;
        String[] resources = pendingResources;
        pendingRequest = null;
        pendingResources = null;
        List<String> granted = new ArrayList<>();
        for (String r : resources) {
            String perm = androidPermission(r);
            if (perm != null && checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED) granted.add(r);
        }
        if (granted.isEmpty()) request.deny(); else request.grant(granted.toArray(new String[0]));
    }

    // ---------- обновления ----------

    private int versionCode() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
        } catch (PackageManager.NameNotFoundException e) {
            return 0;
        }
    }

    private AlertDialog forcedDialog;

    /** Обязательное обновление: окно нельзя закрыть, приложение ждёт установки новой версии. */
    private Updater updaterObj;
    private String updVersion = "";

    synchronized Updater updater() {
        if (updaterObj == null) updaterObj = new Updater(this);
        return updaterObj;
    }

    private void showForced() {
        if (isFinishing() || (forcedDialog != null && forcedDialog.isShowing()) || (updaterObj != null && updaterObj.running())) return;
        SharedPreferences p = prefs();
        if (p.getInt("upd_need_build", 0) <= versionCode()) return;
        forcedDialog = new AlertDialog.Builder(this)
                .setTitle("Нужно обновить MKW Music")
                .setMessage("Вышла версия " + p.getString("upd_need_ver", "") + ". Старая больше не поддерживается: скачайте новую и "
                        + "откройте файл — она встанет поверх, вход и данные сохранятся.")
                .setCancelable(false)
                .setPositiveButton("Обновить", (d, w) -> updater().start(p.getString("upd_need_ver", ""), false, true))
                .show();
    }

    // Странице нужно знать, видит ли человек приложение на самом деле: пока играет музыка, WebView «думает», что он на экране
    // (иначе звук встанет на паузу), и без этой подсказки сообщения и звонки в фоне не показывались бы уведомлением.
    @Override
    protected void onStart() {
        super.onStart();
        runJs("window.__mkwFg=true;window.dispatchEvent(new Event('mkw-fg'))");
    }

    @Override
    protected void onStop() {
        super.onStop();
        runJs("window.__mkwFg=false;window.dispatchEvent(new Event('mkw-fg'))");
        // после звонка приложение не должно оставаться поверх экрана блокировки
        try { if (android.os.Build.VERSION.SDK_INT >= 27) setShowWhenLocked(false); } catch (Exception ignored) { /* не критично */ }
    }

    /** Android 14+: если звонки на весь экран выключены — один раз объясняем и предлагаем включить. */
    private void askFullScreenOnce() {
        if (isFinishing() || Notifier.fullScreenOk(this) || !Notifier.enabled(this)) return;
        android.content.SharedPreferences p = getSharedPreferences("mkw", MODE_PRIVATE);
        if (p.getBoolean("fsiAsked", false)) return;
        p.edit().putBoolean("fsiAsked", true).apply();
        new AlertDialog.Builder(this)
                .setTitle("Звонки на весь экран")
                .setMessage("Чтобы входящий звонок от друга открывался на весь экран, как обычный звонок, даже на заблокированном телефоне — разрешите это MKW. Иначе звонок придёт простым уведомлением.")
                .setPositiveButton("Включить", (d, w) -> Notifier.openFullScreenSettings(this))
                .setNegativeButton("Не сейчас", null)
                .show();
    }

    /** Открыли по входящему звонку: показываем поверх экрана блокировки и включаем экран. */
    private void wakeForCall(Intent i) {
        if (i == null || !i.getBooleanExtra("call", false)) return;
        try {
            if (android.os.Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true); }
            else getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        } catch (Exception ignored) { /* не критично */ }
        i.removeExtra("call");
        Notifier.cancelCalls(this);
    }

    @Override
    protected void onResume() {
        super.onResume();
        runJs("window.__mkwFsi=" + Notifier.fullScreenOk(this) + ";window.dispatchEvent(new Event('mkw-fsi'))");
        if (root != null) root.postDelayed(this::askFullScreenOnce, 6000);
        wakeForCall(getIntent());
        if (updaterObj != null) updaterObj.onResume(updVersion.isEmpty() ? prefs().getString("upd_need_ver", "") : updVersion,
                prefs().getInt("upd_need_build", 0) > versionCode());
        Notifier.cancelCalls(this);
        showForced();
        if (root != null) root.postDelayed(this::checkUpdate, 3000);
    }

    private void checkUpdate() {
        if (isFinishing() || setupShowing) return;
        SharedPreferences p = prefs();
        long now = System.currentTimeMillis();
        if (now - p.getLong("upd_last", 0) < UPDATE_EVERY_MS) return;
        p.edit().putLong("upd_last", now).apply();
        final String current = versionName();
        UpdateChecker.check(current, versionCode(), (version, build, forced) -> runOnUiThread(() -> {
            if (isFinishing()) return;
            if (forced) {
                p.edit().putInt("upd_need_build", build > 0 ? build : versionCode() + 1).putString("upd_need_ver", version).apply();
                showForced();
                return;
            }
            String key = version + "#" + build;
            updVersion = version;
            // на Wi-Fi обновление скачивается само и тихо — останется только нажать «Установить»
            if (offline().unmetered()) { updater().start(version, true, false); return; }
            if (key.equals(p.getString("upd_skip", ""))) return;
            new AlertDialog.Builder(this)
                    .setTitle("Вышла новая версия " + version)
                    .setMessage("Скачайте её и откройте файл — она встанет поверх, вход и данные сохранятся.")
                    .setPositiveButton("Обновить", (d, w) -> updater().start(version, false, false))
                    .setNegativeButton("Позже", (d, w) -> p.edit().putString("upd_skip", key).apply())
                    .show();
        }));
    }

    /** Ручная проверка из настроек: всегда отвечает — либо предлагает скачать, либо говорит, что версия последняя. */
    private void checkUpdateNow() {
        final String current = versionName();
        android.widget.Toast.makeText(this, "Проверяем обновления…", android.widget.Toast.LENGTH_SHORT).show();
        UpdateChecker.check(current, versionCode(), new UpdateChecker.Callback() {
            @Override
            public void onNewer(String version, int build, boolean forced) {
                runOnUiThread(() -> {
                    if (isFinishing()) return;
                    new AlertDialog.Builder(MainActivity.this)
                            .setTitle("Вышла новая версия " + version)
                            .setMessage("У вас " + current + ". Скачайте новую и откройте файл — она встанет поверх, вход и данные сохранятся.")
                            .setPositiveButton("Обновить", (d, w) -> updater().start(version, false, forced))
                            .setNegativeButton("Позже", null)
                            .show();
                });
            }

            @Override
            public void onNone(boolean error) {
                runOnUiThread(() -> {
                    if (isFinishing()) return;
                    android.widget.Toast.makeText(MainActivity.this,
                            error ? "Не получилось проверить. Проверьте интернет и попробуйте ещё раз"
                                    : "У вас последняя версия — " + current,
                            android.widget.Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    /** Экран 120 Гц: просим самый плавный режим, который умеет дисплей (иначе WebView может остаться на 60). */
    private void preferSmoothDisplay() {
        try {
            android.view.Display d = getWindowManager().getDefaultDisplay();
            android.view.Display.Mode cur = d.getMode(), best = cur;
            for (android.view.Display.Mode m : d.getSupportedModes()) {
                if (m.getPhysicalWidth() == cur.getPhysicalWidth() && m.getPhysicalHeight() == cur.getPhysicalHeight()
                        && m.getRefreshRate() > best.getRefreshRate()) best = m;
            }
            android.view.WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.preferredDisplayModeId = best.getModeId();
            getWindow().setAttributes(lp);
        } catch (Exception ignored) {
            // не получилось — остаётся режим по умолчанию
        }
    }

    // ---------- окно ----------

    private void hideCustomView() {
        if (customView == null) return;
        root.removeView(customView);
        customView = null;
        web.setVisibility(View.VISIBLE);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        if (customCallback != null) {
            customCallback.onCustomViewHidden();
            customCallback = null;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILE || fileCallback == null) return;
        // выбор нескольких фото (Google Фото, «Готово») приходит списком ClipData — стандартный разбор его не видит
        Uri[] res = null;
        if (resultCode == RESULT_OK && data != null) {
            android.content.ClipData cd = data.getClipData();
            if (cd != null && cd.getItemCount() > 0) {
                java.util.ArrayList<Uri> l = new java.util.ArrayList<>();
                for (int i = 0; i < cd.getItemCount(); i++) { Uri u = cd.getItemAt(i).getUri(); if (u != null) l.add(u); }
                if (!l.isEmpty()) res = l.toArray(new Uri[0]);
            }
            if (res == null && data.getData() != null) res = new Uri[] { data.getData() };
        }
        fileCallback.onReceiveValue(res);
        fileCallback = null;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (customView != null) {
            hideCustomView();
        } else if (web.canGoBack()) {
            web.goBack();
        } else {
            // не закрываем приложение: музыка продолжит играть
            moveTaskToBack(true);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        if (current == this) current = null;
        if (isFinishing()) PlaybackService.stop();
        if (btHelper != null) { btHelper.release(); btHelper = null; }
        if (fileCallback != null) {
            fileCallback.onReceiveValue(null);
            fileCallback = null;
        }
        root.removeAllViews();
        web.destroy();
        super.onDestroy();
    }

    // ---------- вспомогательное ----------

    private SharedPreferences prefs() {
        return getSharedPreferences("mkw", MODE_PRIVATE);
    }

    private String startUrl(Intent intent) {
        return HOME;
    }

    private static String clip(String s, int n) {
        return s.length() > n ? s.substring(0, n) : s;
    }

    private static boolean isOurs(Uri uri) {
        if (uri == null || !"https".equals(uri.getScheme())) return false;
        String host = uri.getHost();
        return host != null && (host.equals("mkwmusic.ru") || host.endsWith(".mkwmusic.ru"));
    }

    private void openExternal(Uri uri) {
        try {
            if ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) {
                // именно браузер, а не наше приложение
                Intent i = Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_BROWSER);
                i.setData(uri);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
            } else {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            }
        } catch (Exception e) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (Exception ignored) {
                // нечем открыть — ничего не делаем
            }
        }
    }

    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "0";
        }
    }

    private static final String OFFLINE_HTML = "<!doctype html><html><head><meta charset=\"utf-8\">"
            + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            + "<style>html,body{height:100%;margin:0;background:#0d0a0b;color:#f3e9ee;"
            + "font-family:sans-serif}body{display:flex;flex-direction:column;align-items:center;"
            + "justify-content:center;text-align:center;padding:24px;box-sizing:border-box}"
            + "h1{font-size:22px;margin:0 0 8px}p{opacity:.7;margin:0 0 24px;max-width:320px}"
            + "a{background:#a8326a;color:#fff;text-decoration:none;padding:12px 28px;border-radius:999px;"
            + "font-weight:600}</style></head><body><h1>Нет соединения</h1>"
            + "<p>Не получилось открыть MKW Music. Проверьте интернет и попробуйте ещё раз.</p>"
            + "<a href=\"https://mkwmusic.ru/\">Повторить</a></body></html>";
}
