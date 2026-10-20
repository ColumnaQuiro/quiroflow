package com.quiroflow.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;

// QuiroFlow's home-screen widget on Android: the snapshot the app last wrote
// (HomeWidgetPlugin, utils/homeWidget.ts) and how long ago. It never talks to
// the server. What it holds depends on who is signed in, as get_home_widget
// decided:
//   patient -- the next visit and the bono;
//   clinic  -- an owner: money taken this month, visits done of booked today,
//              bonos sold this month, each figure its own tap at 4x2;
//   staff   -- a practitioner's own day, or the front desk's clinic day.
// Words come in the snapshot, in the person's language; the Spanish here is a
// fallback. Taps open quiroflow://widget/... links in MainActivity, where
// Capacitor's App plugin hands them to mobile/plugins/widget-links.client.ts.
public class QuiroFlowWidgetProvider extends AppWidgetProvider {
    /** At this width and up the owner's figures get a column each. */
    private static final int MEDIUM_MIN_WIDTH_DP = 250;

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) update(context, manager, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        update(context, manager, id);
    }

    private static void update(Context context, AppWidgetManager manager, int id) {
        String json = context.getSharedPreferences(HomeWidgetPlugin.PREFS, Context.MODE_PRIVATE).getString(HomeWidgetPlugin.KEY, null);
        JSONObject s = null;
        try {
            if (json != null) s = new JSONObject(json);
        } catch (Exception ignored) {
        }
        if (s != null && "clinic".equals(s.optString("kind"))) {
            if (Build.VERSION.SDK_INT >= 31) {
                // The launcher picks the layout for each size the widget is shown at.
                Map<SizeF, RemoteViews> sizes = new HashMap<>();
                sizes.put(new SizeF(110f, 110f), clinic(context, s, false));
                sizes.put(new SizeF(MEDIUM_MIN_WIDTH_DP, 110f), clinic(context, s, true));
                manager.updateAppWidget(id, new RemoteViews(sizes));
            } else {
                Bundle options = manager.getAppWidgetOptions(id);
                int width = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, MEDIUM_MIN_WIDTH_DP);
                manager.updateAppWidget(id, clinic(context, s, width >= MEDIUM_MIN_WIDTH_DP));
            }
            return;
        }
        manager.updateAppWidget(id, render(context, s));
    }

    // --- Taps ---------------------------------------------------------------

    private static PendingIntent open(Context context, String link, int requestCode) {
        Intent intent = new Intent(context, MainActivity.class);
        if (link != null && link.startsWith("quiroflow://widget/")) {
            intent.setAction(Intent.ACTION_VIEW);
            intent.setData(Uri.parse(link));
        }
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    // --- An owner's clinic figures -----------------------------------------

    private static RemoteViews clinic(Context context, JSONObject s, boolean medium) {
        RemoteViews v = new RemoteViews(context.getPackageName(), medium ? R.layout.quiroflow_widget_clinic : R.layout.quiroflow_widget_clinic_small);
        Freshness f = new Freshness(s);
        if (f.expired()) return placeholder(context, s);
        JSONObject money = s.optJSONObject("money");
        JSONObject patients = s.optJSONObject("patients");
        JSONObject bonos = s.optJSONObject("bonos");
        if (money == null || patients == null || bonos == null) return placeholder(context, s);

        age(context, v, s, f);
        String patientsValue = f.sameDay ? patients.optInt("done") + "/" + patients.optInt("total") : "—";
        String moneyValue = f.sameMonth ? money.optString("value") : "—";
        String bonosValue = f.sameMonth ? String.valueOf(bonos.optInt("count")) : "—";
        v.setTextViewText(R.id.clinic_money, moneyValue);
        v.setTextViewText(R.id.clinic_patients, patientsValue);
        v.setTextViewText(R.id.clinic_bonos, bonosValue);
        v.setTextViewText(R.id.clinic_patients_label, patients.optString("label"));

        if (!medium) {
            v.setTextViewText(R.id.widget_title, s.optString("clinic", "QuiroFlow"));
            v.setTextViewText(R.id.clinic_money_label, money.optString("smallLabel"));
            v.setTextViewText(R.id.clinic_bonos_label, bonos.optString("smallLabel"));
            v.setOnClickPendingIntent(R.id.widget_root, open(context, s.optString("link", null), 1));
            return v;
        }

        v.setTextViewText(R.id.widget_title, s.optString("title", s.optString("clinic", "QuiroFlow")));
        v.setTextViewText(R.id.clinic_money_label, money.optString("label"));
        v.setTextViewText(R.id.clinic_bonos_label, bonos.optString("label"));
        String range;
        if (f.sameDay) range = money.optString("range");
        else if (!f.sameMonth) range = "";
        else if (f.yesterday) range = label(s, "untilYesterday", "hasta ayer", null);
        else range = label(s, "untilDate", "hasta el %@", s.optString("dateLabel", ""));
        v.setTextViewText(R.id.clinic_money_note, range);
        int total = Math.max(1, patients.optInt("total"));
        v.setProgressBar(R.id.clinic_patients_bar, 100, f.sameDay ? Math.round(100f * patients.optInt("done") / total) : 0, false);
        v.setTextViewText(R.id.clinic_patients_note, f.sameDay ? patients.optString("note") : label(s, "noToday", "sin datos de hoy", null));
        v.setTextViewText(R.id.clinic_bonos_note, f.sameMonth ? bonos.optString("value") : "");
        v.setOnClickPendingIntent(R.id.widget_root, open(context, s.optString("link", null), 1));
        v.setOnClickPendingIntent(R.id.col_money, open(context, money.optString("link", null), 2));
        v.setOnClickPendingIntent(R.id.col_patients, open(context, patients.optString("link", null), 3));
        v.setOnClickPendingIntent(R.id.col_bonos, open(context, bonos.optString("link", null), 4));
        return v;
    }

    // --- A patient, or a day of visits --------------------------------------

    private static RemoteViews render(Context context, JSONObject s) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.quiroflow_widget);
        v.setOnClickPendingIntent(R.id.widget_root, open(context, null, 0));
        try {
            if (s == null) throw new IllegalStateException("no snapshot");
            Freshness f = new Freshness(s);
            if (f.expired()) return placeholder(context, s);
            age(context, v, s, f);
            if ("staff".equals(s.optString("kind"))) {
                boolean desk = "clinic".equals(s.optString("scope"));
                v.setOnClickPendingIntent(R.id.widget_root, open(context, s.optString("link", null), 1));
                v.setTextViewText(R.id.widget_title, s.optString("title"));
                if (!f.sameDay) {
                    v.setTextViewText(R.id.widget_big, label(s, "noToday", "sin datos de hoy", null));
                    v.setTextViewText(R.id.widget_sub, "");
                    v.setViewVisibility(R.id.widget_lines, View.GONE);
                    return v;
                }
                JSONArray next = s.optJSONArray("next");
                long now = System.currentTimeMillis();
                JSONObject first = null;
                StringBuilder lines = new StringBuilder();
                int shown = 0;
                String room = label(s, "inRoom", "En sala", null);
                for (int i = 0; next != null && i < next.length(); i++) {
                    JSONObject n = next.getJSONObject(i);
                    long at = parseIso(n.optString("at"));
                    if (at + 15 * 60_000 < now) continue;
                    if (first == null) first = n;
                    else if (shown < 3) {
                        String with = desk ? clean(n.optString("with", "")) : "";
                        lines.append(n.optString("time")).append("  ").append(n.optString("name"));
                        if (n.optBoolean("arrived")) lines.append("  · ").append(room.toLowerCase(Locale.ROOT));
                        if (!with.isEmpty()) lines.append("  · ").append(with);
                        lines.append('\n');
                        shown++;
                    }
                }
                String firstLine = "";
                if (first != null) {
                    String with = desk ? clean(first.optString("with", "")) : "";
                    firstLine = first.optString("time") + "  " + first.optString("name") + (with.isEmpty() ? "" : "  · " + with);
                }
                int remaining = s.optInt("remaining");
                int arrived = s.optInt("arrived");
                int done = s.optInt("done");
                v.setTextViewText(R.id.widget_big, first != null ? firstLine : label(s, "nothingMore", "Nada más hoy", null));
                v.setTextViewText(R.id.widget_sub, desk
                    ? Math.max(0, remaining - arrived) + " " + label(s, "toArrive", "por llegar", null) + " · " + arrived + " " + label(s, "waiting", "en sala", null) + " · " + done + " " + label(s, "done", "hechas", null)
                    : remaining + " " + label(s, "left", "quedan", null) + " · " + done + " " + label(s, "done", "hechas", null) + " · " + arrived + " " + label(s, "waiting", "en sala", null));
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
            return placeholder(context, s);
        }
        return v;
    }

    private static RemoteViews placeholder(Context context, JSONObject s) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.quiroflow_widget);
        v.setOnClickPendingIntent(R.id.widget_root, open(context, null, 0));
        v.setTextViewText(R.id.widget_title, "QUIROFLOW");
        if (s != null && s.optJSONObject("labels") != null) {
            v.setTextViewText(R.id.widget_big, label(s, "openToUpdate", "Abre QuiroFlow para actualizar", null));
            v.setTextViewText(R.id.widget_sub, "");
        } else {
            v.setTextViewText(R.id.widget_big, "Abre la app");
            v.setTextViewText(R.id.widget_sub, "para ver aquí tu próxima visita o tu día.");
        }
        v.setViewVisibility(R.id.widget_lines, View.GONE);
        v.setTextViewText(R.id.widget_updated, "");
        return v;
    }

    // --- Words, times, freshness --------------------------------------------

    /** One of the snapshot's words, with its %d / %@ filled. */
    private static String label(JSONObject s, String key, String fallback, String arg) {
        JSONObject labels = s == null ? null : s.optJSONObject("labels");
        String text = labels != null ? labels.optString(key, fallback) : fallback;
        if (arg == null) return text;
        return text.replace("%d", arg).replace("%@", arg);
    }

    private static String clean(String s) {
        return s == null || "null".equals(s) ? "" : s;
    }

    private static String join(String a, String b) {
        if (a == null || a.isEmpty() || "null".equals(a)) return b == null || "null".equals(b) ? "" : b;
        if (b == null || b.isEmpty() || "null".equals(b)) return a;
        return a + " · " + b;
    }

    // The snapshot's instants are always JavaScript's toISOString()
    // ("2026-10-20T08:00:00.000Z").
    private static long parseIso(String iso) throws java.text.ParseException {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.parse(iso).getTime();
    }

    /** "hace 5 min", "Actualizado ayer, 21:14" -- amber when over two hours old. */
    private static void age(Context context, RemoteViews v, JSONObject s, Freshness f) {
        String text;
        if (!f.sameDay) {
            String time = s.optString("updatedTime", "");
            text = f.yesterday && !time.isEmpty()
                ? label(s, "updatedYesterday", "Actualizado ayer, %@", time)
                : label(s, "daysAgo", "hace %d días", String.valueOf(Math.max(1, f.minutes / 1440)));
        } else if (f.minutes < 1) text = label(s, "now", "ahora", null);
        else if (f.minutes < 60) text = label(s, "minAgo", "hace %d min", String.valueOf(f.minutes));
        else text = label(s, "hoursAgo", "hace %d h", String.valueOf(f.minutes / 60));
        v.setTextViewText(R.id.widget_updated, text);
        v.setTextColor(R.id.widget_updated, context.getColor(f.stale() ? R.color.widget_warn : R.color.widget_faint));
    }

    /** How old a snapshot is, in the clinic's own days: "today" is only today's on that day. */
    private static final class Freshness {
        final long minutes;
        final boolean sameDay;
        final boolean sameMonth;
        final boolean yesterday;

        Freshness(JSONObject s) {
            long now = System.currentTimeMillis();
            long updated;
            try {
                updated = parseIso(s.optString("updatedAt"));
            } catch (Exception e) {
                updated = now;
            }
            minutes = Math.max(0, (now - updated) / 60_000);
            String tz = s.optString("timeZone", "");
            SimpleDateFormat day = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT);
            day.setTimeZone(tz.isEmpty() ? TimeZone.getDefault() : TimeZone.getTimeZone(tz));
            String today = day.format(new Date(now));
            String snapDay = s.optString("date", "");
            if (snapDay.isEmpty()) snapDay = day.format(new Date(updated));
            sameDay = snapDay.equals(today);
            sameMonth = snapDay.length() >= 7 && snapDay.substring(0, 7).equals(today.substring(0, 7));
            yesterday = snapDay.equals(day.format(new Date(now - 24L * 60 * 60_000)));
        }

        boolean expired() {
            return minutes > 7L * 24 * 60;
        }

        boolean stale() {
            return sameDay && minutes > 120;
        }
    }
}
