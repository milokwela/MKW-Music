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
    static final String CH_CALL = "calls";

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
        NotificationChannel call = new NotificationChannel(CH_CALL, "Входящие звонки", NotificationManager.IMPORTANCE_HIGH);
        call.setDescription("Звонки от друзей в MKW");
        call.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        call.enableVibration(true);
        call.setSound(android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_RINGTONE),
                new android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        nm.createNotificationChannel(call);
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

    /** Входящий звонок: уведомление как у обычного звонка — поверх экрана блокировки, с мелодией; по нажатию открывается MKW. */
    @SuppressWarnings("deprecation")
    static void call(Context c, String title, String body, String tag) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null || !nm.areNotificationsEnabled()) return;
        ensureChannels(c);
        Intent i = new Intent(c, MainActivity.class).putExtra("call", true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, 5, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = builder(c, CH_CALL)
                .setSmallIcon(R.drawable.ic_stat_note)
                .setContentTitle(title.isEmpty() ? "Входящий звонок" : title)
                .setContentText(body)
                .setContentIntent(pi)
                .setFullScreenIntent(pi, true)
                .setAutoCancel(true)
                .setOngoing(true)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setCategory(Notification.CATEGORY_CALL);
        if (Build.VERSION.SDK_INT >= 26) b.setTimeoutAfter(45000);
        else b.setPriority(Notification.PRIORITY_MAX).setDefaults(Notification.DEFAULT_ALL);
        nm.notify(tag.isEmpty() ? "call" : tag, 2, b.build());
    }

    static void cancelCalls(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null || Build.VERSION.SDK_INT < 23) return;
        try {
            for (android.service.notification.StatusBarNotification n : nm.getActiveNotifications()) {
                if (n.getId() == 2) nm.cancel(n.getTag(), 2);
            }
        } catch (Exception ignored) { /* не получилось — уведомление само исчезнет через 45 секунд */ }
    }

    /** Android 14+: разрешены ли звонки на весь экран (иначе звонок придёт обычным уведомлением). */
    static boolean fullScreenOk(Context c) {
        if (Build.VERSION.SDK_INT < 34) return true;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        try { return nm != null && nm.canUseFullScreenIntent(); } catch (Exception e) { return true; }
    }

    /** Открыть системный экран «Полноэкранные уведомления» для MKW. */
    static void openFullScreenSettings(android.app.Activity a) {
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                a.startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
                        android.net.Uri.parse("package:" + a.getPackageName())));
                return;
            }
        } catch (Exception ignored) { /* ниже — общий экран уведомлений */ }
        try {
            a.startActivity(new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, a.getPackageName()));
        } catch (Exception ignored) { /* нет такого экрана */ }
    }
}
