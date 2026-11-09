package com.quiroflow.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingRequest;
import com.google.android.gms.location.LocationServices;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

// "Mis hábitos" on Android (HabitRemindersPlugin is the web app's side of it).
// One alarm per habit and time of day, set for its next occurrence; when it
// fires (HabitAlarmReceiver) the reminder is shown -- for a habit limited to
// places, only if the phone is at one of them -- and the next one is set.
// Geofences (HabitGeofenceReceiver) only keep which places the phone is at.
// Inexact alarms: a habit reminder a few minutes late is fine, and exact ones
// need a permission Google Play restricts to alarm clocks.
//
// Kept in this app's SharedPreferences, left out of Auto Backup like the
// widget's (xml/backup_rules.xml): a place is where someone lives.
final class HabitScheduler {
    static final String PREFS = "quiroflow_habits";
    static final String CHANNEL = "habits";
    static final String ACTION_FIRE = "com.quiroflow.app.HABIT_FIRE";
    static final String ACTION_DONE = "com.quiroflow.app.HABIT_DONE";
    static final String ACTION_SNOOZE = "com.quiroflow.app.HABIT_SNOOZE";
    static final String ACTION_OPEN = "com.quiroflow.app.HABIT_OPEN";
    private static final String KEY_CONFIG = "config";
    private static final String KEY_INSIDE = "inside";
    private static final String KEY_PENDING = "pending";
    private static final String KEY_SLOTS = "slots";

