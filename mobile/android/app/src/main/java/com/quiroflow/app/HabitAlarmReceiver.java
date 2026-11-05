package com.quiroflow.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.app.NotificationManagerCompat;
import org.json.JSONObject;

// A "Mis hábitos" alarm going off, or one of its notification's buttons
// (HabitScheduler sets both up). The alarm shows the reminder when it is due
// here and sets the next one; "Hecho" is kept for the app to send when it
// next opens; "En 15 min" sets a one-off alarm.
public class HabitAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String habitId = intent.getStringExtra("habitId");
        if (habitId == null || intent.getAction() == null) return;
        int notificationId = intent.getIntExtra("notificationId", habitId.hashCode());
        switch (intent.getAction()) {
            case HabitScheduler.ACTION_FIRE: {
                JSONObject h = HabitScheduler.habit(context, habitId);
                if (h == null) return;
                if (HabitScheduler.dueHere(context, h)) HabitScheduler.show(context, h);
                String time = intent.getStringExtra("time");
                if (time != null && !intent.getBooleanExtra("snooze", false)) HabitScheduler.setNext(context, h, time);
                break;
            }
            case HabitScheduler.ACTION_DONE:
                HabitScheduler.recordDone(context, habitId);
                NotificationManagerCompat.from(context).cancel(notificationId);
                break;
            case HabitScheduler.ACTION_SNOOZE:
                HabitScheduler.snooze(context, habitId);
                NotificationManagerCompat.from(context).cancel(notificationId);
                break;
            default:
                break;
        }
    }
}
