package ru.mkwmusic.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.RectF;
import android.os.Build;
import android.widget.RemoteViews;

/**
 * Все виджеты MKW на рабочем столе: мини-плеер, плеер с перемоткой, «MKW Волна» и квадрат с обложкой.
 * Фон каждого — размытая обложка текущего трека; полоса перемотки — 10 зон, нажатие ставит песню на это место.
 */
final class WidgetKit {
    static final int MINI = 0, SEEK = 1, WAVE = 2, COVER = 3;
    private static final Class<?>[] KINDS = {PlayerWidget.class, SeekWidget.class, WaveWidget.class, CoverWidget.class};
    private static final int[] LAYOUTS = {R.layout.widget_player, R.layout.widget_seek, R.layout.widget_wave, R.layout.widget_cover};
    private static final int[] ZONES = {R.id.w_z0, R.id.w_z1, R.id.w_z2, R.id.w_z3, R.id.w_z4, R.id.w_z5, R.id.w_z6, R.id.w_z7, R.id.w_z8, R.id.w_z9};

    /** То, что сейчас играет (последнее известное — переживает перезапуск через настройки). */
    static final class State {
        String title = "", artist = "";
        Bitmap cover, coverRound, blur;
        boolean playing, live, wave;
        long durMs, posMs, posAt;
        float rate = 1f;
        long pos() {
            long p = posMs;
            if (playing && posAt > 0) p += (long) ((android.os.SystemClock.elapsedRealtime() - posAt) * rate);
            return durMs > 0 ? Math.max(0, Math.min(durMs, p)) : 0;
        }
    }

    static final State S = new State();
    private static Bitmap lastCoverSrc;

    private WidgetKit() { }

    static Class<?> cls(int kind) { return KINDS[kind]; }

