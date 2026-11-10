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

    /** Вызывается из приложения, когда сайт сообщил о смене трека или паузе. */
    static void push(Context c, String title, String artist, String art, boolean playing) {
        PlaybackService s = instance;
        if (s != null) {
            s.apply(title, artist, art, playing);
            return;
        }
        if (!playing) return;
        Intent i = new Intent(c, PlaybackService.class)
                .putExtra("title", title).putExtra("artist", artist).putExtra("art", art).putExtra("playing", true);
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
        });
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String act = intent.getStringExtra("act");
            if (act != null) {
                dispatch(act);
            } else if (intent.hasExtra("title")) {
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
        title = t == null ? "" : t;
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

    private void refresh() {
        updateSession();
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
        session.setMetadata(md.build());
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS;
        session.setPlaybackState(new PlaybackState.Builder()
                .setActions(actions)
                .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                        PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
                .build());
        session.setActive(true);
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
        handler.removeCallbacks(idleStop);
        lock(false);
        if (session != null) {
            session.setActive(false);
            session.release();
            session = null;
        }
        if (instance == this) instance = null;
        MainActivity.holdVisible(false);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
