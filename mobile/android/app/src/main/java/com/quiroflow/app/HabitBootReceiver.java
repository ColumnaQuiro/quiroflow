package com.quiroflow.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

// Alarms and geofences do not survive a restart or an app update, and a
// change of time zone moves every "09:00": set them all again from the saved
// "Mis hábitos" (HabitScheduler).
public class HabitBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        HabitScheduler.rescheduleAll(context);
        HabitScheduler.syncGeofences(context);
    }
}
