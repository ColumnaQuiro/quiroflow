package com.quiroflow.app;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import org.json.JSONObject;

// "HabitReminders" for the web app (mobile/composables/useHabitReminders.ts):
// "Mis hábitos" as local notifications, scheduled by HabitScheduler.
// Registered in MainActivity.
//
// Location comes in two steps, as Android requires: "while using the app"
// first, then "all the time" (Android 11+ sends the person to the app's
// settings page for that one). A habit limited to places needs the second.
@CapacitorPlugin(
    name = "HabitReminders",
    permissions = {
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "backgroundLocation", strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }),
    }
)
public class HabitRemindersPlugin extends Plugin {

    @Override
    public void load() {
        HabitScheduler.ensureChannel(getContext());
        handleOpen(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        handleOpen(intent);
    }

    private void handleOpen(Intent intent) {
        if (intent == null || !HabitScheduler.ACTION_OPEN.equals(intent.getAction())) return;
        JSObject data = new JSObject();
        data.put("habitId", intent.getStringExtra("habitId"));
        notifyListeners("habitOpened", data, true);
        intent.setAction(null);
    }

    @PluginMethod
    public void schedule(PluginCall call) {
        JSArray habits = call.getArray("habits");
        JSArray places = call.getArray("places");
        if (habits == null || places == null) {
            call.reject("habits and places are required");
            return;
        }
        try {
            HabitScheduler.apply(getContext(), new JSONObject().put("habits", habits).put("places", places));
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not schedule the habits: " + e.getMessage());
        }
    }

    private String locationState() {
        if (HabitScheduler.hasBackgroundLocation(getContext())) return "always";
        if (HabitScheduler.hasLocation(getContext())) return "whenInUse";
        return getPermissionState("location") == PermissionState.DENIED ? "denied" : "prompt";
    }

    private String notificationState() {
        if (Build.VERSION.SDK_INT < 33) return "granted";
        PermissionState s = getPermissionState("notifications");
        return s == PermissionState.GRANTED ? "granted" : s == PermissionState.DENIED ? "denied" : "prompt";
    }

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        JSObject r = new JSObject();
        r.put("notifications", notificationState());
        r.put("location", locationState());
        call.resolve(r);
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            JSObject r = new JSObject();
            r.put("notifications", notificationState());
            call.resolve(r);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsCallback");
    }

    @PermissionCallback
    private void notificationsCallback(PluginCall call) {
        JSObject r = new JSObject();
        r.put("notifications", notificationState());
        call.resolve(r);
    }

    @PluginMethod
    public void requestLocationAlways(PluginCall call) {
        if (!HabitScheduler.hasLocation(getContext())) {
            requestPermissionForAlias("location", call, "locationCallback");
            return;
        }
        locationCallback(call);
    }

    @PermissionCallback
    private void locationCallback(PluginCall call) {
        if (HabitScheduler.hasLocation(getContext()) && !HabitScheduler.hasBackgroundLocation(getContext())) {
            requestPermissionForAlias("backgroundLocation", call, "backgroundCallback");
            return;
        }
        backgroundCallback(call);
    }

    @PermissionCallback
    private void backgroundCallback(PluginCall call) {
        // Granted now: the places start counting at once.
        HabitScheduler.syncGeofences(getContext());
        JSObject r = new JSObject();
        r.put("location", locationState());
        call.resolve(r);
    }

    @PluginMethod
    @SuppressWarnings("MissingPermission")
    public void currentPosition(PluginCall call) {
        if (!HabitScheduler.hasLocation(getContext())) {
            requestPermissionForAlias("location", call, "positionCallback");
            return;
        }
        positionCallback(call);
    }

    @PermissionCallback
    @SuppressWarnings("MissingPermission")
    private void positionCallback(PluginCall call) {
        if (!HabitScheduler.hasLocation(getContext())) {
            call.reject("Location not allowed");
            return;
        }
        LocationServices.getFusedLocationProviderClient(getContext())
            .getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
            .addOnSuccessListener((loc) -> {
                if (loc == null) {
                    call.reject("No location");
                    return;
                }
                JSObject r = new JSObject();
                r.put("lat", loc.getLatitude());
                r.put("lng", loc.getLongitude());
                call.resolve(r);
            })
            .addOnFailureListener((e) -> call.reject(e.getMessage()));
    }

    @PluginMethod
    public void takePendingCheckins(PluginCall call) {
        JSObject r = new JSObject();
        r.put("checkins", HabitScheduler.takePending(getContext()));
        call.resolve(r);
    }
}
