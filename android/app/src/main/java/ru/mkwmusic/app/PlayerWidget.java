package ru.mkwmusic.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** Виджет «мини-плеер» (4×1). Общая логика — в WidgetKit. */
public class PlayerWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        m.updateAppWidget(ids, WidgetKit.build(c, WidgetKit.MINI));
    }
}
