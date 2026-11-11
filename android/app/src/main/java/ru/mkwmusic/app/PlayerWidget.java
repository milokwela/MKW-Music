package ru.mkwmusic.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.widget.RemoteViews;

/** Виджет на рабочий стол: обложка, название, исполнитель и кнопки «назад / играть-пауза / дальше». */
public class PlayerWidget extends AppWidgetProvider {
    private static final String PREF = "widget";
    private static Bitmap lastCover;

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        SharedPreferences p = c.getSharedPreferences(PREF, Context.MODE_PRIVATE);
        m.updateAppWidget(ids, build(c, p.getString("title", ""), p.getString("artist", ""), lastCover, false, PlaybackService.alive()));
    }

    /** Плеер сообщает, что играет. live=false — музыка остановлена и сервис закрыт: кнопки просто открывают приложение. */
    static void push(Context c, String title, String artist, Bitmap cover, boolean playing, boolean live) {
        try {
            lastCover = cover;
            c.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putString("title", title).putString("artist", artist).apply();
            AppWidgetManager m = AppWidgetManager.getInstance(c);
            int[] ids = m.getAppWidgetIds(new ComponentName(c, PlayerWidget.class));
            if (ids == null || ids.length == 0) return;
            m.updateAppWidget(ids, build(c, title, artist, cover, playing, live));
        } catch (Exception ignored) {
            // виджет не обновился — не страшно, обновится на следующем треке
        }
    }

    private static RemoteViews build(Context c, String title, String artist, Bitmap cover, boolean playing, boolean live) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_player);
        boolean has = title != null && !title.isEmpty();
        v.setTextViewText(R.id.w_title, has ? title : "MKW Music");
        v.setTextViewText(R.id.w_artist, has ? (artist == null || artist.isEmpty() ? "MKW Music" : artist) : "Нажмите, чтобы открыть");
        if (cover != null) v.setImageViewBitmap(R.id.w_cover, cover);
        else v.setImageViewResource(R.id.w_cover, R.mipmap.ic_launcher);
        v.setImageViewResource(R.id.w_play, playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play);
        PendingIntent open = Notifier.open(c);
        v.setOnClickPendingIntent(R.id.w_root, open);
        v.setOnClickPendingIntent(R.id.w_cover, open);
        v.setOnClickPendingIntent(R.id.w_prev, live ? act(c, "previoustrack", 11) : open);
        v.setOnClickPendingIntent(R.id.w_play, live ? act(c, playing ? "pause" : "play", 12) : open);
        v.setOnClickPendingIntent(R.id.w_next, live ? act(c, "nexttrack", 13) : open);
        return v;
    }

    private static PendingIntent act(Context c, String a, int code) {
        Intent i = new Intent(c, PlaybackService.class).putExtra("act", a);
        return PendingIntent.getService(c, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
}
