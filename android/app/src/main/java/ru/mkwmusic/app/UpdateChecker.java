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
    static final String APK_URL = "https://github.com/milokwela/MKW-Music/releases/latest/download/MKW-Music-beta.apk";
    private static final String API = "https://api.github.com/repos/milokwela/MKW-Music/releases/tags/android-beta";
    private static final Pattern VER = Pattern.compile("Версия приложения: ([0-9]+(?:\\.[0-9]+)*)");

    interface Callback {
        void onNewer(String version);
    }

    private UpdateChecker() { }

    static void check(final String current, final Callback cb) {
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(API).openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(8000);
                c.setRequestProperty("Accept", "application/vnd.github+json");
                c.setRequestProperty("User-Agent", "MKWApp/" + current);
                if (c.getResponseCode() != 200) return;
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                try (InputStream in = c.getInputStream()) {
                    byte[] buf = new byte[4096];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        if (out.size() > 512 * 1024) return;
                    }
                }
                String body = new JSONObject(out.toString("UTF-8")).optString("body", "");
                Matcher m = VER.matcher(body);
                if (m.find() && newer(m.group(1), current)) cb.onNewer(m.group(1));
            } catch (Exception ignored) {
                // нет сети или лимит GitHub — проверим в другой раз
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
