package ru.mkwmusic.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Обновление прямо в приложении: скачивает новую версию с GitHub и сразу открывает установщик Android
 * («Обновить» — одно нажатие). Без браузера и поиска файла в «Загрузках».
 */
final class Updater {
    private static final String TAG = "MKWUpdate";
    private final Activity act;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private volatile boolean running;
    private AlertDialog dlg;
    private ProgressBar bar;
    private TextView txt;
    private boolean installWhenAllowed;

    Updater(Activity a) { act = a; }

    boolean running() { return running; }

    /** silent=true — качаем молча (на Wi-Fi), потом спрашиваем «Установить». forced — окно нельзя закрыть. */
    void start(final String version, final boolean silent, final boolean forced) {
        if (running) { if (!silent) showProgress(version, forced); return; }
        File f = ApkProvider.file(act);
        if (fresh(f, version)) { askInstall(version, forced); return; }
        running = true;
        if (!silent) showProgress(version, forced);
        new Thread(() -> {
            boolean ok = false;
            try { ok = download(f); } catch (Exception e) { Log.w(TAG, "download", e); }
            final boolean done = ok && fresh(f, version);
            running = false;
            ui.post(() -> {
                if (dlg != null) { try { dlg.dismiss(); } catch (Exception ignored) { /* окно уже закрыто */ } dlg = null; }
                if (act.isFinishing()) return;
                if (done) askInstall(version, forced);
                else if (!silent) fail(version, forced);
            });
        }).start();
    }

    /** Скачанный файл — это MKW, и он новее установленного. */
    private boolean fresh(File f, String version) {
        if (!f.exists() || f.length() < 500_000) return false;
        try {
            PackageInfo pi = act.getPackageManager().getPackageArchiveInfo(f.getPath(), 0);
            PackageInfo me = act.getPackageManager().getPackageInfo(act.getPackageName(), 0);
            if (pi == null || !act.getPackageName().equals(pi.packageName)) return false;
            long a = Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
            long b = Build.VERSION.SDK_INT >= 28 ? me.getLongVersionCode() : me.versionCode;
            return a > b;
        } catch (Exception e) {
            return false;
        }
    }

    private boolean download(File to) throws Exception {
        //noinspection ResultOfMethodCallIgnored
        to.getParentFile().mkdirs();
        File tmp = new File(to.getPath() + ".part");
        HttpURLConnection c = (HttpURLConnection) new URL(UpdateChecker.APK_URL).openConnection();
        c.setInstanceFollowRedirects(true);
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        try {
            if (c.getResponseCode() != 200) return false;
            long len = c.getContentLengthLong(), n = 0;
            try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(tmp)) {
                byte[] buf = new byte[64 * 1024];
                int r;
                while ((r = in.read(buf)) > 0) {
                    out.write(buf, 0, r);
                    n += r;
                    if (n > 80L * 1024 * 1024) return false;
                    final int pct = len > 0 ? (int) (n * 100 / len) : -1;
                    final long got = n;
                    ui.post(() -> progress(pct, got));
                }
            }
            return tmp.renameTo(to);
        } finally {
            c.disconnect();
            if (tmp.exists()) { //noinspection ResultOfMethodCallIgnored
                tmp.delete(); }
        }
    }

    private void showProgress(String version, boolean forced) {
        if (act.isFinishing() || (dlg != null && dlg.isShowing())) return;
        LinearLayout box = new LinearLayout(act);
        box.setOrientation(LinearLayout.VERTICAL);
        int p = (int) (22 * act.getResources().getDisplayMetrics().density);
        box.setPadding(p, p / 2, p, 0);
        bar = new ProgressBar(act, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.setIndeterminate(true);
        txt = new TextView(act);
        txt.setText("Скачиваю…");
        txt.setPadding(0, p / 3, 0, 0);
        box.addView(bar);
        box.addView(txt);
        dlg = new AlertDialog.Builder(act)
                .setTitle("Обновляю до " + version)
                .setView(box)
                .setCancelable(!forced)
                .setNegativeButton(forced ? null : "Скрыть", null)
                .show();
    }

    private void progress(int pct, long got) {
        if (bar == null || dlg == null || !dlg.isShowing()) return;
        if (pct >= 0) { bar.setIndeterminate(false); bar.setProgress(pct); }
        txt.setText(String.format(java.util.Locale.ROOT, "Скачано %.1f МБ%s", got / 1048576.0, pct >= 0 ? " · " + pct + "%" : ""));
    }

    private void fail(String version, boolean forced) {
        new AlertDialog.Builder(act)
                .setTitle("Не получилось скачать")
                .setMessage("Проверьте интернет и попробуйте ещё раз.")
                .setCancelable(!forced)
                .setPositiveButton("Ещё раз", (d, w) -> start(version, false, forced))
                .setNegativeButton(forced ? null : "Позже", null)
                .show();
    }

    private void askInstall(String version, boolean forced) {
        if (act.isFinishing()) return;
        new AlertDialog.Builder(act)
                .setTitle("Обновление " + version + " готово")
                .setMessage(forced ? "Это обязательное обновление: старая версия больше не работает. Нажмите «Установить» — Android спросит подтверждение. Вход, лайки и музыка сохранятся."
                        : "Хотите установить? Это необязательно — можно остаться на своей версии. Вход, лайки и музыка сохранятся.")
                .setCancelable(!forced)
                .setPositiveButton("Установить", (d, w) -> install(version, forced))
                .setNegativeButton(forced ? null : "Нет, остаться", (d, w) -> act.getSharedPreferences("mkw", android.content.Context.MODE_PRIVATE).edit()
                        .putString("upd_skip_ver", version).apply())
                .show();
    }

    /** Открыть установщик. Если Android ещё не разрешил MKW ставить обновления — сначала ведём в эту настройку. */
    void install(String version, boolean forced) {
        if (Build.VERSION.SDK_INT >= 26 && !act.getPackageManager().canRequestPackageInstalls()) {
            installWhenAllowed = true;
            new AlertDialog.Builder(act)
                    .setTitle("Разрешите обновления")
                    .setMessage("Один раз: на следующем экране включите «Разрешить установку из этого источника» и вернитесь назад. Дальше MKW будет обновляться сам.")
                    .setCancelable(!forced)
                    .setPositiveButton("Открыть", (d, w) -> {
                        try {
                            act.startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                    Uri.parse("package:" + act.getPackageName())));
                        } catch (Exception e) { Log.w(TAG, "settings", e); }
                    })
                    .show();
            return;
        }
        installWhenAllowed = false;
        try {
            Intent i = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(ApkProvider.uri(act), "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(i);
        } catch (Exception e) {
            Log.w(TAG, "install", e);
            fail(version, forced);
        }
    }

    /** Вернулись из настроек «Разрешить установку» — продолжаем сами. */
    void onResume(String version, boolean forced) {
        if (!installWhenAllowed) return;
        if (Build.VERSION.SDK_INT >= 26 && act.getPackageManager().canRequestPackageInstalls()) install(version, forced);
    }
}
