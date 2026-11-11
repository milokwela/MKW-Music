package ru.mkwmusic.app;

import android.content.Context;
import android.webkit.WebResourceResponse;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;

/**
 * Чтобы MKW открывался без интернета: страница, код сайта нужной версии и библиотека Firebase
 * один раз сохраняются в память приложения. Неизменные файлы (с версией в адресе) потом берутся отсюда — так ещё и быстрее.
 */
final class ShellCache {
    private final File dir;

    ShellCache(Context c) {
        dir = new File(c.getFilesDir(), "shell");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
    }

    private static String key(String url) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            StringBuilder sb = new StringBuilder();
            for (byte b : md.digest(url.getBytes("UTF-8"))) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return String.valueOf(url.hashCode());
        }
    }

    /** Неизменный файл: есть копия — отдаём её, нет — скачиваем, сохраняем и отдаём. */
    WebResourceResponse immutable(String url, String type) {
        File f = new File(dir, key(url));
        try {
            if (!f.exists() || f.length() == 0) {
                if (!get(url, f)) return null;
                trim();
            }
            Map<String, String> h = new HashMap<>();
            h.put("Access-Control-Allow-Origin", "*");
            h.put("Cache-Control", "public, max-age=31536000, immutable");
            return new WebResourceResponse(type, "utf-8", 200, "OK", h, new FileInputStream(f));
        } catch (Exception e) {
            return null;
        }
    }

    /** Свежая копия главной страницы — на случай запуска без интернета. */
    void saveIndex(String url) {
        new Thread(() -> {
            try { get(url, new File(dir, "index.html")); } catch (Exception ignored) { /* в другой раз */ }
        }).start();
    }

    String index() {
        File f = new File(dir, "index.html");
        if (!f.exists()) return null;
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] b = new byte[(int) Math.min(f.length(), 2 * 1024 * 1024)];
            int n = in.read(b);
            return n > 0 ? new String(b, 0, n, "UTF-8") : null;
        } catch (Exception e) {
            return null;
        }
    }

    private boolean get(String url, File to) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(15000);
        File tmp = new File(to.getPath() + ".part");
        try {
            if (c.getResponseCode() != 200) return false;
            try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(tmp)) {
                byte[] buf = new byte[32 * 1024];
                int r;
                long n = 0;
                while ((r = in.read(buf)) > 0) { out.write(buf, 0, r); n += r; if (n > 8L * 1024 * 1024) return false; }
            }
            return tmp.renameTo(to);
        } finally {
            c.disconnect();
            if (tmp.exists()) { //noinspection ResultOfMethodCallIgnored
                tmp.delete(); }
        }
    }

    /** Старые версии кода не копим: держим не больше 40 файлов, самые давние удаляем. */
    private void trim() {
        File[] fs = dir.listFiles((d, n) -> !n.equals("index.html") && !n.endsWith(".part"));
        if (fs == null || fs.length <= 40) return;
        java.util.Arrays.sort(fs, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
        for (int i = 0; i < fs.length - 40; i++) { //noinspection ResultOfMethodCallIgnored
            fs[i].delete(); }
    }
}
