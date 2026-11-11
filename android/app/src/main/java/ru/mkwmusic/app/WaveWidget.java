package ru.mkwmusic.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** Виджет: «MKW Волна» (4×3). Общая логика — в WidgetKit. */
public class WaveWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        m.updateAppWidget(ids, WidgetKit.build(c, WidgetKit.WAVE));
    }
}
