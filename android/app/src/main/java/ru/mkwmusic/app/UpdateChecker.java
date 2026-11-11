package ru.mkwmusic.app;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Спрашивает у GitHub, не вышла ли версия новее установленной (читает «Версия приложения: X» из описания релиза). */
final class UpdateChecker {
    static final String APK_URL = "https://github.com/milokwela/MKW-Music/releases/latest/download/MKW-Music.apk";
    private static final String API = "https://api.github.com/repos/milokwela/MKW-Music/releases/tags/android-beta";
    private static final Pattern VER = Pattern.compile("Версия приложения: ([0-9]+(?:\\.[0-9]+)*)");

    interface Callback {
        void onNewer(String version, int build, boolean forced);

        /** Новой версии нет (error = не удалось проверить). Нужно только для ручной проверки. */
        default void onNone(boolean error) { }
    }

    private UpdateChecker() { }

    static void check(final String current, final int currentBuild, final Callback cb) {
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(API).openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(8000);
                c.setRequestProperty("Accept", "application/vnd.github+json");
                c.setRequestProperty("User-Agent", "MKWApp/" + current);
                if (c.getResponseCode() != 200) { cb.onNone(true); return; }
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                try (InputStream in = c.getInputStream()) {
                    byte[] buf = new byte[4096];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        if (out.size() > 512 * 1024) { cb.onNone(true); return; }
                    }
                }
                String body = new JSONObject(out.toString("UTF-8")).optString("body", "");
                Matcher m = VER.matcher(body);
                if (!m.find()) { cb.onNone(true); return; }
                String ver = m.group(1);
                int build = 0;
                Matcher b = java.util.regex.Pattern.compile("сборка #([0-9]+)").matcher(body);
                if (b.find()) build = num(b.group(1));
                // новее — если больше номер версии или та же версия, но более свежая сборка
                boolean isNewer = newer(ver, current) || (!newer(current, ver) && build > currentBuild && currentBuild > 0);
                if (isNewer) cb.onNewer(ver, build, body.contains("Обязательное обновление: да"));
                else cb.onNone(false);
            } catch (Exception ignored) {
                // нет сети или лимит GitHub — проверим в другой раз
                cb.onNone(true);
            }
        }).start();
    }

    /** true, если версия a новее версии b (сравнение по числам: 0.10.0 новее 0.9.0). */
    static boolean newer(String a, String b) {
        String[] x = a.split("\\.");
        String[] y = b.split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int p = i < x.length ? num(x[i]) : 0;
            int q = i < y.length ? num(y[i]) : 0;
            if (p != q) return p > q;
        }
        return false;
    }

    private static int num(String s) {
        try {
            return Integer.parseInt(s.replaceAll("[^0-9]", ""));
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
