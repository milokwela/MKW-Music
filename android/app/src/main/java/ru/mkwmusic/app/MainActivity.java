package ru.mkwmusic.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/**
 * MKW Music для Android (beta): тонкая оболочка вокруг https://mkwmusic.ru.
 * Всё приложение живёт на сайте и обновляется вместе с ним; здесь только окно, камера/микрофон
 * (когда их просит сам сайт) и выбор файлов. Страницы других сайтов открываются в браузере.
 */
public class MainActivity extends Activity {
    private static final String HOME = "https://mkwmusic.ru/";
    private static final int BG = 0xFF0D0A0B;
    private static final int REQ_FILE = 1001;
    private static final int REQ_PERM = 1002;

    private FrameLayout root;
    private WebView web;

    private ValueCallback<Uri[]> fileCallback;

    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;

    private PermissionRequest pendingRequest;
    private String[] pendingResources;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        root.setFitsSystemWindows(true);
        setContentView(root);

        web = new WebView(this);
        web.setBackgroundColor(BG);
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        configure(web);

        boolean restored = savedInstanceState != null && web.restoreState(savedInstanceState) != null;
        if (!restored) {
            web.loadUrl(startUrl(getIntent()));
        }
    }

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

        // Файлы вроде MP3 скачиваются через браузер; «внутренние» blob-ссылки приложение пока скачать не умеет.
        view.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (url != null && url.startsWith("https://")) {
                openExternal(Uri.parse(url));
            } else {
                Toast.makeText(this, "Скачивание файлов в приложении пока не работает (beta)", Toast.LENGTH_LONG).show();
            }
        });
    }

    // ---------- камера и микрофон: только для нашего сайта и только после вашего «Разрешить» ----------

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
        if (granted.isEmpty()) {
            request.deny();
        } else {
            request.grant(granted.toArray(new String[0]));
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
        fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
        fileCallback = null;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Uri data = intent.getData();
        if (data != null && isOurs(data)) web.loadUrl(data.toString());
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
        if (fileCallback != null) {
            fileCallback.onReceiveValue(null);
            fileCallback = null;
        }
        root.removeAllViews();
        web.destroy();
        super.onDestroy();
    }

    // ---------- вспомогательное ----------

    private String startUrl(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        return data != null && isOurs(data) ? data.toString() : HOME;
    }

    private static boolean isOurs(Uri uri) {
        if (uri == null || !"https".equals(uri.getScheme())) return false;
        String host = uri.getHost();
        return host != null && (host.equals("mkwmusic.ru") || host.endsWith(".mkwmusic.ru"));
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
            // нечем открыть — ничего не делаем
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
