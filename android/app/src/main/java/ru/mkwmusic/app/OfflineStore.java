package ru.mkwmusic.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.os.StatFs;
import android.util.Log;
import android.webkit.WebResourceResponse;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Офлайн-музыка: звук скачанных треков лежит во внутренней памяти приложения (другие приложения его не видят).
 * Плеер на странице просит адрес https://mkwmusic.ru/__offline/<id> — его отдаём отсюда, с поддержкой перемотки (Range).
 */
final class OfflineStore {
    private static final String TAG = "MKWOffline";
    private static final long MIN_BYTES = 120 * 1024;       // меньше — это не песня, а ошибка или заглушка
    private static final long MAX_BYTES = 60L * 1024 * 1024; // больше — что-то не то (видео, часовой микс)

    private final Context app;
    private final File dir;
    private final ExecutorService pool = Executors.newSingleThreadExecutor();
    private JSONObject meta;
    private volatile String busy = "";

    interface Report { void send(String js); }
    private final Report report;

    OfflineStore(Context c, Report r) {
        app = c.getApplicationContext();
        dir = new File(app.getFilesDir(), "offline");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        report = r;
        meta = load();
    }

    private JSONObject load() {
        try (FileInputStream in = new FileInputStream(new File(dir, "meta.json"))) {
            byte[] b = new byte[(int) Math.min(4 * 1024 * 1024, new File(dir, "meta.json").length())];
            int n = in.read(b);
            return new JSONObject(new String(b, 0, Math.max(0, n), "UTF-8"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private synchronized void save() {
        try {
            File tmp = new File(dir, "meta.json.tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) { out.write(meta.toString().getBytes("UTF-8")); }
            //noinspection ResultOfMethodCallIgnored
            tmp.renameTo(new File(dir, "meta.json"));
        } catch (Exception e) {
            Log.w(TAG, "save", e);
        }
    }

    static String safe(String id) {
        String s = id == null ? "" : id.replaceAll("[^A-Za-z0-9_.-]", "_");
        return s.length() > 120 ? s.substring(0, 120) : s;
    }

    private File audio(String id) { return new File(dir, safe(id) + ".a"); }
    private File cover(String id) { return new File(dir, safe(id) + ".jpg"); }

    /**
     * Wi-Fi (или любая безлимитная сеть) — да; мобильный интернет — нет.
     * С включённым VPN активной сетью считается сам VPN, и у него часто нет пометки «безлимитная», хотя под ним Wi-Fi.
     * Поэтому смотрим ещё и на все сети: если подключён Wi-Fi или Ethernet с интернетом — значит, Wi-Fi.
     */
    boolean unmetered() {
        try {
            ConnectivityManager cm = app.getSystemService(ConnectivityManager.class);
            if (cm == null) return false;
            NetworkCapabilities a = cm.getNetworkCapabilities(cm.getActiveNetwork());
            if (a != null && (a.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
                    || a.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || a.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))) return true;
            if (!cm.isActiveNetworkMetered()) return true;
            for (android.net.Network n : cm.getAllNetworks()) {
                NetworkCapabilities nc = cm.getNetworkCapabilities(n);
                if (nc != null && nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                        && (nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || nc.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))) return true;
            }
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    boolean online() {
        try {
            ConnectivityManager cm = app.getSystemService(ConnectivityManager.class);
            NetworkCapabilities nc = cm == null ? null : cm.getNetworkCapabilities(cm.getActiveNetwork());
            return nc != null && nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (Exception e) {
            return false;
        }
    }

    /** Сводка для страницы: что скачано, сколько места занято и свободно, какая сеть сейчас. */
    synchronized String state() {
        try {
            JSONArray items = new JSONArray();
            long total = 0;
            java.util.Iterator<String> it = meta.keys();
            while (it.hasNext()) {
                String id = it.next();
                JSONObject m = meta.optJSONObject(id);
                if (m == null || !audio(id).exists()) continue;
                JSONObject o = new JSONObject(m.toString());
                o.put("id", id);
                o.put("size", audio(id).length());
                if (cover(id).exists()) o.put("cover", "/__offline/" + safe(id) + ".jpg");
                total += audio(id).length();
                items.put(o);
            }
            JSONObject r = new JSONObject();
            r.put("items", items);
            r.put("total", total);
            StatFs fs = new StatFs(app.getFilesDir().getPath());
            r.put("free", fs.getAvailableBytes());
            r.put("wifi", unmetered());
            r.put("online", online());
            r.put("busy", busy);
            return r.toString();
        } catch (Exception e) {
            return "{\"items\":[],\"total\":0}";
        }
    }

    void push() { report.send("window.__mkwOff&&window.__mkwOff(" + state() + ")"); }

    /** Скачать трек: пробуем ссылки по очереди, первая, что отдаёт звук, — сохраняется. */
    void download(final JSONObject o, final boolean wifiOnly) {
        pool.execute(() -> {
            String id = o.optString("id", "");
            if (id.isEmpty()) return;
            if (audio(id).exists() && audio(id).length() >= MIN_BYTES) { done(id, true, "уже скачано"); return; }
            if (!online()) { done(id, false, "нет интернета"); return; }
            if (wifiOnly && !unmetered()) { done(id, false, "ждём Wi-Fi"); return; }
            busy = id;
            JSONArray urls = o.optJSONArray("urls");
            boolean ok = false;
            String why = "звук не нашёлся";
            lastWhy = "";
            for (int i = 0; urls != null && i < urls.length() && !ok; i++) {
                String u = urls.optString(i, "");
                if (!u.startsWith("https://")) continue;
                try {
                    ok = fetch(u, audio(id), MAX_BYTES, true);
                } catch (Exception e) {
                    why = "ссылка не открылась";
                    Log.w(TAG, "dl " + id + ": " + e);
                }
            }
            if (ok) saveMeta(o);
            else if (!lastWhy.isEmpty()) why = lastWhy;
            busy = "";
            done(id, ok, ok ? "" : why);
        });
    }

    private void done(String id, boolean ok, String why) {
        report.send("window.__mkwOffDone&&window.__mkwOffDone(" + JSONObject.quote(id) + "," + ok + "," + JSONObject.quote(why) + ")");
        push();
    }

    private volatile String lastWhy = "";

    private HttpURLConnection open(String u, String range) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36");
        // сервер MKW и зеркала отдают звук только «своему» сайту — представляемся страницей MKW
        c.setRequestProperty("Origin", "https://mkwmusic.ru");
        c.setRequestProperty("Referer", "https://mkwmusic.ru/");
        c.setRequestProperty("Accept", "*/*");
        if (range != null) c.setRequestProperty("Range", range);
        return c;
    }

    /** Скачать файл. Сначала просим кусок (как делает плеер) — YouTube так отдаёт быстрее и не обрывает; потом докачиваем кусками. */
    private boolean fetch(String u, File to, long max, boolean needAudio) throws Exception {
        File tmp = new File(to.getPath() + ".part");
        final long CH = 1024L * 1024;
        long n = 0, total = -1;
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            while (true) {
                HttpURLConnection c = open(u, needAudio ? "bytes=" + n + "-" + (n + CH - 1) : null);
                try {
                    int code = c.getResponseCode();
                    if (code != 200 && code != 206) { lastWhy = "сервер ответил " + code; return false; }
                    String type = String.valueOf(c.getContentType());
                    if (needAudio && n == 0 && (type.startsWith("text/") || type.contains("html") || type.contains("json"))) { lastWhy = "вместо звука пришло " + type; return false; }
                    if (code == 206) {
                        String cr = c.getHeaderField("Content-Range");
                        if (cr != null && cr.contains("/")) { try { total = Long.parseLong(cr.substring(cr.lastIndexOf('/') + 1).trim()); } catch (Exception ignored) { /* неизвестно */ } }
                    }
                    long got = 0;
                    try (InputStream in = c.getInputStream()) {
                        byte[] buf = new byte[64 * 1024];
                        int r;
                        while ((r = in.read(buf)) > 0) {
                            out.write(buf, 0, r);
                            n += r; got += r;
                            if (n > max) { lastWhy = "слишком большой файл"; return false; }
                        }
                    }
                    if (code == 200 || got == 0) break;          // отдали целиком
                    if (total > 0 && n >= total) break;           // докачали
                    if (total <= 0 && got < CH) break;            // размер не сказали, а кусок неполный — это конец
                } finally {
                    c.disconnect();
                }
            }
        } finally {
            if (n < (needAudio ? MIN_BYTES : 1)) { //noinspection ResultOfMethodCallIgnored
                tmp.delete(); }
        }
        if (needAudio && n < MIN_BYTES) { lastWhy = "файл слишком маленький"; return false; }
        boolean ok = tmp.renameTo(to);
        if (tmp.exists()) { //noinspection ResultOfMethodCallIgnored
            tmp.delete(); }
        return ok;
    }

    // ---- запасной путь: страница сама скачала звук (как его скачивает плеер) и передаёт сюда кусками ----
    private String putId = "";
    private FileOutputStream putOut;
    private long putBytes;

    void put(final JSONObject o) {
        pool.execute(() -> {
            String id = o.optString("id", "");
            try {
                if (o.optInt("seq", 0) == 0) {
                    if (putOut != null) try { putOut.close(); } catch (Exception ignored) { /* ignore */ }
                    putId = id; putBytes = 0;
                    putOut = new FileOutputStream(new File(audio(id).getPath() + ".part"));
                }
                if (!id.equals(putId) || putOut == null) return;
                String b64 = o.optString("b64", "");
                if (!b64.isEmpty()) {
                    byte[] b = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
                    putOut.write(b);
                    putBytes += b.length;
                    if (putBytes > MAX_BYTES) throw new Exception("слишком большой файл");
                }
                if (o.optBoolean("last", false)) {
                    putOut.close(); putOut = null;
                    File part = new File(audio(id).getPath() + ".part");
                    boolean ok = putBytes >= MIN_BYTES && part.renameTo(audio(id));
                    if (part.exists()) { //noinspection ResultOfMethodCallIgnored
                        part.delete(); }
                    if (ok) saveMeta(o);
                    done(id, ok, ok ? "" : "файл слишком маленький");
                }
            } catch (Exception e) {
                try { if (putOut != null) putOut.close(); } catch (Exception ignored) { /* ignore */ }
                putOut = null;
                //noinspection ResultOfMethodCallIgnored
                new File(audio(id).getPath() + ".part").delete();
                done(id, false, String.valueOf(e.getMessage()));
            }
        });
    }

    private void saveMeta(JSONObject o) {
        String id = o.optString("id", "");
        String art = o.optString("art", "");
        if (art.startsWith("https://")) {
            try { fetch(art, cover(id), 2 * 1024 * 1024, false); } catch (Exception ignored) { /* без обложки */ }
        }
        synchronized (this) {
            try {
                JSONObject m = new JSONObject();
                m.put("title", o.optString("title", "")); m.put("artist", o.optString("artist", ""));
                m.put("album", o.optString("album", "")); m.put("dur", o.optDouble("dur", 0));
                m.put("art", art); m.put("at", System.currentTimeMillis());
                m.put("t", o.optJSONObject("track") != null ? o.optJSONObject("track") : new JSONObject());
                meta.put(id, m);
            } catch (Exception ignored) { /* ignore */ }
        }
        save();
    }

    void remove(final String id) {
        pool.execute(() -> {
            //noinspection ResultOfMethodCallIgnored
            audio(id).delete();
            //noinspection ResultOfMethodCallIgnored
            cover(id).delete();
            synchronized (this) { meta.remove(id); }
            save();
            push();
        });
    }

    void clear() {
        pool.execute(() -> {
            File[] fs = dir.listFiles();
            if (fs != null) for (File f : fs) { //noinspection ResultOfMethodCallIgnored
                f.delete(); }
            synchronized (this) { meta = new JSONObject(); }
            save();
            push();
        });
    }

    /** /__offline/<id> — звук (с перемоткой), /__offline/<id>.jpg — обложка. */
    WebResourceResponse serve(String path, Map<String, String> reqHeaders) {
        try {
            String name = path.substring("/__offline/".length());
            boolean img = name.endsWith(".jpg");
            String id = img ? name.substring(0, name.length() - 4) : name;
            File f = img ? cover(id) : audio(id);
            if (!f.exists()) return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<>(), null);
            long len = f.length();
            Map<String, String> h = new HashMap<>();
            h.put("Accept-Ranges", "bytes");
            h.put("Cache-Control", "no-store");
            String type = img ? "image/jpeg" : sniff(f);
            String range = reqHeaders == null ? null : (reqHeaders.containsKey("Range") ? reqHeaders.get("Range") : reqHeaders.get("range"));
            if (!img && range != null && range.startsWith("bytes=")) {
                String[] p = range.substring(6).split("-", 2);
                long start = p[0].isEmpty() ? 0 : Long.parseLong(p[0].trim());
                long end = p.length > 1 && !p[1].trim().isEmpty() ? Long.parseLong(p[1].trim()) : len - 1;
                end = Math.min(end, len - 1);
                if (start > end) start = 0;
                RandomAccessFile raf = new RandomAccessFile(f, "r");
                raf.seek(start);
                final long count = end - start + 1;
                InputStream in = new InputStream() {
                    long left = count;
                    @Override public int read() throws java.io.IOException { if (left <= 0) return -1; left--; return raf.read(); }
                    @Override public int read(byte[] b, int off, int l) throws java.io.IOException {
                        if (left <= 0) return -1;
                        int r = raf.read(b, off, (int) Math.min(l, left));
                        if (r > 0) left -= r;
                        return r;
                    }
                    @Override public void close() throws java.io.IOException { raf.close(); }
                };
                h.put("Content-Range", "bytes " + start + "-" + end + "/" + len);
                h.put("Content-Length", String.valueOf(count));
                return new WebResourceResponse(type, null, 206, "Partial Content", h, in);
            }
            h.put("Content-Length", String.valueOf(len));
            return new WebResourceResponse(type, null, 200, "OK", h, new FileInputStream(f));
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "utf-8", 500, "Error", new HashMap<>(), null);
        }
    }

    /** Тип звука по первым байтам: m4a (ftyp), webm/opus (EBML), mp3. */
    private static String sniff(File f) {
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] b = new byte[12];
            int n = in.read(b);
            if (n >= 8 && b[4] == 'f' && b[5] == 't' && b[6] == 'y' && b[7] == 'p') return "audio/mp4";
            if (n >= 4 && (b[0] & 0xff) == 0x1A && (b[1] & 0xff) == 0x45 && (b[2] & 0xff) == 0xDF && (b[3] & 0xff) == 0xA3) return "audio/webm";
            if (n >= 4 && b[0] == 'O' && b[1] == 'g' && b[2] == 'g' && b[3] == 'S') return "audio/ogg";
            return "audio/mpeg";
        } catch (Exception e) {
            return "audio/mpeg";
        }
    }
}