    static int[] ids(Context c, int kind) {
        try {
            return AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c, KINDS[kind]));
        } catch (Exception e) {
            return new int[0];
        }
    }

    static boolean anyWithProgress(Context c) { return ids(c, SEEK).length > 0 || ids(c, WAVE).length > 0; }

    /** Плеер сообщает новое состояние. */
    static void push(Context c, String title, String artist, Bitmap cover, boolean playing, boolean live, boolean wave,
                     long durMs, long posMs, long posAt, float rate) {
        S.title = title == null ? "" : title;
        S.artist = artist == null ? "" : artist;
        S.playing = playing; S.live = live; S.wave = wave;
        S.durMs = durMs; S.posMs = posMs; S.posAt = posAt; S.rate = rate;
        if (cover != lastCoverSrc) {
            lastCoverSrc = cover;
            S.cover = cover;
            S.coverRound = cover == null ? null : round(cover, 0.18f);
            S.blur = cover == null ? null : blur(cover);
        }
        try {
            c.getSharedPreferences("widget", Context.MODE_PRIVATE).edit()
                    .putString("title", S.title).putString("artist", S.artist).putBoolean("wave", wave).apply();
        } catch (Exception ignored) { /* не страшно */ }
        updateAll(c);
    }

    /** Сайт сообщил место в треке — двигаем полосу на виджетах. */
    static void position(Context c, long durMs, long posMs, long posAt, float rate) {
        boolean durChanged = durMs != S.durMs;
        S.durMs = durMs; S.posMs = posMs; S.posAt = posAt; S.rate = rate;
        if (durChanged) updateAll(c); else tick(c);
    }

    static void restore(Context c) {
        if (!S.title.isEmpty()) return;
        SharedPreferences p = c.getSharedPreferences("widget", Context.MODE_PRIVATE);
        S.title = p.getString("title", "");
        S.artist = p.getString("artist", "");
        S.wave = p.getBoolean("wave", false);
    }

    static void updateAll(Context c) {
        AppWidgetManager m;
        try { m = AppWidgetManager.getInstance(c); } catch (Exception e) { return; }
        for (int k = 0; k < KINDS.length; k++) {
            int[] ids = ids(c, k);
            if (ids.length == 0) continue;
            try { m.updateAppWidget(ids, build(c, k)); } catch (Exception ignored) { /* следующее обновление починит */ }
        }
    }

    /** Раз в секунду, пока играет: двигаем только полосу и время — без перерисовки всего виджета. */
    static void tick(Context c) {
        AppWidgetManager m;
        try { m = AppWidgetManager.getInstance(c); } catch (Exception e) { return; }
        for (int k : new int[]{SEEK, WAVE}) {
            int[] ids = ids(c, k);
            if (ids.length == 0) continue;
            RemoteViews v = new RemoteViews(c.getPackageName(), LAYOUTS[k]);
            progress(v);
            try { m.partiallyUpdateAppWidget(ids, v); } catch (Exception ignored) { /* ignore */ }
        }
    }

    static RemoteViews build(Context c, int kind) {
        restore(c);
        RemoteViews v = new RemoteViews(c.getPackageName(), LAYOUTS[kind]);
        boolean has = !S.title.isEmpty();
        v.setTextViewText(R.id.w_title, has ? S.title : (kind == WAVE ? "Музыка под ваш вкус" : "MKW Music"));
        v.setTextViewText(R.id.w_artist, has ? (S.artist.isEmpty() ? "MKW Music" : S.artist)
                : (kind == WAVE ? "Нажмите «Включить» — волна подберёт треки" : "Нажмите, чтобы открыть"));
        if (S.blur != null) v.setImageViewBitmap(R.id.w_bg, kind == COVER ? S.cover : S.blur);
        else v.setImageViewResource(R.id.w_bg, android.R.color.transparent);
        if (kind != COVER) {
            if (S.coverRound != null) v.setImageViewBitmap(R.id.w_cover, S.coverRound);
            else v.setImageViewResource(R.id.w_cover, R.drawable.widget_logo);
        }
        v.setImageViewResource(R.id.w_play, S.playing ? R.drawable.wg_ic_pause : R.drawable.wg_ic_play);

        PendingIntent open = openApp(c, false);
        v.setOnClickPendingIntent(R.id.w_root, open);
        if (kind != COVER) v.setOnClickPendingIntent(R.id.w_cover, open);
        v.setOnClickPendingIntent(R.id.w_play, S.live ? act(c, S.playing ? "pause" : "play", 100 + kind) : open);
        if (kind != COVER) {
            v.setOnClickPendingIntent(R.id.w_prev, S.live ? act(c, "previoustrack", 110 + kind) : open);
            v.setOnClickPendingIntent(R.id.w_next, S.live ? act(c, "nexttrack", 120 + kind) : open);
        }
        if (kind == SEEK || kind == WAVE) {
            v.setOnClickPendingIntent(R.id.w_rew, S.live ? seek(c, "seekrel", -15000, 130 + kind) : open);
            v.setOnClickPendingIntent(R.id.w_fwd, S.live ? seek(c, "seekrel", 15000, 140 + kind) : open);
            for (int i = 0; i < ZONES.length; i++) {
                v.setOnClickPendingIntent(ZONES[i], S.live ? seek(c, "seekpct", i * 100 + 50, 150 + kind * 10 + i) : open);
            }
            progress(v);
        }
        if (kind == WAVE) {
            boolean on = S.live && S.wave;
            v.setTextViewText(R.id.w_wave, on ? (S.playing ? "В эфире" : "Пауза") : "Включить");
            v.setTextViewText(R.id.w_badge, on ? "СЕЙЧАС В ВОЛНЕ" : (has ? "СЕЙЧАС ИГРАЕТ" : "ПОД ВАШ ВКУС"));
            v.setOnClickPendingIntent(R.id.w_wave, on ? act(c, S.playing ? "pause" : "play", 190)
                    : (S.live ? act(c, "wave", 191) : openApp(c, true)));
        }
        return v;
    }

    private static void progress(RemoteViews v) {
        long d = S.durMs, p = S.pos();
        v.setProgressBar(R.id.w_prog, 1000, d > 0 ? (int) (p * 1000 / d) : 0, false);
        v.setTextViewText(R.id.w_tcur, d > 0 ? time(p) : "0:00");
        v.setTextViewText(R.id.w_tdur, d > 0 ? time(d) : "—:—");
    }

    private static String time(long ms) {
        long s = ms / 1000;
        return (s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
    }

    static PendingIntent openApp(Context c, boolean wave) {
        Intent i = new Intent(c, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (wave) i.putExtra("widget_wave", true);
        return PendingIntent.getActivity(c, wave ? 31 : 30, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static PendingIntent act(Context c, String a, int code) {
        Intent i = new Intent(c, PlaybackService.class).putExtra("act", a);
        return PendingIntent.getService(c, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static PendingIntent seek(Context c, String what, int value, int code) {
        Intent i = new Intent(c, PlaybackService.class).putExtra(what, value);
        return PendingIntent.getService(c, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** Закреплённая квадратная обложка со скруглёнными углами (у RemoteViews нет своего скругления на старых Android). */
    private static Bitmap round(Bitmap src, float k) {
        try {
            int s = Math.min(src.getWidth(), src.getHeight());
            Bitmap out = Bitmap.createBitmap(s, s, Bitmap.Config.ARGB_8888);
            Canvas cv = new Canvas(out);
            Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
            cv.drawRoundRect(new RectF(0, 0, s, s), s * k, s * k, p);
            p.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.SRC_IN));
            cv.drawBitmap(src, (s - src.getWidth()) / 2f, (s - src.getHeight()) / 2f, p);
            return out;
        } catch (Exception e) {
            return src;
        }
    }

    /** Мягкое размытие обложки для фона: уменьшаем до 12×12 и растягиваем обратно со сглаживанием. */
    private static Bitmap blur(Bitmap src) {
        try {
            Bitmap tiny = Bitmap.createScaledBitmap(src, 12, 12, true);
            Bitmap mid = Bitmap.createScaledBitmap(tiny, 48, 48, true);
            return Bitmap.createScaledBitmap(mid, 240, 240, true);
        } catch (Exception e) {
            return null;
        }
    }

    /** Кнопка «Добавить виджет» из настроек: Android сам покажет окно «Добавить на главный экран». */
    static boolean pin(Context c, int kind) {
        if (Build.VERSION.SDK_INT < 26) return false;
        try {
            AppWidgetManager m = c.getSystemService(AppWidgetManager.class);
            if (m == null || !m.isRequestPinAppWidgetSupported()) return false;
            return m.requestPinAppWidget(new ComponentName(c, KINDS[kind]), null, null);
        } catch (Exception e) {
            return false;
        }
    }
}
