package ru.mkwmusic.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** Виджет: плеер с перемоткой (4×2). Общая логика — в WidgetKit. */
public class SeekWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        m.updateAppWidget(ids, WidgetKit.build(c, WidgetKit.SEEK));
    }
}
