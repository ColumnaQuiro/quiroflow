package com.quiroflow.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;

// QuiroFlow's home-screen widget on Android: the snapshot the app last wrote
// (HomeWidgetPlugin) -- for a patient the next visit and the bono, for the
// team today -- and how long ago. It never talks to the server. Tapping it
// opens the app.
public class QuiroFlowWidgetProvider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        String json = context.getSharedPreferences(HomeWidgetPlugin.PREFS, Context.MODE_PRIVATE).getString(HomeWidgetPlugin.KEY, null);
        for (int id : ids) manager.updateAppWidget(id, render(context, json));
    }

    private static RemoteViews render(Context context, String json) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.quiroflow_widget);
        Intent open = new Intent(context, MainActivity.class);
        v.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        try {
            if (json == null) throw new IllegalStateException("no snapshot");
            JSONObject s = new JSONObject(json);
            v.setTextViewText(R.id.widget_updated, age(s.optString("updatedAt")));
            if ("staff".equals(s.optString("kind"))) {
                JSONArray next = s.optJSONArray("next");
                long now = System.currentTimeMillis();
                JSONObject first = null;
                StringBuilder lines = new StringBuilder();
                int shown = 0;
                for (int i = 0; next != null && i < next.length(); i++) {
                    JSONObject n = next.getJSONObject(i);
                    long at = parseIso(n.optString("at"));
                    if (at + 15 * 60_000 < now) continue;
                    if (first == null) first = n;
                    else if (shown < 3) {
                        lines.append(n.optString("time")).append("  ").append(n.optString("name")).append(n.optBoolean("arrived") ? "  · en sala" : "").append('\n');
                        shown++;
                    }
                }
                v.setTextViewText(R.id.widget_title, "HOY · " + s.optString("who"));
                v.setTextViewText(R.id.widget_big, first != null ? first.optString("time") + "  " + first.optString("name") : "Nada más hoy");
                v.setTextViewText(R.id.widget_sub, s.optInt("remaining") + " quedan · " + s.optInt("done") + " hechas · " + s.optInt("arrived") + " en sala");
                v.setTextViewText(R.id.widget_lines, lines.toString().trim());
                v.setViewVisibility(R.id.widget_lines, lines.length() > 0 ? View.VISIBLE : View.GONE);
            } else {
                JSONObject n = s.optJSONObject("next");
                JSONObject b = s.optJSONObject("bono");
                v.setTextViewText(R.id.widget_title, "PRÓXIMA VISITA");
                v.setTextViewText(R.id.widget_big, n != null ? n.optString("label") : "Sin cita reservada");
                String who = n == null ? "" : join(n.optString("what", ""), n.optString("who", ""));
                v.setTextViewText(R.id.widget_sub, who.isEmpty() ? s.optString("clinic", "") : who);
                v.setTextViewText(R.id.widget_lines, b != null ? "Bono: quedan " + b.optInt("left") + " de " + b.optInt("total") : "");
                v.setViewVisibility(R.id.widget_lines, b != null ? View.VISIBLE : View.GONE);
            }
        } catch (Exception e) {
            v.setTextViewText(R.id.widget_title, "QUIROFLOW");
            v.setTextViewText(R.id.widget_big, "Abre la app");
            v.setTextViewText(R.id.widget_sub, "para ver aquí tu próxima visita o tu día.");
            v.setViewVisibility(R.id.widget_lines, View.GONE);
            v.setTextViewText(R.id.widget_updated, "");
        }
        return v;
    }

    private static String join(String a, String b) {
        if (a == null || a.isEmpty() || "null".equals(a)) return b == null || "null".equals(b) ? "" : b;
        if (b == null || b.isEmpty() || "null".equals(b)) return a;
        return a + " · " + b;
    }

    // The snapshot's instants are always JavaScript's toISOString()
    // ("2026-10-20T08:00:00.000Z"); java.time would need API 26, the app runs from 24.
    private static long parseIso(String iso) throws java.text.ParseException {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.parse(iso).getTime();
    }

    // "hace 5 min", "hace 2 h": how old the snapshot is.
    private static String age(String iso) {
        try {
            long minutes = Math.max(0, (System.currentTimeMillis() - parseIso(iso)) / 60_000);
            if (minutes < 1) return "ahora";
            if (minutes < 60) return "hace " + minutes + " min";
            if (minutes < 48 * 60) return "hace " + (minutes / 60) + " h";
            return "hace " + (minutes / 1440) + " días";
        } catch (Exception e) {
            return "";
        }
    }
}