    private HabitScheduler() {}

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static JSONObject config(Context c) {
        try {
            return new JSONObject(prefs(c).getString(KEY_CONFIG, "{\"habits\":[],\"places\":[]}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static void apply(Context c, JSONObject config) {
        Set<String> gone = habitIds(config(c));
        gone.removeAll(habitIds(config));
        prefs(c).edit().putString(KEY_CONFIG, config.toString()).apply();
        rescheduleAll(c);
        syncGeofences(c);
        // A habit no longer configured -- deleted, or every one cleared
        // because the phone is now used as staff or signed out
        // (useHabitReminders().clear) -- leaves no banner behind. Its alarms
        // went in rescheduleAll; a snooze still set finds no habit and shows
        // nothing (HabitAlarmReceiver).
        NotificationManagerCompat nm = NotificationManagerCompat.from(c);
        for (String id : gone) nm.cancel(id.hashCode());
    }

    private static Set<String> habitIds(JSONObject config) {
        Set<String> ids = new HashSet<>();
        JSONArray habits = config.optJSONArray("habits");
        for (int i = 0; habits != null && i < habits.length(); i++) {
            JSONObject h = habits.optJSONObject(i);
            if (h != null) ids.add(h.optString("id"));
        }
        return ids;
    }

    static boolean hasLocation(Context c) {
        return ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    static boolean hasBackgroundLocation(Context c) {
        return hasLocation(c) && ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    // ---------------------------------------------------------------- alarms

    private static int requestCode(String habitId, String time) {
        return (habitId + "|" + time).hashCode();
    }

    private static PendingIntent fireIntent(Context c, String habitId, String time, int flags) {
        Intent i = new Intent(c, HabitAlarmReceiver.class).setAction(ACTION_FIRE).putExtra("habitId", habitId).putExtra("time", time);
        return PendingIntent.getBroadcast(c, requestCode(habitId, time), i, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Cancels every alarm set before, then sets one per habit and time. */
    static void rescheduleAll(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        Set<String> previous = prefs(c).getStringSet(KEY_SLOTS, new HashSet<>());
        for (String slot : previous) {
            String[] p = slot.split("\\|", 2);
            if (p.length == 2) {
                PendingIntent pi = fireIntent(c, p[0], p[1], PendingIntent.FLAG_NO_CREATE);
                if (pi != null) am.cancel(pi);
            }
        }
        Set<String> slots = new HashSet<>();
        JSONArray habits = config(c).optJSONArray("habits");
        for (int i = 0; habits != null && i < habits.length(); i++) {
            JSONObject h = habits.optJSONObject(i);
            JSONArray times = h.optJSONArray("times");
            for (int j = 0; times != null && j < times.length(); j++) {
                String time = times.optString(j);
                if (setNext(c, h, time)) slots.add(h.optString("id") + "|" + time);
            }
        }
        prefs(c).edit().putStringSet(KEY_SLOTS, slots).apply();
    }

    static JSONObject habit(Context c, String id) {
        JSONArray habits = config(c).optJSONArray("habits");
        for (int i = 0; habits != null && i < habits.length(); i++) {
            JSONObject h = habits.optJSONObject(i);
            if (h != null && id.equals(h.optString("id"))) return h;
        }
        return null;
    }

    /** The next time this habit's `time` falls on one of its weekdays, after now. */
    static boolean setNext(Context c, JSONObject h, String time) {
        String[] hm = time.split(":");
        if (hm.length != 2) return false;
        Set<Integer> weekdays = new HashSet<>();
        JSONArray wd = h.optJSONArray("weekdays");
        for (int k = 0; wd != null && k < wd.length(); k++) weekdays.add(wd.optInt(k));
        Calendar at = Calendar.getInstance();
        at.set(Calendar.HOUR_OF_DAY, Integer.parseInt(hm[0]));
        at.set(Calendar.MINUTE, Integer.parseInt(hm[1]));
        at.set(Calendar.SECOND, 0);
        at.set(Calendar.MILLISECOND, 0);
        for (int d = 0; d < 8; d++) {
            // Calendar: Sunday = 1. ISO: Monday = 1 ... Sunday = 7.
            int iso = ((at.get(Calendar.DAY_OF_WEEK) + 5) % 7) + 1;
            if (at.getTimeInMillis() > System.currentTimeMillis() + 30_000 && weekdays.contains(iso)) {
                AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at.getTimeInMillis(), fireIntent(c, h.optString("id"), time, PendingIntent.FLAG_UPDATE_CURRENT));
                return true;
            }
            at.add(Calendar.DAY_OF_MONTH, 1);
        }
        return false;
    }

    /** Whether a habit limited to places should remind now: the phone is at one of them. */
    static boolean dueHere(Context c, JSONObject h) {
        JSONArray placeIds = h.optJSONArray("placeIds");
        if (placeIds == null || placeIds.length() == 0) return true;
        // Without background location the phone cannot know: remind by time, as the app says.
        if (!hasBackgroundLocation(c)) return true;
        Set<String> inside = prefs(c).getStringSet(KEY_INSIDE, new HashSet<>());
        for (int i = 0; i < placeIds.length(); i++) if (inside.contains(placeIds.optString(i))) return true;
        return false;
    }

    // --------------------------------------------------------- notifications

    static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Mis hábitos", NotificationManager.IMPORTANCE_DEFAULT));
        }
    }

    private static PendingIntent actionIntent(Context c, String action, String habitId, int id) {
        Intent i = new Intent(c, HabitAlarmReceiver.class).setAction(action).putExtra("habitId", habitId).putExtra("notificationId", id);
        return PendingIntent.getBroadcast(c, (action + id).hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void show(Context c, JSONObject h) {
        if (ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED && Build.VERSION.SDK_INT >= 33) return;
        ensureChannel(c);
        String habitId = h.optString("id");
        int id = habitId.hashCode();
        Intent open = new Intent(c, MainActivity.class).setAction(ACTION_OPEN).putExtra("habitId", habitId).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPi = PendingIntent.getActivity(c, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(h.optString("title"))
            .setContentText(h.optString("body"))
            .setAutoCancel(true)
            .setContentIntent(openPi)
            .addAction(0, "Hecho", actionIntent(c, ACTION_DONE, habitId, id))
            .addAction(0, "En 15 min", actionIntent(c, ACTION_SNOOZE, habitId, id));
        try {
            NotificationManagerCompat.from(c).notify(id, b.build());
        } catch (SecurityException ignored) {
            // Notifications switched off since the check.
        }
    }

    static void snooze(Context c, String habitId) {
        Intent i = new Intent(c, HabitAlarmReceiver.class).setAction(ACTION_FIRE).putExtra("habitId", habitId).putExtra("snooze", true);
        PendingIntent pi = PendingIntent.getBroadcast(c, ("snooze" + habitId).hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + 15 * 60_000L, pi);
    }

    // --------------------------------------------------------------- "Hecho"

    static void recordDone(Context c, String habitId) {
        JSONObject h = habit(c, habitId);
        try {
            JSONArray pending = new JSONArray(prefs(c).getString(KEY_PENDING, "[]"));
            SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
            iso.setTimeZone(TimeZone.getTimeZone("UTC"));
            pending.put(new JSONObject()
                .put("habitId", habitId)
                .put("kind", h != null ? h.optString("kind", "otro") : "otro")
                .put("doneAt", iso.format(new java.util.Date()))
                .put("clientId", UUID.randomUUID().toString()));
            prefs(c).edit().putString(KEY_PENDING, pending.toString()).apply();
        } catch (Exception ignored) {
            // A lost tick; the streak shows whatever did arrive.
        }
    }

    static JSONArray takePending(Context c) {
        JSONArray pending;
        try {
            pending = new JSONArray(prefs(c).getString(KEY_PENDING, "[]"));
        } catch (Exception e) {
            pending = new JSONArray();
        }
        prefs(c).edit().remove(KEY_PENDING).apply();
        return pending;
    }

    // ------------------------------------------------------------- geofences

    static PendingIntent geofenceIntent(Context c) {
        Intent i = new Intent(c, HabitGeofenceReceiver.class);
        // Mutable: the system fills in which geofence and which transition.
        return PendingIntent.getBroadcast(c, 4711, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
    }

    @SuppressWarnings("MissingPermission")
    static void syncGeofences(Context c) {
        com.google.android.gms.location.GeofencingClient client = LocationServices.getGeofencingClient(c);
        client.removeGeofences(geofenceIntent(c));
        JSONObject config = config(c);
        Set<String> wanted = new HashSet<>();
        JSONArray habits = config.optJSONArray("habits");
        for (int i = 0; habits != null && i < habits.length(); i++) {
            JSONArray ids = habits.optJSONObject(i).optJSONArray("placeIds");
            for (int j = 0; ids != null && j < ids.length(); j++) wanted.add(ids.optString(j));
        }
        Set<String> inside = new HashSet<>(prefs(c).getStringSet(KEY_INSIDE, new HashSet<>()));
        inside.retainAll(wanted);
        prefs(c).edit().putStringSet(KEY_INSIDE, inside).apply();
        if (wanted.isEmpty() || !hasBackgroundLocation(c)) return;
        List<Geofence> fences = new ArrayList<>();
        JSONArray places = config.optJSONArray("places");
        for (int i = 0; places != null && i < places.length(); i++) {
            JSONObject p = places.optJSONObject(i);
            if (!wanted.contains(p.optString("id"))) continue;
            fences.add(new Geofence.Builder()
                .setRequestId(p.optString("id"))
                .setCircularRegion(p.optDouble("lat"), p.optDouble("lng"), (float) Math.max(100, p.optDouble("radius", 150)))
                .setExpirationDuration(Geofence.NEVER_EXPIRE)
                .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER | Geofence.GEOFENCE_TRANSITION_EXIT)
                .build());
        }
        if (fences.isEmpty()) return;
        GeofencingRequest request = new GeofencingRequest.Builder()
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)
            .addGeofences(fences)
            .build();
        client.addGeofences(request, geofenceIntent(c));
    }

    static void setInside(Context c, List<String> placeIds, boolean entered) {
        Set<String> inside = new HashSet<>(prefs(c).getStringSet(KEY_INSIDE, new HashSet<>()));
        if (entered) inside.addAll(placeIds);
        else inside.removeAll(placeIds);
        prefs(c).edit().putStringSet(KEY_INSIDE, inside).apply();
    }
}
