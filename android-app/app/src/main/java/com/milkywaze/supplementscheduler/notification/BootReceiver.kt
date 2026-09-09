package com.milkywaze.supplementscheduler.notification

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Re-registers exact alarms after a reboot, since AlarmManager alarms don't
 * survive a device restart.
 *
 * TODO: inject the repository/scheduler once background work-manager sync is added;
 * for now this is a placeholder hook wired into the manifest.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        // Re-scheduling logic will read all active schedules from Room
        // and call ReminderScheduler.scheduleWeekly(...) for each.
    }
}
