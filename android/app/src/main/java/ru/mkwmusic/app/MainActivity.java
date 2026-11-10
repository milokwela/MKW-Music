package ru.mkwmusic.app;

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

        root.post(this::firstRunSetup);
        root.postDelayed(this::checkUpdate, 5000);
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
                    v.loadDataWithBaseURL(null, OFFLINE_HTML, "text/html", "UTF-8", null);
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
            if (!"GET".equals(request.getMethod()) || !isOurs(u)) return null;
            String path = u.getPath();
            if (path == null || !LOCAL_IMG.matcher(path).matches()) return null;
            InputStream in = getAssets().open("site" + path);
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "public, max-age=86400");
            return new WebResourceResponse("image/webp", null, 200, "OK", headers, in);
        } catch (IOException e) {
            return null; // такого файла в приложении нет — берём с сайта
        }
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
                    if (data == null || data.length() > 16384) return;
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
                        art.startsWith("https://") ? art : "", o.optBoolean("playing", false));
                break;
            case "notify":
                Notifier.message(this, clip(o.optString("title", ""), 120), clip(o.optString("body", ""), 400),
                        clip(o.optString("tag", ""), 64));
                break;
            case "perm":
                requestNotifications(null);
                break;
            case "handoff":
                startHandoff();
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

    private void checkUpdate() {
        if (isFinishing() || setupShowing) return;
        SharedPreferences p = prefs();
        long now = System.currentTimeMillis();
        if (now - p.getLong("upd_last", 0) < UPDATE_EVERY_MS) return;
        p.edit().putLong("upd_last", now).apply();
        final String current = versionName();
        UpdateChecker.check(current, version -> runOnUiThread(() -> {
            if (isFinishing()) return;
            if (version.equals(p.getString("upd_skip", ""))) return;
            new AlertDialog.Builder(this)
                    .setTitle("Вышла новая версия " + version)
                    .setMessage("У вас установлена " + current + ". Скачайте новую и откройте файл — она встанет поверх, "
                            + "вход и данные сохранятся.\n\nФайл берётся с официальной страницы проекта на GitHub.")
                    .setPositiveButton("Скачать", (d, w) -> openExternal(Uri.parse(UpdateChecker.APK_URL)))
                    .setNegativeButton("Позже", (d, w) -> p.edit().putString("upd_skip", version).apply())
                    .show();
        }));
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
        fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
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
