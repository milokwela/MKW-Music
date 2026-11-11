package ru.mkwmusic.app;

import android.content.Context;
import android.util.Log;

import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Уведомления, когда MKW закрыт (даже убран из недавних): сервер MKW (Cloudflare Worker) шлёт сообщение через
 * Firebase Cloud Messaging, Android будит приложение — и здесь показываем звонок на весь экран или сообщение.
 * Пока MKW открыт на экране, звонки и сообщения показывает сама страница — тут ничего не дублируем.
 */
public class PushService extends FirebaseMessagingService {
    private static final String TAG = "MKWPush";

    @Override
    public void onNewToken(String token) {
        save(this, token);
    }

    static void save(Context c, String token) {
        if (token == null || token.isEmpty()) return;
        c.getSharedPreferences("mkw", MODE_PRIVATE).edit().putString("fcm", token).apply();
    }

    static String token(Context c) {
        return c.getSharedPreferences("mkw", MODE_PRIVATE).getString("fcm", "");
    }

    /** Запросить токен устройства (новый придёт и в onNewToken). */
    static void fetch(Context c, java.util.function.Consumer<String> done) {
        try {
            FirebaseMessaging.getInstance().getToken().addOnSuccessListener((t) -> { save(c, t); done.accept(t); })
                    .addOnFailureListener((e) -> Log.w(TAG, "token: " + e));
        } catch (Exception e) {
            Log.w(TAG, "fcm: " + e);
        }
    }

    @Override
    public void onMessageReceived(RemoteMessage msg) {
        Map<String, String> d = msg.getData();
        if (d == null || d.isEmpty()) return;
        String kind = val(d, "kind"), title = val(d, "title"), body = val(d, "body"), tag = val(d, "tag");
        if (MainActivity.visible) return; // приложение на экране — страница покажет сама
        switch (kind) {
            case "call":
                Notifier.call(this, title, body, tag.startsWith("call-") ? tag : "call-" + tag);
                break;
            case "missed":
                Notifier.cancelCalls(this);
                Notifier.message(this, title, body, tag);
                break;
            default:
                Notifier.message(this, title, body, tag);
                break;
        }
    }

    private static String val(Map<String, String> d, String k) {
        String v = d.get(k);
        return v == null ? "" : (v.length() > 400 ? v.substring(0, 400) : v);
    }
}
