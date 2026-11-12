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
            o.put("batt", batteryTemp(a));
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
        int s = 0;
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
                if (pm != null) s = pm.getCurrentThermalStatus();
            }
        } catch (Exception ignored) {
            // на части прошивок статус недоступен
        }
        // Huawei, Honor и часть других оболочек не сообщают нагрев через Android (всегда «норма») —
        // поэтому смотрим и на температуру батареи: она есть на любом телефоне
        int t = batteryTemp(c);
        int b = t >= 460 ? 3 : t >= 420 ? 2 : t >= 390 ? 1 : 0;
        return Math.max(s, b);
    }

    /** Температура батареи в десятых долях градуса (415 = 41,5 °C), 0 — неизвестно. */
    static int batteryTemp(Context c) {
        try {
            android.content.Intent i = c.registerReceiver(null, new android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED));
            return i == null ? 0 : i.getIntExtra(android.os.BatteryManager.EXTRA_TEMPERATURE, 0);
        } catch (Exception e) {
            return 0;
        }
    }

    // ---------- проверка устройства (js/diag.js): снимок раз в 5 секунд ----------

    /** Самая горячая из датчиков процессора, °C×10 (0 — система не даёт их читать). */
    static int cpuTemp() {
        int best = 0;
        for (int i = 0; i < 80; i++) {
            String type = readLine("/sys/class/thermal/thermal_zone" + i + "/type");
            if (type == null) { if (i > 4) break; else continue; }
            String t = type.toLowerCase(java.util.Locale.ROOT);
            if (!(t.contains("cpu") || t.contains("soc") || t.contains("tsens") || t.contains("apc") || t.contains("gpu") || t.contains("big") || t.contains("little"))) continue;
            String v = readLine("/sys/class/thermal/thermal_zone" + i + "/temp");
            if (v == null) continue;
            try {
                long raw = Long.parseLong(v.trim());
                int c10 = (int) (raw > 1000 ? raw / 100 : raw * 10);
                if (c10 > 150 && c10 < 1300) best = Math.max(best, c10);
            } catch (Exception ignored) { /* не число */ }
        }
        return best;
    }

    /** Текущая частота ядер относительно максимальной, % (−1 — не читается). Сильно ниже 100 при нагрузке — телефон сбрасывает частоты. */
    static int[] cpuFreq(int cores) {
        long cur = 0, max = 0; int n = 0; long top = 0;
        for (int i = 0; i < Math.min(cores, 16); i++) {
            String c = readLine("/sys/devices/system/cpu/cpu" + i + "/cpufreq/scaling_cur_freq");
            String m = readLine("/sys/devices/system/cpu/cpu" + i + "/cpufreq/cpuinfo_max_freq");
            String lim = readLine("/sys/devices/system/cpu/cpu" + i + "/cpufreq/scaling_max_freq");
            try {
                if (c != null && m != null) { cur += Long.parseLong(c.trim()); max += Long.parseLong(m.trim()); n++; }
                if (lim != null && m != null) top = Math.max(top, Long.parseLong(lim.trim()) * 100 / Math.max(1, Long.parseLong(m.trim())));
            } catch (Exception ignored) { /* ядро выключено */ }
        }
        return new int[] { n > 0 && max > 0 ? (int) (cur * 100 / max) : -1, n > 0 ? (int) top : -1 };
    }

    private static String readLine(String path) {
        try (BufferedReader r = new BufferedReader(new FileReader(path))) { return r.readLine(); } catch (Exception e) { return null; }
    }

    static JSONObject diag(Activity a) {
        JSONObject o = new JSONObject();
        try {
            o.put("t", System.currentTimeMillis());
            o.put("batt", batteryTemp(a));
            o.put("cpu", cpuTemp());
            o.put("thermal", thermal(a));
            int cores = Runtime.getRuntime().availableProcessors();
            int[] f = cpuFreq(cores);
            o.put("freq", f[0]);
            o.put("cap", f[1]);
            o.put("appCpu", android.os.Process.getElapsedCpuTime());
            ActivityManager am = (ActivityManager) a.getSystemService(Context.ACTIVITY_SERVICE);
            ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
            am.getMemoryInfo(mi);
            o.put("free", mi.availMem / (1024L * 1024L));
            o.put("lowMem", mi.lowMemory);
            o.put("saver", powerSave(a));
            android.content.Intent b = a.registerReceiver(null, new android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED));
            if (b != null) {
                int st = b.getIntExtra(android.os.BatteryManager.EXTRA_STATUS, -1);
                o.put("charging", st == android.os.BatteryManager.BATTERY_STATUS_CHARGING || st == android.os.BatteryManager.BATTERY_STATUS_FULL);
                int lvl = b.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1), sc = b.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, 100);
                o.put("level", lvl >= 0 ? lvl * 100 / Math.max(1, sc) : -1);
            }
            try { o.put("hzNow", Math.round(a.getWindowManager().getDefaultDisplay().getRefreshRate())); } catch (Exception ignored) { /* нет */ }
            o.put("model", Build.MODEL);
            o.put("maker", Build.MANUFACTURER);
            o.put("sdk", Build.VERSION.SDK_INT);
            o.put("emui", sysProp("ro.build.version.emui"));
            o.put("harmony", sysProp("hw_sc.build.platform.version"));
            o.put("gms", PushService.hasGms(a));
            try {
                if (Build.VERSION.SDK_INT >= 26) {
                    PackageInfo p = WebView.getCurrentWebViewPackage();
                    if (p != null) { o.put("wvPkg", p.packageName); o.put("wvVer", p.versionName); }
                }
            } catch (Exception ignored) { /* нет */ }
        } catch (Exception ignored) {
            // что успели — то и отдаём
        }
        return o;
    }

    private static String sysProp(String key) {
        try {
            Class<?> c = Class.forName("android.os.SystemProperties");
            Object v = c.getMethod("get", String.class).invoke(null, key);
            return v == null ? "" : String.valueOf(v);
        } catch (Exception e) {
            return "";
        }
    }
}
