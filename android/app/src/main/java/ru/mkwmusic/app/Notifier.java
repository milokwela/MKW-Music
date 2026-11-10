package ru.mkwmusic.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** Каналы и обычные уведомления (сообщения, звонки, заявки в друзья), которые просит показать сайт. */
final class Notifier {
    static final String CH_MSG = "messages";
    static final String CH_PLAY = "playback";

    private Notifier() { }

    static void ensureChannels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel msg = new NotificationChannel(CH_MSG, "Сообщения и звонки", NotificationManager.IMPORTANCE_HIGH);
        msg.setDescription("Новые сообщения, заявки в друзья и звонки");
        NotificationChannel play = new NotificationChannel(CH_PLAY, "Музыка", NotificationManager.IMPORTANCE_LOW);
        play.setDescription("Кнопки управления музыкой");
        play.setShowBadge(false);
        nm.createNotificationChannel(msg);
        nm.createNotificationChannel(play);
    }

    static boolean enabled(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        return nm != null && nm.areNotificationsEnabled();
    }

    static Notification.Builder builder(Context c, String channel) {
        return Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, channel) : new Notification.Builder(c);
    }

    static PendingIntent open(Context c) {
        Intent i = new Intent(c, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(c, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    @SuppressWarnings("deprecation")
    static void message(Context c, String title, String body, String tag) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null || !nm.areNotificationsEnabled()) return;
        ensureChannels(c);
        Notification.Builder b = builder(c, CH_MSG)
                .setSmallIcon(R.drawable.ic_stat_note)
                .setContentTitle(title.isEmpty() ? "MKW Music" : title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setContentIntent(open(c))
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_MESSAGE);
        if (Build.VERSION.SDK_INT < 26) {
            b.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
        }
        nm.notify(tag.isEmpty() ? "mkw" : tag, 1, b.build());
    }
}
