package ru.mkwmusic.app;

import android.content.Context;
import android.view.View;
import android.webkit.WebView;

/**
 * WebView, который не «засыпает», пока играет музыка. Обычно при сворачивании приложения или выключении экрана
 * страница узнаёт, что её не видно, и видео-плеер ставит трек на паузу. Пока работает служба музыки (hold),
 * мы не сообщаем странице о скрытии — и трек продолжает играть. Когда музыка остановлена, всё как обычно:
 * страница засыпает и не тратит батарею.
 */
public class BgWebView extends WebView {
    private boolean hold;
    private int real = View.VISIBLE;

    public BgWebView(Context c) {
        super(c);
    }

    @Override
    protected void onWindowVisibilityChanged(int visibility) {
        real = visibility;
        super.onWindowVisibilityChanged(hold ? View.VISIBLE : visibility);
    }

    void setHold(boolean h) {
        if (hold == h) return;
        hold = h;
        super.onWindowVisibilityChanged(h ? View.VISIBLE : real);
    }
}
