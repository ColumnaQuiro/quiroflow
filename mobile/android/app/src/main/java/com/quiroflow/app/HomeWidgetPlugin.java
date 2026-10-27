package com.quiroflow.app;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

// "HomeWidget" for the web app (mobile/composables/useHomeWidget.ts): keeps
// the home-screen widget's snapshot (utils/homeWidget.ts) in this app's
// SharedPreferences and asks the widget to redraw. Registered in MainActivity.
// It also keeps what the widget needs to fetch the snapshot itself while the
// app is closed (WidgetRefreshWorker). Those prefs are left out of Auto
// Backup (xml/backup_rules.xml): restored onto another phone, a widget token
// would show this person's clinic there before anyone signed in.
@CapacitorPlugin(name = "HomeWidget")
public class HomeWidgetPlugin extends Plugin {
    static final String PREFS = "quiroflow_widget";
    static final String KEY = "snapshot";

    @PluginMethod
    public void setSnapshot(PluginCall call) {
        String json = call.getString("json");
        if (json == null) {
            call.reject("json is required");
            return;
        }
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply();
        redraw(getContext());
        call.resolve();
    }

    /**
     * Where and how the widget fetches its own snapshot. A call without a
     * token keeps the one already there (the settings change more often than
     * the session does) and reports whether there is one.
     */
    @PluginMethod
    public void setRefresh(PluginCall call) {
        String url = call.getString("url");
        String accountId = call.getString("accountId");
        if (url == null || accountId == null) {
            call.reject("url and accountId are required");
            return;
        }
        Context context = getContext();
        JSONObject previous = WidgetRefreshWorker.config(context);
        String token = call.getString("token", previous == null ? null : previous.optString("token", null));
        JSONObject config = new JSONObject();
        try {
            config.put("url", url);
            config.put("accountId", accountId);
            config.put("timeZone", call.getString("timeZone", "Europe/Madrid"));
            config.put("lang", call.getString("lang", "es"));
            config.put("privacy", Boolean.TRUE.equals(call.getBoolean("privacy", false)));
            if (token != null && !token.isEmpty()) config.put("token", token);
        } catch (Exception e) {
            call.reject("bad refresh settings");
            return;
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(WidgetRefreshWorker.REFRESH_KEY, config.toString()).apply();
        boolean hasToken = config.has("token");
        if (hasToken && WidgetRefreshWorker.hasWidgets(context)) WidgetRefreshWorker.schedule(context);
        JSObject result = new JSObject();
        result.put("hasToken", hasToken);
        call.resolve(result);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY).remove(WidgetRefreshWorker.REFRESH_KEY).apply();
        WidgetRefreshWorker.cancel(getContext());
        redraw(getContext());
        call.resolve();
    }

    static void redraw(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, QuiroFlowWidgetProvider.class));
        if (ids.length == 0) return;
        Intent intent = new Intent(context, QuiroFlowWidgetProvider.class);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        context.sendBroadcast(intent);
    }
}
