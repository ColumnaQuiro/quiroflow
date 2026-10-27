package com.quiroflow.app;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Calendar;
import java.util.TimeZone;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

// The home-screen widget fetching its own snapshot while the app is closed
// (server/api/widget/home.get.ts), as the iOS widget does: with the widget
// token the app got from issue_home_widget_token -- never the app's session,
// whose single-use refresh token the app must keep. The answer is exactly
// what the app would have written, mapped on the server by the same
// widgetSnapshotFromRpc, so nothing here interprets it.
//
// WorkManager, every 15 minutes (its floor; the widget's own
// updatePeriodMillis cannot go below 30), hourly between 22:00 and 07:00 in
// the clinic's clock. Android defers it further in Doze. Scheduled when the
// app hands over a token (HomeWidgetPlugin.setRefresh) or a widget is added
// with one already there; cancelled on sign-out, on a revoked token, and
// when the last widget is removed.
public class WidgetRefreshWorker extends Worker {
    private static final String WORK = "quiroflow-widget-refresh";
    static final String REFRESH_KEY = "refresh";
    private static final String LAST_KEY = "refreshedAt";

    public WidgetRefreshWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    static void schedule(Context context) {
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(WidgetRefreshWorker.class, 15, TimeUnit.MINUTES)
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, request);
    }

    static void cancel(Context context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK);
    }

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(HomeWidgetPlugin.PREFS, Context.MODE_PRIVATE);
    }

    /** What the app handed over (useHomeWidget.ts's WidgetRefresh), or null. */
    static JSONObject config(Context context) {
        try {
            String json = prefs(context).getString(REFRESH_KEY, null);
            return json == null ? null : new JSONObject(json);
        } catch (Exception e) {
            return null;
        }
    }

    static boolean hasToken(Context context) {
        JSONObject c = config(context);
        return c != null && !c.optString("token").isEmpty();
    }

    static boolean hasWidgets(Context context) {
        return AppWidgetManager.getInstance(context).getAppWidgetIds(new ComponentName(context, QuiroFlowWidgetProvider.class)).length > 0;
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        JSONObject c = config(context);
        if (c == null || c.optString("token").isEmpty()) {
            cancel(context);
            return Result.success();
        }
        if (!hasWidgets(context) || overnightAndRecent(context, c)) return Result.success();

        HttpURLConnection conn = null;
        try {
            Uri url = Uri.parse(c.getString("url")).buildUpon()
                .appendQueryParameter("account", c.optString("accountId"))
                .appendQueryParameter("tz", c.optString("timeZone"))
                .appendQueryParameter("lang", c.optString("lang"))
                .appendQueryParameter("privacy", c.optBoolean("privacy") ? "1" : "0")
                .build();
            conn = (HttpURLConnection) new URL(url.toString()).openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            conn.setUseCaches(false);
            conn.setRequestProperty("Authorization", "Bearer " + c.getString("token"));
            int status = conn.getResponseCode();
            SharedPreferences.Editor edit = prefs(context).edit();
            if (status == 200) {
                String body = read(conn.getInputStream());
                // Stored only if it is a snapshot at all; the widget lays it out.
                if (!new JSONObject(body).optString("kind").isEmpty()) edit.putString(HomeWidgetPlugin.KEY, body);
            } else if (status == 204) {
                // Nobody's day to show any more.
                edit.remove(HomeWidgetPlugin.KEY);
            } else if (status == 401) {
                // The session that issued the token has ended: signed out, or
                // revoked. Nothing on the phone is theirs to show now.
                edit.remove(HomeWidgetPlugin.KEY).remove(REFRESH_KEY);
                cancel(context);
            } else if (status == 403) {
                // A second factor is now required, or they left the team: the
                // figures wait for the app, which asks for the code.
                edit.remove(HomeWidgetPlugin.KEY);
            } else {
                // A server error: keep the last snapshot, with its age.
                return Result.success();
            }
            edit.putLong(LAST_KEY, System.currentTimeMillis()).apply();
            HomeWidgetPlugin.redraw(context);
        } catch (Exception e) {
            // Offline or slow: the widget keeps the last snapshot, with its age.
        } finally {
            if (conn != null) conn.disconnect();
        }
        return Result.success();
    }

    /** Overnight in the clinic's clock, once an hour is plenty. */
    private static boolean overnightAndRecent(Context context, JSONObject c) {
        Calendar now = Calendar.getInstance(TimeZone.getTimeZone(c.optString("timeZone", "Europe/Madrid")));
        int hour = now.get(Calendar.HOUR_OF_DAY);
        if (hour >= 7 && hour < 22) return false;
        return System.currentTimeMillis() - prefs(context).getLong(LAST_KEY, 0) < 55 * 60 * 1000L;
    }

    private static String read(InputStream in) throws Exception {
        try (InputStream s = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = s.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        }
    }
}
