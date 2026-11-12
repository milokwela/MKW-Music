package ru.mkwmusic.app;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Музыка в фоне. Пока играет трек, сервис держит приложение «живым» (уведомление с кнопками, блокировка сна),
 * поэтому звук не обрывается при выключенном экране или сворачивании. Сам звук играет сайт в WebView.
 */
public class PlaybackService extends Service {
    private static final int ID = 7;
    private static final long IDLE_STOP_MS = 10 * 60 * 1000L;
    private static volatile PlaybackService instance;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable idleStop = this::shutdown;

    private MediaSession session;
    private PowerManager.WakeLock wake;
    private WifiManager.WifiLock wifi;
    private boolean foreground;
    private boolean playing;
    private String title = "";
    private String artist = "";
    private String coverUrl = "";
    private Bitmap cover;
    private long durationMs, positionMs, positionAt;
    private float rate = 1f;
    private boolean wave;
    private boolean noisyOn;
    /** Наушники выдернули или отключился Bluetooth — ставим на паузу, чтобы музыка не заиграла из динамика. */
    private final android.content.BroadcastReceiver noisy = new android.content.BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) { dispatch("pause"); }
    };

    /** Сайт сообщил длину трека и текущее место — для полосы перемотки на экране блокировки и в шторке. */
    static void position(double d, double p, double r) {
        PlaybackService s = instance;
        if (s == null || s.session == null) return;
        long dur = d > 0 && d < 360000 ? Math.round(d * 1000) : 0;
        boolean metaChanged = dur != s.durationMs;
        s.durationMs = dur;
        s.positionMs = Math.max(0, Math.round(p * 1000));
        s.positionAt = android.os.SystemClock.elapsedRealtime();
        s.rate = r > 0 && r < 8 ? (float) r : 1f;
        if (metaChanged) s.updateSession(); else s.updateState();
        WidgetKit.position(s, s.durationMs, s.positionMs, s.positionAt, s.rate);
    }

    /** Вызывается из приложения, когда сайт сообщил о смене трека или паузе. */
    static void push(Context c, String title, String artist, String art, boolean playing, boolean wave) {
        PlaybackService s = instance;
        if (s != null) {
            s.wave = wave;
            s.apply(title, artist, art, playing);
            return;
        }
        if (!playing) return;
        Intent i = new Intent(c, PlaybackService.class)
                .putExtra("title", title).putExtra("artist", artist).putExtra("art", art).putExtra("playing", true).putExtra("wave", wave);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
        } catch (Exception ignored) {
            // система не разрешила запуск из фона — музыка всё равно играет, просто без уведомления
        }
    }

    static void stop() {
        PlaybackService s = instance;
        if (s != null) s.shutdown();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        MainActivity.holdVisible(true);
        Notifier.ensureChannels(this);
        session = new MediaSession(this, "MKW Music");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { dispatch("play"); }
            @Override public void onPause() { dispatch("pause"); }
            @Override public void onStop() { dispatch("pause"); }
            @Override public void onSkipToNext() { dispatch("nexttrack"); }
            @Override public void onSkipToPrevious() { dispatch("previoustrack"); }
            @Override public void onSeekTo(long pos) { seekTo(pos); }
        });
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String act = intent.getStringExtra("act");
            if (act != null) {
                dispatch(act);
            } else if (intent.hasExtra("seekpct") || intent.hasExtra("seekrel")) {
                // виджет: нажали на полосу (место в тысячных долях) или «±15 секунд»
                long cur = livePos();
                long to = intent.hasExtra("seekpct") ? durationMs * intent.getIntExtra("seekpct", 0) / 1000
                        : cur + intent.getIntExtra("seekrel", 0);
                if (durationMs > 0) seekTo(Math.max(0, Math.min(durationMs - 1000, to)));
            } else if (intent.hasExtra("title")) {
                wave = intent.getBooleanExtra("wave", false);
                apply(intent.getStringExtra("title"), intent.getStringExtra("artist"),
                        intent.getStringExtra("art"), intent.getBooleanExtra("playing", true));
            }
        }
        if (!foreground) {
            // система требует вызвать startForeground в течение пяти секунд после запуска
            startFg(buildNotification());
        }
        return START_NOT_STICKY;
    }

    private void apply(String t, String a, String artUrl, boolean p) {
        String nt = t == null ? "" : t;
        if (!nt.equals(title)) { durationMs = 0; positionMs = 0; positionAt = 0; }
        if (p != playing) {
            long now = android.os.SystemClock.elapsedRealtime();
            // встали на паузу — запоминаем, где остановились
            if (playing && durationMs > 0 && positionAt > 0) positionMs += (long) ((now - positionAt) * rate);
            positionAt = now;
        }
        title = nt;
        artist = a == null ? "" : a;
        playing = p;
        String art = artUrl == null ? "" : artUrl;
        if (!art.equals(coverUrl)) {
            coverUrl = art;
            cover = null;
            fetchCover(art);
        }
        handler.removeCallbacks(idleStop);
        lock(p);
        if (!p) handler.postDelayed(idleStop, IDLE_STOP_MS);
        refresh();
    }

    static boolean alive() { return instance != null; }
    /** Музыка сейчас играет (служба запущена и не на паузе). */
    static boolean playingNow() { PlaybackService s = instance; return s != null && s.playing; }

    private long livePos() {
        long p = positionMs;
        if (playing && positionAt > 0) p += (long) ((android.os.SystemClock.elapsedRealtime() - positionAt) * rate);
        return Math.max(0, p);
    }

    private void seekTo(long pos) {
        positionMs = Math.max(0, pos);
        positionAt = android.os.SystemClock.elapsedRealtime();
        updateState();
        WidgetKit.position(this, durationMs, positionMs, positionAt, rate);
        MainActivity m = MainActivity.current;
        if (m != null) m.runJs("window.__mkwAct&&window.__mkwAct('seekto',{seekTime:" + (pos / 1000.0) + "})");
    }

    /** Пока играет и экран включён — раз в секунду двигаем полосу на виджетах с перемоткой. */
    private final Runnable widgetTick = new Runnable() {
        @Override public void run() {
            handler.removeCallbacks(this);
            if (instance != PlaybackService.this || !playing) return;
            android.os.PowerManager pm = getSystemService(android.os.PowerManager.class);
            if ((pm == null || pm.isInteractive()) && WidgetKit.anyWithProgress(PlaybackService.this)) {
                WidgetKit.tick(PlaybackService.this);
                handler.postDelayed(this, 1000);
            } else {
                handler.postDelayed(this, 5000);
            }
        }
    };

    private void refresh() {
        updateSession();
        WidgetKit.push(this, title, artist, cover, playing, true, wave, durationMs, positionMs, positionAt, rate);
        handler.removeCallbacks(widgetTick);
        if (playing) handler.postDelayed(widgetTick, 1000);
        Notification n = buildNotification();
        if (!foreground) startFg(n);
        else {
            android.app.NotificationManager nm = getSystemService(android.app.NotificationManager.class);
            if (nm != null) nm.notify(ID, n);
        }
    }

    private void startFg(Notification n) {
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            else startForeground(ID, n);
            foreground = true;
        } catch (Exception e) {
            stopSelf();
        }
    }

    private Notification buildNotification() {
        Notification.Builder b = Notifier.builder(this, Notifier.CH_PLAY)
                .setSmallIcon(R.drawable.ic_stat_note)
                .setContentTitle(title.isEmpty() ? "MKW Music" : title)
                .setContentText(artist.isEmpty() ? "Играет музыка" : artist)
                .setContentIntent(Notifier.open(this))
                .setOngoing(playing)
                .setShowWhen(false)
                .setVisibility(Notification.VISIBILITY_PUBLIC);
        if (cover != null) b.setLargeIcon(cover);
        b.addAction(action(android.R.drawable.ic_media_previous, "Назад", "previoustrack", 1));
        b.addAction(action(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                playing ? "Пауза" : "Играть", playing ? "pause" : "play", 2));
        b.addAction(action(android.R.drawable.ic_media_next, "Дальше", "nexttrack", 3));
        b.setStyle(new Notification.MediaStyle()
                .setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2));
        return b.build();
    }

    private Notification.Action action(int icon, String label, String act, int code) {
        Intent i = new Intent(this, PlaybackService.class).putExtra("act", act);
        PendingIntent pi = PendingIntent.getService(this, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Action.Builder(Icon.createWithResource(this, icon), label, pi).build();
    }

    private void updateSession() {
        MediaMetadata.Builder md = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, artist);
        if (cover != null) md.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, cover);
        if (durationMs > 0) md.putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs);
        session.setMetadata(md.build());
        updateState();
        session.setActive(true);
    }

    private void updateState() {
        if (session == null) return;
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_STOP;
        if (durationMs > 0) actions |= PlaybackState.ACTION_SEEK_TO;
        long pos = durationMs > 0 ? Math.min(positionMs, durationMs) : PlaybackState.PLAYBACK_POSITION_UNKNOWN;
        session.setPlaybackState(new PlaybackState.Builder()
                .setActions(actions)
                .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, pos,
                        playing ? rate : 0f, positionAt > 0 ? positionAt : android.os.SystemClock.elapsedRealtime())
                .build());
        // «наушники отключились» слушаем только пока играет
        try {
            if (playing && !noisyOn) {
                registerReceiver(noisy, new android.content.IntentFilter(android.media.AudioManager.ACTION_AUDIO_BECOMING_NOISY));
                noisyOn = true;
            } else if (!playing && noisyOn) {
                unregisterReceiver(noisy);
                noisyOn = false;
            }
        } catch (Exception ignored) {
            // приёмник — только помощь
        }
    }

    /** Кнопки шторки и гарнитуры → сайт (те же обработчики, что у системных кнопок браузера). */
    private void dispatch(String act) {
        MainActivity m = MainActivity.current;
        if (m != null) m.runJs("window.__mkwAct&&window.__mkwAct(" + JSONObject.quote(act) + ")");
    }

    private void fetchCover(final String url) {
        if (!url.startsWith("https://")) return;
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(8000);
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                try (InputStream in = c.getInputStream()) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        if (out.size() > 3 * 1024 * 1024) return;
                    }
                }
                Bitmap raw = BitmapFactory.decodeByteArray(out.toByteArray(), 0, out.size());
                if (raw == null) return;
                final Bitmap bmp = Bitmap.createScaledBitmap(raw, 256, 256, true);
                handler.post(() -> {
                    if (instance == this && url.equals(coverUrl)) {
                        cover = bmp;
                        refresh();
                    }
                });
            } catch (Exception ignored) {
                // обложка не загрузилась — остаётся без неё
            }
        }).start();
    }

    private void lock(boolean on) {
        try {
            if (on) {
                if (wake == null) {
                    PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                    wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "mkw:play");
                    wake.setReferenceCounted(false);
                }
                if (!wake.isHeld()) wake.acquire(4 * 60 * 60 * 1000L);
                if (wifi == null) {
                    WifiManager wm = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
                    if (wm != null) {
                        wifi = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "mkw:play");
                        wifi.setReferenceCounted(false);
                    }
                }
                if (wifi != null && !wifi.isHeld()) wifi.acquire();
            } else {
                if (wake != null && wake.isHeld()) wake.release();
                if (wifi != null && wifi.isHeld()) wifi.release();
            }
        } catch (Exception ignored) {
            // блокировки — только помощь, без них тоже работает
        }
    }

    private void shutdown() {
        handler.removeCallbacks(idleStop);
        lock(false);
        try { stopForeground(true); } catch (Exception ignored) { /* уже остановлен */ }
        foreground = false;
        stopSelf();
    }

    @Override
    public void onDestroy() {
        try { if (noisyOn) unregisterReceiver(noisy); } catch (Exception ignored) { /* уже снят */ }
        noisyOn = false;
        handler.removeCallbacks(idleStop);
        lock(false);
        if (session != null) {
            session.setActive(false);
            session.release();
            session = null;
        }
        if (instance == this) instance = null;
        handler.removeCallbacks(widgetTick);
        WidgetKit.push(this, title, artist, cover, false, false, wave, durationMs, livePos(), 0, rate);
        MainActivity.holdVisible(false);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
