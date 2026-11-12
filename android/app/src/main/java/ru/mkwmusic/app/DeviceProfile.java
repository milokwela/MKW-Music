package ru.mkwmusic.app;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.PowerManager;
import android.view.Display;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.FileReader;

/**
 * Что за телефон: память, процессор, экран, версия WebView. По этим данным интерфейс выбирает,
 * с каким качеством графики стартовать (дальше он сам подстраивается по реальной плавности, см. js/quality.js на сайте).
 * Ничего личного здесь нет: только характеристики железа, и они никуда не отправляются.
 */
final class DeviceProfile {
    private DeviceProfile() { }

    /** 0 — слабый, 1 — средний, 2 — мощный. */
    static int tier(long ramMb, boolean lowRam, int cores, int maxKhz) {
        if (lowRam || ramMb < 4600 || cores <= 4 || (maxKhz > 0 && maxKhz < 2050000) || Build.VERSION.SDK_INT < 28) return 0;
        if (ramMb < 6600 || (maxKhz > 0 && maxKhz < 2450000)) return 1;
        return 2;
    }

    static JSONObject read(Activity a) {
        JSONObject o = new JSONObject();
        try {
            ActivityManager am = (ActivityManager) a.getSystemService(Context.ACTIVITY_SERVICE);
            ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
            am.getMemoryInfo(mi);
            long ramMb = mi.totalMem / (1024L * 1024L);
            boolean lowRam = am.isLowRamDevice();
            int cores = Runtime.getRuntime().availableProcessors();
            int khz = maxCpuKhz(cores);
            o.put("ram", ramMb);
            o.put("lowRam", lowRam);
            o.put("cores", cores);
            o.put("khz", khz);
            o.put("tier", tier(ramMb, lowRam, cores, khz));
            o.put("sdk", Build.VERSION.SDK_INT);
            o.put("hz", Math.round(maxRefresh(a)));
            o.put("wv", webViewMajor());
            o.put("brand", String.valueOf(Build.MANUFACTURER).toLowerCase(java.util.Locale.ROOT));
            o.put("saver", powerSave(a));
            o.put("thermal", thermal(a));
        } catch (Exception ignored) {
            // без профиля сайт определит всё сам
        }
        return o;
    }

    /** Самая высокая частота среди ядер, кГц (0 — узнать не удалось: на части прошивок файл закрыт). */
    private static int maxCpuKhz(int cores) {
        int best = 0;
        for (int i = 0; i < Math.min(cores, 16); i++) {
            try (BufferedReader r = new BufferedReader(new FileReader("/sys/devices/system/cpu/cpu" + i + "/cpufreq/cpuinfo_max_freq"))) {
                String line = r.readLine();
                if (line != null) best = Math.max(best, Integer.parseInt(line.trim()));
            } catch (Exception ignored) {
                // это ядро не читается — берём остальные
            }
        }
        return best;
    }

    static float maxRefresh(Activity a) {
        float best = 60f;
        try {
            Display d = a.getWindowManager().getDefaultDisplay();
            Display.Mode cur = d.getMode();
            best = cur.getRefreshRate();
            for (Display.Mode m : d.getSupportedModes()) {
                if (m.getPhysicalWidth() == cur.getPhysicalWidth() && m.getPhysicalHeight() == cur.getPhysicalHeight()
                        && m.getRefreshRate() > best) best = m.getRefreshRate();
            }
        } catch (Exception ignored) {
            // остаётся 60
        }
        return best;
    }

    /** Версия движка страниц (Android System WebView). На очень старом движке сайт выглядит и работает хуже. */
    static int webViewMajor() {
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                PackageInfo p = WebView.getCurrentWebViewPackage();
                if (p != null && p.versionName != null) {
                    String v = p.versionName;
                    int dot = v.indexOf('.');
                    return Integer.parseInt(dot > 0 ? v.substring(0, dot) : v);
                }
            }
        } catch (Exception ignored) {
            // версию узнает сама страница из своего User-Agent
        }
        return 0;
    }

    static boolean powerSave(Context c) {
        try {
            PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
            return pm != null && pm.isPowerSaveMode();
        } catch (Exception e) {
            return false;
        }
    }

    /** Нагрев: 0 — норма, 1 — слегка тёплый, 2 — тёплый, 3+ — горячий (Android 10+, иначе всегда 0). */
    static int thermal(Context c) {
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
                if (pm != null) return pm.getCurrentThermalStatus();
            }
        } catch (Exception ignored) {
            // на части прошивок статус недоступен
        }
        return 0;
    }
}
