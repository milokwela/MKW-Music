package ru.mkwmusic.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** Виджет: квадрат с обложкой (2×2). Общая логика — в WidgetKit. */
public class CoverWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        m.updateAppWidget(ids, WidgetKit.build(c, WidgetKit.COVER));
    }
}
