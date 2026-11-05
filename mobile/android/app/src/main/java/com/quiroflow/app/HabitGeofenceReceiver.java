package com.quiroflow.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingEvent;
import java.util.ArrayList;
import java.util.List;

// The phone arriving at, or leaving, a place saved for "Mis hábitos". Only
// keeps which places it is at; the habit's alarm reads that when it fires
// (HabitScheduler.dueHere).
public class HabitGeofenceReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        GeofencingEvent event = GeofencingEvent.fromIntent(intent);
        if (event == null || event.hasError() || event.getTriggeringGeofences() == null) return;
        int transition = event.getGeofenceTransition();
        if (transition != Geofence.GEOFENCE_TRANSITION_ENTER && transition != Geofence.GEOFENCE_TRANSITION_EXIT) return;
        List<String> ids = new ArrayList<>();
        for (Geofence g : event.getTriggeringGeofences()) ids.add(g.getRequestId());
        HabitScheduler.setInside(context, ids, transition == Geofence.GEOFENCE_TRANSITION_ENTER);
    }
}
